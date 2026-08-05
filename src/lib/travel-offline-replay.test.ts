// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const replay = await readFile(new URL("./travel-offline-replay.ts", import.meta.url), "utf8");
const config = await readFile(new URL("./cave-config.ts", import.meta.url), "utf8");
const state = await readFile(new URL("./travel-client-state.ts", import.meta.url), "utf8");

assert.match(
  config,
  /export async function offlineTravelItemsNeedingSync\(\)/,
  "travel replay should be able to list unsynced queue items",
);

assert.match(
  config,
  /export async function markOfflineTravelItemSyncing\(itemId: string\)/,
  "travel replay should mark an item syncing before side effects",
);

assert.match(
  config,
  /export async function failOfflineTravelItem\(itemId: string, error: string\)/,
  "travel replay should persist sync failures for visible handoff state",
);

assert.match(
  state,
  /item\.status === "pending" \|\| item\.status === "syncing" \|\| item\.status === "failed"/,
  "handoff should remain pending while any item is pending, syncing, or failed",
);

assert.match(
  replay,
  /let syncMutex: Promise<TravelOfflineReplayResult> \| null = null/,
  "travel replay should serialize reconnect sync attempts in-process",
);

assert.match(
  replay,
  /await markOfflineTravelItemSyncing\(candidate\.id\)[\s\S]*await replayTravelQueueItem\(item, config\)[\s\S]*await completeOfflineTravelItem\(item\.id\)/,
  "queue replay should claim, replay, then mark items synced only after side effects succeed",
);

