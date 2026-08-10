import assert from "node:assert/strict";
import test from "node:test";

import { unrecognizedCovenBlocks } from "./coven-raw-output.ts";

test("recognized control blocks are not surfaced", () => {
  assert.deepEqual(unrecognizedCovenBlocks("Done.\n<coven:next-paths>\n- [reply] Go\n</coven:next-paths>"), []);
  assert.deepEqual(unrecognizedCovenBlocks('<coven:delegation target="echo">do it</coven:delegation>'), []);
  assert.deepEqual(unrecognizedCovenBlocks("plain reply with no markup"), []);
});

test("an unknown tag is captured verbatim", () => {
  assert.deepEqual(
    unrecognizedCovenBlocks("Fine.\n<coven:teleport target=\"mars\">go</coven:teleport>"),
    ['<coven:teleport target="mars">', "</coven:teleport>"],
  );
});

test("a truncated tag is unrecognized, not silently dropped", () => {
  // The stream cut mid-tag: the name is a prefix of a known block but is not it.
  assert.deepEqual(unrecognizedCovenBlocks("Answer.\n<coven:next-pa"), ["<coven:next-pa"]);
});

test("a reply documenting the protocol in a fence is prose, not an emission", () => {
  const text = ["Use this:", "```", "<coven:teleport>", "```"].join("\n");
  assert.deepEqual(unrecognizedCovenBlocks(text), []);
});

test("the same stray tag is reported once", () => {
  assert.deepEqual(
    unrecognizedCovenBlocks("<coven:wat>\nmiddle\n<coven:wat>"),
    ["<coven:wat>"],
  );
});
