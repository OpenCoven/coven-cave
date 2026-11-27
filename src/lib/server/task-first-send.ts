/**
 * Dispatch a task when its native Chat session's first prompt lands, from any
 * surface (#6562 slice 3).
 *
 * The board chat route reserves a native Chat task without dispatching it:
 * the task's work starts when its first prompt is sent. The Board's work view
 * used to be the only place that then moved the card, so a first send from
 * plain Chat (or any other view that opened the session) left a started task
 * sitting in its column. `chat/send` now calls this when it writes a
 * session's first user turn (or fails to, so a lost stub can't strand it).
 *
 * It applies only to the session the route reserved for the task (the card's
 * `nativeSessionId`), never to a chat someone merely linked, and only if the
 * task is still ready under the board lock: a waiting, untriaged or
 * approval-gated task, or one that already moved, is left as it is.
 *
 * It also waits until the run has proved it started: a launch that fails at
 * once (a missing CLI, an agent that won't resolve) ends its run within
 * milliseconds and never saves a clean reply, so the task stays queued for a
 * retry instead of showing Running with nothing executing. A failure here is
 * logged and never fails the send.
 */

import { loadBoard, readyToDispatch, transitionCard, type Card } from "@/lib/cave-board";
import { loadConversation } from "@/lib/cave-conversations";
import { hasActiveChatRun } from "@/lib/server/chat-stop-registry";

/** How long a first send's run must survive before its task dispatches. */
export const FIRST_SEND_LIVENESS_MS = 2_500;

type TranscriptTurn = { role: string; isError?: boolean; cancelled?: boolean };

export type FirstSendDispatchDeps = {
  loadCards: () => Promise<readonly Card[]>;
  wait: (ms: number) => Promise<void>;
  hasActiveChatRun: (sessionId: string) => boolean;
  loadTurns: (sessionId: string) => Promise<readonly TranscriptTurn[] | null>;
  dispatch: (
    cardId: string,
    reason: string,
    onlyIf: (card: Card, cards: readonly Card[]) => boolean,
  ) => Promise<Card | null>;
};

const defaultDeps: FirstSendDispatchDeps = {
  loadCards: async () => (await loadBoard()).cards,
  wait: (ms) => new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    (timer as { unref?: () => void }).unref?.();
  }),
  hasActiveChatRun,
  loadTurns: async (sessionId) => (await loadConversation(sessionId))?.turns ?? null,
  dispatch: (cardId, reason, onlyIf) => transitionCard(cardId, { to: "dispatched", reason, onlyIf }),
};

function isReservedFor(card: Card, sessionId: string): boolean {
  return card.sessionId === sessionId && card.nativeSessionId === sessionId;
}

/** The run is still going, or it already produced a reply that didn't fail. */
async function runStarted(sessionId: string, deps: FirstSendDispatchDeps): Promise<boolean> {
  if (deps.hasActiveChatRun(sessionId)) return true;
  const turns = await deps.loadTurns(sessionId);
  const reply = turns?.findLast((turn) => turn.role === "assistant");
  return Boolean(reply && !reply.isError && !reply.cancelled);
}

/**
 * Dispatch the task whose reserved native session just received its first
 * prompt. Returns the card when this call moved it, otherwise null.
 */
export async function dispatchTaskOnFirstSend(
  sessionId: string,
  deps: FirstSendDispatchDeps = defaultDeps,
): Promise<Card | null> {
  if (!sessionId) return null;
  try {
    const card = (await deps.loadCards()).find((candidate) => isReservedFor(candidate, sessionId));
    if (!card) return null;
    await deps.wait(FIRST_SEND_LIVENESS_MS);
    if (!(await runStarted(sessionId, deps))) return null;
    let applied = false;
    const moved = await deps.dispatch(
      card.id,
      `Task chat started (session ${sessionId})`,
      // Re-checked under the board lock: the session must still be this
      // task's reservation, and the task still ready.
      (current, cards) => {
        applied = isReservedFor(current, sessionId) && readyToDispatch(current, cards);
        return applied;
      },
    );
    return applied && moved ? moved : null;
  } catch (error) {
    console.warn("[task-first-send] could not dispatch the task:", error instanceof Error ? error.message : error);
    return null;
  }
}
