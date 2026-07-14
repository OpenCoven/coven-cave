import type { SessionOrigin, SessionRow } from "./types.ts";

/**
 * Chat auto-archive policy — dynamic archiving of chat sessions driven by
 * events and time instead of manual clicks:
 *
 *  - `archiveOnTaskCompletion`: archive a chat as soon as its linked task
 *    reaches the end of its execution lifecycle (card → `completed`). Off by
 *    default — the inline/inbox nudge (see task-archive-nudge*) remains the
 *    default behavior; enabling this flips the nudge into an automatic archive.
 *  - `archiveOnReflection`: archive a chat as soon as a thread reflection
 *    (self-report) lands for it — a reflection marks the thread as wrapped up.
 *    Off by default; toggled from the chat page's Settings tab. Periodic
 *    (mid-flight) reports never archive, only `manual`/`auto` reflections.
 *  - `archiveOnPrMerge`: archive a chat when the pull request its work
 *    produced merges (see merged-chat-auto-archive.ts). On by default —
 *    a merged PR is the strongest "this thread is done" signal.
 *  - `externalAfterDays`: chats created outside the chat interface (cron,
 *    heartbeat, journal narratives, board/workflow-invoked runs, generated
 *    daemon sessions) archive after this many days without activity.
 *  - `idleAfterDays`: any chat archives after this many days without activity.
 *
 * A session can opt out per-chat: marking it *keep* (never auto-archive) or
 * *extending* it (push the deadline out) — both live in cave state
 * (`sessionKeep` / `sessionArchiveExtendedUntil`).
 *
 * Pure helpers only — no IO. State reads/writes live in cave-config.ts and the
 * sweep wiring in chat-auto-archive-sweep.ts, so this module stays trivially
 * testable in node.
 */

export type ChatAutoArchivePolicy = {
  /** Master switch for time/origin-based sweeps and completion auto-archive. */
  enabled: boolean;
  /** Archive the linked chat when its task completes (instead of only nudging). */
  archiveOnTaskCompletion: boolean;
  /** Archive the chat when a thread reflection (self-report) lands for it. */
  archiveOnReflection: boolean;
  /** Archive the chat when the PR its work produced merges. */
  archiveOnPrMerge: boolean;
  /** Days of inactivity before externally-created chats archive. 0 = off. */
  externalAfterDays: number;
  /** Days of inactivity before any chat archives. 0 = off. */
  idleAfterDays: number;
};

export const DEFAULT_CHAT_AUTO_ARCHIVE_POLICY: ChatAutoArchivePolicy = {
  enabled: true,
  archiveOnTaskCompletion: false,
  archiveOnReflection: false,
  archiveOnPrMerge: true,
  externalAfterDays: 7,
  idleAfterDays: 30,
};

const MAX_DAYS = 365;

/** Grace window applied when a chat is summoned (unarchived) so a sweep
 *  (idle-based or merged-PR) doesn't immediately re-archive it before the
 *  user touches it. */
export const SUMMON_GRACE_DAYS = 7;

function clampDays(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const days = Math.floor(value);
  if (days <= 0) return 0;
  return Math.min(days, MAX_DAYS);
}

/** Tolerate partial/corrupt stored policies; unknown fields are dropped. */
export function normalizeChatAutoArchivePolicy(
  raw: Partial<ChatAutoArchivePolicy> | null | undefined,
): ChatAutoArchivePolicy {
  const d = DEFAULT_CHAT_AUTO_ARCHIVE_POLICY;
  if (!raw || typeof raw !== "object") return { ...d };
  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : d.enabled,
    archiveOnTaskCompletion:
      typeof raw.archiveOnTaskCompletion === "boolean"
        ? raw.archiveOnTaskCompletion
        : d.archiveOnTaskCompletion,
    archiveOnReflection:
      typeof raw.archiveOnReflection === "boolean"
        ? raw.archiveOnReflection
        : d.archiveOnReflection,
    archiveOnPrMerge:
      typeof raw.archiveOnPrMerge === "boolean"
        ? raw.archiveOnPrMerge
        : d.archiveOnPrMerge,
    externalAfterDays: clampDays(raw.externalAfterDays, d.externalAfterDays),
    idleAfterDays: clampDays(raw.idleAfterDays, d.idleAfterDays),
  };
}

/** Origins that mean "a person opened this from a chat-like surface". */
const USER_FACING_ORIGINS: ReadonlySet<SessionOrigin> = new Set([
  "chat",
  "mention",
  "call",
  "canvas",
]);

/** Narrow row shape the decisions need — assignable from SessionRow. */
export type AutoArchiveSessionInput = Pick<
  SessionRow,
  "id" | "status" | "archived_at" | "updated_at" | "origin" | "generated"
>;

/**
 * True when the session was created outside the chat interface — generator
 * spawned runs (journal narratives, flows, automations, CLI/debug runs) or
 * system origins like cron/heartbeat/board.
 */
export function sessionCreatedExternally(
  row: Pick<AutoArchiveSessionInput, "origin" | "generated">,
): boolean {
  if (row.generated) return true;
  if (!row.origin) return false;
  return !USER_FACING_ORIGINS.has(row.origin);
}

