// @ts-nocheck
import assert from "node:assert/strict";
import {
  acceptPlaceholderDefault,
  handlePlaceholderTab,
  nextPlaceholder,
  placeholderSpans,
} from "./prompt-placeholders.ts";

// ── placeholderSpans ─────────────────────────────────────────────────────────
const text = "Ship {{feature}} to {{env|production}} by {{date}}";
const spans = placeholderSpans(text);
assert.equal(spans.length, 3, "all three tokens found");
assert.deepEqual(
  spans.map((s) => s.name),
  ["feature", "env", "date"],
  "names parse in document order",
);
assert.equal(spans[0].def, null, "no-default token carries def: null");
assert.equal(spans[1].def, "production", "defaulted token carries its default");
assert.equal(text.slice(spans[1].start, spans[1].end), "{{env|production}}", "span covers the whole token");

assert.deepEqual(placeholderSpans("no tokens here"), [], "plain text has no spans");
assert.deepEqual(placeholderSpans("{{ }}"), [], "a blank name is not a token");
assert.equal(placeholderSpans("{{a|}}")[0].def, "", "an empty default is still a default (Tab accepts to empty)");
assert.equal(placeholderSpans("{{team|the team}}")[0].def, "the team", "defaults may contain spaces");

// ── nextPlaceholder: wrapping in both directions ─────────────────────────────
assert.equal(nextPlaceholder(text, 0, 1)?.name, "feature", "forward from the top hits the first token");
assert.equal(nextPlaceholder(text, spans[0].end, 1)?.name, "env", "forward from past a token hits the next");
assert.equal(nextPlaceholder(text, spans[2].end, 1)?.name, "feature", "forward wraps past the last token");
assert.equal(nextPlaceholder(text, spans[2].start, -1)?.name, "env", "backward from a token's start hits the previous");
assert.equal(nextPlaceholder(text, 0, -1)?.name, "date", "backward wraps to the last token");
assert.equal(nextPlaceholder("no tokens", 0, 1), null, "no tokens → null (callers fall through to native Tab)");

// ── acceptPlaceholderDefault ─────────────────────────────────────────────────
const accepted = acceptPlaceholderDefault(text, spans[1]);
assert.equal(
  accepted.text,
  "Ship {{feature}} to production by {{date}}",
  "accepting replaces the token with its default",
);
assert.equal(
  accepted.caret,
  "Ship {{feature}} to production".length,
  "the caret lands just past the inserted default",
);
const noDefault = acceptPlaceholderDefault(text, spans[0]);
assert.equal(noDefault.text, text, "a token without a default is left alone");

// ── handlePlaceholderTab (fake textarea) ─────────────────────────────────────
function fakeTextarea(value, selectionStart = 0, selectionEnd = selectionStart) {
  return {
    value,
    selectionStart,
    selectionEnd,
    focused: false,
    focus() {
      this.focused = true;
    },
    setSelectionRange(start, end) {
      this.selectionStart = start;
      this.selectionEnd = end;
    },
  };
}
function tabEvent(shiftKey = false) {
  return {
    key: "Tab",
    shiftKey,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
  };
}
const rafQueue = [];
globalThis.requestAnimationFrame = (cb) => {
  rafQueue.push(cb);
  return rafQueue.length;
};
const flushRaf = () => {
  while (rafQueue.length) rafQueue.shift()();
};

