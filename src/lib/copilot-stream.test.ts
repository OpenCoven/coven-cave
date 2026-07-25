// Behavioral tests for the copilot JSONL stream wiring (cave-yesg): the
// manifest-declared stream spec, the direct-spawn argv builder, and the
// event parser feeding ToolCallTracker — the exact pipeline the chat send
// route runs for copilot turns. The fixture below is a sanitized capture of
// copilot CLI 1.0.70 `--output-format json --stream on -p …` running one
// shell tool call and a follow-up text reply.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildCopilotStreamArgs,
  compareRuntimeClientVersions,
  copilotIdentityPreamble,
  copilotProtocolDiagnostic,
  copilotStreamSpec,
  CopilotTextAssembler,
  COPILOT_EVENT_PROTOCOL_SCHEMAS,
  parseRuntimeClientVersion,
  parseCopilotChatEvent,
  runtimeEventProtocolSchemas,
  selectRuntimeEventProtocol,
} from "./copilot-stream.ts";
import {
  formatToolInputValue,
  toPersistedTools,
  ToolCallTracker,
} from "./chat-tool-events.ts";

// ── stream spec from the synced registry manifest ────────────────────────────

const spec = copilotStreamSpec();
assert.ok(spec, "registry manifest declares copilot stream mode");
assert.equal(spec.protocol.id, "copilot-jsonl-v1", "legacy callers use the verified registry baseline");
assert.equal(spec.executable, "copilot");
assert.deepEqual(
  spec.prefixArgs,
  ["--output-format", "json", "--stream", "on", "-p"],
  "stream prefix args come from the manifest's stream_args.prefix_args",
);
assert.equal(spec.sessionIdFlag, "--session-id");
assert.equal(spec.resumeFlag, "--resume");
assert.equal(spec.modelFlag, "--model");
assert.equal(
  spec.addDirFlag,
  "--add-dir",
  "no manifest add_dir_flag override → copilot's native repeatable flag",
);
assert.deepEqual(spec.sandboxFullArgs, ["--allow-all"]);
assert.deepEqual(spec.sandboxReadOnlyArgs, [
  "--deny-tool",
  "write",
  "--deny-tool",
  "shell",
]);

// ── versioned protocol selection and redacted diagnostics ───────────────────

assert.equal(parseRuntimeClientVersion("copilot version 1.0.70"), "1.0.70");
assert.equal(parseRuntimeClientVersion("Copilot CLI v2.4.0"), "2.4.0");
assert.equal(parseRuntimeClientVersion("warning only"), null);
assert.equal(parseRuntimeClientVersion("copilot version 1.0.70.1"), null, "invalid trailing version syntax fails closed");
assert.equal(parseRuntimeClientVersion("copilot version 01.0.0"), null, "leading-zero SemVer identifiers fail closed");
assert.equal(parseRuntimeClientVersion("dependency version 1.0.70\ncopilot version 2.0.0"), null, "ambiguous output fails closed");
assert.ok((compareRuntimeClientVersions("1.0.70", "1.0.9") ?? 0) > 0);
assert.equal(compareRuntimeClientVersions("9007199254740993.0.0", "9007199254740992.0.0"), 1, "large SemVer identifiers retain exact precedence");
assert.equal(compareRuntimeClientVersions("1.0.0-rc.1", "1.0.0"), -1);
const prereleaseBoundarySchema = {
  ...COPILOT_EVENT_PROTOCOL_SCHEMAS[0]!,
  id: "copilot-prerelease-boundary-fixture",
  minClientVersion: "1.0.0-a",
  maxClientVersionExclusive: null,
};
assert.equal(
  selectRuntimeEventProtocol("1.0.0-B", [prereleaseBoundarySchema]),
  null,
  "ASCII SemVer ordering keeps B below a instead of locale-sorting it above",
);
assert.equal(selectRuntimeEventProtocol("1.0.0-b", [prereleaseBoundarySchema])?.id, prereleaseBoundarySchema.id);
assert.equal(selectRuntimeEventProtocol("0.9.9"), null, "pre-protocol clients fail closed");
assert.equal(selectRuntimeEventProtocol("1.0.70")?.id, "copilot-jsonl-v1");
assert.equal(selectRuntimeEventProtocol("2.0.0"), null, "an unknown future major fails closed");
assert.equal(selectRuntimeEventProtocol("2.0.0-rc.1"), null, "future-major prereleases fail closed");
assert.equal(selectRuntimeEventProtocol("not-a-version"), null, "unparseable clients fail closed");
assert.equal(
  copilotStreamSpec("0.9.9"),
  null,
  "a caller that has an incompatible client version must retain the generic plain-chat path",
);

