import assert from "node:assert/strict";
import { hasUnsupportedClaudeToolFrame, parseClaudeMessageEnvelope } from "./claude-stream.ts";
import { CLAUDE_COMPATIBILITY_PROFILES } from "./runtime-compatibility.ts";

const v1 = CLAUDE_COMPATIBILITY_PROFILES.find((entry) => entry.id === "claude-stream-json-v1")!;
const v2 = CLAUDE_COMPATIBILITY_PROFILES.find((entry) => entry.id === "claude-stream-json-v2")!;

assert.deepEqual(
  parseClaudeMessageEnvelope({
    type: "assistant",
    message: { content: [
      { type: "text", text: "I will inspect it." },
      { type: "tool_use", id: "toolu-old", name: "Read", input: { path: "README.md" } },
    ] },
  }, v1),
  [
    { kind: "text", text: "I will inspect it." },
    { kind: "tool-use", id: "toolu-old", name: "Read", input: { path: "README.md" } },
  ],
  "the historical v1 assistant envelope retains text and native tool ids",
);

assert.deepEqual(
  parseClaudeMessageEnvelope({
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: "toolu-new", content: "done", is_error: false }] },
  }, v2),
  [{ kind: "tool-result", toolUseId: "toolu-new", content: "done", isError: false }],
  "the current v2 follow-up envelope settles its matching native tool id",
);

assert.deepEqual(
  parseClaudeMessageEnvelope({ type: "assistant", message: { content: [{ type: "tool_use", id: 1, name: "Read" }] } }, v2),
  [],
  "malformed ids are ignored rather than becoming unstable UI keys",
);
assert.equal(
  hasUnsupportedClaudeToolFrame({ type: "assistant", message: { content: [{ type: "tool_use", id: 1, name: "Read" }] } }, v2),
  true,
  "malformed tool blocks are visible compatibility failures, not tool bubbles",
);
assert.equal(
  hasUnsupportedClaudeToolFrame({ type: "assistant", message: { content: [{ type: "text", text: "ordinary text" }] } }, v2),
  false,
  "valid text-only frames do not produce a tool compatibility diagnostic",
);
assert.equal(
  hasUnsupportedClaudeToolFrame({ type: "user", message: { content: [{ type: "future_tool_result", id: "toolu-new" }] } }, v2),
  true,
  "unknown user tool frames surface one compatibility diagnostic instead of being silently ignored",
);
assert.equal(
  hasUnsupportedClaudeToolFrame({ type: "assistant", message: { content: { type: "tool_use" } } }, v2),
  true,
  "partial message envelopes are compatibility failures rather than silent drops",
);
assert.equal(
  hasUnsupportedClaudeToolFrame({ type: "future", message: { content: [] } }, v2),
  true,
  "unknown message envelopes are visible compatibility failures",
);
assert.deepEqual(parseClaudeMessageEnvelope({ type: "future", payload: "untrusted" }, v2), []);

console.log("claude-stream: ok");
