import assert from "node:assert/strict";
import { assistantTextFromStream } from "./coven-stream-text.ts";

// Shape of a real `coven run claude --stream-json` stream (#5629): transport
// frames come first, the familiar uses tools, then answers with JSON.
const answer = '{"notes":"Ship the teaser","steps":["Draft"],"status":"backlog"}';
const stream = [
  JSON.stringify({ type: "system", subtype: "init", cwd: "/w", session_id: "s" }),
  JSON.stringify({ agents: ["claude"], apiKeySource: "none" }),
  JSON.stringify({ type: "assistant", message: { content: [{ type: "thinking", thinking: "" }, { type: "tool_use", input: { command: "ls" } }] } }),
  JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", content: "{\"x\":1}" }] } }),
  JSON.stringify({ type: "rate_limit_event", rate_limit_info: { status: "allowed" } }),
  JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: answer }] } }),
  JSON.stringify({ type: "result", subtype: "success", is_error: false }),
].join("\n");

assert.equal(
  assistantTextFromStream(stream),
  answer,
  "only assistant text blocks are the answer; transport frames are dropped",
);

// Text split across assistant frames is joined in order.
assert.equal(
  assistantTextFromStream([
    JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: '{"a":' }] } }),
    JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "1}" }] } }),
  ].join("\n")),
  '{"a":1}',
);

// Plain-text harnesses keep their lines.
assert.equal(assistantTextFromStream("Here you go\n{\"steps\":[\"a\"]}\n"), 'Here you go\n{"steps":["a"]}\n');

// A stream with no answer at all falls back to the raw text.
const noAnswer = JSON.stringify({ type: "result", subtype: "error" });
assert.equal(assistantTextFromStream(noAnswer), noAnswer);
