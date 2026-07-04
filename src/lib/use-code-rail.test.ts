import { test } from "node:test";
import assert from "node:assert/strict";
import { CODE_RAIL_PIN_KEY, parsePinned, serializePinned } from "./use-code-rail.ts";

test("pin key is versioned", () => {
  assert.equal(CODE_RAIL_PIN_KEY, "cave:code-rail:pinned:v1");
});
test("parsePinned tolerates junk", () => {
  assert.equal(parsePinned("true"), true);
  assert.equal(parsePinned("false"), false);
  assert.equal(parsePinned(null), false);
  assert.equal(parsePinned("garbage"), false);
});
test("serializePinned round-trips", () => {
  assert.equal(parsePinned(serializePinned(true)), true);
  assert.equal(parsePinned(serializePinned(false)), false);
});
