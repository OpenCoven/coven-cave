import assert from "node:assert/strict";
import test from "node:test";
import { createCanonicalResponseBuffer } from "./canonical-response-buffer.ts";

test("canonical response buffer appends deltas and collapses excess newlines", () => {
  const buffer = createCanonicalResponseBuffer();

  assert.equal(buffer.append("First\n\n"), "First\n\n");
  assert.equal(buffer.append("\nSecond"), "First\n\nSecond");
  assert.equal(buffer.read(), "First\n\nSecond");
});

test("canonical response buffer replaces revisions atomically", () => {
  const buffer = createCanonicalResponseBuffer();

  buffer.append("Draft answer");
  assert.equal(buffer.replace("Final answer"), "Final answer");
  assert.equal(buffer.append(" with detail"), "Final answer with detail");
  assert.equal(buffer.read(), "Final answer with detail");
});