assert.match(
  replay,
  /catch \(err\) \{[\s\S]*await failOfflineTravelItem\(item\.id, error\)/,
  "queue replay should mark failed items instead of dropping them",
);

assert.match(
  replay,
  /if \(config\.multiHost\.mode !== "hub"\) return result/,
  "queue replay should only sync back to a configured hub",
);

assert.match(
  replay,
  /path: "\/api\/v1\/sessions"/,
  "chat and flow replay should spawn hub sessions",
);

assert.match(
  replay,
  /path: "\/api\/v1\/workflows\/run"/,
  "workflow replay should try the daemon workflow engine before session fallback",
);

assert.match(
  replay,
  /startAutomationRun/,
  "queued automation jobs should be replayed through the automation runner",
);

assert.match(
  replay,
  /function queuedRuntime\(payload: Record<string, unknown>\): string \| null \{[\s\S]*payload\.responseMetadata[\s\S]*metadata\.runtime/,
  "chat replay should inspect the queued runtime metadata before launching a local hub session",
);

assert.match(
  replay,
  /if \(runtime\?\.startsWith\("ssh:"\)\) \{[\s\S]*queued SSH-runtime chat cannot be replayed as a local hub session/,
  "chat replay should not convert queued SSH-runtime work into a local hub session",
);

assert.match(
  replay,
  /queuedModelOverride\(payload\)[\s\S]*modelOverrideScope:[\s\S]*reasoningEffort: stringValue\(payload\.reasoningEffort\),[\s\S]*responseSpeed: stringValue\(payload\.responseSpeed\),[\s\S]*modelControls: record\(payload\.modelControls\)/,
  "travel replay extracts queued model and capability intent before the daemon boundary",
);
assert.match(
  replay,
  /const model = cleanModelId\(queuedModel\)[\s\S]*queued chat model id is not safe for launch/,
  "travel replay rejects a malformed persisted model instead of silently using the runtime default",
);
assert.match(
  replay,
  /modelSource === "familiar-default"[\s\S]*metadata\.desiredModel \?\? metadata\.model/,
  "travel replay preserves model intent from older queued items that predate the explicit override field",
);
assert.match(
  replay,
  /modelOverride && !isModelAllowedByRuntime\(binding\.harness, modelOverride\)[\s\S]*queued chat model id is not allowed by the selected runtime/,
  "travel replay validates a queued model against the current runtime before spawning",
);
assert.match(
  replay,
  /const harness = canonicalHarnessId\(args\.harness\)[\s\S]*path: "\/api\/v1\/sessions"[\s\S]*body:[\s\S]*harness,[\s\S]*\.\.\.\(harness === "copilot" \? \{\} : \{ launchMode: "nonInteractive" \}\)/,
  "travel replay canonicalizes runtime aliases and keeps Copilot on its supported daemon launch contract",
);

assert.match(
  replay,
  /export function daemonReplayControlFamilies\([\s\S]*?if \(stringValue\(payload\.reasoningEffort\)\)[\s\S]*?if \(stringValue\(payload\.responseSpeed\)\)/,
  "travel replay identifies legacy and typed control intent before it reaches the daemon",
);

assert.match(
  replay,
  /const controlFamilies = daemonReplayControlFamilies\(payload\);[\s\S]*?queued model controls cannot be replayed through the current hub session contract/,
  "travel replay must fail visibly instead of marking unsupported controls synced",
);

assert.match(
  replay,
  /queuedMetadata = record\(payload\.responseMetadata\)[\s\S]*canonicalHarnessId\(queuedHarness\) !== canonicalHarnessId\(binding\.harness\)/,
  "travel replay must not silently move a queued turn onto a newly selected harness",
);

assert.match(
  replay,
  /runtime\?\.startsWith\("local:"\) && isSshRuntime\(binding\.runtime\)[\s\S]*queued local-runtime chat cannot be replayed after this familiar moved to SSH/,
  "travel replay must fail closed across a local-to-SSH binding change",
);

assert.match(
  replay,
  /const payloadProjectRoot = stringValue\(payload\.projectRoot\)[\s\S]*const projectRoot = payloadProjectRoot \?\? runtimeCwd \?\? process\.cwd\(\)/,
  "chat replay should derive projectRoot from queued local runtime when payload omits it",
);

assert.match(
  replay,
  /const allowLocalRuntimeCwd = normalizeProjectRoot\(projectRoot\) === normalizeProjectRoot\(process\.cwd\(\)\)[\s\S]*await assertProjectRootAccess\(\{ familiarId \}, projectRoot, "chat", \{[\s\S]*allowUnregisteredRoot: allowLocalRuntimeCwd/,
  "chat replay should revalidate the current familiar project grant before spawning a hub session",
);

console.log("travel-offline-replay.test.ts: ok");

assert.match(
  replay,
  /const placeholderRunId = stringValue\(payload\.placeholderRunId\);[\s\S]*?if \(placeholderRunId\) \{[\s\S]*?await updateFlowRun\(placeholderRunId, runFields\);[\s\S]*?if \(updated\) return "complete";[\s\S]*?await recordFlowRun\(runFields\);/,
  "flow replay must update the queued placeholder run in place (mission iterations keep its id), falling back to a fresh record only for legacy/evicted items",
);

console.log("travel-offline-replay.test.ts: placeholder-run pin ok");

await import("../../scripts/test-alias-register.mjs");
const {
  collectReplayEventPages,
  replayAssistantMirrorOutcome,
  replayAssistantStatus,
  REPLAY_EVENT_PAGE_SAFETY_CAP,
} = await import("./travel-offline-replay.ts");

function daemonEvent(seq, kind, payload) {
  return {
    seq,
    kind,
    payload_json: JSON.stringify(payload),
    created_at: `2026-08-05T12:00:${String(seq % 60).padStart(2, "0")}.000Z`,
  };
}

function replayDaemon(pages) {
  const eventCursors = [];
  const daemonCall = async ({ path }) => {
    if (path === "/api/v1/sessions") {
      return {
        ok: true,
        status: 200,
        data: [{
          id: "hub-session",
          status: "completed",
          updated_at: "2026-08-05T12:01:00.000Z",
        }],
      };
    }
    const url = new URL(path, "http://daemon.test");
    const afterSeq = Number(url.searchParams.get("afterSeq"));
    eventCursors.push(afterSeq);
    const page = typeof pages === "function" ? pages(afterSeq, eventCursors.length) : pages.get(afterSeq);
    if (page instanceof Error) {
      return { ok: false, status: 503, data: null, error: page.message };
    }
    return { ok: true, status: 200, data: page };
  };
  return { daemonCall, eventCursors };
}

test("replay drains more than 500 ordered events before extracting the terminal assistant message", async () => {
  const firstPage = Array.from(
    { length: 498 },
    (_, index) => daemonEvent(index + 1, "patch_metadata", { index }),
  );
  firstPage.push(
    daemonEvent(499, "output", { data: "first output chunk" }),
    daemonEvent(500, "assistant.message", { content: "Earlier assistant message." }),
  );
  const secondPage = [
    daemonEvent(501, "output", { data: "second output chunk" }),
    daemonEvent(502, "assistant.message", {
      content: "Final answer.\n<coven:attention reason=\"approval\" />",
    }),
  ];
  const pages = new Map([
    [0, { events: firstPage, nextCursor: { afterSeq: 500 }, hasMore: true }],
    [500, { events: secondPage, nextCursor: { afterSeq: 502 }, hasMore: false }],
  ]);

  const collectionProbe = replayDaemon(pages);
  const events = await collectReplayEventPages({
    harnessSessionId: "hub-session",
    daemonCall: collectionProbe.daemonCall,
  });
  assert.deepEqual(collectionProbe.eventCursors, [0, 500]);
  assert.deepEqual(
    events
      ?.filter((event) => event.kind === "output")
      .map((event) => JSON.parse(event.payload_json).data),
    ["first output chunk", "second output chunk"],
    "page concatenation preserves daemon event and output-chunk order",
  );

  const statusProbe = replayDaemon(pages);
  const status = await replayAssistantStatus({
    harnessSessionId: "hub-session",
    harness: "codex",
    daemonCall: statusProbe.daemonCall,
  });
  assert.deepEqual(statusProbe.eventCursors, [0, 500]);
  assert.equal(status.eventsComplete, true);
  assert.equal(status.assistantText, "Final answer.\n<coven:attention reason=\"approval\" />");
  assert.equal(replayAssistantMirrorOutcome(status), "complete");
});

test("replay rejects malformed continuation cursors", async () => {
  for (const nextCursor of [null, { afterSeq: "500" }, { unexpected: 500 }]) {
    const probe = replayDaemon(new Map([
      [0, { events: [daemonEvent(1, "assistant.message", { content: "partial" })], nextCursor, hasMore: true }],
    ]));
    assert.equal(
      await collectReplayEventPages({
        harnessSessionId: "hub-session",
        daemonCall: probe.daemonCall,
      }),
      null,
    );
  }
});

test("replay rejects a repeated or regressing continuation cursor", async () => {
  for (const afterSeq of [0, -1]) {
    const probe = replayDaemon(new Map([
      [0, {
        events: [daemonEvent(1, "assistant.message", { content: "partial" })],
        nextCursor: { afterSeq },
        hasMore: true,
      }],
    ]));
    assert.equal(
      await collectReplayEventPages({
        harnessSessionId: "hub-session",
        daemonCall: probe.daemonCall,
      }),
      null,
    );
    assert.deepEqual(probe.eventCursors, [0], "an invalid cursor must not trigger another request");
  }
});

test("replay stays pending when a later event page fails", async () => {
  const probe = replayDaemon(new Map([
    [0, {
      events: [daemonEvent(1, "assistant.message", { content: "premature answer" })],
      nextCursor: { afterSeq: 1 },
      hasMore: true,
    }],
    [1, new Error("later page unavailable")],
  ]));
  const status = await replayAssistantStatus({
    harnessSessionId: "hub-session",
    harness: "codex",
    daemonCall: probe.daemonCall,
  });
  assert.deepEqual(probe.eventCursors, [0, 1]);
  assert.equal(status.eventsComplete, false);
  assert.equal(status.assistantText, null, "partial text must not mark the queue complete");
  assert.equal(replayAssistantMirrorOutcome(status), "pending");
});

test("replay safety cap returns pending instead of truncating an endless event log", async () => {
  const probe = replayDaemon((afterSeq) => ({
    events: [daemonEvent(afterSeq + 1, "assistant.message", { content: `page ${afterSeq + 1}` })],
    nextCursor: { afterSeq: afterSeq + 1 },
    hasMore: true,
  }));
  const status = await replayAssistantStatus({
    harnessSessionId: "hub-session",
    harness: "codex",
    daemonCall: probe.daemonCall,
  });
  assert.equal(probe.eventCursors.length, REPLAY_EVENT_PAGE_SAFETY_CAP);
  assert.equal(status.eventsComplete, false);
  assert.equal(status.assistantText, null);
  assert.equal(replayAssistantMirrorOutcome(status), "pending");
});

function arbitrarilyChunk(value, widths = [1, 7, 3, 19, 5, 31]) {
  const chunks = [];
  let cursor = 0;
  let widthIndex = 0;
  while (cursor < value.length) {
    const width = widths[widthIndex % widths.length];
    chunks.push(value.slice(cursor, cursor + width));
    cursor += width;
    widthIndex += 1;
  }
  return chunks;
}

function outputEventPage(data) {
  const events = data.map((chunk, index) => daemonEvent(index + 1, "output", { data: chunk }));
  return new Map([
    [0, {
      events,
      nextCursor: { afterSeq: events.length },
      hasMore: false,
    }],
  ]);
}

test("replay decodes Claude assistant envelopes across arbitrary daemon output chunks", async () => {
  const jsonl = [
    JSON.stringify({ type: "system", subtype: "init", prompt: "PROMPT ECHO MUST STAY PRIVATE" }),
    JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", id: "tool-1", name: "Read", input: { path: "private.txt" } },
          { type: "text", text: "Verified " },
        ],
      },
    }),
    JSON.stringify({
      type: "user",
      message: {
        content: [{ type: "tool_result", tool_use_id: "tool-1", content: "TOOL OUTPUT MUST STAY PRIVATE" }],
      },
    }),
    JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "Claude answer." }] },
    }),
    JSON.stringify({ type: "result", result: "PROTOCOL RESULT MUST STAY PRIVATE" }),
  ].join("\n") + "\n";
  const probe = replayDaemon(outputEventPage(arbitrarilyChunk(jsonl)));

  const status = await replayAssistantStatus({
    harnessSessionId: "hub-session",
    harness: "claude",
    daemonCall: probe.daemonCall,
  });

  assert.equal(status.eventsComplete, true);
  assert.equal(status.assistantText, "Verified Claude answer.");
});

