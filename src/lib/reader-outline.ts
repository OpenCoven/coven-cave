// Pure model for the Expand reader's left rail (Reader.dc.html 3a): the
// contents list and the "N words · M min read" line under it.
//
// Both are read off the answer's own markdown — no new plumbing and no
// invented facts. A turn with no headings yields no outline, which is the
// signal the reader uses to keep the rail closed rather than render an empty
// panel pretending there is structure to navigate.
//
// Deliberately dependency-free so it is unit-testable with bare node and can
// never disagree with the prose it indexes.

/** One navigable heading in the answer. */
export type ReaderHeading = {
  /** Stable DOM id for the rail button ↔ heading anchor. */
  id: string;
  /** Heading text, with inline markdown stripped. */
  text: string;
  /** 1–6 as written; the rail indents anything below the shallowest level. */
  level: number;
};

/** Words per minute used for the read estimate. Deliberately conservative for
 *  technical prose — a review full of code spans reads slower than an essay. */
export const READER_WPM = 200;

export type ReadingStats = {
  words: number;
  /** Whole minutes, floored at 1 — "0 min read" tells the reader nothing. */
  minutes: number;
};

/** Fences hide `#` lines that are shell comments or markdown-in-markdown, not
 *  headings. Stripping them first is what keeps a bash block out of the rail. */
function withoutFencedBlocks(text: string): string {
  const out: string[] = [];
  let fence: string | null = null;
  for (const line of text.split("\n")) {
    const open = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fence) {
      if (open && open[1][0] === fence[0] && open[1].length >= fence.length) fence = null;
      continue;
    }
    if (open) {
      fence = open[1];
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

/** Inline markdown a heading may carry — links, emphasis, code spans. The rail
 *  shows the words, never the syntax. */
function stripInline(text: string): string {
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** Slug for the heading's scroll anchor. Collisions get a numeric suffix so
 *  two "Notes" headings stay independently reachable. */
function slugify(text: string, taken: Set<string>): string {
  const base =
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "section";
  let id = base;
  let n = 2;
  while (taken.has(id)) id = `${base}-${n++}`;
  taken.add(id);
  return id;
}

/** The answer's ATX headings, in document order. Setext (`===` underline)
 *  headings are deliberately not indexed: they are vanishingly rare in agent
 *  output and matching them costs a second pass over every line. */
export function readerOutline(text: string): ReaderHeading[] {
  const taken = new Set<string>();
  const headings: ReaderHeading[] = [];
  for (const line of withoutFencedBlocks(text).split("\n")) {
    const match = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!match) continue;
    const label = stripInline(match[2]);
    if (!label) continue;
    headings.push({ id: slugify(label, taken), text: label, level: match[1].length });
  }
  return headings;
}

/** Words and read time for the rail's footer. Fenced code is counted — the
 *  reader still has to move through it — but its syntax is not tokenised into
 *  dozens of fake words, so a diff does not read as a novel. */
export function readingStats(text: string): ReadingStats {
  const prose = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1");
  const words = prose.split(/\s+/).filter(Boolean).length;
  return { words, minutes: Math.max(1, Math.round(words / READER_WPM)) };
}

/** The shallowest heading level present — the rail indents relative to this,
 *  so an answer written entirely in `##` is not uniformly indented. */
export function outlineBaseLevel(headings: readonly ReaderHeading[]): number {
  return headings.reduce((min, h) => Math.min(min, h.level), 6);
}
