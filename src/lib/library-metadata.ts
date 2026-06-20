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

// A "subtitle" line: a markdown heading (`## …`), a bold tagline (`**…**`), or
// an italic tagline (`*…*`). Research notes place these between the title and
// the metadata run.
const SUBTITLE_LINE_RE = /^(?:#{1,6}\s|\*\*[^*].*\*\*$|\*[^*].*\*$)/;

/** A subtitle block: every line is a heading/bold/italic tagline (a block may
 *  be multi-line, e.g. a stacked `## …` + `### …`). Used to skip the
 *  subtitle/heading region notes place before the metadata run. */
function isSubtitleBlock(lines: string[], start: number, end: number): boolean {
  if (end <= start) return false;
  for (let i = start; i < end; i++) {
    if (!SUBTITLE_LINE_RE.test(lines[i].trim())) return false;
  }
  return true;
}

// Cap on how many leading subtitle/heading blocks we skip looking for the
// metadata run — enough for a stacked-heading + tagline opener, low enough that
// a metadata-looking paragraph buried in real prose is never swallowed.
const MAX_SUBTITLE_SKIP = 3;

/**
 * Detect a leading metadata paragraph and split it into entries.
 *
 * Qualifies when the metadata run is the first paragraph, OR when it follows a
 * short leading run of subtitle/heading blocks — a bold or italic tagline,
 * `## …` headings, or a stack of them — which research notes routinely place
 * between the title and the metadata. The skipped subtitles are kept in `rest`
 * (they render below the lifted grid); only the metadata paragraph is removed.
 * At most MAX_SUBTITLE_SKIP all-subtitle blocks are skipped, and skipping stops
 * at the first non-subtitle block, so a metadata-looking paragraph buried under
 * real prose isn't swallowed. Returns `null` when no leading metadata is found.
 */
export function parseLeadingMetadata(body: string): LeadingMetadata | null {
  const lines = body.split("\n");

  const first = gatherParagraph(lines, 0);
  if (!first) return null;

  // Case 1 — metadata is the very first paragraph.
  const firstEntries = metadataEntries(first.text);
  if (firstEntries) {
    const rest = lines.slice(first.end).join("\n").replace(/^\n+/, "");
    return { entries: firstEntries, rest };
  }

  // Case 2 — the metadata run follows a short run of leading subtitle blocks.
  const skipped: string[] = [];
  let block: ReturnType<typeof gatherParagraph> = first;
  let skips = 0;
  while (block && isSubtitleBlock(lines, block.start, block.end) && skips < MAX_SUBTITLE_SKIP) {
    skipped.push(lines.slice(block.start, block.end).join("\n"));
    skips++;
    const next = gatherParagraph(lines, block.end);
    if (!next) return null;
    const entries = metadataEntries(next.text);
    if (entries) {
      const after = lines.slice(next.end).join("\n").replace(/^\n+/, "");
      const head = skipped.join("\n\n");
      const rest = after ? `${head}\n\n${after}` : head;
      return { entries, rest };
    }
    block = next; // not metadata — keep going only if it's another subtitle block
  }
  return null;
}