test("replay filters Codex PTY transcript inside stream-json across arbitrary daemon output chunks", async () => {
  const jsonl = [
    JSON.stringify({ type: "system", prompt: "PROTOCOL PROMPT ECHO MUST STAY PRIVATE" }),
    JSON.stringify({
      type: "output",
      text: [
        "OpenAI Codex",
        "--------",
        "workdir: /repo",
        "model: gpt-test",
        "user",
        "ORIGINAL PROMPT MUST STAY PRIVATE",
        "co",
      ].join("\n"),
    }),
    JSON.stringify({
      type: "tool",
      output: "STRUCTURED TOOL OUTPUT MUST STAY PRIVATE",
    }),
    JSON.stringify({
      type: "output",
      text: [
        "dex",
        "Verified Codex answer.",
        "exec",
        "/bin/zsh -lc 'cat private.txt' in /repo",
        "succeeded in 5ms:",
        "RAW TOOL OUTPUT MUST STAY PRIVATE",
        "",
        "Final line.",
      ].join("\n") + "\n",
    }),
    JSON.stringify(["ARRAY PROTOCOL PAYLOAD MUST STAY PRIVATE"]),
    JSON.stringify("PRIMITIVE PROTOCOL PAYLOAD MUST STAY PRIVATE"),
    JSON.stringify({ type: "result", is_error: false }),
  ].join("\n") + "\n";
  const probe = replayDaemon(outputEventPage(arbitrarilyChunk(jsonl)));

  const status = await replayAssistantStatus({
    harnessSessionId: "hub-session",
    harness: "codex",
    daemonCall: probe.daemonCall,
  });

  assert.equal(status.eventsComplete, true);
  assert.equal(status.assistantText, "Verified Codex answer.\nFinal line.");
});

