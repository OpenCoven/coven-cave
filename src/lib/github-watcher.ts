import { createItem, loadInbox } from "@/lib/cave-inbox";
import { broadcastCreated } from "@/lib/inbox-scheduler";
import { resolveGitHubToken } from "@/lib/github-token";
import { withinDeadline } from "./async-deadline.ts";
import {
  diffCompletedRuns,
  diffOpenedPrs,
  loadSubscriptions,
  patchSubscriptions,
  updateCursor,
  type GithubSubscriptions,
  type SubscriptionsPatch,
  type PrLike,
  type RunLike,
} from "@/lib/github-subscriptions";

/**
 * GitHub event watcher — polls watched repos for newly opened PRs and
 * completed CI (workflow) runs and delivers them as Cave inbox notifications
 * through the existing bell SSE stream.
 *
 * Token-gated: polling spends REST quota per repo per tick, which the public
 * 60/hr budget can't absorb (same reasoning as the activity route's check
 * enrichment). No PAT → the watcher idles.
 *
 * One process-local owner survives hot reloads. Configuration transitions
 * cancel reads and drain admitted persistence before changing subscriptions.
 */

const TICK_MS = 60_000;
const READ_TIMEOUT_MS = 8_000;
const GH = "https://api.github.com";
// Per repo per tick — a storm (e.g. cursor loss) can't flood the inbox.
const MAX_NOTIFICATIONS_PER_REPO = 10;

type WatcherState = {
  started: boolean;
  suspended: boolean;
  timer?: ReturnType<typeof setInterval>;
  read?: AbortController;
  write?: Promise<void>;
  transition: Promise<unknown>;
};

declare global {
  // eslint-disable-next-line no-var
  var __githubWatcher: WatcherState | undefined;
}

function watcherState(): WatcherState {
  return globalThis.__githubWatcher ??= {
    started: false, suspended: false, transition: Promise.resolve(),
  };
}

function eligible(subs: GithubSubscriptions): boolean {
  return subs.enabled && subs.repos.length > 0 && (subs.events.prOpened || subs.events.ciCompleted);
}

function clearPollingTimer(state: WatcherState): void {
  if (state.timer !== undefined) clearInterval(state.timer);
  state.timer = undefined;
}

async function ghFetch(path: string, token: string, owner: AbortSignal): Promise<unknown> {
  // Include body consumption: a partial response must not hold the shared
  // tick forever. Only the winning read reaches notification/cursor effects.
  const result = await withinDeadline(async (signal) => {
    const res = await fetch(`${GH}${path}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
      signal,
    });
    if (signal.aborted || !res.ok) {
      void res.body?.cancel().catch(() => undefined);
      return null;
    }
    return res.json();
  }, Date.now() + READ_TIMEOUT_MS, { signal: owner });
  return result.state === "ready" ? result.value : null;
}

async function notify(input: {
  title: string;
  body: string;
  url: string;
  auto: string;
}, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  // Dedup on the auto tag: cursor loss (deleted store) must not re-notify
  // events that are still sitting in the inbox.
  const file = await loadInbox();
  if (signal.aborted || file.items.some((item) => item.auto === input.auto)) return;
  await persist(async () => {
    const item = await createItem({
      kind: "agent",
      title: input.title,
      body: input.body,
      source: "system",
      link: { kind: "url", ref: input.url },
      auto: input.auto,
    });
    // An admitted write is drained, never replayed or reported as cancelled.
    broadcastCreated(item);
  });
}

async function persist(work: () => Promise<void>): Promise<void> {
  const state = watcherState();
  const write = work();
  state.write = write;
  try {
    await write;
  } finally {
    if (state.write === write) state.write = undefined;
  }
}

async function pollRepo(
  repo: string,
  token: string,
  events: { prOpened: boolean; ciCompleted: boolean },
  cursor: { prOpenedAt?: string | null; ciCompletedAt?: string | null; seenRunIds?: number[] },
  signal: AbortSignal,
): Promise<void> {
  let prCursor = cursor.prOpenedAt ?? null;
  let ciCursor = cursor.ciCompletedAt ?? null;
  let seenRunIds = cursor.seenRunIds ?? [];

  if (events.prOpened) {
    const data = (await ghFetch(
      `/repos/${repo}/pulls?state=open&sort=created&direction=desc&per_page=20`,
      token,
      signal,
    )) as PrLike[] | null;
    if (Array.isArray(data)) {
      const { fresh, nextCursor } = diffOpenedPrs(data, prCursor);
      for (const pr of fresh.slice(-MAX_NOTIFICATIONS_PER_REPO)) {
        await notify({
          title: `PR opened in ${repo}: #${pr.number} ${pr.title}`,
          body: pr.user?.login ? `Opened by @${pr.user.login}${pr.draft ? " (draft)" : ""}` : "",
          url: pr.html_url,
          auto: `github-sub:pr-opened:${repo}#${pr.number}`,
        }, signal);
      }
      prCursor = nextCursor ?? prCursor;
    }
  }

  if (events.ciCompleted && !signal.aborted) {
    const data = (await ghFetch(
      `/repos/${repo}/actions/runs?status=completed&per_page=20`,
      token,
      signal,
    )) as { workflow_runs?: RunLike[] } | null;
    const runs = Array.isArray(data?.workflow_runs) ? data.workflow_runs : null;
    if (runs) {
      const { fresh, nextCursor, nextSeenIds } = diffCompletedRuns(runs, ciCursor, seenRunIds);
      for (const run of fresh.slice(-MAX_NOTIFICATIONS_PER_REPO)) {
        const verdict = run.conclusion === "success" ? "passed" : `${run.conclusion}`;
        const name = run.name ?? "CI";
        const what = run.display_title ? ` — ${run.display_title}` : "";
        await notify({
          title: `CI ${verdict} in ${repo}: ${name}${what}`,
          body: run.head_branch ? `Branch ${run.head_branch}` : "",
          url: run.html_url,
          auto: `github-sub:ci:${repo}:${run.id}`,
        }, signal);
      }
      ciCursor = nextCursor ?? ciCursor;
      seenRunIds = nextSeenIds;
    }
  }

  if (signal.aborted) return;
  await persist(() => updateCursor(repo, {
    prOpenedAt: prCursor, ciCompletedAt: ciCursor, seenRunIds,
  }));
}

