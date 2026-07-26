import assert from "node:assert/strict";
import {
  hasUnsupportedClaudeToolFrame,
  parseClaudeMessageEnvelope,
  parseClaudeTextOnlyEnvelope,
} from "./claude-stream.ts";
import { CLAUDE_COMPATIBILITY_PROFILES } from "./runtime-compatibility.ts";

const v1 = CLAUDE_COMPATIBILITY_PROFILES.find((entry) => entry.id === "claude-stream-json-v1")!;
const v2 = CLAUDE_COMPATIBILITY_PROFILES.find((entry) => entry.id === "claude-stream-json-v2")!;

for (const profile of CLAUDE_COMPATIBILITY_PROFILES) {
  assert.deepEqual(
    parseClaudeMessageEnvelope({
      type: "assistant",
      message: { content: [
        { type: "text", text: "I will inspect it." },
        { type: "tool_use", id: `toolu-${profile.id}`, name: "Read", input: { path: "README.md" } },
      ] },
    }, profile),
    [
      { kind: "text", text: "I will inspect it." },
      { kind: "tool-use", id: `toolu-${profile.id}`, name: "Read", input: { path: "README.md" } },
    ],
    `${profile.id} decodes assistant text and tool_use blocks`,
  );
  assert.deepEqual(
    parseClaudeMessageEnvelope({
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: `toolu-${profile.id}`, content: "done", is_error: true }] },
    }, profile),
    [{ kind: "tool-result", toolUseId: `toolu-${profile.id}`, content: "done", isError: true }],
    `${profile.id} decodes user tool_result blocks`,
  );
}

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
assert.deepEqual(
  parseClaudeMessageEnvelope({ type: "assistant", message: { content: [{ type: "tool_use", id: "toolu-missing-input", name: "Read" }] } }, v2),
  [],
  "a tool_use block without its required input does not create an incomplete tool bubble",
);
assert.equal(
  hasUnsupportedClaudeToolFrame({ type: "assistant", message: { content: [{ type: "tool_use", id: "toolu-missing-input", name: "Read" }] } }, v2),
  true,
  "a missing tool input is a malformed profile frame rather than an empty invocation",
);
assert.deepEqual(
  parseClaudeMessageEnvelope({ type: "assistant", message: { content: [{ type: "tool_use", id: "toolu-null-input", name: "Read", input: null }] } }, v2),
  [],
  "a null tool input does not create an incomplete tool bubble",
);
assert.equal(
  hasUnsupportedClaudeToolFrame({ type: "assistant", message: { content: [{ type: "tool_use", id: "toolu-null-input", name: "Read", input: null }] } }, v2),
  true,
  "a null tool input is a malformed profile frame rather than an empty invocation",
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
  hasUnsupportedClaudeToolFrame({
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: "toolu-new", is_error: "true" }] },
  }, v2),
  true,
  "a malformed error flag must not turn a failed tool result into an ok bubble",
);
assert.deepEqual(
  parseClaudeMessageEnvelope({
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: "toolu-missing-content" }] },
  }, v2),
  [],
  "a partial tool_result without its required content cannot settle a tool bubble",
);
assert.equal(
  hasUnsupportedClaudeToolFrame({
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: "toolu-missing-content" }] },
  }, v2),
  true,
  "a tool_result missing content is a malformed profile frame rather than a successful empty result",
);
assert.deepEqual(
  parseClaudeMessageEnvelope({
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: "toolu-null-content", content: null }] },
  }, v2),
  [],
  "a null tool_result content cannot settle a tool bubble successfully",
);
assert.equal(
  hasUnsupportedClaudeToolFrame({
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: "toolu-null-content", content: null }] },
  }, v2),
  true,
  "a null tool_result content is malformed rather than a successful empty result",
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
assert.equal(
  hasUnsupportedClaudeToolFrame({ type: "future", message: "partial" }, v2),
  true,
  "unknown partial message frames still surface the compatibility diagnostic",
);
assert.equal(
  hasUnsupportedClaudeToolFrame({ type: "future", payload: "untrusted" }, v2),
  true,
  "unknown frames without a message field must not be silently dropped",
);
assert.equal(
  hasUnsupportedClaudeToolFrame({ type: "system", subtype: "init" }, v2),
  false,
  "known stream metadata is not a compatibility failure",
);
assert.equal(
  hasUnsupportedClaudeToolFrame({ type: "output", text: "untrusted tool payload" }, v2),
  true,
  "Coven's Codex-only output envelope must not make an unknown Claude payload renderable",
);
assert.deepEqual(parseClaudeMessageEnvelope({ type: "future", payload: "untrusted" }, v2), []);
assert.deepEqual(
  parseClaudeTextOnlyEnvelope({
    type: "assistant",
    message: { content: [null, { type: "tool_use", id: "untrusted" }, { type: "text", text: "keep this" }] },
  }),
  ["keep this"],
  "fallback preserves valid text after malformed or tool blocks without creating a tool event",
);

console.log("claude-stream: ok");
