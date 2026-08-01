/**
 * In-transcript find (CHAT-D9-04, extended for the Chat.dc.html 2a find band).
 *
 * Two levels of result:
 *
 * - {@link findMatchingTurnIds} — which TURNS match. Drives the jump targets,
 *   because scrolling lands on a turn, not on a character offset.
 * - {@link findTranscriptHits} — every OCCURRENCE, with the snippet and the
 *   offsets needed to highlight the hit in place. Drives the band's hit list.
 *
 * Both scan a turn's VISIBLE text: callers pass the already-rendered visible
 * body, so reasoning blocks and tool payloads are deliberately excluded.
 */

export type FindableTurn = {
  id: string;
  /** Visible transcript text for the turn (post reasoning-split). */
  text: string;
  role?: "user" | "assistant" | "system";
};

export type FindOptions = {
  /** Case-sensitive when true. Default false. */
  matchCase?: boolean;
  /** Require word boundaries around the hit. Default false. */
  wholeWord?: boolean;
};

export type TranscriptHit = {
  turnId: string;
  role: "user" | "assistant" | "system";
  /** 0-based position of the turn in the transcript — the design's "step". */
  turnIndex: number;
  /** 1-based occurrence within its own turn. */
  occurrenceInTurn: number;
  /** How many occurrences that turn holds, so a row can read "2 of 5". */
  occurrencesInTurn: number;
  /** The turn's normalized text, windowed around this hit. */
  snippet: string;
  /** Offsets of the hit inside `snippet`. */
  snippetStart: number;
  snippetEnd: number;
  /** Window cut a leading / trailing piece off the turn text. */
  ellipsisStart: boolean;
  ellipsisEnd: boolean;
};

/** Characters that count as "inside a word" for the Whole word toggle. */
const WORD_CHAR = /[\p{L}\p{N}_]/u;
/** Snippet window: enough context to recognise the line, short enough to scan. */
const SNIPPET_BUDGET = 96;
const SNIPPET_LEAD = 28;

/**
 * Collapse whitespace runs to single spaces.
 *
 * Matching and display both run on this normalized form, which is what keeps
 * snippet offsets honest: if we matched the raw text but displayed a collapsed
 * version, every newline before a hit would shift the highlight left.
 */
export function normalizeFindText(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

/**
 * Lowercase without changing string length.
 *
 * `String.prototype.toLowerCase` is not length-preserving for every input —
 * "İ" lowercases to two code units, and some ligatures expand. Folding the
 * haystack with it would desync every offset after such a character, so the
 * hit would highlight the wrong span. Here each code point folds only when its
 * lowercase occupies the same number of UTF-16 units; otherwise the original
 * is kept. The cost is that those few characters do not match
 * case-insensitively — far better than a corrupted highlight.
 */
function foldPreservingLength(text: string): string {
  // Fast path: the common case folds cleanly, so skip the per-code-point walk.
  const naive = text.toLowerCase();
  if (naive.length === text.length) return naive;
  let out = "";
  for (const ch of text) {
    const lower = ch.toLowerCase();
    out += lower.length === ch.length ? lower : ch;
  }
  return out;
}

function isWordBoundedAt(haystack: string, start: number, end: number): boolean {
  const before = start > 0 ? haystack[start - 1] : "";
  const after = end < haystack.length ? haystack[end] : "";
  return !(before && WORD_CHAR.test(before)) && !(after && WORD_CHAR.test(after));
}

/**
 * Every occurrence of `normalizedQuery` in `normalizedText`, as [start, end)
 * offsets. Scans with indexOf rather than a RegExp: no escaping bugs on
 * queries like `a.*b` or `(`, and no ReDoS surface on user input.
 */
export function findOccurrences(
  normalizedText: string,
  normalizedQuery: string,
  options: FindOptions = {},
): Array<{ start: number; end: number }> {
  if (!normalizedQuery) return [];
  const haystack = options.matchCase ? normalizedText : foldPreservingLength(normalizedText);
  const needle = options.matchCase ? normalizedQuery : foldPreservingLength(normalizedQuery);
  if (!needle) return [];
  const out: Array<{ start: number; end: number }> = [];
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) break;
    const end = at + needle.length;
    if (!options.wholeWord || isWordBoundedAt(haystack, at, end)) {
      out.push({ start: at, end });
    }
    // Advance past this occurrence, so "aa" in "aaa" counts twice rather than
    // three times — the same way editors count.
    from = at + needle.length;
  }
  return out;
}

function snippetFor(
  text: string,
  start: number,
  end: number,
): Pick<TranscriptHit, "snippet" | "snippetStart" | "snippetEnd" | "ellipsisStart" | "ellipsisEnd"> {
  if (text.length <= SNIPPET_BUDGET) {
    return {
      snippet: text,
      snippetStart: start,
      snippetEnd: end,
      ellipsisStart: false,
      ellipsisEnd: false,
    };
  }
  // Keep a little text before the hit so the row reads as a sentence, but
  // never push the hit itself out of the window.
  let from = Math.max(0, start - SNIPPET_LEAD);
  let to = Math.min(text.length, from + SNIPPET_BUDGET);
  if (to - from < SNIPPET_BUDGET) from = Math.max(0, to - SNIPPET_BUDGET);
  // A hit longer than the window still starts at the window's left edge.
  if (end > to) to = Math.min(text.length, start + SNIPPET_BUDGET);
  return {
    snippet: text.slice(from, to),
    snippetStart: start - from,
    snippetEnd: Math.min(end, to) - from,
    ellipsisStart: from > 0,
    ellipsisEnd: to < text.length,
  };
}

/**
 * Every occurrence across the transcript, in reading order.
 *
 * A blank query matches nothing — an empty find band should read 0 results,
 * not "every turn matches the empty string".
 */
export function findTranscriptHits(
  turns: readonly FindableTurn[],
  query: string,
  options: FindOptions = {},
): TranscriptHit[] {
  const needle = normalizeFindText(query);
  if (!needle) return [];
  const hits: TranscriptHit[] = [];
  turns.forEach((turn, turnIndex) => {
    const text = normalizeFindText(turn.text);
    const found = findOccurrences(text, needle, options);
    found.forEach((occurrence, i) => {
      hits.push({
        turnId: turn.id,
        role: turn.role ?? "assistant",
        turnIndex,
        occurrenceInTurn: i + 1,
        occurrencesInTurn: found.length,
        ...snippetFor(text, occurrence.start, occurrence.end),
      });
    });
  });
  return hits;
}

/**
 * Ids of turns whose visible text contains `query`, in transcript order — one
 * entry per turn however many times it matches, because a jump lands on a turn.
 */
export function findMatchingTurnIds(
  turns: readonly FindableTurn[],
  query: string,
  options: FindOptions = {},
): string[] {
  const needle = normalizeFindText(query);
  if (!needle) return [];
  const out: string[] = [];
  for (const turn of turns) {
    if (findOccurrences(normalizeFindText(turn.text), needle, options).length > 0) {
      out.push(turn.id);
    }
  }
  return out;
}
