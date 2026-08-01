// On-demand chat title generation — the engine behind the title row's sparkle
// control (cave-quiva). Periodic auto-rename (chat-auto-rename.ts) already
// re-derives a title from the latest exchange on a cadence; this module is the
// user-triggered path for the same idea: "name this chat from what it is
// actually about, now".
//
// It deliberately reuses `chatSummaryTitle` rather than adding a titling model
// call. The heuristic is pure, synchronous and offline, so the control works
// with no daemon and no network — the same reason the auto-rename decision
// logic stays pure. Everything here is unit-tested with no I/O.

import { chatSummaryTitle } from "./cave-chat-titles.ts";
import type { Turn } from "./chat-turn-state.ts";

/** The pair the title heuristic reads: a prompt and the reply it produced. */
export type TitleExchange = {
  userText: string | null;
  assistantText: string | null;
};

function turnText(turn: Turn | undefined): string | null {
  const text = turn?.text?.trim();
  return text ? text : null;
}

/**
 * The freshest *settled* exchange in the thread — the newest non-pending,
 * non-error assistant turn plus the most recent user turn before it.
 *
 * Pending and errored assistant turns are skipped: naming a chat after a reply
 * that is still streaming (or that failed) would capture a half-formed thought.
 * When no assistant turn has settled yet the last user turn stands alone, which
 * is what the first-exchange auto-name already does.
 */
export function latestExchangeForTitle(turns: readonly Turn[]): TitleExchange | null {
  if (turns.length === 0) return null;

  let assistantIndex = -1;
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const turn = turns[i];
    if (turn.role === "assistant" && !turn.pending && !turn.error && turnText(turn)) {
      assistantIndex = i;
      break;
    }
  }

  const searchUserFrom = assistantIndex >= 0 ? assistantIndex - 1 : turns.length - 1;
  let userText: string | null = null;
  for (let i = searchUserFrom; i >= 0; i -= 1) {
    const turn = turns[i];
    if (turn.role === "user" && turnText(turn)) {
      userText = turnText(turn);
      break;
    }
  }

  const assistantText = assistantIndex >= 0 ? turnText(turns[assistantIndex]) : null;
  if (!userText && !assistantText) return null;
  return { userText, assistantText };
}

/**
 * Derive a title for the thread, or null when there is nothing meaningful to
 * name it after (an empty chat, or one whose only content is whitespace).
 * Callers keep the current title on null rather than blanking it.
 */
export function generateChatTitle(turns: readonly Turn[]): string | null {
  const exchange = latestExchangeForTitle(turns);
  if (!exchange) return null;
  return chatSummaryTitle({
    userText: exchange.userText,
    assistantText: exchange.assistantText,
  });
}
