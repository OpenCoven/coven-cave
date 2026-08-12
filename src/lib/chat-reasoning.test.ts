import assert from "node:assert/strict";
import test from "node:test";
import { splitReasoning } from "./chat-reasoning.ts";

test("extracts real reasoning while preserving fenced literal tag examples", () => {
  const text = [
    "Visible intro.",
    "```xml",
    "<thinking>literal fenced example</thinking>",
    "```",
    "<thinking>private plan</thinking>",
    "Visible outro.",
  ].join("\n");

  assert.deepEqual(splitReasoning(text), {
    visible: "Visible intro.\n```xml\n<thinking>literal fenced example</thinking>\n```\n\nVisible outro.",
    reasoning: "private plan",
  });
});

test("ignores reasoning tags inside tilde fences and inline backticks", () => {
  const text = [
    "Keep ` <thinking>inline literal</thinking> ` visible.",
    "~~~html",
    "<reasoning>literal block</reasoning>",
    "~~~",
    "<reasoning>hidden</reasoning>",
  ].join("\n");

  assert.deepEqual(splitReasoning(text), {
    visible: "Keep ` <thinking>inline literal</thinking> ` visible.\n~~~html\n<reasoning>literal block</reasoning>\n~~~\n",
    reasoning: "hidden",
  });
});

test("keeps multiple reasoning blocks ordered while leaving fragmented fences literal", () => {
  const text = [
    "<thinking>first</thinking>",
    "```xml",
    "<thinking>literal without closing fence yet",
    "<reasoning>still literal</reasoning>",
    "<reasoning>second</reasoning>",
    "After.",
  ].join("\n");

  assert.deepEqual(splitReasoning(text), {
    visible: "```xml\n<thinking>literal without closing fence yet\n<reasoning>still literal</reasoning>\n<reasoning>second</reasoning>\nAfter.",
    reasoning: "first",
  });
});

test("an optional Markdown range source preserves original slices while exposing reasoning", () => {
  const text = "Prefix ` noise <thinking>private plan</thinking> Visible.";
  const rangeSource = text.replace("`", " ");

  assert.deepEqual(splitReasoning(text, rangeSource), {
    visible: "Prefix ` noise  Visible.",
    reasoning: "private plan",
  });
});

test("optional opaque ranges keep nested reasoning syntax literal", () => {
  const literal = "<thinking>literal plan</thinking>";
  const text = `<thinking>real plan</thinking>\nKeep ${literal} exact.`;
  const start = text.indexOf(literal);

  assert.deepEqual(splitReasoning(text, text, [[start, start + literal.length]]), {
    visible: `Keep ${literal} exact.`,
    reasoning: "real plan",
  });
});

test("opaque ranges preserve debug-like lines and repeated newlines byte-for-byte", () => {
  const literal = [
    "<thinking>literal plan</thinking>",
    "[debug/path] literal diagnostic",
    "",
    "",
    "after three newlines",
  ].join("\n");
  const text = `<thinking>real plan</thinking>\nKeep:\n${literal}\nDone.`;
  const start = text.indexOf(literal);

  assert.deepEqual(splitReasoning(text, text, [[start, start + literal.length]]), {
    visible: `Keep:\n${literal}\nDone.`,
    reasoning: "real plan",
  });
});

test("opaque bytes do not suppress same-line debug cleanup before their range", () => {
  const marker =
    '<coven:result id="debug-label" state="passed" label="[debug/path] exact label" />';
  const text = `[debug/transport] internal detail ${marker}`;
  const start = text.indexOf(marker);

  assert.deepEqual(splitReasoning(text, text, [[start, start + marker.length]]), {
    visible: marker,
    reasoning: "",
  });
});

test("reasoning range inputs reject mismatched sources and unsorted opaque ranges", () => {
  const text = "0123456789";
  assert.throws(
    () => splitReasoning(text, text.slice(1)),
    /range source must match text length/,
  );
  assert.throws(
    () => splitReasoning(text, text, [[5, 7], [1, 3]]),
    /protected ranges must be sorted and non-overlapping/,
  );
});