/** Statuses that mean the session may still be doing work — never sweep
 *  those. Shared by every auto-archive sweep (policy and merged-PR) so the
 *  two paths can't drift on what counts as "active". */
export const ACTIVE_SESSION_STATUSES: ReadonlySet<string> = new Set([
  "running",
  "starting",
  "working",
  "queued",
  "streaming",
  "waiting",
]);

export type AutoArchiveReason = "external" | "idle";

export type AutoArchiveDecision = {
  sessionId: string;
  reason: AutoArchiveReason;
};

export type AutoArchiveContext = {
  /** Sessions marked keep (never auto-archive): id → ISO marked-at. */
  keep: Record<string, string>;
  /** Per-session extension deadlines: id → ISO auto-archive-not-before. */
  extendedUntil: Record<string, string>;
  now: Date;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** True while `id` sits inside a still-valid auto-archive extension window
 *  (explicit "remind me later" extensions and the summon grace both live in
 *  `sessionArchiveExtendedUntil`). Shared by every auto-archive sweep. */
export function underExtension(
  extendedUntil: Record<string, string>,
  id: string,
  now: Date,
): boolean {
  const raw = extendedUntil[id];
  if (!raw) return false;
  const until = Date.parse(raw);
  return Number.isFinite(until) && until > now.getTime();
}

function daysIdle(row: AutoArchiveSessionInput, now: Date): number | null {
  const updated = Date.parse(row.updated_at);
  if (!Number.isFinite(updated)) return null;
  return (now.getTime() - updated) / DAY_MS;
}

/**
 * Decide which sessions are due for auto-archive right now. Skips archived
 * rows, keep-marked rows, rows inside an extension window, and rows whose
 * status suggests active work. Deterministic and side-effect free.
 */
export function autoArchiveDecisions(
  rows: AutoArchiveSessionInput[],
  policy: ChatAutoArchivePolicy,
  context: AutoArchiveContext,
): AutoArchiveDecision[] {
  if (!policy.enabled) return [];
  if (policy.externalAfterDays === 0 && policy.idleAfterDays === 0) return [];

  const decisions: AutoArchiveDecision[] = [];
  for (const row of rows) {
    if (row.archived_at) continue;
    if (context.keep[row.id]) continue;
    if (ACTIVE_SESSION_STATUSES.has((row.status ?? "").toLowerCase())) continue;
    if (underExtension(context.extendedUntil, row.id, context.now)) continue;
    const idle = daysIdle(row, context.now);
    if (idle == null) continue;

    if (
      policy.externalAfterDays > 0 &&
      sessionCreatedExternally(row) &&
      idle >= policy.externalAfterDays
    ) {
      decisions.push({ sessionId: row.id, reason: "external" });
      continue;
    }
    if (policy.idleAfterDays > 0 && idle >= policy.idleAfterDays) {
      decisions.push({ sessionId: row.id, reason: "idle" });
    }
  }
  return decisions;
}

/**
 * Whether a completed task's linked chat should be archived automatically
 * (vs. only nudged). Keep-marked and already-archived sessions are never
 * auto-archived; the nudge path still applies to them.
 */
export function shouldAutoArchiveOnTaskCompletion(
  sessionId: string | null | undefined,
  policy: ChatAutoArchivePolicy,
  context: Pick<AutoArchiveContext, "keep"> & {
    archivedSessionIds: readonly string[];
  },
): boolean {
  if (!sessionId) return false;
  if (!policy.enabled || !policy.archiveOnTaskCompletion) return false;
  if (context.keep[sessionId]) return false;
  return !context.archivedSessionIds.includes(sessionId);
}

/** How a thread reflection (self-report) was triggered. Mirrors the triggers
 *  the self-report route accepts. */
export type ReflectionTrigger = "auto" | "manual" | "periodic";

/**
 * Whether a thread whose reflection just landed should be archived
 * automatically. `periodic` reports are mid-flight health checks — they never
 * archive. Keep-marked and already-archived sessions are left alone, same as
 * the task-completion path.
 */
export function shouldAutoArchiveOnReflection(
  sessionId: string | null | undefined,
  trigger: ReflectionTrigger,
  policy: ChatAutoArchivePolicy,
  context: Pick<AutoArchiveContext, "keep"> & {
    archivedSessionIds: readonly string[];
  },
): boolean {
  if (!sessionId) return false;
  if (trigger === "periodic") return false;
  if (!policy.enabled || !policy.archiveOnReflection) return false;
  if (context.keep[sessionId]) return false;
  return !context.archivedSessionIds.includes(sessionId);
}

/** Clamp a user-supplied extension request; null = invalid (reject). */
export function clampExtendDays(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const days = Math.floor(value);
  if (days < 1) return null;
  return Math.min(days, MAX_DAYS);
}

/** Deadline ISO for an extension of `days` from `now`. */
export function extendUntilIso(now: Date, days: number): string {
  return new Date(now.getTime() + days * DAY_MS).toISOString();
}
