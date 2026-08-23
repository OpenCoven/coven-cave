/**
 * Composer markdown decoration model (cave-7ncq).
 *
 * The chat composer stays a real `<textarea>`: the message the daemon receives
 * is byte-for-byte the string the user typed, and every existing keydown
 * behaviour (slash menus, `@`-mentions, `{{placeholder}}` Tab cycling, ↑↓
 * history, IME-safe Enter) keeps working because nothing about the input
 * element changes. What this module adds is the *rendering* half of WYSIWYG:
 * a decoration list that a presentation layer paints behind the caret so
 * bold reads bold, code reads mono, and headings read large **while typing**.
 *
 * The single load-bearing invariant, which `composer-markdown-decorations.test.ts`
 * asserts against adversarial input:
 *
 *     decorateComposerMarkdown(src).map((d) => d.text).join("") === src
 *
 * The overlay is positioned by mirroring the textarea's own text metrics, so
 * any divergence between the decorated text and the source text would smear
 * the caret away from the glyph it belongs to. Concatenation fidelity is not a
 * nicety here — it is what keeps the caret honest. Nothing in this file may
 * drop, insert, reorder, or rewrite a character; markers are *classified*, not
 * removed. That is also why this is a hybrid (marker-visible) renderer rather
 * than a marker-hiding one: hiding `**` would change the text the layer paints
 * and desynchronise the caret from the textarea that still contains it.
 */

/** Inline role of a run of characters. */
export type ComposerInlineKind =
  | "text"
  /** Syntax punctuation — `**`, `` ` ``, `#`, `[`, `](`, `)`. Dimmed, never hidden. */
  | "marker"
  | "strong"
  | "emphasis"
  | "strong-emphasis"
  | "code"
  | "strike"
  | "link-text"
  | "link-url";

/** Block context a run sits inside, when it is not a plain paragraph. */
export type ComposerBlockKind =
  | "heading-1"
  | "heading-2"
  | "heading-3"
  | "heading-4"
  | "heading-5"
  | "heading-6"
  | "quote"
  | "list"
  | "code-block";

export type ComposerDecoration = {
  kind: ComposerInlineKind;
  block?: ComposerBlockKind;
  text: string;
};

const FENCE_RE = /^(\s{0,3})(`{3,}|~{3,})(.*)$/;
const HEADING_RE = /^(\s{0,3})(#{1,6})(\s+)(.*)$/;
const QUOTE_RE = /^(\s{0,3})((?:>\s?)+)(.*)$/;
const BULLET_RE = /^(\s*)([-*+])(\s+)(.*)$/;
const ORDERED_RE = /^(\s*)(\d{1,9}[.)])(\s+)(.*)$/;

/** Bare `http(s)://` autolink, allowing balanced parens inside the path. */
const BARE_URL_RE = /^https?:\/\/[^\s<>()]*(?:\([^\s<>()]*\)[^\s<>()]*)*/;
/** Punctuation a sentence ends with, which is never part of the URL. */
const URL_TRAILING_PUNCTUATION = /[.,;:!?'"]+$/;

function isWhitespace(ch: string | undefined): boolean {
  return ch === undefined || /\s/.test(ch);
}

/** Word constituent for the `_` intraword rule — `snake_case` must not italicise. */
function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /[\p{L}\p{N}_]/u.test(ch);
}

/**
 * Index of the next run of exactly `length` backticks at or after `from`.
 * A longer run cannot close a shorter opener (CommonMark), so runs of the
 * wrong length are skipped whole.
 */
function findBacktickRun(source: string, from: number, length: number): number {
  let i = from;
  while (i < source.length) {
    if (source[i] !== "`") {
      i += 1;
      continue;
    }
    let run = 0;
    while (source[i + run] === "`") run += 1;
    if (run === length) return i;
    i += run;
  }
  return -1;
}

/**
 * Index of the `]` closing the `[` at `open`, honouring nesting and backslash
 * escapes so `[a [b] c](url)` is one link rather than two broken ones.
 */
function findLabelEnd(source: string, open: number): number {
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "\\") {
      i += 1;
      continue;
    }
    if (ch === "[") depth += 1;
    else if (ch === "]") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Index of the `)` closing the `(` at `open`, honouring nesting. Wikipedia-style
 * destinations — `[x](https://en.wikipedia.org/wiki/Foo_(bar))` — are the reason
 * this cannot be a lazy scan to the first `)`.
 */
function findDestinationEnd(source: string, open: number): number {
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "\\") {
      i += 1;
      continue;
    }
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return i;
    } else if (ch === "\n") return -1;
  }
  return -1;
}

