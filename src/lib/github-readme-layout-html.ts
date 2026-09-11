/**
 * github-readme-layout-html.ts — strip block-level layout HTML out of a
 * captured README before it reaches the markdown parser (cave-3aww3).
 *
 * Why this exists: `@create-markdown/core` has no block-HTML pass, so a
 * `<div align="center">` wrapper — which is how a large share of real READMEs
 * centre their header — survives parsing as literal text and is then escaped
 * into the output. The reader sees `<div align="center">` and `</div>` printed
 * as prose. That is the P0-5 fidelity leak in the repository-modal redesign.
 *
 * The rule is: in a captured README, STRIP block-level layout HTML rather than
 * escape it. These tags carry presentation, not content, and dropping the tag
 * while keeping everything inside it is always closer to the author's intent
 * than printing the tag.
 *
 * Deliberately narrow. Inline HTML (`<a>`, `<code>`, `<kbd>`, `<b>`, `<i>`,
 * `<sub>`, `<sup>`, `<br>`, `<hr>`) already renders, tables already render, and
 * fenced code is left byte-identical — inside a fence the angle brackets ARE
 * the content, which is the one place escaping is correct.
 */

/**
 * Block-level wrappers that carry layout and nothing else. `<center>` is the
 * pre-HTML5 spelling of the same intent; `<picture>`/`<source>` wrap an
 * `<img>` that `suppressRemoteMedia` handles on its own.
 */
const LAYOUT_TAGS = [
  "div",
  // `<p>` in markdown is always redundant layout — paragraph breaks come from
  // blank lines — and its CLOSING tag has to go with it. Stripping only the
  // `align`-carrying opener the spec names would leave `</p>` behind, which is
  // the same leak one tag later.
  "p",
  "center",
  "section",
  "article",
  "figure",
  "figcaption",
  "picture",
  "source",
  "span",
  "table-of-contents",
];

const LAYOUT_TAG_RE = new RegExp(
  `</?(?:${LAYOUT_TAGS.join("|")})(?:\\s[^<>]*)?/?>`,
  "gi",
);

/** Self-closing or not, with or without alt/src ordering. */
const IMG_RE = /<img\s+([^<>]*?)\/?>/gi;

const ATTR_RE = /([a-z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>]+))/gi;

function readAttributes(raw: string): Map<string, string> {
  const attrs = new Map<string, string>();
  ATTR_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ATTR_RE.exec(raw)) !== null) {
    attrs.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attrs;
}

/**
 * Rewrite `<img>` into markdown image syntax so it flows through the pipeline
 * the app already has — including `suppressRemoteMedia`, which turns a remote
 * image into an alt-text placeholder rather than a silent gap. An `<img>` with
 * no usable `src` is dropped entirely; its alt text alone is not content.
 */
function rewriteImages(markdown: string): string {
  return markdown.replace(IMG_RE, (whole, rawAttrs: string) => {
    const attrs = readAttributes(rawAttrs);
    const src = (attrs.get("src") ?? "").trim();
    if (!src) return "";
    // A markdown image's own delimiters would terminate the syntax early.
    if (/[()\s]/.test(src)) return whole;
    const alt = (attrs.get("alt") ?? "").replace(/[[\]]/g, "").trim();
    return `![${alt}](${src})`;
  });
}

/**
 * Split on fenced-code boundaries so the transform never reaches inside a
 * fence. Returns alternating prose/fence chunks with a flag for each.
 *
 * Tracks the opening fence's character and run length, so a ```` ```` ```` block
 * containing a ``` line is not closed early.
 */
function splitFences(markdown: string): Array<{ text: string; fenced: boolean }> {
  const lines = markdown.split("\n");
  const chunks: Array<{ text: string; fenced: boolean }> = [];
  let buffer: string[] = [];
  let fence: { char: string; length: number } | null = null;

  const flush = (fenced: boolean) => {
    if (buffer.length === 0) return;
    chunks.push({ text: buffer.join("\n"), fenced });
    buffer = [];
  };

  for (const line of lines) {
    const opener = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (!fence && opener) {
      flush(false);
      fence = { char: opener[1][0], length: opener[1].length };
      buffer.push(line);
      continue;
    }
    if (fence) {
      buffer.push(line);
      const closer = /^\s{0,3}(`{3,}|~{3,})\s*$/.exec(line);
      if (
        closer
        && closer[1][0] === fence.char
        && closer[1].length >= fence.length
        && buffer.length > 1
      ) {
        flush(true);
        fence = null;
      }
      continue;
    }
    buffer.push(line);
  }
  flush(fence !== null);
  return chunks;
}

/**
 * Strip block-level layout HTML from a captured README.
 *
 * Content inside a stripped wrapper is kept verbatim; only the tags go. The
 * wrapper's alignment is lost, which is the deliberate trade: markdown has no
 * way to express it, and a centred header is worth less than a header with no
 * `<div align="center">` printed above it.
 */
export function stripReadmeLayoutHtml(markdown: string): string {
  if (!markdown.includes("<")) return markdown;
  return splitFences(markdown)
    .map(({ text, fenced }) => {
      if (fenced) return text;
      return rewriteImages(text)
        .replace(LAYOUT_TAG_RE, "")
        // A line that held nothing but layout tags is now blank-but-indented;
        // left alone it reads as an indented code block to the parser.
        .replace(/^[ \t]+$/gm, "");
    })
    .join("\n");
}