const V2_SCHEMA = {
  ...COPILOT_EVENT_PROTOCOL_SCHEMAS[0]!,
  id: "copilot-jsonl-v2-fixture",
  minClientVersion: "2.0.0",
  maxClientVersionExclusive: null,
  eventTypes: {
    textDelta: ["assistant.delta"],
    message: ["assistant.complete"],
    toolStart: ["tool.started"],
    toolEnd: ["tool.finished"],
    result: ["run.finished"],
  },
  fields: {
    ...COPILOT_EVENT_PROTOCOL_SCHEMAS[0]!.fields,
    data: ["payload"],
    messageId: ["message_id"],
    deltaContent: ["delta"],
    toolCallId: ["call_id"],
    toolName: ["tool"],
    arguments: ["input"],
    resultContent: ["text"],
    sessionId: ["session_id"],
    exitCode: ["exit_code"],
    durationMs: ["duration_ms"],
  },
};
assert.deepEqual(
  runtimeEventProtocolSchemas([V2_SCHEMA]).map((schema) => schema.id),
  ["copilot-jsonl-v2-fixture"],
  "a validated registry schema can extend support without a new normalized event implementation",
);

const flagShapedModelArgs = buildCopilotStreamArgs({
  spec,
  prompt: "safe prompt",
  resumeSessionId: null,
  newSessionId: null,
  model: "openai/--allow-all-tools",
  permissionMode: "read",
  addDirs: [],
});
assert.ok(!flagShapedModelArgs.includes("--model"), "a provider prefix cannot turn a model value into a Copilot flag");
assert.ok(!flagShapedModelArgs.includes("--allow-all-tools"), "stripped flag-shaped model values never reach spawn argv");
assert.deepEqual(
  runtimeEventProtocolSchemas([{ ...V2_SCHEMA, fields: { data: ["payload"] } }]),
  [],
  "a partial or malformed registry schema cannot select the event parser",
);
assert.equal(
  selectRuntimeEventProtocol("2.0.1", [COPILOT_EVENT_PROTOCOL_SCHEMAS[0]!, V2_SCHEMA])?.id,
  "copilot-jsonl-v2-fixture",
  "newer registry schemas win without changing the normalized chat contract",
);
const refreshedProtocolSpec = copilotStreamSpec("2.0.1", [V2_SCHEMA]);
assert.equal(
  refreshedProtocolSpec?.protocol.id,
  "copilot-jsonl-v2-fixture",
  "a refreshed registry protocol activates without allowing it to alter Cave's spawn manifest",
);
assert.equal(refreshedProtocolSpec?.executable, "copilot", "refreshed metadata cannot replace the launch executable");
assert.deepEqual(refreshedProtocolSpec?.sandboxReadOnlyArgs, ["--deny-tool", "write", "--deny-tool", "shell"], "refreshed metadata cannot weaken read-only sandbox argv");
assert.deepEqual(
  parseCopilotChatEvent(
    {
      type: "tool.finished",
      payload: { call_id: "new-tool", success: false, result: { text: "denied" } },
    },
    V2_SCHEMA,
  ),
  { kind: "tool_end", toolCallId: "new-tool", output: "denied", isError: true, model: undefined },
  "schema aliases normalize a changed event envelope into the same tool lifecycle",
);
const alternateDiscriminatorSchema = { ...V2_SCHEMA, eventTypeFields: ["event"] };
assert.deepEqual(
  parseCopilotChatEvent(
    { event: "assistant.delta", payload: { message_id: "alternate", delta: "schema-selected key" } },
    alternateDiscriminatorSchema,
  ),
  { kind: "text_delta", messageId: "alternate", text: "schema-selected key", model: undefined },
  "a refreshed schema can select its own top-level event discriminator key",
);
assert.equal(
  copilotProtocolDiagnostic(
    { type: "operation.progress", payload: {} },
    { ...V2_SCHEMA, diagnosticEventPrefixes: ["operation."] },
  )?.code,
  "unsupported-tool-event",
  "a refreshed schema defines which unknown event namespaces signal protocol drift",
);
const unknownDiagnostic = copilotProtocolDiagnostic(
  { type: "tool.execution_progress", data: { toolCallId: "secret-id", output: "/private/path" } },
  COPILOT_EVENT_PROTOCOL_SCHEMAS[0]!,
);
assert.equal(unknownDiagnostic?.code, "unsupported-tool-event");
assert.doesNotMatch(JSON.stringify(unknownDiagnostic), /secret-id|private\/path/);
assert.equal(
  copilotProtocolDiagnostic(
    { type: "tool.execution_partial_result", data: { toolCallId: "t1", partialOutput: "safe" } },
    COPILOT_EVENT_PROTOCOL_SCHEMAS[0]!,
  ),
  null,
  "known partial-result noise is deliberately ignored rather than shown as an error",
);
assert.equal(
  copilotProtocolDiagnostic(
    { type: "assistant.tool_call_started", data: { toolCallId: "secret-id" } },
    COPILOT_EVENT_PROTOCOL_SCHEMAS[0]!,
  )?.code,
  "unsupported-tool-event",
  "unknown assistant-namespaced tool events are never silently dropped",
);
assert.equal(
  parseCopilotChatEvent(
    { type: "tool.execution_complete", data: { toolCallId: "t1", result: { content: "unknown" } } },
    COPILOT_EVENT_PROTOCOL_SCHEMAS[0]!,
  ),
  null,
  "completion frames without a boolean success state are malformed",
);
assert.equal(
  parseCopilotChatEvent(
    { type: "assistant.message", data: { messageId: "m", content: "text", toolRequests: [{ name: "shell" }] } },
    COPILOT_EVENT_PROTOCOL_SCHEMAS[0]!,
  ),
  null,
  "malformed declared tool requests fail the known event closed",
);
assert.equal(
  parseCopilotChatEvent(
    { type: "assistant.message", data: { messageId: "m", content: { unexpected: true } } },
    COPILOT_EVENT_PROTOCOL_SCHEMAS[0]!,
  ),
  null,
  "present non-string message content is malformed rather than silently emptied",
);
assert.equal(
  parseCopilotChatEvent(
    { type: "tool.execution_complete", data: { toolCallId: "t1", success: true, result: { content: [] } } },
    COPILOT_EVENT_PROTOCOL_SCHEMAS[0]!,
  ),
  null,
  "present non-string tool result content is malformed rather than silently omitted",
);

