// OpenKnowledge-style [[wiki-links]] between Grimoire docs (memory / knowledge /
// journal). This module is the pure parser: it extracts link references from a
// markdown string. Resolution of a target to a real doc lives in
// `wiki-link-resolve.ts`, and navigation reuses `grimoire-link.ts`.

export type WikiLink = {
  /** The full raw match including the brackets, e.g. "[[Title|Alias]]". */
  raw: string;
  /** The link target, before any alias pipe, trimmed. e.g. "Title". */
  target: string;
  /** The text to display: the alias (after `|`) if present, else the target. */
  display: string;
  /** Character offset of the match start in the source markdown. */
  index: number;
};

// A wiki-link is `[[target]]` or `[[target|display]]`. The inner text may not
// span lines or contain the bracket characters (so `[[a][b]]` / `[[nested]]`
// don't false-match) and the target may not be empty.
const WIKI_LINK_RE = /\[\[([^[\]\n|]+?)(?:\|([^[\]\n]+?))?\]\]/g;

// Mask a region (fenced code block or inline code span) with spaces of the SAME
// length, so link offsets in the masked string still line up with the original.
function blankOut(match: string): string {
  return match.replace(/[^\n]/g, " ");
}

/**
 * Extract `[[wiki-links]]` from a markdown string. Links inside fenced code
 * blocks (``` / ~~~) and inline code spans (`…`) are ignored, so a `[[x]]` in a
 * code sample is treated as literal text, not a link.
 *
 * Supports `[[Target]]` and `[[Target|Alias]]`. Duplicate targets are returned
 * once per occurrence (callers de-dupe if they want unique links). The returned
 * `index` is the offset into the ORIGINAL `markdown`, so callers can decorate or
 * slice the source safely.
 */
export function extractWikiLinks(markdown: string): WikiLink[] {
  if (!markdown || markdown.indexOf("[[") === -1) return [];

  // Blank out code regions first so their contents can't match. Fenced blocks
  // before inline spans (a fence can contain backticks). Length is preserved,
  // so indices stay valid against the original string.
  const masked = markdown
    .replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, blankOut)
    .replace(/`[^`\n]*`/g, blankOut);

  const links: WikiLink[] = [];
  for (const m of masked.matchAll(WIKI_LINK_RE)) {
    const index = m.index ?? 0;
    const target = (m[1] ?? "").trim();
    if (!target) continue;
    const alias = m[2]?.trim();
    // Slice the raw match from the ORIGINAL so the display keeps its real text.
    const raw = markdown.slice(index, index + m[0].length);
    links.push({ raw, target, display: alias && alias.length > 0 ? alias : target, index });
  }
  return links;
}

/** Unique link targets from a markdown string, preserving first-seen order.
 *  Case-insensitive de-dupe (targets resolve case-insensitively downstream). */
export function uniqueWikiLinkTargets(markdown: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const { target } of extractWikiLinks(markdown)) {
    const key = target.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(target);
  }
  return out;
}
