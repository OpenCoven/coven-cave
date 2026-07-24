// Findings document model — turns a mission's freeform findings markdown into
// the structured shape the Research Reader renders: a title, an optional lede,
// and collapsible sections whose prose/lists/tables carry inline source-ref
// chips (S14, C1, …) cross-linked to the evidence rail.
//
// The parser is deliberately small and line-based rather than a general
// markdown engine: the reader needs *structure* (sections to collapse and list
// in the contents rail, tables to typeset as Key Results, and ref tokens to
// chip) that a plain HTML renderer would flatten away. It degrades honestly —
// unknown constructs fall through to paragraphs, and nothing is invented.

import type { ResearchSourceRef } from "./research-missions.ts";

export type FindingsRefTone = "accent" | "warn" | "muted";

export type FindingsSpan =
  | { kind: "text"; text: string; bold?: boolean; italic?: boolean }
  | { kind: "ref"; id: string; tone: FindingsRefTone }
  | { kind: "link"; text: string; href: string };

export type FindingsBlock =
  | { kind: "p"; spans: FindingsSpan[] }
  | { kind: "ul"; items: FindingsSpan[][] }
  | { kind: "table"; header: FindingsSpan[][]; rows: FindingsSpan[][][] };

export type FindingsSection = {
  /** Stable slug used for the contents rail anchor and scroll-spy. */
  id: string;
  /** Empty when the body has no headings (a single untitled section). */
  heading: string;
  blocks: FindingsBlock[];
  /** Unique source/conflict ids cited anywhere in this section, in order. */
  refIds: string[];
};

export type FindingsDoc = {
  title: string | null;
  lede: FindingsSpan[] | null;
  sections: FindingsSection[];
  /** Union of every ref id cited across the document, in first-seen order. */
  refIds: string[];
};

/** Map a source's ledger status to the chip tone the reader paints. */
export function refToneForStatus(status: ResearchSourceRef["status"]): FindingsRefTone {
  if (status === "conflicting") return "warn";
  if (status === "rejected") return "muted";
  return "accent";
}

type RefResolver = { pattern: RegExp | null; toneFor: (id: string) => FindingsRefTone };

const CONFLICT_ID_RE = /^C\d+$/;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Build the ref tokenizer from the mission's real source ids so only genuine
 *  references become chips — arbitrary capitalised words never do. Conflict
 *  ids (C1, C2, …) are always recognised even when they carry no source row. */
function buildRefResolver(sources: ResearchSourceRef[]): RefResolver {
  const toneById = new Map<string, FindingsRefTone>();
  for (const source of sources) {
    if (source.id) toneById.set(source.id, refToneForStatus(source.status));
  }
  // Longest ids first so "S14" wins over "S1" in the alternation.
  const ids = [...toneById.keys()].sort((a, b) => b.length - a.length);
  const alternatives = ids.map(escapeRegExp);
  // Always recognise bare conflict tokens even if absent from the ledger.
  alternatives.push("C\\d+");
  const pattern = alternatives.length
    ? new RegExp(`\\[?\\b(${alternatives.join("|")})\\b\\]?`, "g")
    : null;
  return {
    pattern,
    toneFor: (id) => toneById.get(id) ?? (CONFLICT_ID_RE.test(id) ? "warn" : "accent"),
  };
}

/** Split plain text into text/ref spans (no emphasis parsing at this layer). */
function tokenizeRefs(text: string, resolver: RefResolver, base: { bold?: boolean; italic?: boolean }): FindingsSpan[] {
  if (!resolver.pattern || !text) {
    return text ? [{ kind: "text", text, ...base }] : [];
  }
  const spans: FindingsSpan[] = [];
  let last = 0;
  resolver.pattern.lastIndex = 0;
  for (let m = resolver.pattern.exec(text); m; m = resolver.pattern.exec(text)) {
    if (m.index > last) spans.push({ kind: "text", text: text.slice(last, m.index), ...base });
    spans.push({ kind: "ref", id: m[1], tone: resolver.toneFor(m[1]) });
    last = m.index + m[0].length;
  }
  if (last < text.length) spans.push({ kind: "text", text: text.slice(last), ...base });
  return spans;
}

// Emphasis + link matcher: **bold**, __bold__, *italic*, _italic_, [text](url).
const INLINE_RE =
  /(\*\*|__)([\s\S]+?)\1|(\*|_)([\s\S]+?)\3|\[([^\]]+)\]\(([^)\s]+)\)/g;

/** Parse one run of inline markdown into spans (emphasis, links, ref chips). */
export function parseInline(input: string, sources: ResearchSourceRef[]): FindingsSpan[] {
  return parseSpans(input, buildRefResolver(sources));
}

