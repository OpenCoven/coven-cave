// @ts-nocheck
import assert from "node:assert/strict";
import { BUILTIN_OPENCODE_SCHEMA_BUNDLE } from "./opencode-compatibility.ts";
import { handleOpenCodeJsonLine, parseOpenCodeRunEvent } from "./opencode-stream.ts";

assert.deepEqual(
  parseOpenCodeRunEvent({ type: "text", sessionID: "ses_123", part: { text: "Hello" } }),
  { kind: "text", sessionId: "ses_123", text: "Hello" },
);
{
  const sessions: string[] = [];
  const text: string[] = [];
  const toolIds: string[] = [];
  const diagnostics: string[] = [];
  handleOpenCodeJsonLine(
    JSON.stringify({ type: "text", sessionID: "ses_live", part: { text: "live reply" } }),
    BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0],
    { onSession: (id) => sessions.push(id), onText: (event) => text.push(event.text), onTool: (event) => toolIds.push(event.id), onOther: (event) => diagnostics.push(event.diagnostic ?? "other") },
  );
  handleOpenCodeJsonLine(
    JSON.stringify({ type: "tool_use", sessionID: "ses_live", part: { id: "tool_live", tool: "Read", state: { output: "ok" } } }),
    BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0],
    { onSession: (id) => sessions.push(id), onText: (event) => text.push(event.text), onTool: (event) => toolIds.push(event.id), onOther: (event) => diagnostics.push(event.diagnostic ?? "other") },
  );
  handleOpenCodeJsonLine(
    JSON.stringify({ type: "text", sessionID: "ses_hijack", text: "hostile root text" }),
    BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0],
    { onSession: (id) => sessions.push(id), onText: (event) => text.push(event.text), onTool: (event) => toolIds.push(event.id), onOther: (event) => diagnostics.push(event.diagnostic ?? "other") },
  );
  assert.deepEqual(sessions, ["ses_live", "ses_live"], "JSONL dispatch adopts a native session only after a frame matches the selected schema");
  assert.deepEqual(text, ["live reply"], "only schema-authorized text reaches the route callback");
  assert.deepEqual(toolIds, ["tool_live"], "terminal tool frames retain their upstream call id");
  assert.deepEqual(diagnostics, ["malformed-event"], "hostile frames reach the diagnostic path instead of assistant text");
}
assert.deepEqual(
  parseOpenCodeRunEvent(
    { type: "text", sessionID: "ses_123", text: "provider-controlled root field" },
    BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0],
  ),
  { kind: "other", sessionId: "ses_123", diagnostic: "malformed-event" },
  "a text label cannot promote root payload fields unless its signed profile explicitly authorizes a root text envelope",
);
assert.deepEqual(
  parseOpenCodeRunEvent(
    { type: "step_start", sessionID: "ses_123", part: { id: "step_1" } },
    BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0],
  ),
  { kind: "ignore", sessionId: "ses_123" },
  "current OpenCode step-start frames are lifecycle metadata, not compatibility failures",
);
assert.deepEqual(
  parseOpenCodeRunEvent(
    { type: "step_finish", sessionID: "ses_123", part: { id: "step_1" } },
    BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0],
  ),
  { kind: "ignore", sessionId: "ses_123" },
  "current OpenCode step-finish frames are lifecycle metadata, not compatibility failures",
);
assert.deepEqual(
  parseOpenCodeRunEvent(
    { type: "reasoning", sessionID: "ses_123", part: { text: "private chain of thought" } },
    BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0],
  ),
  { kind: "ignore", sessionId: "ses_123" },
  "current OpenCode reasoning frames are lifecycle metadata and never leak as assistant text",
);
assert.deepEqual(
  parseOpenCodeRunEvent(
    { session: "ses_mapped", payload: { event: "reply", body: "A registry-mapped reply" } },
    {
      ...BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0],
      id: "mapped-envelope",
      eventTypes: { ...BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0].eventTypes, text: ["reply"] },
      shape: {
        ...BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0].shape,
        envelope: ["payload"],
        discriminator: { envelope: "payload", field: "event" },
        textEnvelope: ["payload"],
        sessionId: ["session"],
        text: ["body"],
      },
    },
  ),
  { kind: "text", sessionId: "ses_mapped", text: "A registry-mapped reply" },
  "a signed schema can adapt a renamed envelope and session/text fields without code changes",
);
assert.deepEqual(
  parseOpenCodeRunEvent({ type: "tool_use", sessionID: "ses_123", part: { id: "prt_1", tool: "bash", state: { input: { command: "pwd" }, output: "ok", status: "completed" } } }),
  { kind: "tool", sessionId: "ses_123", id: "prt_1", name: "bash", input: { command: "pwd" }, output: "ok", isError: false },
);
assert.deepEqual(
  parseOpenCodeRunEvent({ type: "text" }),
  { kind: "other", sessionId: undefined, diagnostic: "malformed-event" },
  "malformed events never produce assistant text",
);
assert.deepEqual(
  parseOpenCodeRunEvent({
    type: "error",
    sessionID: "ses_123",
    error: { name: "UnknownError", data: { message: "Selected model is unavailable" } },
  }),
  { kind: "error", sessionId: "ses_123", message: "Selected model is unavailable" },
  "OpenCode nests command errors under error.data.message",
);
assert.deepEqual(
  parseOpenCodeRunEvent(
    { type: "tool_start", sessionId: "ses_123", data: { id: "tool_1", name: "Read", state: { input: { path: "README.md" } } } },
    BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0],
  ),
  { kind: "tool_start", sessionId: "ses_123", id: "tool_1", name: "Read", input: { path: "README.md" } },
  "newer split lifecycle events keep their upstream id",
);
assert.deepEqual(
  parseOpenCodeRunEvent(
    { type: "tool_result", session_id: "ses_123", data: { id: "tool_1", state: { output: "ok" } } },
    BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0],
  ),
  { kind: "tool_end", sessionId: "ses_123", id: "tool_1", output: "ok", isError: false },
  "reordered results can close the same stable tool bubble",
);
assert.deepEqual(
  parseOpenCodeRunEvent(
    { type: "tool_result", id: "tool_failed", error: "permission denied" },
    BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0],
  ),
  { kind: "tool_end", sessionId: undefined, id: "tool_failed", output: "permission denied", isError: true },
  "root-level terminal errors settle a failed tool rather than an empty success",
);
assert.deepEqual(
  parseOpenCodeRunEvent(
    { type: "tool", sessionID: "ses_123", callID: "call_1", tool: "bash", state: { input: { command: "pwd" }, status: "running" } },
    BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0],
  ),
  { kind: "tool_start", sessionId: "ses_123", id: "call_1", name: "bash", input: { command: "pwd" } },
  "current root tool updates use callID without fabricating a local id",
);
assert.deepEqual(
  parseOpenCodeRunEvent(
    { type: "tool", sessionID: "ses_123", callID: "call_1", tool: "bash", state: { input: { command: "pwd" }, output: "ok", status: "completed" } },
    BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0],
  ),
  { kind: "tool", sessionId: "ses_123", id: "call_1", name: "bash", input: { command: "pwd" }, output: "ok", isError: false },
  "current root terminal tool updates preserve input and output",
);
assert.deepEqual(
  parseOpenCodeRunEvent(
    { type: "tool_use", sessionID: "ses_123", part: { id: "prt_failed", tool: "bash", state: { input: { command: "false" }, error: "permission denied", status: "error" } } },
    BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0],
  ),
  { kind: "tool", sessionId: "ses_123", id: "prt_failed", name: "bash", input: { command: "false" }, output: "permission denied", isError: true },
  "terminal tool failures preserve a safe partial error output",
);
assert.deepEqual(
  parseOpenCodeRunEvent({ type: "tool_use", part: { id: "prt_statusless", tool: "bash", state: { input: { command: "pwd" }, output: "ok" } } }),
  { kind: "tool", sessionId: undefined, id: "prt_statusless", name: "bash", input: { command: "pwd" }, output: "ok", isError: false },
  "legacy terminal snapshots preserve output even when status is omitted",
);
assert.deepEqual(
  parseOpenCodeRunEvent({ type: "tool_use", part: { tool: "Read" } }),
  { kind: "other", sessionId: undefined, diagnostic: "malformed-event" },
  "missing tool ids never create random, non-resumable bubbles",
);
assert.deepEqual(
  parseOpenCodeRunEvent({ type: "future_text_delta", data: { text: "Still show this reply" } }),
  { kind: "other", sessionId: undefined, diagnostic: "unknown-event" },
  "unknown envelopes never promote arbitrary payload text into assistant output",
);
assert.equal(
  parseOpenCodeRunEvent({ type: "tool", callID: "failed_1", tool: "bash", state: { status: "FAILED" } }, BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0]).kind,
  "tool",
  "case variants of terminal states remain terminal",
);
assert.equal(
  (parseOpenCodeRunEvent({ type: "tool", callID: "failed_1", tool: "bash", state: { status: "FAILED" } }, BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0]) as { isError: boolean }).isError,
  true,
  "case variants of error statuses do not render successful tool bubbles",
);
assert.deepEqual(
  parseOpenCodeRunEvent(
    { type: "tool", callID: "cancelled_1", tool: "bash", state: { status: "CANCELLED" } },
    BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0],
  ),
  { kind: "tool", sessionId: undefined, id: "cancelled_1", name: "bash", input: {}, output: "", isError: true },
  "cancelled terminal states settle the upstream tool as an error",
);
assert.deepEqual(
  parseOpenCodeRunEvent(["future", "envelope"]),
  { kind: "other", diagnostic: "malformed-event" },
  "valid JSON with an unsupported envelope still produces one compatibility diagnostic",
);
assert.deepEqual(
  parseOpenCodeRunEvent(
    { type: "assistant_text", session_id: "ses_legacy", data: { content: "Older client reply" } },
    BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[1],
  ),
  { kind: "text", sessionId: "ses_legacy", text: "Older client reply" },
  "the legacy capability profile keeps a prior text envelope compatible",
);
assert.deepEqual(
  parseOpenCodeRunEvent(
    { type: "tool_call", sessionId: "ses_legacy", data: { toolCallId: "legacy_1", name: "Read", input: { path: "README.md" }, state: { status: "running" } } },
    BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[1],
  ),
  { kind: "tool_start", sessionId: "ses_legacy", id: "legacy_1", name: "Read", input: { path: "README.md" } },
  "the legacy profile keeps stable ids for a split tool lifecycle",
);
const shapedSchema = {
  ...BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0],
  id: "opencode-run-json-shaped-v2",
  shape: {
    envelope: [["event", "payload"]],
    discriminator: { envelope: ["event", "payload"], field: "event" },
    sessionId: ["session"],
    id: ["call_id"],
    name: ["tool_name"],
    state: ["phase"],
    status: ["state"],
    input: ["arguments"],
    output: ["result"],
    error: ["failure"],
    terminalStates: ["done", "failed"],
    errorStates: ["failed"],
  },
};
assert.deepEqual(
  parseOpenCodeRunEvent(
    { event: { payload: { event: "tool", session: "ses_v2", call_id: "call_v2", tool_name: "Read", phase: { state: "done", arguments: { path: "README.md" }, result: "ok" } } } },
    shapedSchema,
  ),
  { kind: "tool", sessionId: "ses_v2", id: "call_v2", name: "Read", input: { path: "README.md" }, output: "ok", isError: false },
  "a signed schema resolves envelope-native sessions as well as bounded future fields and terminal states",
);
console.log("opencode-stream.test.ts: ok");
