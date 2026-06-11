/**
 * In-transcript find (CHAT-D9-04).
 *
 * Turn-level matching: a case-insensitive substring scan over each turn's
 * VISIBLE text (callers pass the already-rendered visible body — reasoning
 * blocks and tool payloads are deliberately excluded). Honest scope: the
 * find bar reports and jumps between matching TURNS; intra-turn `<mark>`
 * highlighting inside sanitized rendered HTML is deferred render-pipeline
 * surgery.
 */

export type FindableTurn = {
  id: string;
  /** Visible transcript text for the turn (post reasoning-split). */
  text: string;
};

/**
 * Returns the ids of turns whose visible text contains `query`
 * (case-insensitive substring), in transcript order. A blank or
 * whitespace-only query matches nothing — an empty find bar should
 * report 0 / 0, not "every turn matches the empty string".
 */
export function findMatchingTurnIds(
  turns: readonly FindableTurn[],
  query: string,
): string[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const out: string[] = [];
  for (const turn of turns) {
    if (turn.text.toLowerCase().includes(needle)) out.push(turn.id);
  }
  return out;
}
