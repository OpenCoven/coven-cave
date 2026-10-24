import assert from "node:assert/strict";
import test from "node:test";
import { UI_BLOCK_FALLBACK_CASES } from "./ui-block-fallback-fixtures.ts";

test("the fallback corpus covers every case kind with unique ids", () => {
  const ids = UI_BLOCK_FALLBACK_CASES.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  const kinds = new Set(UI_BLOCK_FALLBACK_CASES.map((c) => c.kind));
  assert.deepEqual([...kinds].sort(), ["complete", "malformed", "nested-literal", "partial"]);
});

test("nested-literal examples read back byte for byte", () => {
  for (const c of UI_BLOCK_FALLBACK_CASES.filter((c) => c.kind === "nested-literal")) {
    assert.ok(c.input.includes("```coven:ui"), c.id);
    assert.equal(c.readable, c.input, c.id);
  }
});

test("projected cases never keep the raw markup", () => {
  for (const c of UI_BLOCK_FALLBACK_CASES.filter((c) => c.readable !== c.input)) {
    assert.ok(c.input.includes("```coven:ui"), c.id);
    assert.ok(!c.readable.includes("```coven:ui"), c.id);
    assert.doesNotMatch(c.readable, /<\/?[A-Z][A-Za-z]*[\s/>]/, c.id);
  }
});