const v1Fixture = await readFile(
  new URL("./fixtures/copilot/1.0.70-tool-lifecycle.jsonl", import.meta.url),
  "utf8",
);
const v1Events = v1Fixture.trim().split(/\r?\n/).map((line) =>
  parseCopilotChatEvent(JSON.parse(line), COPILOT_EVENT_PROTOCOL_SCHEMAS[0]!),
);
assert.deepEqual(
  v1Events.map((event) => event?.kind),
  ["text_delta", "message", "tool_start", "tool_end", "result"],
  "the recorded 1.0.70 lifecycle fixture covers every normalised bubble state",
);

// ── argv builder ──────────────────────────────────────────────────────────────

const freshArgs = buildCopilotStreamArgs({
  spec,
  prompt: "do the thing",
  resumeSessionId: null,
  newSessionId: "11111111-2222-4333-8444-555555555555",
  model: "openai/gpt-5.5",
  permissionMode: "full",
  addDirs: ["/Users/example/projects/alpha", "", "/Users/example/.coven/workspaces/familiars/sage"],
});
assert.deepEqual(
  freshArgs,
  [
    "--session-id",
    "11111111-2222-4333-8444-555555555555",
    "--model",
    "gpt-5.5",
    "--add-dir",
    "/Users/example/projects/alpha",
    "--add-dir",
    "/Users/example/.coven/workspaces/familiars/sage",
    "--output-format",
    "json",
    "--stream",
    "on",
    "-p",
    "do the thing",
  ],
  "fresh turns pre-assign the session id, strip the model namespace, trust each granted root via repeatable --add-dir (empty entries dropped), leave full access implicit, and trail the prompt after -p",
);

const resumeArgs = buildCopilotStreamArgs({
  spec,
  prompt: "continue",
  resumeSessionId: "aaaa1111-2222-4333-8444-555555555555",
  newSessionId: null,
  model: null,
  permissionMode: "read",
  addDirs: ["/Users/example/projects/alpha"],
});
assert.deepEqual(
  resumeArgs,
  [
    "--resume",
    "aaaa1111-2222-4333-8444-555555555555",
    "--add-dir",
    "/Users/example/projects/alpha",
    "--deny-tool",
    "write",
    "--deny-tool",
    "shell",
    "--output-format",
    "json",
    "--stream",
    "on",
    "-p",
    "continue",
  ],
  "resumed read-only turns use --resume, still trust granted roots via --add-dir (cave-n1yc: read-only sessions previously got no grant access at all), and keep the manifest's deny-tool sandbox args",
);