function parseSpans(input: string, resolver: RefResolver): FindingsSpan[] {
  const text = input.trim();
  if (!text) return [];
  const spans: FindingsSpan[] = [];
  let last = 0;
  INLINE_RE.lastIndex = 0;
  for (let m = INLINE_RE.exec(text); m; m = INLINE_RE.exec(text)) {
    if (m.index > last) spans.push(...tokenizeRefs(text.slice(last, m.index), resolver, {}));
    if (m[1]) {
      spans.push(...tokenizeRefs(m[2], resolver, { bold: true }));
    } else if (m[3]) {
      spans.push(...tokenizeRefs(m[4], resolver, { italic: true }));
    } else {
      spans.push({ kind: "link", text: m[5], href: m[6] });
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) spans.push(...tokenizeRefs(text.slice(last), resolver, {}));
  return spans;
}

function collectRefIds(spans: FindingsSpan[], into: string[]): void {
  for (const span of spans) {
    if (span.kind === "ref" && !into.includes(span.id)) into.push(span.id);
  }
}

function slugify(heading: string, index: number): string {
  const base = heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `s-${base || `section-${index + 1}`}`;
}

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*$/;
const LIST_RE = /^\s*[-*+]\s+(.+)$/;
const TABLE_ROW_RE = /^\s*\|(.+)\|\s*$/;
const TABLE_SEP_RE = /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/;

function splitCells(row: string): string[] {
  return row
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

/** Parse the body region (everything after the title/lede or one section) into
 *  blocks. Consecutive list items merge into one list; pipe tables with a
 *  dash separator become table blocks; wrapped prose lines join into one
 *  paragraph. */
function parseBlocks(lines: string[], resolver: RefResolver): FindingsBlock[] {
  const blocks: FindingsBlock[] = [];
  let paragraph: string[] = [];
  let list: FindingsSpan[][] | null = null;

  const flushParagraph = () => {
    if (paragraph.length) {
      const spans = parseSpans(paragraph.join(" "), resolver);
      if (spans.length) blocks.push({ kind: "p", spans });
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list && list.length) blocks.push({ kind: "ul", items: list });
    list = null;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }

    // Pipe table: a row line immediately followed by a dash separator.
    if (TABLE_ROW_RE.test(line) && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1])) {
      flushParagraph();
      flushList();
      const header = splitCells(line).map((cell) => parseSpans(cell, resolver));
      const rows: FindingsSpan[][][] = [];
      i += 2;
      for (; i < lines.length && TABLE_ROW_RE.test(lines[i]); i += 1) {
        rows.push(splitCells(lines[i]).map((cell) => parseSpans(cell, resolver)));
      }
      i -= 1;
      blocks.push({ kind: "table", header, rows });
      continue;
    }

    const listMatch = LIST_RE.exec(line);
    if (listMatch) {
      flushParagraph();
      list = list ?? [];
      list.push(parseSpans(listMatch[1], resolver));
      continue;
    }

    flushList();
    // Blockquotes inside the body read as ordinary prose (strip the marker).
    paragraph.push(line.replace(/^\s*>\s?/, "").trim());
  }
  flushParagraph();
  flushList();
  return blocks;
}

function sectionRefIds(blocks: FindingsBlock[]): string[] {
  const ids: string[] = [];
  for (const block of blocks) {
    if (block.kind === "p") collectRefIds(block.spans, ids);
    else if (block.kind === "ul") for (const item of block.items) collectRefIds(item, ids);
    else {
      for (const cell of block.header) collectRefIds(cell, ids);
      for (const row of block.rows) for (const cell of row) collectRefIds(cell, ids);
    }
  }
  return ids;
}

/** Strip the leading `<!-- research-provenance … -->` header (and any other
 *  HTML comments) so it never renders as prose. */
function stripComments(markdown: string): string {
  return markdown.replace(/<!--[\s\S]*?-->/g, "");
}

/**
 * Parse findings markdown into the reader's document model. `sources` supplies
 * the id set that turns S14/C1 tokens into chips.
 */
export function parseFindingsDoc(markdown: string, sources: ResearchSourceRef[]): FindingsDoc {
  const resolver = buildRefResolver(sources);
  const lines = stripComments(markdown ?? "").split(/\r?\n/);

  let title: string | null = null;
  let lede: FindingsSpan[] | null = null;
  const sections: FindingsSection[] = [];

  // Group lines by heading. The first level-1 heading is the title; the region
  // before the first sub-heading yields the lede (its first paragraph/quote).
  type Group = { heading: string; level: number; lines: string[] };
  const preamble: string[] = [];
  const groups: Group[] = [];
  let current: Group | null = null;

  for (const line of lines) {
    const headingMatch = HEADING_RE.exec(line);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const heading = headingMatch[2].trim();
      if (title === null && level === 1) {
        title = heading;
        current = null;
        continue;
      }
      current = { heading, level, lines: [] };
      groups.push(current);
      continue;
    }
    if (current) current.lines.push(line);
    else preamble.push(line);
  }

  // Lede: only a *leading blockquote* becomes the italic tagline under the
  // title (matching the design). Plain opening prose stays body text so a
  // heading-less "title + paragraph" doc doesn't lose its content to a lede.
  const preambleBlocks = parseBlocks(preamble, resolver);
  const firstNonEmpty = preamble.find((line) => line.trim());
  const leadsWithQuote = Boolean(firstNonEmpty && /^\s*>/.test(firstNonEmpty));
  let leadBlocks: FindingsBlock[] = preambleBlocks;
  if (leadsWithQuote && preambleBlocks[0]?.kind === "p") {
    lede = preambleBlocks[0].spans;
    leadBlocks = preambleBlocks.slice(1);
  }

  groups.forEach((group, index) => {
    const blocks = parseBlocks(group.lines, resolver);
    sections.push({
      id: slugify(group.heading, index),
      heading: group.heading,
      blocks,
      refIds: sectionRefIds(blocks),
    });
  });

  // Leftover preamble prose (rare) is preserved as a leading, heading-less
  // section rather than discarded.
  if (leadBlocks.length) {
    sections.unshift({ id: "s-overview", heading: "", blocks: leadBlocks, refIds: sectionRefIds(leadBlocks) });
  }

  const refIds: string[] = [];
  if (lede) collectRefIds(lede, refIds);
  for (const section of sections) for (const id of section.refIds) if (!refIds.includes(id)) refIds.push(id);

  return { title, lede, sections, refIds };
}

/** Sections (id + heading) that cite the given source id — the evidence card's
 *  "Supports" links, derived from where the source is actually referenced. */
export function sectionsSupportingRef(
  doc: FindingsDoc,
  id: string,
): Array<{ id: string; heading: string }> {
  return doc.sections
    .filter((section) => section.heading && section.refIds.includes(id))
    .map((section) => ({ id: section.id, heading: section.heading }));
}
