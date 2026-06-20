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

/** A single-line bold tagline (`**…**`) or a markdown heading (`## …`) — the
 *  kind of subtitle research notes place between the title and the metadata
 *  run. Used to allow ONE leading subtitle before the metadata. */
function isLeadingSubtitle(lines: string[], start: number, end: number): boolean {
  if (end - start !== 1) return false; // single line only
  const line = lines[start].trim();
  return /^#{1,6}\s/.test(line) || /^\*\*[^*].*\*\*$/.test(line);
}

/**
 * Detect a leading metadata paragraph and split it into entries.
 *
 * Qualifies when the metadata run is the first paragraph, OR when it's the
 * second paragraph and the first is a single-line subtitle/heading (a bold
 * tagline or `## …`) — many notes open with such a subtitle before the
 * metadata. The subtitle is kept in `rest` (it renders below the lifted grid);
 * only the metadata paragraph is removed. Skips at most one leading subtitle,
 * so a metadata-looking paragraph buried under real prose isn't swallowed.
 * Returns `null` when no leading metadata paragraph is present.
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

  // Case 2 — a single leading subtitle/heading precedes the metadata run.
  if (!isLeadingSubtitle(lines, first.start, first.end)) return null;
  const second = gatherParagraph(lines, first.end);
  if (!second) return null;
  const secondEntries = metadataEntries(second.text);
  if (!secondEntries) return null;

  const subtitle = lines.slice(first.start, first.end).join("\n");
  const after = lines.slice(second.end).join("\n").replace(/^\n+/, "");
  const rest = after ? `${subtitle}\n\n${after}` : subtitle;
  return { entries: secondEntries, rest };
}