const unattendedArgs = buildCopilotStreamArgs({
  spec,
  prompt: "run one bounded iteration",
  resumeSessionId: null,
  newSessionId: "22222222-3333-4444-8555-666666666666",
  model: null,
  permissionMode: "unattended",
  addDirs: ["/Users/example/.coven/cave/research-missions/research-1"],
});
assert.deepEqual(
  unattendedArgs,
  [
    "--session-id",
    "22222222-3333-4444-8555-666666666666",
    "--add-dir",
    "/Users/example/.coven/cave/research-missions/research-1",
    "--allow-all-tools",
    "--allow-all-urls",
    "--output-format",
    "json",
    "--stream",
    "on",
    "-p",
    "run one bounded iteration",
  ],
  "unattended one-shots (flow sessions) pre-approve tools and URLs — a -p run can't answer prompts, so approvals otherwise auto-deny and every workspace write fails — while path verification stays on (no --allow-all/--allow-all-paths), keeping writes inside cwd + --add-dir grants",
);

// ── identity preamble (mirror of coven's FamiliarContext) ─────────────────────

assert.equal(
  copilotIdentityPreamble("nova", "Nova", "Queen / Orchestrator"),
  "[Identity: You are Nova, a Queen / Orchestrator. Respond as Nova, not as the underlying tool.]",
);
assert.equal(
  copilotIdentityPreamble("sage", "Sage"),
  "[Identity: You are Sage. Respond as Sage, not as the underlying tool.]",
);
assert.equal(
  copilotIdentityPreamble("charm"),
  "[Identity: You are Charm. Respond as Charm, not as the underlying tool.]",
  "missing display name falls back to the capitalized familiar id",
);

// ── fixture: sanitized copilot CLI 1.0.70 JSONL capture ──────────────────────

const FIXTURE = [
  `{"type":"session.mcp_servers_loaded","data":{"servers":[]},"id":"e1","timestamp":"2026-07-12T12:58:59.497Z","ephemeral":true}`,
  `{"type":"user.message","data":{"content":"Run the shell command: echo hello-fixture."},"id":"e2","timestamp":"2026-07-12T12:59:00.015Z"}`,
  `{"type":"assistant.turn_start","data":{"turnId":"0","model":"claude-fable-5"},"id":"e3","timestamp":"2026-07-12T12:59:04.660Z"}`,
  `{"type":"assistant.tool_call_delta","data":{"toolCallId":"toolu_01","toolName":"bash","inputDelta":"{\\"c"},"id":"e4","timestamp":"2026-07-12T12:59:04.663Z","ephemeral":true}`,
  `{"type":"assistant.message","data":{"messageId":"m1","model":"claude-fable-5","content":"","toolRequests":[{"toolCallId":"toolu_01","name":"bash","arguments":{"command":"echo hello-fixture","description":"Echo hello-fixture"},"type":"function"}],"turnId":"0"},"id":"e5","timestamp":"2026-07-12T12:59:04.672Z"}`,
  `{"type":"tool.execution_start","data":{"toolCallId":"toolu_01","toolName":"bash","arguments":{"command":"echo hello-fixture","description":"Echo hello-fixture"},"model":"claude-fable-5","turnId":"0"},"id":"e6","timestamp":"2026-07-12T12:59:04.674Z"}`,
  `{"type":"tool.execution_partial_result","data":{"toolCallId":"toolu_01","partialOutput":"hello-fixture\\n"},"id":"e7","timestamp":"2026-07-12T12:59:04.709Z","ephemeral":true}`,
  `{"type":"tool.execution_complete","data":{"toolCallId":"toolu_01","model":"claude-fable-5","turnId":"0","success":true,"result":{"content":"hello-fixture\\n<shellId: 0 completed with exit code 0>"}},"id":"e8","timestamp":"2026-07-12T12:59:04.711Z"}`,
  `{"type":"assistant.turn_end","data":{"turnId":"0","model":"claude-fable-5"},"id":"e9","timestamp":"2026-07-12T12:59:04.712Z"}`,
  `{"type":"assistant.message_start","data":{"messageId":"m2"},"id":"e10","timestamp":"2026-07-12T12:59:08.059Z","ephemeral":true}`,
  `{"type":"assistant.message_delta","data":{"messageId":"m2","deltaContent":"The command "},"id":"e11","timestamp":"2026-07-12T12:59:08.059Z","ephemeral":true}`,
  `{"type":"assistant.message_delta","data":{"messageId":"m2","deltaContent":"printed hello-fixture."},"id":"e12","timestamp":"2026-07-12T12:59:08.060Z","ephemeral":true}`,
  `{"type":"assistant.message","data":{"messageId":"m2","model":"claude-fable-5","content":"The command printed hello-fixture.","toolRequests":[],"turnId":"1"},"id":"e13","timestamp":"2026-07-12T12:59:08.063Z"}`,
  `{"type":"assistant.idle","data":{},"id":"e14","timestamp":"2026-07-12T12:59:08.067Z","ephemeral":true}`,
  `{"type":"result","timestamp":"2026-07-12T12:59:08.078Z","sessionId":"06b41838-31ab-4dc4-8481-96d85281bfa7","exitCode":0,"usage":{"premiumRequests":1,"totalApiDurationMs":7931,"sessionDurationMs":9980}}`,
];