test("replay preserves Codex assistant text order across transcript and structured envelopes", async () => {
  const jsonl = [
    JSON.stringify({ type: "output", text: "codex\nFiltered first.\n" }),
    JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "Structured second." }] },
    }),
  ].join("\n") + "\n";
  const probe = replayDaemon(outputEventPage(arbitrarilyChunk(jsonl)));

  const status = await replayAssistantStatus({
    harnessSessionId: "hub-session",
    harness: "codex",
    daemonCall: probe.daemonCall,
  });

  assert.equal(status.assistantText, "Filtered first.\nStructured second.");
});

test("replay assembles only Copilot assistant events from daemon JSONL chunks", async () => {
  const jsonl = [
    JSON.stringify({ type: "user.message", data: { content: "PROMPT ECHO MUST STAY PRIVATE" } }),
    JSON.stringify({
      id: "frame-1",
      type: "assistant.message_delta",
      data: { messageId: "message-1", deltaContent: "Verified Copilot " },
    }),
    JSON.stringify({
      type: "tool.execution_complete",
      data: {
        toolCallId: "tool-1",
        success: true,
        result: { content: "TOOL OUTPUT MUST STAY PRIVATE" },
      },
    }),
    JSON.stringify({
      type: "assistant.message",
      data: {
        messageId: "message-1",
        content: "Verified Copilot answer.",
        toolRequests: [],
      },
    }),
    JSON.stringify({ type: "result", sessionId: "copilot-session", exitCode: 0 }),
  ].join("\n") + "\n";
  const probe = replayDaemon(outputEventPage(arbitrarilyChunk(jsonl)));

  const status = await replayAssistantStatus({
    harnessSessionId: "hub-session",
    harness: "copilot",
    daemonCall: probe.daemonCall,
  });

  assert.equal(status.assistantText, "Verified Copilot answer.");
});

