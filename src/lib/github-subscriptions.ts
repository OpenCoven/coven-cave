import { mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { writeJsonAtomic } from "./server/atomic-write.ts";

/**
 * GitHub event subscriptions — prefs + poll cursors for the local watcher
 * (`github-watcher.ts`) that turns repo events (opened PRs, completed CI runs)
 * into Cave inbox notifications.
 *
 * Path: `~/.coven/github-subscriptions.json`, overridable via
 * `COVEN_GITHUB_SUBSCRIPTIONS_PATH` (tests). Same atomic-write + promise-chain
 * lock pattern as cave-inbox / workflow-runs.
 */

export type SubscriptionEvents = {
  /** Notify when a PR is opened in a watched repo. */
  prOpened: boolean;
  /** Notify when a CI workflow run completes in a watched repo. */
  ciCompleted: boolean;
};

export type RepoCursor = {
  /** ISO timestamp of the newest PR creation we've already seen. */
  prOpenedAt?: string | null;
  /** ISO timestamp of the newest completed run update we've already seen. */
  ciCompletedAt?: string | null;
  /** Recently notified workflow-run ids — guards `updated_at` ties. */
  seenRunIds?: number[];
};

export type GithubSubscriptions = {
  version: 1;
  enabled: boolean;
  events: SubscriptionEvents;
  /** Watched repos as `owner/name`. */
  repos: string[];
  cursors: Record<string, RepoCursor>;
};

export const SEEN_RUN_IDS_CAP = 100;

const DEFAULTS: GithubSubscriptions = {
  version: 1,
  enabled: false,
  events: { prOpened: true, ciCompleted: true },
  repos: [],
  cursors: {},
};

// `owner/name` — GitHub logins and repo names (letters, digits, ., _, -).
const REPO_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/;

export function isValidRepo(repo: string): boolean {
  return REPO_RE.test(repo);
}

function storePath(): string {
  const override = process.env.COVEN_GITHUB_SUBSCRIPTIONS_PATH?.trim();
  if (override) return override;
  return path.join(homedir(), ".coven", "github-subscriptions.json");
}

export async function loadSubscriptions(): Promise<GithubSubscriptions> {
  try {
    const raw = await readFile(storePath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<GithubSubscriptions>;
    return {
      version: 1,
      enabled: Boolean(parsed.enabled),
      events: {
        prOpened: parsed.events?.prOpened ?? true,
        ciCompleted: parsed.events?.ciCompleted ?? true,
      },
      repos: Array.isArray(parsed.repos)
        ? parsed.repos.filter((r): r is string => typeof r === "string" && isValidRepo(r))
        : [],
      cursors:
        parsed.cursors && typeof parsed.cursors === "object" ? { ...parsed.cursors } : {},
    };
  } catch {
    return { ...DEFAULTS, events: { ...DEFAULTS.events }, repos: [], cursors: {} };
  }
}

// Serialize read-modify-write sequences (same rationale as withInboxLock).
// Attached to globalThis so the chain survives Next.js dev hot-reloads.
declare global {
  // eslint-disable-next-line no-var
  var __githubSubsWriteChain: Promise<unknown> | undefined;
}

export function withSubscriptionsLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = globalThis.__githubSubsWriteChain ?? Promise.resolve();
  const next = prev.then(fn, fn);
  globalThis.__githubSubsWriteChain = next.catch(() => undefined);
  return next;
}

export async function saveSubscriptions(subs: GithubSubscriptions): Promise<void> {
  await mkdir(path.dirname(storePath()), { recursive: true });
  await writeJsonAtomic(storePath(), subs);
}

export type SubscriptionsPatch = {
  enabled?: boolean;
  events?: Partial<SubscriptionEvents>;
  /** Full replacement list of watched repos. Invalid entries are rejected. */
  repos?: string[];
};

export async function patchSubscriptions(
  patch: SubscriptionsPatch,
): Promise<GithubSubscriptions> {
  return withSubscriptionsLock(async () => {
    const subs = await loadSubscriptions();
    if (typeof patch.enabled === "boolean") subs.enabled = patch.enabled;
    if (patch.events) {
      if (typeof patch.events.prOpened === "boolean") subs.events.prOpened = patch.events.prOpened;
      if (typeof patch.events.ciCompleted === "boolean") subs.events.ciCompleted = patch.events.ciCompleted;
    }
    if (patch.repos) {
      const cleaned = [...new Set(patch.repos.map((r) => r.trim()).filter(Boolean))];
      subs.repos = cleaned.filter(isValidRepo);
      // Drop cursors for repos no longer watched so re-adding starts fresh.
      for (const key of Object.keys(subs.cursors)) {
        if (!subs.repos.includes(key)) delete subs.cursors[key];
      }
    }
    await saveSubscriptions(subs);
    return subs;
  });
}

export async function updateCursor(repo: string, cursor: RepoCursor): Promise<void> {
  await withSubscriptionsLock(async () => {
    const subs = await loadSubscriptions();
    const prev = subs.cursors[repo] ?? {};
    subs.cursors[repo] = {
      prOpenedAt: cursor.prOpenedAt ?? prev.prOpenedAt ?? null,
      ciCompletedAt: cursor.ciCompletedAt ?? prev.ciCompletedAt ?? null,
      seenRunIds: (cursor.seenRunIds ?? prev.seenRunIds ?? []).slice(0, SEEN_RUN_IDS_CAP),
    };
    await saveSubscriptions(subs);
  });
}

// ── Pure diff helpers (unit-tested, no I/O) ─────────────────────────────────

export type PrLike = {
  number: number;
  title: string;
  html_url: string;
  created_at: string;
  draft?: boolean;
  user?: { login?: string } | null;
};

export type RunLike = {
  id: number;
  name?: string | null;
  display_title?: string | null;
  html_url: string;
  updated_at: string;
  conclusion?: string | null;
  head_branch?: string | null;
};

/**
 * PRs created strictly after the cursor, oldest first. A missing cursor is
 * the first poll for this repo: report nothing (no backlog spam) and let the
 * caller persist the newest `created_at` as the new cursor.
 */
export function diffOpenedPrs(
  prs: PrLike[],
  cursorIso: string | null | undefined,
): { fresh: PrLike[]; nextCursor: string | null } {
  const sorted = [...prs].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const newest = sorted.length ? sorted[sorted.length - 1].created_at : null;
  if (!cursorIso) return { fresh: [], nextCursor: newest };
  const fresh = sorted.filter((pr) => pr.created_at > cursorIso);
  return { fresh, nextCursor: newest && newest > cursorIso ? newest : cursorIso };
}

// Conclusions worth a notification. Cancelled/skipped/stale runs are usually
// superseded, not actionable (mirrors github-checks.ts reasoning).
const NOTIFY_CONCLUSIONS = new Set([
  "success",
  "failure",
  "timed_out",
  "action_required",
  "startup_failure",
]);

/**
 * Completed runs newer than the cursor and not already notified (id set guards
 * `updated_at` ties), oldest first. Missing cursor = first poll: no backlog.
 */
export function diffCompletedRuns(
  runs: RunLike[],
  cursorIso: string | null | undefined,
  seenIds: number[] | undefined,
): { fresh: RunLike[]; nextCursor: string | null; nextSeenIds: number[] } {
  const eligible = runs.filter((run) => NOTIFY_CONCLUSIONS.has(run.conclusion ?? ""));
  const sorted = [...eligible].sort((a, b) => a.updated_at.localeCompare(b.updated_at));
  const newest = sorted.length ? sorted[sorted.length - 1].updated_at : null;
  if (!cursorIso) {
    return { fresh: [], nextCursor: newest, nextSeenIds: sorted.map((r) => r.id) };
  }
  const seen = new Set(seenIds ?? []);
  const fresh = sorted.filter((run) => run.updated_at >= cursorIso && !seen.has(run.id));
  const nextSeenIds = [
    ...fresh.map((r) => r.id),
    ...(seenIds ?? []),
  ].slice(0, SEEN_RUN_IDS_CAP);
  return {
    fresh,
    nextCursor: newest && newest > cursorIso ? newest : cursorIso,
    nextSeenIds,
  };
}