// ── parser unit shapes ────────────────────────────────────────────────────────

assert.equal(
  parseCopilotChatEvent(JSON.parse(FIXTURE[0])),
  null,
  "session noise frames parse to null",
);
assert.equal(
  parseCopilotChatEvent(JSON.parse(FIXTURE[3])),
  null,
  "tool_call_delta frames (partial input JSON) parse to null",
);
assert.equal(
  parseCopilotChatEvent(JSON.parse(FIXTURE[6])),
  null,
  "partial tool output frames parse to null",
);
assert.equal(parseCopilotChatEvent("not an object"), null);
assert.equal(parseCopilotChatEvent({ type: 42 }), null);

assert.deepEqual(
  parseCopilotChatEvent(JSON.parse(FIXTURE[10])),
  { kind: "text_delta", messageId: "m2", text: "The command ", frameId: "e11", model: undefined },
  "the parser preserves the schema-declared frame identity for replay suppression",
);

const resultEv = parseCopilotChatEvent(JSON.parse(FIXTURE[14]));
assert.deepEqual(resultEv, {
  kind: "result",
  sessionId: "06b41838-31ab-4dc4-8481-96d85281bfa7",
  isError: false,
  durationMs: 9980,
});
assert.deepEqual(
  parseCopilotChatEvent({ type: "result", exitCode: 1 }),
  { kind: "result", sessionId: undefined, isError: true, durationMs: undefined },
  "nonzero exit codes surface as errors",
);
assert.equal(
  parseCopilotChatEvent({ type: "result", exitCode: "1" }),
  null,
  "a malformed declared result exit code fails closed",
);
assert.equal(
  parseCopilotChatEvent({ type: "result" }),
  null,
  "a result frame missing its declared exit code fails closed",
);

// ── full pipeline: fixture → tracker + text assembly (what the route runs) ───

{
  const tracker = new ToolCallTracker(() => 1_000);
  const text = new CopilotTextAssembler();
  let assistantText = "";
  const streamed: Array<{ id: string; status: string; output?: string }> = [];
  let model: string | undefined;

  for (const line of FIXTURE) {
    const ev = parseCopilotChatEvent(JSON.parse(line));
    if (!ev) continue;
    if (ev.kind !== "result" && ev.model && !model) model = ev.model;
    switch (ev.kind) {
      case "text_delta": {
        assistantText += text.delta(ev.messageId, ev.text, ev.frameId);
        break;
      }
      case "message": {
        assistantText += text.message(ev.messageId, ev.content);
        for (const req of ev.toolRequests) {
          const toolEv = tracker.envelopeToolUse(
            req.toolCallId,
            req.name,
            formatToolInputValue(req.input),
            assistantText.length,
          );
          if (toolEv) streamed.push(toolEv);
        }
        break;
      }
      case "tool_start": {
        const toolEv = tracker.envelopeToolUse(
          ev.toolCallId,
          ev.toolName,
          formatToolInputValue(ev.input),
          assistantText.length,
        );
        if (toolEv) streamed.push(toolEv);
        break;
      }
      case "tool_end": {
        const toolEv = tracker.envelopeToolResult(ev.toolCallId, ev.output, ev.isError);
        if (toolEv) streamed.push(toolEv);
        break;
      }
      case "result":
        break;
    }
  }

  assert.equal(model, "claude-fable-5", "the model echo is captured for parity");
  assert.equal(
    assistantText,
    "The command printed hello-fixture.",
    "delta frames stream text; the full-content message frame appends nothing new",
  );

  assert.equal(
    streamed.length,
    2,
    "one running chip (from toolRequests; execution_start dedups onto it) and one settle",
  );
  assert.equal(streamed[0].id, "toolu_01");
  assert.equal(streamed[0].status, "running");
  assert.equal(streamed[1].id, "toolu_01", "start and settle merge on the native id");
  assert.equal(streamed[1].status, "ok");
  assert.match(streamed[1].output ?? "", /hello-fixture/);

  const persisted = toPersistedTools(tracker.snapshot(), 0);
  assert.ok(persisted, "the turn persists its tool rows");
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].name, "bash");
  assert.equal(persisted[0].status, "ok");
  assert.equal(persisted[0].textOffset, 0, "the call started before any text streamed");
  assert.match(persisted[0].input ?? "", /echo hello-fixture/);
}

