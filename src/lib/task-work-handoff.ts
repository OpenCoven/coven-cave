/**
 * Hand a task chat's first prompt to the Board's work view (#6562 slice 2).
 *
 * A native Chat task starts when its first prompt is sent, and only the
 * Board's work view does that safely: it sends the prompt once (its handoff
 * id survives remounts) and dispatches the task when the send lands. Chat's
 * start page and the GitHub view open task chats too, but they open plain
 * sessions, so a native reservation used to arrive there empty. They now
 * route such a start here: the prompt waits in memory for this window, the
 * URL names the task (`#work-<id>`), and the Board picks both up.
 */

export const TASK_WORK_HASH_PREFIX = "work-";

export type TaskWorkHandoff = {
  cardId: string;
  sessionId: string;
  initialPrompt: string;
  initialModelOverride?: string;
  /**
   * The card as the start returned it, with the reserved session recorded.
   * The Board uses it when its own snapshot predates the start, so it never
   * has to wait for a reload to open the work view.
   */
  card?: { id: string; sessionId: string };
};

type TaskChatStartResponse = {
  card?: unknown;
  sessionId?: unknown;
  initialPrompt?: unknown;
  initialModelOverride?: unknown;
  bridge?: unknown;
};

let pending: TaskWorkHandoff | null = null;

/**
 * The handoff a board task-chat response asks for, or null when the session
 * can simply be opened (a daemon session, or one whose prompt was sent).
 */
export function taskWorkHandoffFrom(cardId: string, json: TaskChatStartResponse | null | undefined): TaskWorkHandoff | null {
  if (!json || json.bridge !== "native-chat") return null;
  if (typeof json.sessionId !== "string" || !json.sessionId) return null;
  if (typeof json.initialPrompt !== "string" || !json.initialPrompt.trim()) return null;
  return {
    cardId,
    sessionId: json.sessionId,
    initialPrompt: json.initialPrompt,
    ...(typeof json.initialModelOverride === "string" && json.initialModelOverride
      ? { initialModelOverride: json.initialModelOverride }
      : {}),
    ...(isReservedCard(json.card, cardId, json.sessionId) ? { card: json.card } : {}),
  };
}

function isReservedCard(value: unknown, cardId: string, sessionId: string): value is { id: string; sessionId: string } {
  if (!value || typeof value !== "object") return false;
  const card = value as { id?: unknown; sessionId?: unknown };
  return card.id === cardId && card.sessionId === sessionId;
}

/** Park the prompt and send the person to the task's work view on the Board. */
export function openTaskWorkOnBoard(handoff: TaskWorkHandoff): void {
  pending = handoff;
  if (typeof window === "undefined") return;
  // Same order as the workspace's focus-card intent: switch, then name it.
  window.dispatchEvent(new CustomEvent("cave:navigate-mode", { detail: { mode: "board" } }));
  window.location.hash = `${TASK_WORK_HASH_PREFIX}${encodeURIComponent(handoff.cardId)}`;
}

/** The task a `#work-<id>` hash names, if any. */
export function taskWorkCardIdFromHash(hash: string): string | null {
  const prefix = `#${TASK_WORK_HASH_PREFIX}`;
  if (!hash.startsWith(prefix)) return null;
  try {
    const id = decodeURIComponent(hash.slice(prefix.length));
    return id || null;
  } catch {
    return null;
  }
}

/** Take (once) the parked prompt for this task. */
export function takeTaskWorkHandoff(cardId: string): TaskWorkHandoff | null {
  if (!pending || pending.cardId !== cardId) return null;
  const handoff = pending;
  pending = null;
  return handoff;
}

/** Test seam. */
export function resetTaskWorkHandoffForTest(): void {
  pending = null;
}