test("replay accepts only signed OpenCode text envelopes from daemon JSONL chunks", async () => {
  const jsonl = [
    JSON.stringify({
      type: "reasoning",
      sessionID: "opencode-session",
      part: { type: "reasoning", text: "PRIVATE REASONING" },
    }),
    JSON.stringify({
      type: "tool_use",
      sessionID: "opencode-session",
      part: {
        type: "tool",
        id: "tool-1",
        tool: "Read",
        state: { status: "completed", output: "TOOL OUTPUT MUST STAY PRIVATE" },
      },
    }),
    JSON.stringify({
      type: "text",
      sessionID: "opencode-session",
      part: { type: "text", text: "Verified OpenCode answer." },
    }),
  ].join("\n") + "\n";
  const probe = replayDaemon(outputEventPage(arbitrarilyChunk(jsonl)));

  const status = await replayAssistantStatus({
    harnessSessionId: "hub-session",
    harness: "opencode",
    daemonCall: probe.daemonCall,
  });

  assert.equal(status.assistantText, "Verified OpenCode answer.");
});

test("replay accepts only Grok text events from daemon JSONL chunks", async () => {
  const jsonl = [
    JSON.stringify({ type: "thought", data: "PRIVATE REASONING" }),
    JSON.stringify({ type: "text", data: "Verified Grok answer." }),
    JSON.stringify({ type: "error", message: "PROTOCOL ERROR MUST STAY PRIVATE" }),
  ].join("\n") + "\n";
  const probe = replayDaemon(outputEventPage(arbitrarilyChunk(jsonl)));

  const status = await replayAssistantStatus({
    harnessSessionId: "hub-session",
    harness: "grok",
    daemonCall: probe.daemonCall,
  });

  assert.equal(status.assistantText, "Verified Grok answer.");
});

