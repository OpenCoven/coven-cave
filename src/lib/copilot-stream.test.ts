// Behavioral tests for the copilot JSONL stream wiring (cave-yesg): the
// manifest-declared stream spec, the direct-spawn argv builder, and the
// event parser feeding ToolCallTracker — the exact pipeline the chat send
// route runs for copilot turns. The fixture below is a sanitized capture of
// copilot CLI 1.0.70 `--output-format json --stream on -p …` running one
// shell tool call and a follow-up text reply.

import assert from "node:assert/strict";
import {
  buildCopilotStreamArgs,
  copilotIdentityPreamble,
  copilotStreamSpec,
  CopilotTextAssembler,
  parseCopilotChatEvent,
} from "./copilot-stream.ts";
import {
  formatToolInputValue,
  toPersistedTools,
  ToolCallTracker,
} from "./chat-tool-events.ts";

// ── stream spec from the synced registry manifest ────────────────────────────

const spec = copilotStreamSpec();
assert.ok(spec, "registry manifest declares copilot stream mode");
assert.equal(spec.executable, "copilot");
assert.deepEqual(
  spec.prefixArgs,
  ["--output-format", "json", "--stream", "on", "-p"],
  "stream prefix args come from the manifest's stream_args.prefix_args",
);
assert.equal(spec.sessionIdFlag, "--session-id");
assert.equal(spec.resumeFlag, "--resume");
assert.equal(spec.modelFlag, "--model");
assert.deepEqual(spec.sandboxFullArgs, ["--allow-all"]);
assert.deepEqual(spec.sandboxReadOnlyArgs, [
  "--deny-tool",
  "write",
  "--deny-tool",
  "shell",
]);

// ── argv builder ──────────────────────────────────────────────────────────────

const freshArgs = buildCopilotStreamArgs({
  spec,
  prompt: "do the thing",
  resumeSessionId: null,
  newSessionId: "11111111-2222-4333-8444-555555555555",
  model: "openai/gpt-5.5",
  permissionMode: "full",
});
assert.deepEqual(
  freshArgs,
  [
    "--session-id",
    "11111111-2222-4333-8444-555555555555",
    "--model",
    "gpt-5.5",
    "--allow-all",
    "--output-format",
    "json",
    "--stream",
    "on",
    "-p",
    "do the thing",
  ],
  "fresh turns pre-assign the session id, strip the model namespace, map full access to --allow-all, and trail the prompt after -p",
);

const resumeArgs = buildCopilotStreamArgs({
  spec,
  prompt: "continue",
  resumeSessionId: "aaaa1111-2222-4333-8444-555555555555",
  newSessionId: null,
  model: null,
  permissionMode: "read",
});
assert.deepEqual(
  resumeArgs,
  [
    "--resume",
    "aaaa1111-2222-4333-8444-555555555555",
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
  "resumed read-only turns use --resume and the manifest's deny-tool sandbox args",
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
        assistantText += text.delta(ev.messageId, ev.text);
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

  assert.equal(text.delta("m", "Hello "), "Hello ");
  assert.equal(text.delta("m", "world"), "world");
  assert.equal(
    text.message("m", "Hello world!"),
    "!",
    "a final message longer than its deltas contributes only the tail",
  );
  assert.equal(
    text.message("m", "Hello"),
    "",
    "a final message shorter than its streamed deltas never duplicates",
  );

  text.reset();
  assert.equal(text.message("m", "fresh"), "fresh", "reset clears per-attempt state");
}

console.log("copilot-stream: ok");
