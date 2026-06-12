// Leading-metadata extraction for library research notes.
//
// Sage's research notes open with a metadata paragraph — a run of
// `**Date:** … **Source:** … **Stars:** …` bold-label pairs written as the
// first body paragraph. Rendered inline it's a hard-to-scan wrapped blob, so
// the preview lifts it out of the markdown and renders it as a collapsible
// key/value grid. This module is the pure parser (no JSX) so it can be tested
// directly under `node --experimental-strip-types`.

export interface MetaEntry {
  key: string;
  value: string;
}

export interface LeadingMetadata {
  entries: MetaEntry[];
  /** Body markdown with the metadata paragraph removed. */
  rest: string;
}

/**
 * Detect a leading metadata paragraph and split it into entries.
 *
 * Qualifies only when the first non-empty paragraph opens with a `**Label:**`
 * bold label and carries at least two of them — so ordinary prose that merely
 * starts with bold text isn't swallowed. Returns `null` when no metadata
 * paragraph is present, leaving the body untouched.
 */
export function parseLeadingMetadata(body: string): LeadingMetadata | null {
  const lines = body.split("\n");
  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i++;

  // Gather the first paragraph (up to the next blank line).
  const para: string[] = [];
  while (i < lines.length && lines[i].trim() !== "") {
    para.push(lines[i]);
    i++;
  }
  const text = para.join(" ").trim();

  // Must open with a bold label and carry ≥2 of them.
  if (!/^\*\*\s*[^*\n]+?\s*:\s*\*\*/.test(text)) return null;
  const labelCount = (text.match(/\*\*\s*[^*\n]+?\s*:\s*\*\*/g) ?? []).length;
  if (labelCount < 2) return null;

  const entries: MetaEntry[] = [];
  const re = /\*\*\s*([^*\n]+?)\s*:\s*\*\*\s*([\s\S]*?)(?=\s*\*\*\s*[^*\n]+?\s*:\s*\*\*|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const key = m[1].trim();
    const value = m[2].trim();
    if (key) entries.push({ key, value });
  }
  if (entries.length < 2) return null;

  const rest = lines.slice(i).join("\n").replace(/^\n+/, "");
  return { entries, rest };
}
