/**
 * Pure model for the Work scheduler (cave-7c329) — the `isWork` half of the
 * Cody Code Reading v2 handoff, whose room half landed as cave-0rcku / #4423.
 *
 * EVERY EXPORT HERE EXISTS TO KEEP THE SURFACE HONEST. The frame draws several
 * figures the Cave cannot back, and the decisions are encoded as types rather
 * than left to a component to remember:
 *
 *  - There is no `reorder()`. `buildSchedulerQueue` is a pure function of the
 *    issues it is handed, so the order on screen is reproducible from the
 *    tracker alone and survives a reload by construction. The frame's drag
 *    would have written a rank GitHub does not store; the honest ordering
 *    write is a priority band (a `P0`–`P4` label), which this module exposes
 *    as `PRIORITY_BANDS` and nothing else.
 *  - `SchedulerLane.shareOfQueue` is share OF THE QUEUE, not load against a
 *    capacity. No familiar declares a capacity anywhere in the Cave, so a
 *    percentage-of-capacity would have no denominator.
 *  - `SchedulerLane.presence` is `null` — not "idle" — when the session roster
 *    could not be read. A lane cannot report a state it did not observe.
 *  - A `GateCard` names its blockers and marks WHY one of them is primary.
 *    Issues record `blocked_by` and nothing else: no designated primary blocker
 *    and no structured next step. (`docs/orchestration-ready-tasks.md` does
 *    specify that triple, but it governs Cave BOARD tasks — `cave-board-types.ts`
 *    / `task-orchestration.ts` / `/api/board` — not issues. See the PR body.)
 *  - A `SchedulerLogEntry` either offers an undo that fires or states why it
 *    cannot be reversed. `schedulerLogEntryIsCoherent` pins that as an
 *    invariant, and only priority changes qualify.
 */

import { computePresence, type Presence } from "@/lib/presence";
import type { Familiar, SessionRow } from "@/lib/types";

// ── issues ────────────────────────────────────────────────────────────────────

/** The subset of a ready or blocked issue (`/api/queue/issues`) this reads. */
export type SchedulerIssue = {
  id: string;
  title: string;
  /** 0-4 from a `P<n>` label; null when the issue is unranked. */
  priority: number | null;
  status: string;
  assignee?: string | null;
  labels?: string[] | null;
  updated_at?: string | null;
  issue_type?: string | null;
};

/** A blocked issue: the same record plus the ids of its open blockers. */
export type BlockedIssue = SchedulerIssue & {
  blocked_by?: string[] | null;
  blocked_by_count?: number | null;
};

/** Priority is a band 0-4, stored as a `P<n>` label (P0 = Critical). */
export type PriorityBand = { value: number; label: string };

export const PRIORITY_BANDS: readonly PriorityBand[] = [
  { value: 0, label: "Critical" },
  { value: 1, label: "High" },
  { value: 2, label: "Medium" },
  { value: 3, label: "Low" },
  { value: 4, label: "Backlog" },
];

const UNKNOWN_BAND: PriorityBand = { value: -1, label: "Unranked" };

export function priorityBand(priority: number | null | undefined): PriorityBand {
  return PRIORITY_BANDS.find((band) => band.value === priority) ?? UNKNOWN_BAND;
}

// ── queue ────────────────────────────────────────────────────────────────────

export const UNASSIGNED_LANE_KEY = "unassigned";

export type SchedulerQueueRow = {
  /**
   * 1-based position under the derived sort below. Derived on read and never
   * stored: it renumbers when the tracker changes and cannot be dragged.
   */
  position: number;
  issue: SchedulerIssue;
  /** The familiar this issue resolves to, or null when it resolves to none. */
  familiarId: string | null;
  /**
   * Who the row shows in its FAMILIAR column. An issue assigned to someone who
   * is not a familiar keeps that name rather than being flattened into
   * "Unassigned" — flattening would claim the issue is unowned when it is not.
   */
  familiarLabel: string;
  band: PriorityBand;
};

function labelValue(labels: string[] | null | undefined, prefix: string): string | null {
  for (const label of labels ?? []) {
    if (label.startsWith(prefix)) return label.slice(prefix.length);
  }
  return null;
}

/**
 * The raw ownership key an issue carries, matching the convention already used
 * by the Board's queue (`work-queue.ts`): an explicit `familiar:<id>`
 * label wins, otherwise the assignee.
 */
export function issueOwnerKey(issue: SchedulerIssue): string | null {
  const label = labelValue(issue.labels, "familiar:")?.trim();
  if (label) return label;
  const assignee = issue.assignee?.trim();
  return assignee ? assignee : null;
}

