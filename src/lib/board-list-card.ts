import type { BoardAgenticEnhanceState, Card } from "./cave-board-types.ts";

/**
 * The board list sends cards without their Enhance proposal history (#5690).
 *
 * `agenticEnhance` was 4.98 MB of a 5.9 MB `/api/board` response (559
 * proposals plus 559 audit entries on 216 cards), and every list caller paid
 * for it, including the workspace's 60-second task-badge poll. Only the board
 * inspector reads it, one card at a time, so it loads that card in full from
 * `GET /api/board/<id>` instead.
 */
export function toBoardListCard(card: Card): Card {
  if (card.agenticEnhance === undefined) return card;
  const { agenticEnhance: _omitted, ...lean } = card;
  return lean;
}

/**
 * The card the inspector renders: the list's card, with the newest Enhance
 * state it knows about. A card that already carries its state (a mutation
 * response) wins; a lean list card falls back to the state the inspector
 * loaded or last received.
 */
export function withAgenticEnhance(card: Card, loaded: BoardAgenticEnhanceState | null): Card {
  if (card.agenticEnhance !== undefined || loaded === null) return card;
  return { ...card, agenticEnhance: loaded };
}
