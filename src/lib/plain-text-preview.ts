// Plain-text boundary for strings that were authored (or generated) as
// markdown but are rendered as bare text: chat titles derived from harness
// transcripts, sketch tiles named after a prompt, report rows. Rendering
// "## Prior conversation **User:** …" verbatim leaks syntax into the UI, so
// the syntax is stripped here rather than rendered or left in place.
//
// Deliberately conservative: only paired/anchored constructs are removed so
// content that merely contains a star or underscore ("2*3", "snake_case")
// survives untouched.

const HEADING_RE = /^#{1,6}\s+/;
const BLOCK_PREFIX_RE = /^(?:>\s*|[-*+]\s+|\d+[.)]\s+)+/;
const STRONG_RE = /(\*\*|__)(\S(?:.*?\S)?)\1/g;
const EMPHASIS_RE = /(^|[^\w*])[*_](\S(?:[^*_]*?\S)?)[*_](?=[^\w*]|$)/g;
const CODE_RE = /`+([^`]+)`+/g;
const LINK_RE = /!?\[([^\]]*)\]\([^)]*\)/g;
const STRIKE_RE = /~~(\S(?:.*?\S)?)~~/g;
// Dangling emphasis markers left when a title was cut mid-span
// ("**User:** Push cody/astra **" — the harness truncates before closing).
const DANGLING_MARKERS_RE = /(?:^|\s)(?:\*\*|__|\*|_|`)+(?=\s|$)/g;

/**
 * Strip inline and line-leading markdown syntax from a single-line string,
 * returning the readable text. Whitespace is collapsed to single spaces.
 */
export function stripInlineMarkdown(input: string | null | undefined): string {
  if (typeof input !== "string") return "";
  let text = input.replace(/\s+/g, " ").trim();
  if (!text) return "";
  // Run twice so nested wrappers ("# **Title**", "**`code`**") unwrap fully.
  for (let pass = 0; pass < 2; pass += 1) {
    text = text
      .replace(HEADING_RE, "")
      .replace(BLOCK_PREFIX_RE, "")
      .replace(LINK_RE, "$1")
      .replace(STRONG_RE, "$2")
      .replace(STRIKE_RE, "$1")
      .replace(CODE_RE, "$1")
      .replace(EMPHASIS_RE, "$1$2")
      .replace(DANGLING_MARKERS_RE, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  return text;
}
