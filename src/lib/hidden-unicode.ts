/**
 * Characters that change how text reads without being seen (#5781): bidi
 * controls, zero-width and other format characters, and control characters.
 *
 * A file named `invoice‮gnp.exe` listed as "invoiceexe.png", `a​b.ts`
 * looked exactly like `ab.ts`, and code holding bidi controls showed in an
 * order other than the one it runs in ("Trojan Source"). The desk now shows
 * each one as its code point, in a span that isolates it so an override can't
 * reach the text after it, and keeps the character itself in the DOM so Copy
 * and the accessible name stay faithful.
 *
 * Left alone on purpose: ZWNJ and ZWJ (U+200C, U+200D), which emoji sequences
 * and several scripts need, and variation selectors.
 */

// Bidi controls: ALM, LRM/RLM, LRE..RLO, LRI..PDI. Invisible: soft hyphen,
// Mongolian vowel separator, ZWSP, line and paragraph separators, word joiner
// and invisible operators, BOM, interlinear annotation controls.
const FORMAT = "\\u00ad\\u061c\\u180e\\u200b\\u200e\\u200f\\u2028-\\u202e\\u2060-\\u2064\\u2066-\\u2069\\ufeff\\ufff9-\\ufffb";

/** In a name, every control character counts, newline and tab included. */
const NAME_HIDDEN = `[\\u0000-\\u001f\\u007f-\\u009f${FORMAT}]`;
/** In code, tab and line breaks are ordinary. */
const CODE_HIDDEN = `[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f-\\u009f${FORMAT}]`;

export type HiddenUnicodeKind = "name" | "code";

/** A fresh pattern per call (#5785 review): a shared global regex kept its
 *  `lastIndex` after a test, and `matchAll` starts from it, so a split right
 *  after a check skipped the first hidden character. */
const patternFor = (kind: HiddenUnicodeKind, flags = "g") => new RegExp(kind === "name" ? NAME_HIDDEN : CODE_HIDDEN, flags);

/** `U+202E` for a hidden character. */
export function codePointLabel(char: string): string {
  return `U+${(char.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}`;
}

/** Whether `text` holds a character the reader can't see. A byte-order mark
 *  at the very start of a file is ordinary and doesn't count. */
export function hasHiddenUnicode(text: string, kind: HiddenUnicodeKind): boolean {
  const pattern = patternFor(kind, "");
  const body = kind === "code" && text.startsWith("﻿") ? text.slice(1) : text;
  return pattern.test(body);
}

export type HiddenUnicodeSegment = { text: string; hidden: false } | { text: string; hidden: true; label: string };

/** `text` split into plain runs and single hidden characters, in order. */
export function splitHiddenUnicode(text: string, kind: HiddenUnicodeKind): HiddenUnicodeSegment[] {
  const pattern = patternFor(kind);
  pattern.lastIndex = 0;
  const out: HiddenUnicodeSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const at = match.index ?? 0;
    if (at > last) out.push({ text: text.slice(last, at), hidden: false });
    out.push({ text: match[0], hidden: true, label: codePointLabel(match[0]) });
    last = at + match[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), hidden: false });
  return out;
}

/** `text` with each hidden character replaced by its code point in angle
 *  brackets, for a tooltip or other plain-text attribute. */
export function describeHiddenUnicode(text: string, kind: HiddenUnicodeKind = "name"): string {
  return text.replace(patternFor(kind), (char) => `⟨${codePointLabel(char)}⟩`);
}

/** The markup for one hidden character: the character itself, isolated, with
 *  its code point drawn by CSS (`.cave-hidden-char::before`). */
function hiddenCharHtml(char: string): string {
  return `<span class="cave-hidden-char" data-cp="${codePointLabel(char)}">${char}</span>`;
}

/**
 * Reveal hidden characters in HTML whose text came from escaped source and
 * whose attributes carry none of it: Shiki's output, or an escaped line. Never
 * run it over markup with user text in an attribute, where the inserted span
 * would land inside the attribute value.
 */
export function revealHiddenUnicodeInHtml(html: string): string {
  return html.replace(patternFor("code"), hiddenCharHtml);
}