function matchFamiliar(key: string | null, familiars: readonly Familiar[]): Familiar | null {
  if (!key) return null;
  const needle = key.toLowerCase();
  return (
    familiars.find((familiar) => familiar.id.toLowerCase() === needle) ??
    familiars.find((familiar) => (familiar.display_name ?? "").toLowerCase() === needle) ??
    null
  );
}

/**
 * Deterministic queue order: priority band first, then the oldest update, then
 * the id. Identical inputs always produce an identical order — which is what
 * lets the surface promise that what you see survives a reload without storing
 * anything of its own.
 */
function queueSortKey(issue: SchedulerIssue): string {
  const priority = Number.isInteger(issue.priority) ? issue.priority : 9;
  return `${priority}:${issue.updated_at || "9999"}:${issue.id}`;
}

export function buildSchedulerQueue(
  issues: readonly SchedulerIssue[],
  options: { familiars: readonly Familiar[] },
): SchedulerQueueRow[] {
  return [...issues]
    .filter((issue) => issue.issue_type !== "epic")
    .sort((a, b) => queueSortKey(a).localeCompare(queueSortKey(b)))
    .map((issue, index) => {
      const key = issueOwnerKey(issue);
      const familiar = matchFamiliar(key, options.familiars);
      return {
        position: index + 1,
        issue,
        familiarId: familiar?.id ?? null,
        familiarLabel: familiar?.display_name ?? key ?? "Unassigned",
        band: priorityBand(issue.priority),
      };
    });
}

// ── lanes ────────────────────────────────────────────────────────────────────

export type SchedulerLane = {
  /** A familiar id, or `UNASSIGNED_LANE_KEY`. */
  key: string;
  name: string;
  familiar: Familiar | null;
  /**
   * The familiar's live state, using the Cave's existing presence vocabulary.
   * `null` means the session roster was not readable — render "state unknown",
   * never a dot and a word the lane did not observe.
   */
  presence: Presence | null;
  /** Rows in `rows` that resolve to this lane. */
  queued: number;
  /**
   * `queued / rows.length`, in 0..1. SHARE OF THE QUEUE. The Cave stores no
   * per-familiar capacity, so there is no load percentage to render.
   */
  shareOfQueue: number;
  /** The familiar's running session title, when there is one. */
  note: string | null;
};

function needsReply(sessions: readonly SessionRow[]): boolean {
  return sessions.some(
    (session) =>
      session.attention?.state === "awaiting-human" || session.attention?.state === "overdue-human",
  );
}

export function buildSchedulerLanes(input: {
  familiars: readonly Familiar[];
  sessions: readonly SessionRow[];
  /** False when the session roster failed to load or was never fetched. */
  sessionsKnown: boolean;
  rows: readonly SchedulerQueueRow[];
}): SchedulerLane[] {
  const total = input.rows.length;
  const share = (queued: number) => (total === 0 ? 0 : queued / total);

  const lanes: SchedulerLane[] = input.familiars.map((familiar) => {
    const mine = input.sessions.filter(
      (session) => session.familiarId === familiar.id && !session.archived_at,
    );
    const queued = input.rows.filter((row) => row.familiarId === familiar.id).length;
    const running = mine.find((session) => session.status === "running");
    return {
      key: familiar.id,
      name: familiar.display_name || familiar.id,
      familiar,
      presence: input.sessionsKnown
        ? computePresence({ familiar, sessions: [...mine], needsReply: needsReply(mine) })
        : null,
      queued,
      shareOfQueue: share(queued),
      note: running?.title?.trim() || null,
    };
  });

  // Work owned by nobody the Cave knows is still work. It gets a lane, with no
  // presence at all — there is no familiar behind it to have a state.
  const unowned = input.rows.filter((row) => row.familiarId === null).length;
  if (unowned > 0) {
    lanes.push({
      key: UNASSIGNED_LANE_KEY,
      name: "Unassigned",
      familiar: null,
      presence: null,
      queued: unowned,
      shareOfQueue: share(unowned),
      note: null,
    });
  }

  return lanes;
}

// ── gates ────────────────────────────────────────────────────────────────────

export type GateBlocker = {
  id: string;
  /** null when the join could not name it — the card says so rather than guessing. */
  title: string | null;
  status: string | null;
  priority: number | null;
  /** True when this blocker is itself blocked, i.e. the chain runs deeper. */
  itselfBlocked: boolean;
};

/**
 * Why a blocker is shown as primary. Issues do NOT designate one, so the card
 * always states its basis instead of implying the tracker chose it.
 */
