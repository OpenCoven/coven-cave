// Session status presentation for the Sessions list — the status vocabulary the
// "Chat Session - Prototype" handoff paints as a pill on every row and as a
// counted filter chip above the list.
//
// The prototype's five states (running / waiting / completed / failed /
// canceled) are its own fiction; Cave's daemon reports `running`, `queued`,
// `completed`, `failed` and `paused`. We keep Cave's truth and adopt the
// prototype's *presentation*: one solid token per state, the pill tinted off it
// through the color-mix recipe, and a glyph so the state is never colour-only.

import type { IconName } from "./icon";
import type { SessionRow } from "./types";

export type ChatSessionStatusKey = "running" | "queued" | "completed" | "failed" | "paused";
export type ChatSessionStatusFilter = "all" | ChatSessionStatusKey;

/** Chip order in the toolbar: live work first, then the ways a run ends. */
export const CHAT_SESSION_STATUS_ORDER: readonly ChatSessionStatusKey[] = [
  "running",
  "queued",
  "completed",
  "failed",
  "paused",
];

export type ChatSessionStatusPresentation = {
  /** Sentence-case label for the pill and the filter chip. */
  label: string;
  /** The ONE solid token every tint for this state derives from. */
  tint: string;
  /** Glyph carried beside the label so colour is never the only channel.
   *  `running` has none — it uses the breathing dot instead. */
  icon: IconName | null;
};

export const CHAT_SESSION_STATUS: Record<ChatSessionStatusKey, ChatSessionStatusPresentation> = {
  // Running borrows the presence accent, which is what the prototype's `--live`
  // resolves to: a running session is the surface's one live thing.
  running: { label: "Running", tint: "var(--accent-presence)", icon: null },
  queued: { label: "Queued", tint: "var(--color-warning)", icon: "ph:clock" },
  completed: { label: "Completed", tint: "var(--color-success)", icon: "ph:check" },
  failed: { label: "Failed", tint: "var(--color-danger)", icon: "ph:warning" },
  paused: { label: "Paused", tint: "var(--text-muted)", icon: "ph:pause" },
};

/** Any status the daemon reports that we don't paint explicitly reads as a
 *  finished run — the same fallback the old STATUS_STYLES map used. */
export function chatSessionStatusKey(status: string | null | undefined): ChatSessionStatusKey {
  const key = (status ?? "").trim().toLowerCase();
  return (CHAT_SESSION_STATUS_ORDER as readonly string[]).includes(key)
    ? (key as ChatSessionStatusKey)
    : "completed";
}

export function chatSessionStatus(row: SessionRow): ChatSessionStatusPresentation {
  return CHAT_SESSION_STATUS[chatSessionStatusKey(row.status)];
}

/** Counts for every chip, including `all`. Counted BEFORE the status filter
 *  applies (but after search), so switching chips never changes the numbers
 *  under the other chips — the prototype's behaviour. */
export function countChatSessionStatuses(
  rows: readonly SessionRow[],
): Record<ChatSessionStatusFilter, number> {
  const counts: Record<ChatSessionStatusFilter, number> = {
    all: rows.length,
    running: 0,
    queued: 0,
    completed: 0,
    failed: 0,
    paused: 0,
  };
  for (const row of rows) counts[chatSessionStatusKey(row.status)] += 1;
  return counts;
}

export function filterChatRowsByStatus(
  rows: readonly SessionRow[],
  filter: ChatSessionStatusFilter,
): SessionRow[] {
  if (filter === "all") return [...rows];
  return rows.filter((row) => chatSessionStatusKey(row.status) === filter);
}

/** A chip with a zero count still renders (so the row of chips doesn't reflow
 *  as runs finish) but reads as unavailable unless it is the active filter. */
export function chatStatusChipDisabled(count: number, active: boolean): boolean {
  return count === 0 && !active;
}

// ── Transport is a modifier, never a status ────────────────────────────────
// The session detail header used to report transport (`connecting…`) in the
// same slot as outcome (`28 done`) and wall-clock (`elapsed 1m 33s`), so one
// run narrated itself in three disagreeing voices. Transport is not a state a
// session can END in — it describes the wire, not the work — so it modifies
// the pill's dot rather than replacing the pill's label.

/** Wire condition beneath a running session. `null` once bytes are flowing. */
export type ChatSessionTransport = "connecting" | "reconnecting" | null;

/** Lifecycle of the turn in flight, as `chat-turn-state.ts` reports it. */
type TurnLifecycle =
  | "queued"
  | "connecting"
  | "streaming"
  | "tooling"
  | "cancelled"
  | "failed"
  | "complete";

export type ChatSessionState = {
  key: ChatSessionStatusKey;
  transport: ChatSessionTransport;
};

/**
 * Collapse a turn lifecycle onto the ONE status vocabulary the list already
 * speaks, keeping the wire condition beside it instead of inside it.
 *
 * `daemonRunning === false` outranks everything: with no daemon there is no
 * run to report on, and the header's remedy (Start daemon) is the only useful
 * thing left to say. It reads as `paused` + `reconnecting` — the session is
 * not progressing and the wire is what's missing.
 */
export function chatSessionStateFromLifecycle(args: {
  lifecycle: TurnLifecycle | null;
  busy: boolean;
  error: boolean;
  daemonRunning: boolean | undefined;
}): ChatSessionState {
  if (args.daemonRunning === false) return { key: "paused", transport: "reconnecting" };
  if (args.lifecycle === "failed" || args.error) return { key: "failed", transport: null };
  if (args.lifecycle === "cancelled") return { key: "paused", transport: null };
  if (args.lifecycle === "queued") return { key: "queued", transport: "connecting" };
  if (args.lifecycle === "connecting") return { key: "running", transport: "connecting" };
  if (args.lifecycle === "streaming" || args.lifecycle === "tooling" || args.busy) {
    return { key: "running", transport: null };
  }
  return { key: "completed", transport: null };
}
