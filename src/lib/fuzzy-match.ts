// Fuzzy matching for the command palette. Power users type abbreviations and
// subsequences ("brd" → "Board", "gtcal" → "Go to Calendar") rather than exact
// substrings. `fuzzyScore` returns null for no match, or a number where higher =
// better; substring matches always outrank scattered subsequence matches, and
// word-start / contiguous hits score above mid-word ones, so the best label
// floats to the top when results are sorted by score.

const BOUNDARY = /[\s\-_/.:>]/;

/**
 * Case-insensitive fuzzy score of `query` against `text`.
 * - `null` when `query` is not an in-order subsequence of `text`.
 * - An empty query scores 0 (matches everything — caller decides browse order).
 * - A substring match scores in a high band (earlier + at a word boundary wins).
 * - Otherwise an in-order subsequence, rewarded for contiguity and word starts.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const t = text.toLowerCase();

  // Substring: the strongest signal. Keep it in a band above any subsequence
  // score so "board" ranks the literal "Board" row above scattered matches.
  const sub = t.indexOf(q);
  if (sub !== -1) {
    const atBoundary = sub === 0 || BOUNDARY.test(t[sub - 1]);
    return 1000 - sub + (atBoundary ? 100 : 0);
  }

  // In-order subsequence with contiguity + word-boundary bonuses.
  let ti = 0;
  let score = 0;
  let prev = -2;
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi];
    while (ti < t.length && t[ti] !== ch) ti++;
    if (ti >= t.length) return null;
    if (ti === prev + 1) score += 8; // contiguous run
    if (ti === 0 || BOUNDARY.test(t[ti - 1])) score += 6; // start of a word
    prev = ti;
    ti++;
  }
  // Tighter (shorter) texts edge out longer ones on ties.
  return score - t.length * 0.05;
}

/** Whether `query` fuzzy-matches `text` (an in-order, case-insensitive subsequence). */
export function fuzzyMatch(query: string, text: string): boolean {
  return fuzzyScore(query, text) !== null;
}

/** Best fuzzy score of `query` across several candidate strings (null if none match). */
export function bestFuzzyScore(query: string, texts: Array<string | null | undefined>): number | null {
  let best: number | null = null;
  for (const text of texts) {
    if (text == null) continue;
    const s = fuzzyScore(query, text);
    if (s !== null && (best === null || s > best)) best = s;
  }
  return best;
}
