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
    JSON.stringify({ type: "text", sessionID: "ses_live", part: { type: "text", text: "live reply" } }),
    BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0],
    { onSession: (id) => sessions.push(id), onText: (event) => text.push(event.text), onTool: (event) => toolIds.push(event.id), onOther: (event) => diagnostics.push(event.diagnostic ?? "other") },
  );
  handleOpenCodeJsonLine(
    JSON.stringify({ type: "tool_use", sessionID: "ses_live", part: { type: "tool", id: "tool_live", tool: "Read", state: { output: "ok" } } }),
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
    { type: "text", sessionID: "ses_123", part: { type: "tool", text: "provider-controlled tool output", id: "prt_hostile" } },
    BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0],
  ),
  { kind: "other", sessionId: "ses_123", diagnostic: "malformed-event" },
  "a known root text label cannot render a payload whose signed kind is tool",
);
assert.deepEqual(
  parseOpenCodeRunEvent(
    { type: "step_start", sessionID: "ses_123", part: { id: "step_1" } },
    BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0],
  ),
  { kind: "ignore" },
  "current OpenCode step-start frames are lifecycle metadata, not compatibility failures",
);
assert.deepEqual(
  parseOpenCodeRunEvent(
    { type: "step_finish", sessionID: "ses_123", part: { id: "step_1" } },
    BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0],
  ),
  { kind: "ignore" },
  "current OpenCode step-finish frames are lifecycle metadata, not compatibility failures",
);
assert.deepEqual(
  parseOpenCodeRunEvent(
    { type: "reasoning", sessionID: "ses_123", part: { text: "private chain of thought" } },
    BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0],
  ),
  { kind: "ignore" },
  "current OpenCode reasoning frames are lifecycle metadata and never leak as assistant text",
);
{
  const sessions: string[] = [];
  handleOpenCodeJsonLine(
    JSON.stringify({ type: "step_start", sessionID: "ses_injected", part: { id: "step_1" } }),
    BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0],
    { onSession: (id) => sessions.push(id) },
  );
  assert.deepEqual(sessions, [], "ignored lifecycle frames cannot overwrite the persisted native resume token");
}
assert.deepEqual(
  parseOpenCodeRunEvent(
    { session: "ses_mapped", payload: { event: "reply", type: "text", body: "A registry-mapped reply" } },
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
  parseOpenCodeRunEvent(
    { type: "tool_use", sessionID: "ses_123", id: "root_tool", tool: "bash", state: { input: { command: "pwd" }, output: "secret", status: "completed" } },
    BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0],
  ),
  { kind: "other", sessionId: "ses_123", diagnostic: "malformed-event" },
  "the current v1 profile requires the documented part envelope for tool activity",
);
assert.deepEqual(
  parseOpenCodeRunEvent(
    { type: "tool_use", sessionID: "ses_123", part: { type: "text", id: "prt_hostile", tool: "bash", state: { output: "provider-controlled output" } } },
    BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0],
  ),
  { kind: "other", sessionId: "ses_123", diagnostic: "malformed-event" },
  "a known root tool label cannot render a payload whose signed kind is text",
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
  { kind: "other", sessionId: "ses_123", diagnostic: "unknown-event" },
  "undocumented split lifecycle labels cannot become trusted v1 activity",
);
assert.deepEqual(
  parseOpenCodeRunEvent(
    { type: "tool_result", session_id: "ses_123", data: { id: "tool_1", state: { output: "ok" } } },
    BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0],
  ),
  { kind: "other", sessionId: "ses_123", diagnostic: "unknown-event" },
  "undocumented terminal labels cannot settle a trusted v1 bubble",
);
assert.deepEqual(
  parseOpenCodeRunEvent(
    { type: "tool", sessionID: "ses_123", callID: "call_1", tool: "bash", state: { input: { command: "pwd" }, status: "running" } },
    BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0],
  ),
  { kind: "other", sessionId: "ses_123", diagnostic: "unknown-event" },
  "undocumented root tool labels cannot create a trusted v1 bubble",
);
assert.deepEqual(
  parseOpenCodeRunEvent(
    { type: "tool_use", sessionID: "ses_123", part: { type: "tool", id: "prt_failed", tool: "bash", state: { input: { command: "false" }, error: "permission denied", status: "error" } } },
    BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0],
  ),
  { kind: "tool", sessionId: "ses_123", id: "prt_failed", name: "bash", input: { command: "false" }, output: "permission denied", isError: true },
  "terminal tool failures preserve a safe partial error output",
);
assert.deepEqual(
  parseOpenCodeRunEvent(
    { type: "tool_use", sessionID: "ses_123", part: { type: "tool", id: "prt_null_error", tool: "bash", state: { input: { command: "pwd" }, output: "ok", error: null, status: "completed" } } },
    BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0],
  ),
  { kind: "tool", sessionId: "ses_123", id: "prt_null_error", name: "bash", input: { command: "pwd" }, output: "ok", isError: false },
  "a null error payload is a successful terminal result unless the status itself is an error",
);
assert.deepEqual(
  parseOpenCodeRunEvent(
    { type: "tool_use", sessionID: "ses_123", part: { type: "tool", id: "prt_false_error", tool: "bash", state: { input: { command: "pwd" }, output: "ok", error: false, status: "completed" } } },
    BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0],
  ),
  { kind: "tool", sessionId: "ses_123", id: "prt_false_error", name: "bash", input: { command: "pwd" }, output: "ok", isError: false },
  "a false error marker is a successful terminal result unless the status itself is an error",
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
assert.deepEqual(
  parseOpenCodeRunEvent(
    { type: "future_text_delta", sessionID: "ses_future", part: { type: "text", text: "Still show this trusted reply" } },
    BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0],
  ),
  { kind: "text", sessionId: "ses_future", text: "Still show this trusted reply", diagnostic: "unknown-event" },
  "an unknown label retains text only when the signed text envelope and payload kind both validate",
);
{
  const sessions: string[] = [];
  const text: string[] = [];
  const diagnostics: string[] = [];
  handleOpenCodeJsonLine(
    JSON.stringify({ type: "future_text_delta", sessionID: "ses_future", part: { type: "text", text: "trusted reply" } }),
    BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0],
    { onSession: (id) => sessions.push(id), onText: (event) => text.push(event.text), onOther: (event) => diagnostics.push(event.diagnostic ?? "other") },
  );
  assert.deepEqual(text, ["trusted reply"], "a trusted unknown-label text frame reaches the live assistant transcript");
  assert.deepEqual(diagnostics, ["unknown-event"], "the same evolved label still creates one compatibility diagnostic");
  assert.deepEqual(sessions, [], "an unknown text label cannot overwrite the persisted native resume token");
}
assert.deepEqual(
  parseOpenCodeRunEvent(["future", "envelope"]),
  { kind: "other", diagnostic: "malformed-event" },
  "valid JSON with an unsupported envelope still produces one compatibility diagnostic",
);
assert.deepEqual(
  parseOpenCodeRunEvent(
    { type: "assistant_text", session_id: "ses_legacy", data: { type: "text", content: "Older client reply" } },
    BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[1],
  ),
  { kind: "text", sessionId: "ses_legacy", text: "Older client reply" },
  "the legacy capability profile keeps a prior text envelope compatible",
);
assert.deepEqual(
  parseOpenCodeRunEvent(
    { type: "tool_call", sessionId: "ses_legacy", data: { type: "tool", toolCallId: "legacy_1", name: "Read", input: { path: "README.md" }, state: { status: "running" } } },
    BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[1],
  ),
  { kind: "tool_start", sessionId: "ses_legacy", id: "legacy_1", name: "Read", input: { path: "README.md" } },
  "the legacy profile keeps stable ids for a split tool lifecycle",
);
const progressSchema = {
  ...BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[1],
  id: "opencode-progress-v2",
  eventTypes: {
    ...BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[1].eventTypes,
    toolProgress: ["tool_progress"],
  },
};
assert.deepEqual(
  parseOpenCodeRunEvent(
    { type: "tool_progress", sessionId: "ses_progress", data: { type: "tool", toolCallId: "progress_1", state: { output: "read 50%" } } },
    progressSchema,
  ),
  { kind: "tool_progress", sessionId: "ses_progress", id: "progress_1", output: "read 50%" },
  "a signed schema can identify a nonterminal progress frame without treating it as a start or result",
);
{
  const progress: string[] = [];
  handleOpenCodeJsonLine(
    JSON.stringify({ type: "tool_progress", data: { type: "tool", toolCallId: "progress_dispatch", state: { output: "working" } } }),
    progressSchema,
    { onToolProgress: (event) => progress.push(`${event.id}:${String(event.output)}`) },
  );
  assert.deepEqual(progress, ["progress_dispatch:working"], "JSONL dispatch forwards declared tool progress separately from terminal results");
}
const shapedSchema = {
  ...BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0],
  id: "opencode-run-json-shaped-v2",
  eventTypes: {
    ...BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0].eventTypes,
    toolComplete: ["tool"],
  },
  shape: {
    envelope: [["event", "payload"]],
    discriminator: { envelope: ["event", "payload"], field: "event" },
    payloadKind: { field: "kind", text: ["text"], tool: ["tool"] },
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
    { event: { payload: { event: "tool", kind: "tool", session: "ses_v2", call_id: "call_v2", tool_name: "Read", phase: { state: "done", arguments: { path: "README.md" }, result: "ok" } } } },
    shapedSchema,
  ),
  { kind: "tool", sessionId: "ses_v2", id: "call_v2", name: "Read", input: { path: "README.md" }, output: "ok", isError: false },
  "a signed schema resolves envelope-native sessions as well as bounded future fields and terminal states",
);
const rootIdSchema = {
  ...BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0],
  id: "opencode-root-id-v2",
  eventTypes: {
    ...BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0].eventTypes,
    toolComplete: ["tool"],
  },
  shape: {
    ...BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0].shape,
    envelope: ["part"],
    idEnvelope: ["root"],
  },
};
assert.deepEqual(
  parseOpenCodeRunEvent(
    { type: "tool", callID: "root_call_1", part: { type: "tool", tool: "Read", state: { input: { path: "README.md" }, output: "ok", status: "completed" } } },
    rootIdSchema,
  ),
  { kind: "tool", sessionId: undefined, id: "root_call_1", name: "Read", input: { path: "README.md" }, output: "ok", isError: false },
  "a signed schema can read a root tool ID while retaining a nested payload envelope",
);
console.log("opencode-stream.test.ts: ok");