/**
 * Index of the delimiter run that closes an emphasis opener of `length`
 * `marker` characters starting the scan at `from`.
 *
 * Deliberately pragmatic rather than full CommonMark flanking: a closer must be
 * preceded by a non-space (so `**a **` does not close), and a `_` closer must
 * not be followed by a word character (so `snake_case_name` stays plain in a
 * composer that is mostly used to talk about code).
 */
function findEmphasisEnd(
  source: string,
  from: number,
  marker: string,
  length: number,
): number {
  let i = from;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch !== marker) {
      i += 1;
      continue;
    }
    let run = 0;
    while (source[i + run] === marker) run += 1;
    if (run >= length && !isWhitespace(source[i - 1])) {
      if (marker === "_" && isWordChar(source[i + run])) {
        i += run;
        continue;
      }
      return i;
    }
    i += run;
  }
  return -1;
}

function emphasisKind(length: number): ComposerInlineKind {
  if (length >= 3) return "strong-emphasis";
  if (length === 2) return "strong";
  return "emphasis";
}

/**
 * Classify the inline spans of one line's content.
 *
 * `block` is threaded through untouched so a bolded word inside a blockquote or
 * a list item keeps both its inline role and its block context.
 */
function scanInline(source: string, block?: ComposerBlockKind): ComposerDecoration[] {
  const out: ComposerDecoration[] = [];
  let buffer = "";

  const push = (kind: ComposerInlineKind, text: string) => {
    if (!text) return;
    out.push(block ? { kind, block, text } : { kind, text });
  };
  const flush = () => {
    push("text", buffer);
    buffer = "";
  };

  let i = 0;
  while (i < source.length) {
    const ch = source[i];

    // A backslash escape consumes the character it protects, so `\*not italic\*`
    // never opens emphasis and the two characters still reach the output verbatim.
    if (ch === "\\" && i + 1 < source.length) {
      buffer += source.slice(i, i + 2);
      i += 2;
      continue;
    }

    if (ch === "`") {
      let run = 0;
      while (source[i + run] === "`") run += 1;
      const close = findBacktickRun(source, i + run, run);
      if (close === -1) {
        buffer += source.slice(i, i + run);
        i += run;
        continue;
      }
      flush();
      push("marker", source.slice(i, i + run));
      push("code", source.slice(i + run, close));
      push("marker", source.slice(close, close + run));
      i = close + run;
      continue;
    }

    if (ch === "[") {
      const labelEnd = findLabelEnd(source, i);
      if (labelEnd !== -1 && source[labelEnd + 1] === "(") {
        const destEnd = findDestinationEnd(source, labelEnd + 1);
        if (destEnd !== -1) {
          flush();
          push("marker", "[");
          push("link-text", source.slice(i + 1, labelEnd));
          push("marker", "](");
          push("link-url", source.slice(labelEnd + 2, destEnd));
          push("marker", ")");
          i = destEnd + 1;
          continue;
        }
      }
      buffer += ch;
      i += 1;
      continue;
    }

    if (ch === "*" || ch === "_" || ch === "~") {
      let run = 0;
      while (source[i + run] === ch) run += 1;
      const length = ch === "~" ? 2 : Math.min(run, 3);
      const opensCleanly =
        run >= length &&
        !isWhitespace(source[i + run]) &&
        source[i + run] !== ch &&
        // `_` only opens at a word boundary, so `a_b_c` reads as an identifier.
        (ch !== "_" || !isWordChar(source[i - 1]));
      const close = opensCleanly ? findEmphasisEnd(source, i + run, ch, length) : -1;
      if (close === -1) {
        buffer += source.slice(i, i + run);
        i += run;
        continue;
      }
      flush();
      push("marker", source.slice(i, i + length));
      const inner = source.slice(i + length, close);
      const kind = ch === "~" ? "strike" : emphasisKind(length);
      // One nesting level: `**bold with `code` inside**` keeps both roles by
      // re-scanning the inner run and upgrading its plain text to `kind`.
      for (const part of scanInline(inner, block)) {
        push(part.kind === "text" ? kind : part.kind, part.text);
      }
      push("marker", source.slice(close, close + length));
      i = close + length;
      continue;
    }

    if ((ch === "h" || ch === "H") && (i === 0 || isWhitespace(source[i - 1]))) {
      const match = BARE_URL_RE.exec(source.slice(i));
      if (match) {
        const url = match[0].replace(URL_TRAILING_PUNCTUATION, "");
        if (url.length > "https://".length) {
          flush();
          push("link-url", url);
          i += url.length;
          continue;
        }
      }
    }

    buffer += ch;
    i += 1;
  }

  flush();
  return out;
}

