import { createItem, loadInbox } from "@/lib/cave-inbox";
import { broadcastCreated } from "@/lib/inbox-scheduler";
import { resolveGitHubToken } from "@/lib/github-token";
import {
  diffCompletedRuns,
  diffOpenedPrs,
  loadSubscriptions,
  updateCursor,
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
 * Same globalThis singleton pattern as inbox-scheduler so dev hot-reloads
 * don't stack intervals.
 */

const TICK_MS = 60_000;
const GH = "https://api.github.com";
// Per repo per tick — a storm (e.g. cursor loss) can't flood the inbox.
const MAX_NOTIFICATIONS_PER_REPO = 10;

declare global {
  // eslint-disable-next-line no-var
  var __githubWatcherStarted: boolean | undefined;
  // eslint-disable-next-line no-var
  var __githubWatcherTicking: boolean | undefined;
}

async function ghFetch(path: string, token: string): Promise<unknown> {
  const res = await fetch(`${GH}${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      Authorization: `Bearer ${token}`,
    },
    cache: "no-store",
  });
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

async function notify(input: {
  title: string;
  body: string;
  url: string;
  auto: string;
}): Promise<void> {
  // Dedup on the auto tag: cursor loss (deleted store) must not re-notify
  // events that are still sitting in the inbox.
  const file = await loadInbox();
  if (file.items.some((item) => item.auto === input.auto)) return;
  const item = await createItem({
    kind: "agent",
    title: input.title,
    body: input.body,
    source: "system",
    link: { kind: "url", ref: input.url },
    auto: input.auto,
  });
  broadcastCreated(item);
}

async function pollRepo(
  repo: string,
  token: string,
  events: { prOpened: boolean; ciCompleted: boolean },
  cursor: { prOpenedAt?: string | null; ciCompletedAt?: string | null; seenRunIds?: number[] },
): Promise<void> {
  let prCursor = cursor.prOpenedAt ?? null;
  let ciCursor = cursor.ciCompletedAt ?? null;
  let seenRunIds = cursor.seenRunIds ?? [];

  if (events.prOpened) {
    const data = (await ghFetch(
      `/repos/${repo}/pulls?state=open&sort=created&direction=desc&per_page=20`,
      token,
    )) as PrLike[] | null;
    if (Array.isArray(data)) {
      const { fresh, nextCursor } = diffOpenedPrs(data, prCursor);
      for (const pr of fresh.slice(-MAX_NOTIFICATIONS_PER_REPO)) {
        await notify({
          title: `PR opened in ${repo}: #${pr.number} ${pr.title}`,
          body: pr.user?.login ? `Opened by @${pr.user.login}${pr.draft ? " (draft)" : ""}` : "",
          url: pr.html_url,
          auto: `github-sub:pr-opened:${repo}#${pr.number}`,
        });
      }
      prCursor = nextCursor ?? prCursor;
    }
  }

  if (events.ciCompleted) {
    const data = (await ghFetch(
      `/repos/${repo}/actions/runs?status=completed&per_page=20`,
      token,
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
        });
      }
      ciCursor = nextCursor ?? ciCursor;
      seenRunIds = nextSeenIds;
    }
  }

  await updateCursor(repo, {
    prOpenedAt: prCursor,
    ciCompletedAt: ciCursor,
    seenRunIds,
  });
}

export async function tickGithubWatcher(): Promise<void> {
  if (globalThis.__githubWatcherTicking) return; // skip overlapping ticks
  globalThis.__githubWatcherTicking = true;
  try {
    const subs = await loadSubscriptions();
    if (!subs.enabled || subs.repos.length === 0) return;
    if (!subs.events.prOpened && !subs.events.ciCompleted) return;
    const token = resolveGitHubToken();
    if (!token) return;
    for (const repo of subs.repos) {
      try {
        await pollRepo(repo, token, subs.events, subs.cursors[repo] ?? {});
      } catch {
        // One repo failing (deleted, no access, network) must not stall the rest.
      }
    }
  } finally {
    globalThis.__githubWatcherTicking = false;
  }
}

export function startGithubWatcher(): void {
  if (globalThis.__githubWatcherStarted) return;
  globalThis.__githubWatcherStarted = true;
  void tickGithubWatcher().catch(() => undefined);
  setInterval(() => {
    void tickGithubWatcher().catch(() => undefined);
  }, TICK_MS);
}
