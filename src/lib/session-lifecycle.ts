// The canonical session lifecycle — the ONE vocabulary every list speaks.
//
// The redesign handoff's sharpest diagnosis is that this app had no single
// answer to "what is this session doing?". Six vocabularies were live at once:
//
//   chat-session-status.ts  Running · Queued · Completed · Failed · Paused
//   session-status.ts       running · done · failed · idle
//   chat-attention.ts       Left hanging · Awaiting you · Still waiting
//   lifecycle-badge.tsx     queued … review … cancelled (+ needs human)
//   code-surface.ts         running · failed · idle
//   permissions-console.ts  Awaiting you
//
// Same state, three spellings. Worse, two different AXES were rendered into
// one slot: what the daemon is doing, and what the session wants from you.
// They are independent — a completed run can still be waiting on you, and a
// running one cannot be — so collapsing them by accident is how "Still
// waiting" ended up painted in danger red and reading as an error.
//
// This module is the composition the app was missing. Six words, and only six:
//
//   Running · Awaiting you · Blocked · Completed · Failed · Idle
//
// It REPLACES neither source. The daemon's status stays the daemon's
// (chat-session-status.ts still owns the detail pill) and the attention
// evidence stays server-authored (chat-attention.ts still derives it from
// turns and `<coven:attention>` markers). What was missing was the one
// function that puts the two axes in a defined order.

import { chatSessionStatusKey } from "./chat-session-status.ts";

/** The attention facts this module reads, named structurally rather than
 *  imported from chat-attention.ts: that module depends on THIS one for its
 *  labels, and a structural shape keeps the dependency pointing one way. */
export type AttentionInput = {
  state: string;
  reason: string | null;
};

export type SessionLifecycle =
  | "running"
  | "awaiting"
  | "blocked"
  | "completed"
  | "failed"
  | "idle";

/** Reading order for a list: live work first, then what needs you, then the
 *  ways a run ends. Not the same as NEEDS_YOU_ORDER below, which ranks urgency
 *  rather than narrating a lifecycle. */
export const SESSION_LIFECYCLE_ORDER: readonly SessionLifecycle[] = [
  "running",
  "awaiting",
  "blocked",
  "completed",
  "failed",
  "idle",
];

export type SessionLifecyclePresentation = {
  /** The ONLY word this state is ever spelled with. */
  label: string;
  /** The ONE solid token every tint for this state derives from, per the
   *  color-mix recipe in docs/coven-design-language.md §3. */
  tint: string;
  /** Whether the ROW carries a tinted field.
   *
   *  True for awaiting and blocked only. Failed deliberately does not: a
   *  row-wide red field across every failure is what produced the alarm wall
   *  the handoff diagnoses, and it also spends the loudest treatment in the
   *  list on the state that is already over. Failure is carried by a badge
   *  plus the existing 2px danger spine (cave-dkdev), which keeps it findable
   *  without colour being the only channel. */
  rowTint: boolean;
};

export const SESSION_LIFECYCLE: Record<SessionLifecycle, SessionLifecyclePresentation> = {
  running: { label: "Running", tint: "var(--status-running)", rowTint: false },
  awaiting: { label: "Awaiting you", tint: "var(--status-awaiting)", rowTint: true },
  blocked: { label: "Blocked", tint: "var(--status-blocked)", rowTint: true },
  completed: { label: "Completed", tint: "var(--status-completed)", rowTint: false },
  failed: { label: "Failed", tint: "var(--status-failed)", rowTint: false },
  idle: { label: "Idle", tint: "var(--status-idle)", rowTint: false },
};

/**
 * A session *needs you* when it cannot advance without you.
 *
 * Note `running` is absent, which is the point: volume of work in flight is
 * not a call to action, and badging it is what made every badge permanent and
 * therefore meaningless.
 */
export const NEEDS_YOU: readonly SessionLifecycle[] = ["blocked", "failed", "awaiting"];

/** Urgency rank inside the Needs-you inbox: blocked → failed → awaiting.
 *  Blocked outranks failed because a block is a question addressed to you,
 *  while a failure is a fact you may or may not want to act on. */
const NEEDS_YOU_RANK: Record<SessionLifecycle, number> = {
  blocked: 0,
  failed: 1,
  awaiting: 2,
  running: 3,
  completed: 4,
  idle: 5,
};

export function needsYou(lifecycle: SessionLifecycle): boolean {
  return NEEDS_YOU.includes(lifecycle);
}

export function compareNeedsYou(a: SessionLifecycle, b: SessionLifecycle): number {
  return NEEDS_YOU_RANK[a] - NEEDS_YOU_RANK[b];
}

/**
 * Attention reasons that mean the session is BLOCKED rather than merely
 * awaiting a reply.
 *
 * The distinction is whether the session is stopped on something only you can
 * grant. `approval` and `credentials` are gates — the run cannot proceed at
 * all until you act — whereas `input` and `decision` are questions the session
 * is holding open. The handoff's own example carries the same split: "needs
 * repo access" is drawn as Blocked, while a PR review sits as Awaiting you.
 *
 * This reads existing server-authored data (`<coven:attention reason="…">`);
 * it invents no backend state.
 */
const BLOCKING_REASONS = new Set(["approval", "credentials"]);

/**
 * Compose the daemon's status and the server's attention evidence into one of
 * the six words.
 *
 * Precedence, and why:
 *
 * 1. `failed` wins outright. A failed run is a terminal fact about the work;
 *    nothing it might additionally be waiting for changes what to say.
 * 2. Live work (`running`, `queued`) outranks attention. This is not a tie
 *    being broken — `deriveChatAttention` already returns no attention for
 *    active sessions — but stating it here means the two modules cannot drift
 *    into disagreeing about it later.
 * 3. Attention, split into blocked vs awaiting by reason.
 * 4. Otherwise the daemon's own outcome.
 *
 * `queued` folds into `running`: to a reader scanning a list, a queued session
 * is live work in flight — it is neither idle nor finished, and the handoff's
 * six words have no seventh slot for it. The daemon distinction is not lost,
 * it is simply not this module's to spend a word on; `chat-session-status.ts`
 * still carries it on the detail pill.
 */
export function sessionLifecycle(args: {
  status: string | null | undefined;
  attention?: AttentionInput | null;
  archived?: boolean;
}): SessionLifecycle {
  const status = chatSessionStatusKey(args.status);

  if (status === "failed") return "failed";

  // An archived session is settled by definition — it can want nothing from
  // you, which is the same rule resolveThreadAttention applies in the rail.
  const attention = args.archived ? null : args.attention;

  if (status === "running" || status === "queued") return "running";

  if (attention && attention.state !== "none") {
    return attention.reason && BLOCKING_REASONS.has(attention.reason) ? "blocked" : "awaiting";
  }

  return status === "paused" ? "idle" : "completed";
}

/**
 * The attention axis on its own, for callers that hold attention evidence but
 * no daemon status — the thread rail, which renders a cue rather than a state.
 *
 * Returns `null` for "none" so a settled session renders no cue at all, which
 * is the existing contract at every call site.
 */
export function attentionLifecycle(
  state: string,
  reason: string | null = null,
): Extract<SessionLifecycle, "awaiting" | "blocked"> | null {
  if (!state || state === "none") return null;
  return reason && BLOCKING_REASONS.has(reason) ? "blocked" : "awaiting";
}

/** The word, for any renderer that has already resolved the lifecycle. */
export function sessionLifecycleLabel(lifecycle: SessionLifecycle): string {
  return SESSION_LIFECYCLE[lifecycle].label;
}
