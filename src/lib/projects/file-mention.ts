/**
 * `@`-file mention helpers for the chat composer (CHAT-D1-04).
 *
 * Pure functions so the token parsing and fuzzy ranking are behaviorally
 * testable without a DOM: `fileMentionToken` finds the active `@query`
 * token at the caret, `filterFileMentions` ranks the workspace file index
 * against the query.
 */

/** Hard cap on mentions per send — mirrors the attachment cap. */
export const MAX_FILE_MENTIONS = 10;
/** How many fuzzy matches the picker shows. */
export const FILE_MENTION_RESULT_LIMIT = 12;

export type FileMentionToken = {
  /** Index of the `@` in the composer text. */
  start: number;
  /** Text between the `@` and the caret. */
  query: string;
};

/**
 * Find the active `@` mention token at the caret. The `@` must start the
 * text or follow whitespace — so emails and mid-word `@` never trigger the
 * picker, and a `/slash` first token can never also be a mention (the two
 * menus stay disjoint). The query must contain no whitespace and no second
 * `@`; it may contain `/` so nested paths keep filtering.
 */
export function fileMentionToken(text: string, caret: number): FileMentionToken | null {
  const bounded = Math.max(0, Math.min(caret, text.length));
  const upTo = text.slice(0, bounded);
  const start = upTo.lastIndexOf("@");
  if (start < 0) return null;
  if (start > 0 && !/\s/.test(upTo[start - 1] ?? "")) return null;
  const query = upTo.slice(start + 1);
  if (/[\s@]/.test(query)) return null;
  return { start, query };
}

/** True when every char of `query` appears in `target` in order. */
function isSubsequence(query: string, target: string): boolean {
  let qi = 0;
  for (let ti = 0; ti < target.length && qi < query.length; ti += 1) {
    if (target[ti] === query[qi]) qi += 1;
  }
  return qi === query.length;
}

function basenameOf(p: string): string {
  const idx = p.lastIndexOf("/");
  return idx < 0 ? p : p.slice(idx + 1);
}

/**
 * Case-insensitive fuzzy filter over repo-relative paths. Rank order:
 *   0 — basename starts with the query (best: `@cha` → chat-view.tsx)
 *   1 — basename contains the query
 *   2 — full path contains the query
 *   3 — query is a subsequence of the full path (weakest)
 * Ties break to the shorter path, then lexicographically. An empty query
 * returns the head of the index unranked.
 */
export function filterFileMentions(
  files: readonly string[],
  query: string,
  limit: number = FILE_MENTION_RESULT_LIMIT,
): string[] {
  if (limit <= 0) return [];
  const q = query.trim().toLowerCase();
  if (!q) return files.slice(0, limit);

  const scored: Array<{ file: string; rank: number }> = [];
  for (const file of files) {
    const p = file.toLowerCase();
    const base = basenameOf(p);
    let rank: number;
    if (base.startsWith(q)) rank = 0;
    else if (base.includes(q)) rank = 1;
    else if (p.includes(q)) rank = 2;
    else if (isSubsequence(q, p)) rank = 3;
    else continue;
    scored.push({ file, rank });
  }
  scored.sort(
    (a, b) =>
      a.rank - b.rank ||
      a.file.length - b.file.length ||
      (a.file < b.file ? -1 : a.file > b.file ? 1 : 0),
  );
  return scored.slice(0, limit).map((entry) => entry.file);
}
