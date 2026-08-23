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