test("replay preserves Grok's verified plain one-shot response contract", async () => {
  const probe = replayDaemon(outputEventPage(arbitrarilyChunk("Verified plain Grok answer.\n")));

  const status = await replayAssistantStatus({
    harnessSessionId: "hub-session",
    harness: "grok",
    daemonCall: probe.daemonCall,
  });

  assert.equal(status.assistantText, "Verified plain Grok answer.");
});

test("replay accepts only Hermes response text events from daemon SSE chunks", async () => {
  const sse = [
    "event: response.output_item.added",
    `data: ${JSON.stringify({ item: { type: "function_call", call_id: "tool-1", name: "shell" } })}`,
    "",
    "event: response.output_text.delta",
    `data: ${JSON.stringify({ delta: "Verified Hermes " })}`,
    "",
    "event: response.function_call_output",
    `data: ${JSON.stringify({ call_id: "tool-1", output: "TOOL OUTPUT MUST STAY PRIVATE" })}`,
    "",
    "event: response.output_text.delta",
    `data: ${JSON.stringify({ delta: "answer." })}`,
    "",
  ].join("\n") + "\n";
  const probe = replayDaemon(outputEventPage(arbitrarilyChunk(sse)));

  const status = await replayAssistantStatus({
    harnessSessionId: "hub-session",
    harness: "hermes",
    daemonCall: probe.daemonCall,
  });

  assert.equal(status.assistantText, "Verified Hermes answer.");
});

test("replay filters Hermes's verified quiet-mode response contract", async () => {
  const transcript = [
    "Normalized model 'openai/gpt-test' to 'gpt-test' for openai-codex.",
    "Verified plain Hermes answer.",
  ].join("\n") + "\n";
  const probe = replayDaemon(outputEventPage(arbitrarilyChunk(transcript)));

  const status = await replayAssistantStatus({
    harnessSessionId: "hub-session",
    harness: "hermes",
    daemonCall: probe.daemonCall,
  });

  assert.equal(status.assistantText, "Verified plain Hermes answer.");
});

test("replay never treats unverified raw daemon output as an assistant reply", async () => {
  const probe = replayDaemon(new Map([
    [0, {
      events: [
        daemonEvent(1, "output", { data: "raw PTY chunk that looks like prose" }),
        daemonEvent(2, "output", { data: "tool call chatter, never a validated reply" }),
        daemonEvent(3, "patch_metadata", { content: "content on the wrong event kind must not count either" }),
      ],
      nextCursor: { afterSeq: 3 },
      hasMore: false,
    }],
  ]));
  const status = await replayAssistantStatus({
    harnessSessionId: "hub-session",
    harness: "codex",
    daemonCall: probe.daemonCall,
  });
  assert.equal(status.eventsComplete, true, "a terminal session with only output events still finishes draining events");
  assert.equal(status.assistantText, null, "raw output/tool payloads must never be mirrored as assistant prose");
  assert.equal(
    replayAssistantMirrorOutcome(status),
    "missing",
    "a terminal session with no verified assistant boundary must be reported missing, not complete",
  );
});

test("replay fails explicitly when the harness has no safe output decoder", async () => {
  const probe = replayDaemon(outputEventPage(["plain text from an unsupported harness"]));

  await assert.rejects(
    replayAssistantStatus({
      harnessSessionId: "hub-session",
      harness: "openclaw",
      daemonCall: probe.daemonCall,
    }),
    /offline replay output decoding is not supported for harness 'openclaw'/,
  );
});
