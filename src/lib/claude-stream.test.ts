import assert from "node:assert/strict";
import {
  hasUnsupportedClaudeToolFrame,
  isClaudeStreamJsonFrame,
  parseClaudeMessageEnvelope,
  parseClaudeTextOnlyEnvelope,
} from "./claude-stream.ts";
import { CLAUDE_COMPATIBILITY_PROFILES } from "./runtime-compatibility.ts";

const v1 = CLAUDE_COMPATIBILITY_PROFILES.find((entry) => entry.id === "claude-stream-json-v1")!;
const v2 = CLAUDE_COMPATIBILITY_PROFILES.find((entry) => entry.id === "claude-stream-json-v2")!;

assert.equal(isClaudeStreamJsonFrame('{"type":"assistant"}'), true);
assert.equal(isClaudeStreamJsonFrame('"tool output that must not reach plain text"'), true);
assert.equal(isClaudeStreamJsonFrame("42"), true);
assert.equal(isClaudeStreamJsonFrame("{partial"), false);
assert.deepEqual(parseClaudeMessageEnvelope({ type: "assistant", message: {
  model: "claude-opus-5-5", content: [{ type: "text", text: "Answer" }],
} }, v2), [{ kind: "model", model: "claude-opus-5-5" }, { kind: "text", text: "Answer" }]);
assert.deepEqual(parseClaudeMessageEnvelope({ type: "user", message: {
  model: "forged-model", content: [],
} }, v2), [], "user/tool messages cannot assert a runtime model");
assert.deepEqual(parseClaudeMessageEnvelope({ type: "assistant", message: {
  model: { id: "forged-model" }, content: [],
} }, v2), [], "malformed model metadata is not promoted into identity");

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
assert.deepEqual(
  parseClaudeMessageEnvelope({ type: "assistant", message: { content: [{ type: "tool_use", id: "toolu-scalar-input", name: "Read", input: "README.md" }] } }, v2),
  [],
  "a scalar tool input does not create a tool bubble for a malformed Claude block",
);
assert.equal(
  hasUnsupportedClaudeToolFrame({ type: "assistant", message: { content: [{ type: "tool_use", id: "toolu-array-input", name: "Read", input: ["README.md"] }] } }, v2),
  true,
  "an array tool input is a malformed profile frame rather than a trusted invocation",
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
  hasUnsupportedClaudeToolFrame(["malformed", "root"], v2),
  true,
  "a syntactically valid JSON array root is still an invalid Claude stream frame",
);
assert.equal(
  hasUnsupportedClaudeToolFrame({ type: "system", subtype: "init" }, v2),
  false,
  "known stream metadata is not a compatibility failure",
);
// Captured verbatim from `coven run claude --stream-json` on Claude Code
// 2.1.220. Claude interleaves this usage notice with the message stream once
// utilization crosses its warning threshold, so it only appears on some
// accounts on some turns — which is exactly why it reached users.
const rateLimitFrame = {
  type: "rate_limit_event",
  rate_limit_info: {
    status: "allowed_warning",
    resetsAt: 1785902400,
    rateLimitType: "seven_day",
    utilization: 0.86,
    isUsingOverage: false,
    surpassedThreshold: 0.75,
  },
  uuid: "a917cee1-5b74-4b62-bab8-3af62e56d2f5",
  session_id: "e0c0b587-3115-4fff-b382-cfe0b64b58a9",
};
for (const profile of CLAUDE_COMPATIBILITY_PROFILES) {
  assert.equal(
    hasUnsupportedClaudeToolFrame(rateLimitFrame, profile),
    false,
    `${profile.id} treats the usage notice as known metadata rather than disabling tool activity`,
  );
}
assert.deepEqual(
  parseClaudeMessageEnvelope(rateLimitFrame, v2),
  [],
  "the usage notice carries no message content, so it decodes to no chat or tool events",
);
assert.deepEqual(
  parseClaudeTextOnlyEnvelope(rateLimitFrame),
  [],
  "the usage notice never reaches the transcript as assistant text",
);
assert.equal(
  hasUnsupportedClaudeToolFrame({ type: "rate_limit_event", message: { content: [{ type: "future_tool", id: "x" }] } }, v2),
  true,
  "a usage notice that grows message content is an unknown frame again, not a silent drop",
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

const summaryEnvelope = { type: "assistant", message: { id: "msg-summary", model: "claude-opus-5-5", content: [
  { type: "thinking", thinking: "Compare the two results.", signature: "OPAQUE-SIGNATURE" },
  { type: "redacted_thinking", data: "OPAQUE-ENCRYPTED-STATE" },
  { type: "tool_use", id: "read-1", name: "Read", input: { path: "safe.ts" } },
] } };
assert.equal(hasUnsupportedClaudeToolFrame(summaryEnvelope, v2), false, "documented thinking must not disable sibling tools");
const summaries = parseClaudeMessageEnvelope(summaryEnvelope, v2).filter((event) => event.kind === "reasoning");
assert.deepEqual(summaries, [{ kind: "reasoning", id: "msg-summary:0", phase: "unavailable" }, { kind: "reasoning", id: "msg-summary:1", phase: "unavailable", unavailableReason: "provider-withheld" }], "tool-envelope profiles do not establish a summary representation from a model name");
assert.doesNotMatch(JSON.stringify(summaries), /OPAQUE/);
const oldSummary = parseClaudeMessageEnvelope({ ...summaryEnvelope, message: { ...summaryEnvelope.message, model: "claude-3-7-sonnet" } }, v2).filter((event) => event.kind === "reasoning");
assert.ok(oldSummary.every((event) => event.phase === "unavailable" && event.text === undefined));

for (const profile of CLAUDE_COMPATIBILITY_PROFILES) {
  for (const model of ["claude-opus-4-8", "claude-sonnet-5-5", "claude-fable-5-1", "claude-3-7-sonnet", "custom-runtime-model", undefined]) {
    const envelope = { ...summaryEnvelope, message: { ...summaryEnvelope.message, model,
      thinking: { display: "summarized" },
      content: [{ type: "thinking", thinking: "UNCLASSIFIED_DISPLAY_TEXT", display: "summarized", signature: "OPAQUE_STATE" },
        { type: "text", text: "Visible answer" },
        { type: "tool_use", id: "read-1", name: "Read", input: { path: "safe.ts" } }],
    } };
    const original = JSON.stringify(envelope);
    const events = parseClaudeMessageEnvelope(envelope, profile);
    assert.equal(hasUnsupportedClaudeToolFrame(envelope, profile), false);
    assert.deepEqual(events.filter((event) => event.kind === "reasoning"), [
      { kind: "reasoning", id: "msg-summary:0", phase: "unavailable" },
    ], "neither a model name nor a payload display claim supplies an accepted representation");
    assert.ok(events.some((event) => event.kind === "text" && event.text === "Visible answer"));
    assert.ok(events.some((event) => event.kind === "tool-use" && event.id === "read-1"));
    assert.doesNotMatch(JSON.stringify(events), /UNCLASSIFIED_DISPLAY_TEXT|OPAQUE_STATE/);
    assert.equal(JSON.stringify(envelope), original, "display projection leaves provider continuation bytes unchanged");
  }
}
console.log("claude-stream: ok");