export type GatePrimaryBasis =
  | "sole-blocker"
  | "only-actionable"
  | "highest-priority-actionable"
  | "none-actionable";

export type GateCard = {
  issue: BlockedIssue;
  blockers: GateBlocker[];
  /** Blocker ids the join could not resolve to a record. */
  unnamed: number;
  primary: GateBlocker | null;
  primaryBasis: GatePrimaryBasis | null;
  /**
   * The only action a gate card offers: go to the blocker. There is no
   * approval backend anywhere in the Cave, so there is no Approve button.
   */
  route: { issueId: string; label: string } | null;
};

function blockerSortKey(blocker: GateBlocker): string {
  const priority = Number.isInteger(blocker.priority) ? String(blocker.priority) : "9";
  return `${priority}:${blocker.id}`;
}

export function buildGateCards(
  blocked: readonly BlockedIssue[],
  blockerRecords: readonly SchedulerIssue[],
): GateCard[] {
  const byId = new Map<string, SchedulerIssue>();
  for (const record of blockerRecords) byId.set(record.id, record);
  const blockedIds = new Set(blocked.map((issue) => issue.id));

  return blocked.map((issue) => {
    const ids = (issue.blocked_by ?? []).filter((id): id is string => typeof id === "string" && !!id.trim());
    const blockers: GateBlocker[] = ids.map((id) => {
      const record = byId.get(id);
      return {
        id,
        title: record?.title ?? null,
        status: record?.status ?? null,
        priority: typeof record?.priority === "number" ? record.priority : null,
        itselfBlocked: blockedIds.has(id),
      };
    });

    const actionable = blockers.filter((blocker) => !blocker.itselfBlocked);
    const pool = actionable.length > 0 ? actionable : blockers;
    const primary = [...pool].sort((a, b) => blockerSortKey(a).localeCompare(blockerSortKey(b)))[0] ?? null;

    let primaryBasis: GatePrimaryBasis | null = null;
    if (primary) {
      // "Every blocker is itself blocked" outranks "there is only one of them":
      // a lone blocker that is ITSELF blocked would otherwise read as a single
      // hop when the real chain runs deeper, which is the more useful fact.
      if (actionable.length === 0) primaryBasis = "none-actionable";
      else if (blockers.length === 1) primaryBasis = "sole-blocker";
      else if (actionable.length === 1) primaryBasis = "only-actionable";
      else primaryBasis = "highest-priority-actionable";
    }

    return {
      issue,
      blockers,
      unnamed: blockers.filter((blocker) => blocker.title === null).length,
      primary,
      primaryBasis,
      route: primary ? { issueId: primary.id, label: `Open ${primary.id}` } : null,
    };
  });
}

/** The sentence a gate card prints under its primary blocker. */
export function gatePrimaryBasisText(basis: GatePrimaryBasis): string {
  switch (basis) {
    case "sole-blocker":
      return "The only thing blocking this issue.";
    case "only-actionable":
      return "Derived: the only blocker not itself blocked. Issues record blockers, not a primary.";
    case "highest-priority-actionable":
      return "Derived: highest-priority blocker not itself blocked. Issues record blockers, not a primary.";
    case "none-actionable":
      return "Every blocker is itself blocked — the chain runs deeper than this card.";
  }
}

// ── scheduler state ──────────────────────────────────────────────────────────

/** Which of the surface's reads succeeded on the most recent pass. */
export type SchedulerSources = { queue: boolean; roster: boolean; gates: boolean };

export type SchedulerStatusKind = "no-project" | "unavailable" | "stale" | "partial" | "live";

export type SchedulerStatus = {
  kind: SchedulerStatusKind;
  label: string;
  detail: string;
};

/** A poll is called stale once it has missed this many intervals. */
export const SCHEDULER_STALE_FACTOR = 2.5;

/**
 * Derived, never chosen. The frame's state menu let an operator pick a state;
 * a picker would let someone assert "live" over data that is not.
 */
export function deriveSchedulerStatus(input: {
  projectSelected: boolean;
  sources: SchedulerSources;
  /** Epoch ms of the last successful queue read, or null if there has been none. */
  lastLoadedAtMs: number | null;
  nowMs: number;
  pollIntervalMs: number;
}): SchedulerStatus {
  if (!input.projectSelected) {
    return {
      kind: "no-project",
      label: "No project",
      detail: "Pick the project whose issues this scheduler reads.",
    };
  }
  if (input.lastLoadedAtMs === null) {
    return {
      kind: "unavailable",
      label: "Unavailable",
      detail: "The queue has not loaded. Nothing below is real yet.",
    };
  }
  const age = input.nowMs - input.lastLoadedAtMs;
  if (age > input.pollIntervalMs * SCHEDULER_STALE_FACTOR) {
    return {
      kind: "stale",
      label: "Stale",
      detail: "The queue has stopped refreshing. Everything below is the last good read.",
    };
  }
  const down: string[] = [];
  if (!input.sources.queue) down.push("queue");
  if (!input.sources.roster) down.push("familiars");
  if (!input.sources.gates) down.push("gates");
  if (down.length > 0) {
    return {
      kind: "partial",
      label: "Partial",
      detail: `Could not read: ${down.join(", ")}. Those sections show nothing rather than a guess.`,
    };
  }
  return { kind: "live", label: "Live", detail: "Every source read on the last pass." };
}

