/**
 * Turning a Shiki `<pre><code>…</code></pre>` string into per-line HTML so a
 * surface can address individual lines (cave-f6mu9).
 *
 * The reading inspector needs each line to be its own clickable row — line
 * numbers select, shift-click extends — which the highlighter's single
 * `<code>` blob cannot express. Splitting on newlines is safe because Shiki
 * emits one `<span class="line">` per source line and never wraps a newline
 * inside a token: the newline characters in the output are exactly the source
 * line breaks.
 *
 * Framework-free so the split is unit-testable without a highlighter.
 */

const CODE_INNER_RE = /<code[^>]*>([\s\S]*)<\/code>/;

/**
 * Extract the per-line HTML fragments from a highlighted block.
 *
 * Falls back to escaping the raw source when the input is not the expected
 * shape — a caller that hands us a plain string still gets one row per line
 * rather than an empty panel.
 */
export function splitHighlightedLines(html: string, fallbackSource: string): string[] {
  const match = CODE_INNER_RE.exec(html);
  if (!match) return escapeLines(fallbackSource);
  const lines = match[1].split("\n");
  // Shiki terminates the final line with a newline, producing a trailing empty
  // fragment that would render as a phantom last line.
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.length > 0 ? lines : escapeLines(fallbackSource);
}

function escapeLines(source: string): string[] {
  return source
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => escapeHtml(line));
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