export async function tickGithubWatcher(): Promise<void> {
  const state = watcherState();
  if (state.suspended || state.read) return;
  const controller = new AbortController();
  state.read = controller;
  try {
    const subs = await loadSubscriptions();
    if (controller.signal.aborted) return;
    if (!eligible(subs)) {
      clearPollingTimer(state);
      return;
    }
    const token = resolveGitHubToken();
    if (!token) return;
    for (const repo of subs.repos) {
      if (controller.signal.aborted) return;
      try {
        await pollRepo(repo, token, subs.events, subs.cursors[repo] ?? {}, controller.signal);
      } catch {
        // One repo failing (deleted, no access, network) must not stall the rest.
      }
    }
  } finally {
    if (state.read === controller) state.read = undefined;
  }
}

function activate(state: WatcherState, subs: GithubSubscriptions | null): void {
  state.suspended = false;
  if (subs && !eligible(subs)) return;
  // Unknown settings retain one slow read retry. Only confirmed ineligibility
  // stops polling; never use unavailable data to admit network or write work.
  if (subs) void tickGithubWatcher().catch(() => undefined);
  state.timer = setInterval(() => {
    void tickGithubWatcher().catch(() => undefined);
  }, TICK_MS);
  state.timer.unref?.();
}

function transition<T>(work: (state: WatcherState) => Promise<T>): Promise<T> {
  const state = watcherState();
  const next = state.transition.then(() => work(state), () => work(state));
  state.transition = next.catch(() => undefined);
  return next;
}

async function suspend(state: WatcherState): Promise<void> {
  state.suspended = true;
  clearPollingTimer(state);
  state.read?.abort();
  state.read = undefined;
  // Filesystem writes cannot be safely cancelled. Configuration is not
  // acknowledged until admitted effects settle; failures are not replayed.
  await state.write?.catch(() => undefined);
}

export function startGithubWatcher(): Promise<void> {
  return transition(async (state) => {
    if (state.started) return;
    const subs = await loadSubscriptions().catch(() => null);
    state.started = true;
    activate(state, subs);
  });
}

export function stopGithubWatcher(): Promise<void> {
  return transition(async (state) => {
    await suspend(state);
    state.started = false;
  });
}

/** The subscription route uses this boundary instead of racing save and tick. */
export function configureGithubWatcher(patch: SubscriptionsPatch): Promise<GithubSubscriptions> {
  return transition(async (state) => {
    await suspend(state);
    state.started = true;
    try {
      const subs = await patchSubscriptions(patch);
      activate(state, subs);
      return subs;
    } catch (error) {
      // A rejected save does not silently leave a previously enabled watcher off.
      activate(state, await loadSubscriptions().catch(() => null));
      throw error;
    }
  });
}