// Tab falls through when the draft has no tokens (native focus-move survives).
{
  const el = fakeTextarea("plain draft");
  const e = tabEvent();
  assert.equal(handlePlaceholderTab(e, el, () => {}), false, "no tokens → not consumed");
  assert.equal(e.defaultPrevented, false, "no tokens → default not prevented");
}
// Non-Tab keys are never consumed.
{
  const el = fakeTextarea(text);
  assert.equal(
    handlePlaceholderTab({ key: "Enter", shiftKey: false, preventDefault() {} }, el, () => {}),
    false,
    "only Tab is owned",
  );
}
// Tab selects the first token; Tab again advances; wrapping past the end.
{
  const el = fakeTextarea(text, 0);
  assert.equal(handlePlaceholderTab(tabEvent(), el, () => {}), true);
  assert.equal(el.value.slice(el.selectionStart, el.selectionEnd), "{{feature}}", "first Tab selects the first token");
  handlePlaceholderTab(tabEvent(), el, () => {});
  assert.equal(el.value.slice(el.selectionStart, el.selectionEnd), "{{env|production}}", "second Tab advances");
  // Tab on the selected defaulted token would ACCEPT (covered below) — park
  // the caret past it to keep exercising pure navigation.
  el.setSelectionRange(el.selectionEnd, el.selectionEnd);
  handlePlaceholderTab(tabEvent(), el, () => {});
  assert.equal(el.value.slice(el.selectionStart, el.selectionEnd), "{{date}}", "third Tab reaches the last token");
  handlePlaceholderTab(tabEvent(), el, () => {});
  assert.equal(el.value.slice(el.selectionStart, el.selectionEnd), "{{feature}}", "Tab wraps back to the first token ({{date}} has no default, so Tab navigates)");
}
// Shift+Tab reverses (and wraps backward).
{
  const el = fakeTextarea(text, 0);
  handlePlaceholderTab(tabEvent(true), el, () => {});
  assert.equal(el.value.slice(el.selectionStart, el.selectionEnd), "{{date}}", "Shift+Tab from the top wraps to the last token");
  handlePlaceholderTab(tabEvent(true), el, () => {});
  assert.equal(el.value.slice(el.selectionStart, el.selectionEnd), "{{env|production}}", "Shift+Tab keeps reversing");
}
// A caret inside a token selects that token first.
{
  const inside = text.indexOf("feature") + 3;
  const el = fakeTextarea(text, inside);
  handlePlaceholderTab(tabEvent(), el, () => {});
  assert.equal(el.value.slice(el.selectionStart, el.selectionEnd), "{{feature}}", "caret inside a token selects it");
}
// Tab on a selected defaulted token accepts the default then jumps onward.
{
  const span = placeholderSpans(text)[1];
  const el = fakeTextarea(text, span.start, span.end);
  let latest = text;
  const consumed = handlePlaceholderTab(tabEvent(), el, (v) => {
    latest = v;
    el.value = v; // simulate the controlled re-render before the rAF fires
  });
  assert.equal(consumed, true, "accepting a default consumes Tab");
  assert.equal(latest, "Ship {{feature}} to production by {{date}}", "the default replaced the token");
  flushRaf();
  assert.equal(el.focused, true, "focus returns to the textarea after the re-render");
  assert.equal(el.value.slice(el.selectionStart, el.selectionEnd), "{{date}}", "after accepting, selection jumps to the next token");
}
// Accepting the LAST remaining default parks the caret after the inserted text.
{
  const solo = "Deploy {{env|staging}} now";
  const span = placeholderSpans(solo)[0];
  const el = fakeTextarea(solo, span.start, span.end);
  handlePlaceholderTab(tabEvent(), el, (v) => {
    el.value = v;
  });
  flushRaf();
  const caret = "Deploy staging".length;
  assert.equal(el.selectionStart, caret, "caret parks after the accepted default");
  assert.equal(el.selectionEnd, caret, "nothing stays selected when no tokens remain");
}
// Shift+Tab on a selected defaulted token navigates (never accepts).
{
  const span = placeholderSpans(text)[1];
  const el = fakeTextarea(text, span.start, span.end);
  let called = false;
  handlePlaceholderTab(tabEvent(true), el, () => {
    called = true;
  });
  assert.equal(called, false, "Shift+Tab never accepts a default");
  assert.equal(el.value.slice(el.selectionStart, el.selectionEnd), "{{feature}}", "Shift+Tab moves backward instead");
}

console.log("prompt-placeholders.test.ts: ok");
