// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  findToolOutput,
  INLINE_TOOL_OUTPUT_MAX_CHARS,
  slimConversationToolOutputs,
} from "./conversation-tool-output.ts";

const big = (label) => `${label} `.repeat(400);
const tool = (id, output, status = "ok") => ({ id, name: "Bash", status, output });
const turn = (id, parentId, tools) => ({ id, parentId, role: "assistant", text: id, createdAt: `2026-09-26T00:00:${id.slice(1).padStart(2, "0")}Z`, tools });

test("older large outputs are omitted with their length; the last three finished stay", () => {
  const conversation = {
    activeLeafId: "t3",
    turns: [
      turn("t1", null, [tool("a", big("a")), tool("b", "short")]),
      turn("t2", "t1", [tool("c", big("c")), tool("d", big("d"))]),
      turn("t3", "t2", [tool("e", big("e")), tool("f", big("f"), "running")]),
    ],
  };
  const slim = slimConversationToolOutputs(conversation);
  const byId = Object.fromEntries(slim.turns.flatMap((t) => t.tools).map((t) => [t.id, t]));
  assert.equal(byId.a.output, undefined);
  assert.equal(byId.a.outputChars, big("a").length);
  assert.equal(byId.b.output, "short", "small outputs stay inline");
  // Last three finished on the active path: c, d, e.
  assert.equal(byId.c.output, big("c"));
  assert.equal(byId.d.output, big("d"));
  assert.equal(byId.e.output, big("e"));
  assert.equal(byId.f.output, big("f"), "a running tool is never the omitted kind");
  assert.equal(conversation.turns[0].tools[0].output, big("a"), "the input is not mutated");
});

test("only the active path counts as recent", () => {
  const conversation = {
    activeLeafId: "t2",
    turns: [
      turn("t1", null, [tool("a", big("a"))]),
      turn("t2", "t1", [tool("b", big("b"))]),
      turn("x9", "t1", [tool("x", big("x")), tool("y", big("y")), tool("z", big("z"))]),
    ],
  };
  const byId = Object.fromEntries(slimConversationToolOutputs(conversation).turns.flatMap((t) => t.tools).map((t) => [t.id, t]));
  assert.equal(byId.a.output, big("a"));
  assert.equal(byId.b.output, big("b"));
  assert.equal(byId.x.output, undefined, "an inactive branch's tools are not recent");
});

test("an unchanged conversation is returned as is", () => {
  const conversation = { activeLeafId: "t1", turns: [turn("t1", null, [tool("a", "x".repeat(INLINE_TOOL_OUTPUT_MAX_CHARS))])] };
  assert.equal(slimConversationToolOutputs(conversation), conversation);
});

test("findToolOutput finds by id and refuses to guess between different outputs", () => {
  const conversation = { turns: [turn("t1", null, [tool("a", "one"), tool("b", "two")]), turn("t2", "t1", [tool("b", "other")])] };
  assert.deepEqual(findToolOutput(conversation, "a"), { kind: "found", output: "one" });
  assert.deepEqual(findToolOutput(conversation, "b"), { kind: "ambiguous" });
  assert.deepEqual(findToolOutput(conversation, "nope"), { kind: "missing" });
  assert.deepEqual(findToolOutput(null, "a"), { kind: "missing" });
});
