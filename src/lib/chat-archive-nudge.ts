/**
 * In-chat archive nudge — the "final nudge" surfaced inline at the end of a
 * chat transcript when the linked task has reached the end of its execution
 * lifecycle (card lifecycle → `completed`) and the chat is ready to archive.
 *
 * The toast variant (see {@link ./task-archive-nudge}) lives in the global
 * inbox and auto-dismisses after a few seconds; it is easy to miss when the
 * user is heads-down in the chat. This module powers a persistent inline
 * banner that stays put until the user either archives the chat or dismisses
 * the prompt.
 *
 * Pure helpers only — no IO. Storage and network calls are the caller's
 * concern so this module stays trivially testable in node.
 */

/** Status passed in from {@link ChatLinkedContext}["task"]["lifecycle"]. */
const COMPLETED: string = "completed";

/** localStorage key used to remember a per-session dismiss. */
export function chatArchiveNudgeDismissKey(sessionId: string): string {
  return `cave:chat-archive-nudge-dismissed:${sessionId}`;
}

/**
 * Minimal `Storage`-like surface so callers can pass `window.localStorage`,
 * `globalThis.localStorage`, or a test fake.
 */
export type DismissStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** True when the user has previously dismissed the nudge for this session. */
export function isChatArchiveNudgeDismissed(
  sessionId: string,
  storage: DismissStorage | null | undefined,
): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(chatArchiveNudgeDismissKey(sessionId)) === "1";
  } catch {
    return false;
  }
}

/** Persist a per-session dismiss so the banner stays hidden across reloads. */
export function markChatArchiveNudgeDismissed(
  sessionId: string,
  storage: DismissStorage | null | undefined,
): void {
  if (!storage) return;
  try {
    storage.setItem(chatArchiveNudgeDismissKey(sessionId), "1");
  } catch {
    /* swallow — storage may be unavailable (private mode, quota) */
  }
}

/** Clear a previous dismiss (e.g. if we ever expose an "undo" path). */
export function clearChatArchiveNudgeDismissed(
  sessionId: string,
  storage: DismissStorage | null | undefined,
): void {
  if (!storage) return;
  try {
    storage.removeItem(chatArchiveNudgeDismissKey(sessionId));
  } catch {
    /* swallow */
  }
}

/**
 * Inputs that determine whether the inline archive nudge should render.
 * Kept narrow and string-typed so {@link ChatLinkedContext}["task"]["lifecycle"]
 * (already a `string` at the type level) feeds in directly without coupling
 * this lib to the board card types.
 */
export type ChatArchiveNudgeInputs = {
  /** Lifecycle of the task linked to this chat, or `null` when no task. */
  taskLifecycle: string | null | undefined;
  /** Whether the chat session has already been archived. */
  sessionArchived: boolean;
  /** Whether the user has dismissed the nudge for this session. */
  dismissed: boolean;
};

/**
 * Decide whether to render the inline archive nudge for the current chat.
 * Returns true only when there's a linked task at end-of-lifecycle, the
 * session is still active, and the user hasn't already dismissed it.
 */
export function shouldShowChatArchiveNudge(inputs: ChatArchiveNudgeInputs): boolean {
  if (inputs.sessionArchived) return false;
  if (inputs.dismissed) return false;
  if (!inputs.taskLifecycle) return false;
  return inputs.taskLifecycle === COMPLETED;
}
