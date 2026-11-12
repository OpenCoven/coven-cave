import assert from "node:assert/strict";
import test from "node:test";
import { UI_BLOCK_FALLBACK_CASES } from "./ui-block-fallback-fixtures.ts";
import { UI_BLOCK_ENDED_EARLY, projectUiBlocksToReadable, uiBlockReadableLines } from "./ui-block-readable.ts";
import { sliceUiBlocks, UI_COMPONENT_TYPES } from "./ui-blocks.ts";

for (const c of UI_BLOCK_FALLBACK_CASES) {
  test(`readable projection: ${c.id}`, () => {
    assert.equal(projectUiBlocksToReadable(c.input), c.readable);
  });
}

test("the corpus exercises every catalog component", () => {
  const inputs = UI_BLOCK_FALLBACK_CASES.filter((c) => c.kind !== "nested-literal").map((c) => c.input).join("\n");
  for (const type of UI_COMPONENT_TYPES) {
    assert.match(inputs, new RegExp(`<${type}[\\s/>]`), type);
  }
});

test("slice pieces tile the message, so a literal block reads back byte for byte", () => {
  for (const c of UI_BLOCK_FALLBACK_CASES) {
    const tiled = sliceUiBlocks(c.input).map((piece) => (piece.kind === "text" ? piece.text : piece.raw)).join("");
    assert.equal(tiled, c.input, c.id);
  }
  const tilde = "Intro\n~~~coven:ui\n{\"not\": \"markup\"}\n~~~\nAfter";
  assert.equal(projectUiBlocksToReadable(tilde), tilde);
});

test("a button is only its label: nothing runs, sends or prefills", () => {
  const lines = uiBlockReadableLines('<Button prefill="Send the report now">Draft it</Button>');
  assert.deepEqual(lines, ["[Draft it]"]);
});

test("an empty block projects to nothing and an unterminated one says it ended early", () => {
  assert.deepEqual(uiBlockReadableLines(""), []);
  assert.deepEqual(uiBlockReadableLines("<Badge>Hi</Badge>", false), ["Hi", UI_BLOCK_ENDED_EARLY]);
});