// ── failed tool call settles as error ────────────────────────────────────────

{
  const tracker = new ToolCallTracker(() => 1_000);
  const start = parseCopilotChatEvent({
    type: "tool.execution_start",
    data: { toolCallId: "t9", toolName: "bash", arguments: { command: "false" } },
  });
  assert.ok(start && start.kind === "tool_start");
  tracker.envelopeToolUse(start.toolCallId, start.toolName, undefined, 0);
  const end = parseCopilotChatEvent({
    type: "tool.execution_complete",
    data: { toolCallId: "t9", success: false, result: { content: "boom" } },
  });
  assert.ok(end && end.kind === "tool_end");
  assert.equal(end.isError, true);
  const settled = tracker.envelopeToolResult(end.toolCallId, end.output, end.isError);
  assert.equal(settled?.status, "error");
  assert.equal(settled?.output, "boom");
}

// ── text assembler edge cases ────────────────────────────────────────────────

{
  const text = new CopilotTextAssembler();
  assert.equal(
    text.message("solo", "No deltas came first."),
    "No deltas came first.",
    "a message with no prior deltas contributes its full content",
  );
  assert.equal(text.message("solo", "No deltas came first."), "", "repeats add nothing");
  assert.equal(text.delta("solo", "No deltas came first."), "", "a delayed replay after a full message never duplicates text");

  assert.equal(text.delta("m", "Hello "), "Hello ", "deltas stream before an authoritative full frame arrives");
  assert.equal(text.delta("m", "world"), "world");
  assert.equal(
    text.message("m", "Hello world!"),
    "!",
    "a final message appends only the suffix after streamed deltas",
  );
  assert.equal(
    text.message("m", "Hello"),
    "",
    "a final message shorter than its streamed deltas never duplicates",
  );
  assert.equal(text.delta("m", "world"), "", "deltas arriving after the authoritative full frame are ignored");

  assert.equal(text.delta("repeat", "ha"), "ha");
  assert.equal(text.delta("repeat", "ha"), "ha", "equal neighboring deltas remain valid assistant text");
  assert.equal(text.message("repeat", "haha"), "", "the full message reconciles repeated streamed chunks without duplication");

  assert.equal(text.delta("replay", "Hello ", "frame-1"), "Hello ");
  assert.equal(text.delta("replay", "Hello ", "frame-1"), "", "a repeated JSONL frame id is ignored as a replay");
  assert.equal(text.delta("replay", "Hello ", "frame-2"), "Hello ", "different frame ids preserve identical adjacent chunks while streaming");
  assert.equal(text.message("replay", "Hello Hello "), "", "the final frame confirms the replay-safe streamed content");

  assert.equal(text.delta("diverged", "Hello old", "frame-old"), "Hello old");
  assert.equal(
    text.message("diverged", "Hello new"),
    "",
    "a divergent full frame is reconciled through a replacement event",
  );
  assert.deepEqual(
    text.takeReplacement("diverged"),
    { previous: "Hello old", content: "Hello new" },
    "a divergent authoritative message replaces stale streamed text",
  );

  assert.equal(text.delta("interrupted", "partial response", "frame-partial"), "partial response");
  assert.deepEqual(text.flushUnconfirmed(), [{ messageId: "interrupted", text: "partial response" }], "a process that exits before its full frame retains buffered partial text");

  text.reset();
  assert.equal(text.message("m", "fresh"), "fresh", "reset clears per-attempt state");
}

console.log("copilot-stream: ok");
