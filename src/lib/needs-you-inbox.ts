// The Needs-you inbox — the ONE attention surface.
//
// Design handoff `Coven Cave Prototype.dc.html`, frame 2c, and §4.4/§7 of the
// redesign spec. It replaces the running-activity popover, whose diagnosis was
// that a 156-row list of everything in flight is a list, not a popover, and
// that volume of work is not a call to action.
//
// The inversion this module encodes: the popover stops reporting what is
// RUNNING and starts reporting what is STOPPED ON YOU. Running becomes a count
// in the footer, because a running session wants nothing from you — that is the
// whole reason `NEEDS_YOU` in session-lifecycle.ts omits it.
//
// No backend state is invented here. Every field is composed from data
// `SessionRow` already carries: the daemon's status, the server-authored
// attention evidence (`<coven:attention>`), and the session's own git context.

import { projectNameForRoot } from "./chat-add-project.ts";
import {
  compareNeedsYou,
  needsYou,
  sessionLifecycle,
  type SessionLifecycle,
} from "./session-lifecycle.ts";
import { truncateBranch } from "./truncate-middle.ts";
import type { SessionRow } from "./types.ts";

/** The three states that can want something from you. Narrowed from
 *  `SessionLifecycle` so a row in this inbox cannot be typed as `running`. */
export type NeedsYouLifecycle = Extract<
  SessionLifecycle,
  "awaiting" | "blocked" | "failed"
>;

export type NeedsYouItem = {
  sessionId: string;
  title: string;
  lifecycle: NeedsYouLifecycle;
  familiarId: string | null;
  /** Repo when the session reported a PR, else the project root's own name. */
  project: string;
  /** Middle-truncated per spec §3; null when the session has no branch. */
  branch: string | null;
  /** When this session started needing you. Drives the "oldest first" order. */
  since: string | null;
  /**
   * Identity of THIS ask, not of the session.
   *
   * Marking an item seen must silence the ask you actually read, never the
   * next one. Keying on the session id alone would do the latter: a session
   * you dismissed on Monday would stay silent when it asked you something new
   * on Friday. Including `since` mints a fresh key each time the attention
   * evidence moves, so a new ask always re-surfaces.
   */
  seenKey: string;
};

/** Counts for the footer's ELSEWHERE strip: what is happening that is NOT
 *  asking for you. */
export type NeedsYouElsewhere = { running: number; idle: number };

function lifecycleOf(session: SessionRow): SessionLifecycle {
  return sessionLifecycle({
    status: session.status,
    attention: session.attention,
    archived: Boolean(session.archived_at),
  });
}

/**
 * Can a click on this row land anywhere?
 *
 * `generated` sessions are daemon-only runs — journal narratives, flow steps,
 * ritual executions — spawned without anyone chatting. Most have no Cave
 * transcript behind them, so a row for one would open an empty reader. Those
 * are dropped. A generated run that DID save a conversation is kept, which is
 * what lets a failed ritual reach this inbox at all (spec §2: ritual runs
 * surface only when they need a human).
 */
function isReachable(session: SessionRow): boolean {
  return !session.generated || session.hasLocalConversation === true;
}

/** When the session started needing you. Attention carries its own `since`;
 *  a failed run has no attention evidence, so its last update is when it
 *  stopped — which is the moment it started waiting. */
function needingSince(session: SessionRow, lifecycle: NeedsYouLifecycle): string | null {
  if (lifecycle === "failed") return session.updated_at || null;
  return session.attention?.since || session.updated_at || null;
}

function projectOf(session: SessionRow): string {
  const repo = session.pullRequest?.repo;
  if (repo) return repo;
  return projectNameForRoot(session.project_root);
}

function branchOf(session: SessionRow): string | null {
  // `workBranch` is this session's own recorded branch; `git.branch` is
  // whatever the shared checkout happens to have checked out at poll time and
  // must never be presented as the session's (see SessionRow's own comment).
  const branch = session.workBranch;
  return branch ? truncateBranch(branch) : null;
}

export function needsYouSeenKey(sessionId: string, since: string | null): string {
  return `${sessionId}@${since ?? "-"}`;
}

/**
 * Every session that cannot advance without you, in inbox order.
 *
 * Order is the spec's, and each tier is deliberate:
 *   1. blocked → failed → awaiting  (`compareNeedsYou`; a block is a question
 *      addressed to you, a failure is a fact you may or may not act on)
 *   2. oldest wait first — the thing that has been ignored longest is the
 *      thing most likely to have been forgotten
 *   3. title, so the order is stable across renders when two items tie
 */
export function needsYouItems(sessions: readonly SessionRow[]): NeedsYouItem[] {
  const items: NeedsYouItem[] = [];
  for (const session of sessions) {
    if (session.archived_at) continue;
    if (!isReachable(session)) continue;
    const lifecycle = lifecycleOf(session);
    if (!needsYou(lifecycle)) continue;
    const narrowed = lifecycle as NeedsYouLifecycle;
    const since = needingSince(session, narrowed);
    items.push({
      sessionId: session.id,
      title: session.title || "Untitled session",
      lifecycle: narrowed,
      familiarId: session.familiarId ?? null,
      project: projectOf(session),
      branch: branchOf(session),
      since,
      seenKey: needsYouSeenKey(session.id, since),
    });
  }
  return items.sort((a, b) => {
    const byUrgency = compareNeedsYou(a.lifecycle, b.lifecycle);
    if (byUrgency !== 0) return byUrgency;
    // Oldest first. A missing timestamp sorts last rather than first: we do
    // not know it has waited long, and guessing it has would put an unknown at
    // the top of a list whose whole promise is that the top item waited most.
    if (a.since && b.since && a.since !== b.since) return a.since < b.since ? -1 : 1;
    if (a.since && !b.since) return -1;
    if (!a.since && b.since) return 1;
    return a.title.localeCompare(b.title);
  });
}

/** Items the reader has not already dismissed. */
export function unseenNeedsYouItems(
  items: readonly NeedsYouItem[],
  seen: ReadonlySet<string>,
): NeedsYouItem[] {
  return items.filter((item) => !seen.has(item.seenKey));
}

/**
 * What is going on that is NOT asking for you — the footer's counts.
 *
 * Running is reported as text rather than a badge on purpose (spec §6): a
 * permanent count is a badge that stops meaning anything, which is how `156
 * running` and `99+` came to be ignored.
 */
export function needsYouElsewhere(sessions: readonly SessionRow[]): NeedsYouElsewhere {
  let running = 0;
  let idle = 0;
  for (const session of sessions) {
    if (session.archived_at) continue;
    if (!isReachable(session)) continue;
    const lifecycle = lifecycleOf(session);
    if (lifecycle === "running") running += 1;
    else if (lifecycle === "idle") idle += 1;
  }
  return { running, idle };
}

/**
 * How long this item has been waiting, as a 0–1 fraction of a week.
 *
 * The row draws it as a hairline under the row. It is a comparative cue inside
 * one list, not a measurement — which is why it saturates at 7 days instead of
 * growing without bound, and why the exact wait is always also written out in
 * words beside it.
 */
export const NEEDS_YOU_WAIT_SATURATION_MS = 7 * 24 * 60 * 60 * 1000;

export function needsYouWaitFraction(since: string | null, now: number): number {
  if (!since) return 0;
  const started = Date.parse(since);
  if (!Number.isFinite(started)) return 0;
  const waited = now - started;
  if (waited <= 0) return 0;
  return Math.min(1, waited / NEEDS_YOU_WAIT_SATURATION_MS);
}