/**
 * Classify `source` into decoration runs whose concatenation is `source`.
 *
 * Fenced code is tracked across lines so a fence containing markdown — the
 * case where a naive line-at-a-time scanner starts bolding sample syntax — is
 * emitted verbatim as `code-block`.
 */
export function decorateComposerMarkdown(source: string): ComposerDecoration[] {
  const out: ComposerDecoration[] = [];
  const lines = source.split("\n");
  let fence: string | null = null;

  lines.forEach((line, index) => {
    if (index > 0) out.push({ kind: "text", text: "\n" });

    const fenceMatch = FENCE_RE.exec(line);
    if (fence) {
      // Only a fence of the same character (and at least as long) closes.
      if (fenceMatch && fenceMatch[2][0] === fence[0] && fenceMatch[2].length >= fence.length) {
        fence = null;
        out.push({ kind: "text", block: "code-block", text: fenceMatch[1] });
        out.push({ kind: "marker", block: "code-block", text: fenceMatch[2] });
        out.push({ kind: "code", block: "code-block", text: fenceMatch[3] });
        return;
      }
      out.push({ kind: "code", block: "code-block", text: line });
      return;
    }
    if (fenceMatch) {
      fence = fenceMatch[2];
      out.push({ kind: "text", block: "code-block", text: fenceMatch[1] });
      out.push({ kind: "marker", block: "code-block", text: fenceMatch[2] });
      out.push({ kind: "code", block: "code-block", text: fenceMatch[3] });
      return;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      const block = `heading-${heading[2].length}` as ComposerBlockKind;
      out.push({ kind: "text", block, text: heading[1] });
      out.push({ kind: "marker", block, text: heading[2] });
      out.push({ kind: "text", block, text: heading[3] });
      out.push(...scanInline(heading[4], block));
      return;
    }

    const quote = QUOTE_RE.exec(line);
    if (quote) {
      out.push({ kind: "text", block: "quote", text: quote[1] });
      out.push({ kind: "marker", block: "quote", text: quote[2] });
      out.push(...scanInline(quote[3], "quote"));
      return;
    }

    const list = BULLET_RE.exec(line) ?? ORDERED_RE.exec(line);
    if (list) {
      out.push({ kind: "text", block: "list", text: list[1] });
      out.push({ kind: "marker", block: "list", text: list[2] });
      out.push({ kind: "text", block: "list", text: list[3] });
      out.push(...scanInline(list[4], "list"));
      return;
    }

    out.push(...scanInline(line));
  });

  return out.filter((decoration) => decoration.text.length > 0);
}

/** Re-join decorations into the source they came from. Used by the fidelity tests. */
export function composerDecorationText(decorations: ComposerDecoration[]): string {
  return decorations.map((decoration) => decoration.text).join("");
}

/**
 * True when `source` contains anything the layer would paint differently from
 * plain text. The overlay is only allowed to blank the textarea's own glyphs
 * when this holds, so a plain-prose message never pays the alignment risk.
 */
export function hasComposerMarkdown(source: string): boolean {
  return decorateComposerMarkdown(source).some(
    (decoration) => decoration.kind !== "text" || decoration.block !== undefined,
  );
}
