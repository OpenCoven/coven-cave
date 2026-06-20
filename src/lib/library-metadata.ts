// Leading-metadata extraction for library research notes.
//
// Sage's research notes open with a metadata paragraph — a run of
// `**Date:** … **Source:** … **Stars:** …` bold-label pairs. Rendered inline
// it's a hard-to-scan wrapped blob, so the preview lifts it out of the markdown
// and renders it as a collapsible key/value grid. This module is the pure
// parser (no JSX) so it can be tested directly under
// `node --experimental-strip-types`.

export interface MetaEntry {
  key: string;
  value: string;
}

export interface LeadingMetadata {
  entries: MetaEntry[];
  /** Body markdown with the metadata paragraph removed. */
  rest: string;
}

// A `**Label:**` bold label (colon immediately before the closing `**`).
const LABEL_RE = /\*\*\s*[^*\n]+?\s*:\s*\*\*/g;
const ENTRY_RE = /\*\*\s*([^*\n]+?)\s*:\s*\*\*\s*([\s\S]*?)(?=\s*\*\*\s*[^*\n]+?\s*:\s*\*\*|$)/g;

/** Parse a paragraph's text into metadata entries, or null when it isn't a
 *  bold-label run with at least two labels. */
function metadataEntries(text: string): MetaEntry[] | null {
  if (!/^\*\*\s*[^*\n]+?\s*:\s*\*\*/.test(text)) return null;
  if ((text.match(LABEL_RE) ?? []).length < 2) return null;
  const entries: MetaEntry[] = [];
  const re = new RegExp(ENTRY_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const key = m[1].trim();
    const value = m[2].trim();
    if (key) entries.push({ key, value });
  }
  return entries.length >= 2 ? entries : null;
}

/** Gather the paragraph at/after `from` (skipping blank lines). Returns its
 *  start/end line indices and joined text, or null past end of body. */
function gatherParagraph(
  lines: string[],
  from: number,
): { start: number; end: number; text: string } | null {
  let i = from;
  while (i < lines.length && lines[i].trim() === "") i++;
  if (i >= lines.length) return null;
  const start = i;
  const para: string[] = [];
  while (i < lines.length && lines[i].trim() !== "") {
    para.push(lines[i]);
    i++;
  }
  return { start, end: i, text: para.join(" ").trim() };
}

// A leading blockquote marker (`> `), tolerated so blockquoted metadata
// (`> **Document type:** …`) and blockquoted taglines are recognized.
const BLOCKQUOTE_RE = /^\s*>\s?/;
const stripQuote = (line: string): string => line.replace(BLOCKQUOTE_RE, "");

/** A `**Label:**` metadata label line (blockquote prefix tolerated). */
function isLabelLine(line: string): boolean {
  return /^\*\*\s*[^*\n]+?\s*:\s*\*\*/.test(stripQuote(line).trim());
}

/** A "subtitle" line — a heading (`## …`), a bold tagline (`**…**`), or an
 *  italic tagline (`*…*`) — but NOT a metadata label. Covers the subtitles and
 *  bylines notes place between the title and the metadata run. */
function isSubtitleLine(line: string): boolean {
  const l = stripQuote(line).trim();
  if (isLabelLine(line)) return false;
  return /^#{1,6}\s/.test(l) || /^\*\*[^*].*\*\*$/.test(l) || /^\*[^*].*\*$/.test(l);
}

/** Block text with blockquote markers stripped, for metadata detection. */
function blockText(lines: string[], start: number, end: number): string {
  return lines.slice(start, end).map(stripQuote).join(" ").trim();
}

/** Every line of the block is a subtitle line (heading/tagline) — a block to
 *  skip while looking for the metadata run (may be multi-line, e.g. stacked
 *  `## …` + `### …`). */
function isSubtitleBlock(lines: string[], start: number, end: number): boolean {
  if (end <= start) return false;
  for (let i = start; i < end; i++) if (!isSubtitleLine(lines[i])) return false;
  return true;
}

/** Extract metadata from a single block, blockquote-aware and peeling any
 *  leading subtitle/byline LINES that precede the first label within the block
 *  (e.g. `**Research note by Sage · …**` then `**Requested by:** …`). Returns
 *  the entries plus the peeled leading lines (kept for `rest`), or null. */
function metadataFromBlock(
  lines: string[],
  start: number,
  end: number,
): { entries: MetaEntry[]; peeled: string[] } | null {
  const whole = metadataEntries(blockText(lines, start, end));
  if (whole) return { entries: whole, peeled: [] };

  // Peel leading non-label lines, but only if each is a subtitle/byline line.
  let j = start;
  while (j < end && !isLabelLine(lines[j])) {
    if (!isSubtitleLine(lines[j])) return null;
    j++;
  }
  if (j === start || j >= end) return null;
  const entries = metadataEntries(blockText(lines, j, end));
  if (!entries) return null;
  return { entries, peeled: lines.slice(start, j) };
}

// Cap on how many leading subtitle/heading blocks we skip looking for the
// metadata run — enough for a stacked-heading + tagline opener, low enough that
// a metadata-looking paragraph buried in real prose is never swallowed.
const MAX_SUBTITLE_SKIP = 3;

/**
 * Detect a leading metadata run and split it into entries.
 *
 * Qualifies when the metadata run is the first paragraph, or follows a short
 * leading run of subtitle blocks (bold/italic taglines, `## …` headings, or a
 * stack of them). Within a block, a leading byline line (`**… no colon …**`)
 * before the labels is peeled, and blockquoted metadata (`> **X:** …`) is
 * recognized. Skipped subtitles and peeled bylines are kept in `rest` (they
 * render below the lifted grid); only the metadata lines are removed. At most
 * MAX_SUBTITLE_SKIP all-subtitle blocks are skipped and skipping stops at the
 * first non-subtitle block, so a metadata-looking paragraph buried under real
 * prose isn't swallowed. Returns `null` when no leading metadata is found.
 */
export function parseLeadingMetadata(body: string): LeadingMetadata | null {
  const lines = body.split("\n");
  const skipped: string[] = [];
  let cursor = 0;
  let skips = 0;

  for (;;) {
    const block = gatherParagraph(lines, cursor);
    if (!block) return null;

    const got = metadataFromBlock(lines, block.start, block.end);
    if (got) {
      const after = lines.slice(block.end).join("\n").replace(/^\n+/, "");
      const head = [...skipped, ...(got.peeled.length ? [got.peeled.join("\n")] : [])].join("\n\n");
      const rest = head ? (after ? `${head}\n\n${after}` : head) : after;
      return { entries: got.entries, rest };
    }

    // Not metadata — only keep looking past an all-subtitle block.
    if (skips >= MAX_SUBTITLE_SKIP || !isSubtitleBlock(lines, block.start, block.end)) return null;
    skipped.push(lines.slice(block.start, block.end).join("\n"));
    cursor = block.end;
    skips++;
  }
}
