// Template placeholder engine (cave-jg6k): Tab-cycling for {{placeholder}}
// tokens in the composer. Stateless by design — the spans derive from the live
// textarea text on every keypress, so there is nothing to sync when the user
// edits around (or inside) a token; unreplaced tokens simply stay literal.
//
// Grammar: `{{name}}` or `{{name|default}}`. Names are free-form (anything but
// braces or a pipe); the optional default after the first pipe is what Tab
// accepts when the token is already selected.

export type PlaceholderSpan = {
  /** Index of the opening `{{`. */
  start: number;
  /** Index just past the closing `}}`. */
  end: number;
  name: string;
  /** Text after the first `|`, when present. */
  def: string | null;
};

const PLACEHOLDER_RE = /\{\{([^{}|]+)(?:\|([^{}]*))?\}\}/g;

/** Every placeholder token in the text, in document order. */
export function placeholderSpans(text: string): PlaceholderSpan[] {
  const spans: PlaceholderSpan[] = [];
  for (const m of text.matchAll(PLACEHOLDER_RE)) {
    const name = m[1].trim();
    if (!name) continue;
    spans.push({
      start: m.index,
      end: m.index + m[0].length,
      name,
      def: m[2] !== undefined ? m[2] : null,
    });
  }
  return spans;
}

/** The next placeholder to visit from `caret`, wrapping. `dir` 1 finds the
 *  first token starting at/after the caret; -1 the last token ending
 *  at/before it. Returns null only when the text has no tokens at all. */
export function nextPlaceholder(
  text: string,
  caret: number,
  dir: 1 | -1 = 1,
): PlaceholderSpan | null {
  const spans = placeholderSpans(text);
  if (!spans.length) return null;
  if (dir === 1) {
    return spans.find((s) => s.start >= caret) ?? spans[0];
  }
  for (let i = spans.length - 1; i >= 0; i -= 1) {
    if (spans[i].end <= caret) return spans[i];
  }
  return spans[spans.length - 1];
}

/** Replace a defaulted token with its default text. Returns the new text and
 *  the caret just past the inserted default. No-op passthrough for tokens
 *  without a default (callers keep the selection instead). */
export function acceptPlaceholderDefault(
  text: string,
  span: PlaceholderSpan,
): { text: string; caret: number } {
  if (span.def === null) return { text, caret: span.end };
  return {
    text: text.slice(0, span.start) + span.def + text.slice(span.end),
    caret: span.start + span.def.length,
  };
}

/** Composer keydown helper: owns Tab/Shift+Tab while the draft carries
 *  placeholder tokens. Returns true when it consumed the event.
 *
 *  - Tab jumps to (selects) the next token from the caret, wrapping;
 *    Shift+Tab reverses.
 *  - Tab while a *defaulted* token is exactly selected accepts the default,
 *    then jumps to the next token if one remains.
 *  - No tokens in the draft → returns false so the native focus-move keeps
 *    working (a11y: Tab must not be unconditionally trapped).
 *
 *  `setText` triggers the React re-render for accepted defaults; the
 *  selection lands on the next frame (the promptInsertion idiom).
 */
export function handlePlaceholderTab(
  e: { key: string; shiftKey: boolean; preventDefault: () => void },
  el: HTMLTextAreaElement | null,
  setText: (value: string) => void,
): boolean {
  if (e.key !== "Tab" || !el) return false;
  const text = el.value;
  const spans = placeholderSpans(text);
  if (!spans.length) return false;
  const dir: 1 | -1 = e.shiftKey ? -1 : 1;

  const selected = spans.find(
    (s) => s.start === el.selectionStart && s.end === el.selectionEnd,
  );
  if (selected && selected.def !== null && dir === 1) {
    // Accept the default in place, then move on to the next token (if any)
    // once the re-rendered value is in the DOM.
    e.preventDefault();
    const accepted = acceptPlaceholderDefault(text, selected);
    setText(accepted.text);
    requestAnimationFrame(() => {
      el.focus();
      const next = nextPlaceholder(accepted.text, accepted.caret, 1);
      if (next) el.setSelectionRange(next.start, next.end);
      else el.setSelectionRange(accepted.caret, accepted.caret);
    });
    return true;
  }

  // Plain navigation: no text change, select the target token directly.
  // A caret sitting inside a token selects that token first; otherwise
  // forward scans from the selection's end so a selected token advances past
  // itself, and backward scans from its start for the mirror-image reason.
  e.preventDefault();
  const from = dir === 1 ? el.selectionEnd : el.selectionStart;
  const inside =
    el.selectionStart === el.selectionEnd
      ? spans.find((s) => s.start < from && from < s.end)
      : undefined;
  const target = inside ?? nextPlaceholder(text, from, dir);
  if (target) el.setSelectionRange(target.start, target.end);
  return true;
}