// ── history and undo ─────────────────────────────────────────────────────────

/**
 * The one reversible mutation. `POST /api/queue/issues {action:"priority"}` writes a
 * stored band, so replaying the previous band (or clearing it back to
 * Unranked) is an exact reversal.
 */
export type SchedulerUndo = { action: "priority"; id: string; priority: number | null };

export type SchedulerLogEntry = {
  id: string;
  at: number;
  kind: "reassign" | "priority";
  issueId: string;
  issueTitle: string;
  summary: string;
  /** The request that reverses this entry, or null. */
  undo: SchedulerUndo | null;
  /** Why it cannot be reversed. Set exactly when `undo` is null. */
  irreversible: string | null;
  undone: boolean;
};

export const SCHEDULER_LOG_LIMIT = 50;

/**
 * Reassign assigns the connected GitHub user and replaces the issue's
 * `familiar:<id>` label, so reversing it needs the previous assignees AND the
 * previous familiar label restored. `/api/queue/issues` has no action that
 * can do that, so an "Undo" here could not fire. It is not offered, and the
 * entry says why.
 */
export const REASSIGN_IRREVERSIBLE =
  "Reassigning also claimed the issue on GitHub. Cave has no action that restores the previous assignees and familiar label, so this cannot be undone here.";

export const PRIORITY_UNKNOWN_PREVIOUS =
  "Cave did not observe this issue's previous priority, so it has no value to restore.";

export function reassignLogEntry(input: {
  id: string;
  at: number;
  issueId: string;
  issueTitle: string;
  toLabel: string;
}): SchedulerLogEntry {
  return {
    id: input.id,
    at: input.at,
    kind: "reassign",
    issueId: input.issueId,
    issueTitle: input.issueTitle,
    summary: `Reassigned to ${input.toLabel}`,
    undo: null,
    irreversible: REASSIGN_IRREVERSIBLE,
    undone: false,
  };
}

export function priorityLogEntry(input: {
  id: string;
  at: number;
  issueId: string;
  issueTitle: string;
  /** The band before the change; null when it was Unranked; undefined when Cave never observed it. */
  previousPriority: number | null | undefined;
  priority: number;
}): SchedulerLogEntry {
  const previous = input.previousPriority;
  const reversible = previous === null || Number.isInteger(previous);
  return {
    id: input.id,
    at: input.at,
    kind: "priority",
    issueId: input.issueId,
    issueTitle: input.issueTitle,
    summary: reversible
      ? `Priority ${priorityBand(input.previousPriority).label} → ${priorityBand(input.priority).label}`
      : `Priority set to ${priorityBand(input.priority).label}`,
    undo: reversible
      ? { action: "priority", id: input.issueId, priority: previous ?? null }
      : null,
    irreversible: reversible ? null : PRIORITY_UNKNOWN_PREVIOUS,
    undone: false,
  };
}

/**
 * The invariant the history rail depends on: an entry offers a reversal that
 * fires, or it states why there is none. Never both, never neither.
 */
export function schedulerLogEntryIsCoherent(entry: SchedulerLogEntry): boolean {
  return (entry.undo === null) !== (entry.irreversible === null);
}

export function appendSchedulerLog(
  log: readonly SchedulerLogEntry[],
  entry: SchedulerLogEntry,
): SchedulerLogEntry[] {
  return [entry, ...log].slice(0, SCHEDULER_LOG_LIMIT);
}

export function markSchedulerLogUndone(
  log: readonly SchedulerLogEntry[],
  id: string,
): SchedulerLogEntry[] {
  return log.map((entry) => (entry.id === id ? { ...entry, undone: true, undo: null, irreversible: "Already undone." } : entry));
}

/** The body a queued undo sends. Kept beside the entry so the two cannot drift. */
export function undoRequestBody(undo: SchedulerUndo, projectRoot: string): Record<string, unknown> {
  return { action: undo.action, id: undo.id, priority: undo.priority, projectRoot };
}
