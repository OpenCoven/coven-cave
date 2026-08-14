import assert from "node:assert/strict";
import test from "node:test";

import {
  createClientStreamTranslator,
  createResumedRunStream,
  encodeClientStreamEvent,
  parseClientStreamCursor,
  translateInitialChatResponse,
  translateStreamEvent,
} from "./sse.ts";
import {
  canonicalizeAndRecordRunStreamEvent,
  getRunBufferStatus,
  openRunBuffer,
  resetRunBuffersForTest,
  RUN_STREAM_EVENT_MAX_BYTES,
  subscribeRunStream,
} from "@/lib/server/chat-stream-buffer";

const context = {
  runId: "9f4145de-9b43-4abc-876d-81ef63de60e0",
  conversationId: "conversation-safe",
};

test("translateStreamEvent is the one typed mapping used by send and resume", () => {
  assert.deepEqual(
    translateStreamEvent({ kind: "session", sessionId: "harness-private" }, context),
    { type: "run.started", ...context },
  );
  assert.deepEqual(
    translateStreamEvent({ kind: "assistant_chunk", text: "hello" }, context),
    { type: "message.delta", text: "hello" },
  );
  assert.deepEqual(
    translateStreamEvent({
      kind: "progress",
      id: "launch",
      label: "Launching",
      status: "running",
    }, context),
    { type: "progress", id: "launch", label: "Launching", status: "running" },
  );
  assert.deepEqual(
    translateStreamEvent({ kind: "done", isError: false }, context),
    { type: "run.completed", conversationId: context.conversationId },
  );
  assert.deepEqual(
    translateStreamEvent({ kind: "error", code: "spawn_error", message: "/secret/path" }, context),
    { type: "run.failed", code: "spawn_error", message: "The run failed." },
  );
  assert.equal(translateStreamEvent({ kind: "user", text: "private prompt" }, context), null);
});

test("run failure codes cannot carry paths or diagnostic secrets", () => {
  assert.deepEqual(
    translateStreamEvent({
      kind: "error",
      code: "/Users/private/project?token=secret",
      message: "raw diagnostic",
    }, context),
    { type: "run.failed", code: "run_failed", message: "The run failed." },
  );
});

test("stateful replacement translation emits only additive suffixes and reconciles rewrites", () => {
  const translator = createClientStreamTranslator(context);
  assert.deepEqual(
    translator.translate({ kind: "assistant_chunk", text: "hello" }),
    { event: { type: "message.delta", text: "hello" }, terminal: false },
  );
  assert.deepEqual(
    translator.translate({ kind: "assistant_replace", text: "hello world" }),
    { event: { type: "message.delta", text: " world" }, terminal: false },
  );
  assert.deepEqual(
    translator.translate({ kind: "assistant_replace", text: "rewritten" }),
    {
      event: { type: "reconcile_required", conversationId: context.conversationId },
      terminal: true,
    },
  );
  assert.deepEqual(
    translator.translate({ kind: "assistant_chunk", text: "must-not-leak" }),
    { event: null, terminal: true },
  );
});

test("SSE frames carry a canonical strictly increasing numeric id", () => {
  const first = new TextDecoder().decode(
    encodeClientStreamEvent(41, { type: "message.delta", text: "a" }),
  );
  const second = new TextDecoder().decode(
    encodeClientStreamEvent(42, { type: "run.completed", conversationId: "c" }),
  );
  assert.match(first, /^id: 41\ndata: /);
  assert.match(second, /^id: 42\ndata: /);
  assert.throws(() =>
    encodeClientStreamEvent(-1, { type: "run.completed", conversationId: "c" }));
});

test("cursor and Last-Event-ID are strict resumable nonnegative safe integers", () => {
  assert.equal(
    parseClientStreamCursor(new Request("http://localhost/stream?cursor=7")),
    7,
  );
  assert.equal(
    parseClientStreamCursor(new Request("http://localhost/stream", {
      headers: { "last-event-id": "9" },
    })),
    9,
  );
  assert.equal(
    parseClientStreamCursor(new Request("http://localhost/stream?cursor=7", {
      headers: { "last-event-id": "9" },
    })),
    9,
  );
  assert.equal(
    parseClientStreamCursor(new Request(
      `http://localhost/stream?cursor=${Number.MAX_SAFE_INTEGER - 1}`,
    )),
    Number.MAX_SAFE_INTEGER - 1,
  );
  for (const raw of ["-1", "1.2", "1e2", "+1", " 1", "Infinity", "9007199254740991", "9007199254740992"]) {
    assert.throws(() => parseClientStreamCursor(new Request(
      `http://localhost/stream?cursor=${encodeURIComponent(raw)}`,
    )), raw);
  }
  for (const raw of ["-1", "1.2", "1e2", "+1", "Infinity", "9007199254740991", "9007199254740992"]) {
    assert.throws(() => parseClientStreamCursor(new Request("http://localhost/stream", {
      headers: { "last-event-id": raw },
    })), raw);
  }
});

test("resume replays only seq greater than cursor through the shared translator", async () => {
  resetRunBuffersForTest();
  const run = openRunBuffer([context.runId]);
  run.record({ kind: "session", sessionId: "private" });
  run.record({ kind: "assistant_chunk", text: "hello" });
  run.record({ kind: "done", isError: false });
  run.finish();
  const response = createResumedRunStream(
    context.runId,
    1,
    context,
    new AbortController().signal,
  );
  assert.ok(response);
  const text = await response.text();
  assert.deepEqual(
    [...text.matchAll(/^id: (\d+)$/gm)].map((match) => Number(match[1])),
    [2, 3],
  );
  assert.match(text, /"type":"message.delta"/);
  assert.match(text, /"type":"run.completed"/);

  const duplicate = createResumedRunStream(
    context.runId,
    3,
    context,
    new AbortController().signal,
  );
  assert.ok(duplicate);
  assert.equal(await duplicate.text(), "");
});

test("client-v1 translates synchronous pre-accept Gateway events from their canonical replay entries", async () => {
  resetRunBuffersForTest();
  const key = "client-v1-gateway-sync-early";
  const run = openRunBuffer([key]);
  const live: Array<{ seq: number | undefined }> = [];
  const dispatch = () => {
    const recorded = canonicalizeAndRecordRunStreamEvent(run, {
      kind: "assistant_chunk",
      text: "early Gateway text",
    });
    assert.ok(recorded);
    live.push(recorded);
    return { kind: "accepted" as const };
  };

  assert.equal(dispatch().kind, "accepted");
  assert.ok(canonicalizeAndRecordRunStreamEvent(run, { kind: "done", isError: false }));
  run.finish();
  const response = createResumedRunStream(
    key,
    0,
    context,
    new AbortController().signal,
  );
  assert.ok(response);
  const text = await response.text();
  assert.deepEqual(sseFrames(text), [{
    id: live[0]!.seq,
    payload: { type: "message.delta", text: "early Gateway text" },
  }, {
    id: 2,
    payload: { type: "run.completed", conversationId: context.conversationId },
  }]);
  resetRunBuffersForTest();
});

function assistantChunkAtSerializedSize(byteLength: number) {
  const empty = JSON.stringify({ kind: "assistant_chunk", text: "" });
  const text = "x".repeat(byteLength - Buffer.byteLength(empty, "utf8"));
  const event = { kind: "assistant_chunk", text } as const;
  assert.equal(Buffer.byteLength(JSON.stringify(event), "utf8"), byteLength);
  return event;
}

function sseFrames(text: string) {
  return text
    .split("\n\n")
    .filter(Boolean)
    .map((frame) => {
      const id = frame.match(/^id: (\d+)$/m);
      const data = frame.match(/^data: (.+)$/m);
      assert.ok(id, "every event frame has an id");
      assert.ok(data, "every event frame has data");
      return { id: Number(id[1]), payload: JSON.parse(data[1]) };
    });
}

test("initial and resumed streams share the 128 KiB canonical event boundary", async () => {
  resetRunBuffersForTest();
  const key = "run-event-size-boundary";
  const event = assistantChunkAtSerializedSize(RUN_STREAM_EVENT_MAX_BYTES);
  const run = openRunBuffer([key]);
  run.record(event);
  run.record({ kind: "done", isError: false });
  run.finish();

  const upstream = new Response(
    `id: 1\ndata: ${JSON.stringify(event)}\n\n`
      + `id: 2\ndata: ${JSON.stringify({ kind: "done", isError: false })}\n\n`,
    { headers: { "content-type": "text/event-stream" } },
  );
  const initial = await translateInitialChatResponse(upstream, context, key).text();
  const resumed = createResumedRunStream(key, 0, context, new AbortController().signal);
  assert.ok(resumed);
  const replay = await resumed.text();

  assert.deepEqual(
    sseFrames(initial),
    sseFrames(replay),
    "initial and resumed streams retain every boundary event, including the terminal",
  );
  assert.deepEqual(sseFrames(initial), [
    { id: 1, payload: { type: "message.delta", text: event.text } },
    { id: 2, payload: { type: "run.completed", conversationId: context.conversationId } },
  ]);
  resetRunBuffersForTest();
});

test("initial translation emits the canonical oversized replacement recorded for resume history", async () => {
  resetRunBuffersForTest();
  const key = "run-event-size-replacement";
  const oversizedReplace = {
    kind: "assistant_replace",
    text: `hello${assistantChunkAtSerializedSize(RUN_STREAM_EVENT_MAX_BYTES).text}`,
  } as const;
  assert.ok(
    Buffer.byteLength(JSON.stringify(oversizedReplace), "utf8") > RUN_STREAM_EVENT_MAX_BYTES,
  );
  const run = openRunBuffer([key]);
  run.record({ kind: "assistant_chunk", text: "hello" });
  run.record(oversizedReplace);
  run.finish();

  const upstream = new Response(
    `id: 1\ndata: ${JSON.stringify({ kind: "assistant_chunk", text: "hello" })}\n\n`
      + `id: 2\ndata: ${JSON.stringify(oversizedReplace)}\n\n`,
    { headers: { "content-type": "text/event-stream" } },
  );
  const initial = await translateInitialChatResponse(upstream, context, key).text();
  const resumed = createResumedRunStream(key, 0, context, new AbortController().signal);
  assert.ok(resumed);
  const replay = await resumed.text();

  assert.deepEqual(
    sseFrames(initial),
    sseFrames(replay),
    "initial and resumed streams retain identical oversized-replacement terminals",
  );
  assert.deepEqual(sseFrames(initial), [
    { id: 1, payload: { type: "message.delta", text: "hello" } },
    {
      id: 2,
      payload: { type: "run.failed", code: "stream_event_too_large", message: "The run failed." },
    },
  ]);
  resetRunBuffersForTest();
});

test("an evicted cursor emits reconcile_required before retained events", async () => {
  resetRunBuffersForTest();
  const run = openRunBuffer([context.runId]);
  for (let index = 0; index < 10; index += 1) {
    run.record({ kind: "assistant_chunk", text: String(index).repeat(64 * 1024) });
  }
  run.record({ kind: "done", isError: false });
  run.finish();
  const response = createResumedRunStream(
    context.runId,
    0,
    context,
    new AbortController().signal,
  );
  assert.ok(response);
  const text = await response.text();
  assert.match(text, /"type":"reconcile_required"/);
  const ids = [...text.matchAll(/^id: (\d+)$/gm)].map((match) => Number(match[1]));
  assert.ok(ids.every((id, index) => index === 0 || id > ids[index - 1]));
  assert.equal(ids.length, 1, "a gap reconciles and closes instead of applying a partial replay");
});

test("resume cancellation unsubscribes the canonical live tail", async () => {
  resetRunBuffersForTest();
  let attaches = 0;
  let detaches = 0;
  openRunBuffer([context.runId], {
    attach: () => { attaches += 1; },
    detach: () => { detaches += 1; },
  });
  const response = createResumedRunStream(
    context.runId,
    0,
    context,
    new AbortController().signal,
  );
  assert.ok(response);
  assert.equal(attaches, 1);
  await response.body?.cancel();
  assert.equal(detaches, 1);
});

test("a stalled resumed consumer detaches instead of accumulating an unbounded queue", () => {
  resetRunBuffersForTest();
  let detaches = 0;
  const run = openRunBuffer([context.runId], {
    attach: () => {},
    detach: () => { detaches += 1; },
  });
  const response = createResumedRunStream(
    context.runId,
    0,
    context,
    new AbortController().signal,
  );
  assert.ok(response);
  for (let index = 0; index < 100; index += 1) {
    run.record({ kind: "assistant_chunk", text: "x".repeat(1024) });
  }
  assert.equal(detaches, 1);
  run.finish();
  resetRunBuffersForTest();
});

test("resume seeds translator state through the cursor before translating a replacement", async () => {
  resetRunBuffersForTest();
  const run = openRunBuffer([context.runId]);
  run.record({ kind: "assistant_chunk", text: "hello" });
  run.record({ kind: "assistant_replace", text: "hello world" });
  run.finish();
  const response = createResumedRunStream(
    context.runId,
    1,
    context,
    new AbortController().signal,
  );
  assert.ok(response);
  const text = await response.text();
  assert.match(text, /"text":" world"/);
  assert.doesNotMatch(text, /"text":"hello world"/);
  resetRunBuffersForTest();
});

test("resume reconciles when an evicted 100k assistant chunk leaves no complete seed", async () => {
  resetRunBuffersForTest();
  const run = openRunBuffer([context.runId]);
  const evictedText = "a".repeat(100_000);
  run.record({ kind: "assistant_chunk", text: evictedText });
  for (let index = 0; index < 8; index += 1) {
    run.record({ kind: "user", text: "p".repeat(64 * 1024) });
  }
  const cursor = getRunBufferStatus(context.runId)!.latestSeq;
  run.record({ kind: "assistant_replace", text: `${evictedText} corrected` });
  run.record({ kind: "done", isError: false });
  run.finish();

  const response = createResumedRunStream(
    context.runId,
    cursor,
    context,
    new AbortController().signal,
  );
  assert.ok(response);
  const text = await response.text();
  assert.deepEqual(sseFrames(text), [{
    id: cursor + 1,
    payload: { type: "reconcile_required", conversationId: context.conversationId },
  }], "a replacement cannot be emitted as a duplicate delta from an incomplete seed");
  assert.doesNotMatch(text, /message\.delta|corrected/);
  resetRunBuffersForTest();
});

test("a retained replacement checkpoint avoids false resume reconciliation after eviction", async () => {
  resetRunBuffersForTest();
  const run = openRunBuffer([context.runId]);
  run.record({ kind: "assistant_chunk", text: "a".repeat(100_000) });
  for (let index = 0; index < 8; index += 1) {
    run.record({ kind: "user", text: "p".repeat(64 * 1024) });
  }
  const checkpoint = "b".repeat(100_000);
  const checkpointSeq = run.record({ kind: "assistant_replace", text: checkpoint });
  assert.ok(checkpointSeq);
  run.record({ kind: "assistant_replace", text: `${checkpoint} updated` });
  run.record({ kind: "done", isError: false });
  run.finish();

  const response = createResumedRunStream(
    context.runId,
    checkpointSeq,
    context,
    new AbortController().signal,
  );
  assert.ok(response);
  assert.deepEqual(sseFrames(await response.text()), [{
    id: checkpointSeq + 1,
    payload: { type: "message.delta", text: " updated" },
  }, {
    id: checkpointSeq + 2,
    payload: { type: "run.completed", conversationId: context.conversationId },
  }]);
  resetRunBuffersForTest();
});

test("replace-only histories seed and resume without reconciliation", async () => {
  resetRunBuffersForTest();
  const run = openRunBuffer([context.runId]);
  run.record({ kind: "assistant_replace", text: "first" });
  run.record({ kind: "assistant_replace", text: "first second" });
  run.record({ kind: "done", isError: false });
  run.finish();

  const response = createResumedRunStream(
    context.runId,
    1,
    context,
    new AbortController().signal,
  );
  assert.ok(response);
  assert.deepEqual(sseFrames(await response.text()), [{
    id: 2,
    payload: { type: "message.delta", text: " second" },
  }, {
    id: 3,
    payload: { type: "run.completed", conversationId: context.conversationId },
  }]);
  resetRunBuffersForTest();
});

test("complete initial and resumed histories translate identically through replacements", async () => {
  resetRunBuffersForTest();
  const key = "complete-initial-resume-equivalence";
  const events = [
    { kind: "session", sessionId: "private" },
    { kind: "assistant_chunk", text: "hello" },
    { kind: "assistant_replace", text: "hello world" },
    { kind: "done", isError: false },
  ] as const;
  const run = openRunBuffer([key]);
  for (const event of events) run.record(event);
  run.finish();

  const upstream = new Response(
    events.map((event, index) => `id: ${index + 1}\ndata: ${JSON.stringify(event)}\n\n`).join(""),
    { headers: { "content-type": "text/event-stream" } },
  );
  const initial = await translateInitialChatResponse(upstream, context, key).text();
  const resumed = createResumedRunStream(key, 0, context, new AbortController().signal);
  assert.ok(resumed);
  assert.deepEqual(sseFrames(await resumed.text()), sseFrames(initial));
  resetRunBuffersForTest();
});

test("a divergent replacement emits one reconcile event and closes", async () => {
  const upstream = new Response(
    `id: 1\ndata: ${JSON.stringify({ kind: "assistant_chunk", text: "old" })}\n\n`
      + `id: 2\ndata: ${JSON.stringify({ kind: "assistant_replace", text: "new" })}\n\n`
      + `id: 3\ndata: ${JSON.stringify({ kind: "assistant_chunk", text: "leak" })}\n\n`,
    { headers: { "content-type": "text/event-stream" } },
  );
  const text = await translateInitialChatResponse(upstream, context).text();
  assert.match(text, /"text":"old"/);
  assert.equal(text.match(/"type":"reconcile_required"/g)?.length, 1);
  assert.doesNotMatch(text, /new|leak/);
});

test("ahead resume cursor reconciles once and never tails later events", async () => {
  resetRunBuffersForTest();
  const run = openRunBuffer([context.runId]);
  run.record({ kind: "assistant_chunk", text: "one" });
  const response = createResumedRunStream(
    context.runId,
    10,
    context,
    new AbortController().signal,
  );
  assert.ok(response);
  run.record({ kind: "assistant_chunk", text: "later" });
  const text = await response.text();
  assert.equal(text.match(/"type":"reconcile_required"/g)?.length, 1);
  assert.deepEqual(
    [...text.matchAll(/^id: (\d+)$/gm)].map((match) => Number(match[1])),
    [11],
  );
  assert.doesNotMatch(text, /later/);
  resetRunBuffersForTest();
});

test("malformed initial and resumed events emit one sanitized failure without raw diagnostics", async () => {
  const secret = "/Users/private/project?token=secret";
  const upstream = new Response(
    `id: 1\ndata: {"kind":"assistant_chunk","text":${secret}}\n\n`,
    { headers: { "content-type": "text/event-stream" } },
  );
  const initialText = await translateInitialChatResponse(upstream, context).text();
  assert.equal(initialText.match(/"type":"run.failed"/g)?.length, 1);
  assert.match(initialText, /"code":"invalid_stream_event"/);
  assert.doesNotMatch(initialText, /Users|private|token|secret/);

  resetRunBuffersForTest();
  const run = openRunBuffer([context.runId]);
  run.record({ kind: "assistant_chunk", text: "safe" });
  const subscription = subscribeRawForTest(context.runId);
  subscription.json = `{"kind":"assistant_chunk","text":"${secret}`;
  run.finish();
  const resumed = createResumedRunStream(
    context.runId,
    0,
    context,
    new AbortController().signal,
  );
  assert.ok(resumed);
  const resumedText = await resumed.text();
  assert.equal(resumedText.match(/"type":"run.failed"/g)?.length, 1);
  assert.doesNotMatch(resumedText, /Users|private|token|secret/);
  resetRunBuffersForTest();
});

function subscribeRawForTest(key: string) {
  const subscription = subscribeRunStream(key, 0, () => {}, () => {});
  assert.ok(subscription);
  return subscription.replay[0];
}

test("legacy non-SSE bodies are replaced with fixed safe errors", async () => {
  const response = translateInitialChatResponse(
    new Response('{"error":"/private/path token=secret"}', {
      status: 500,
      headers: { "content-type": "application/json" },
    }),
    context,
  );
  assert.equal(response.status, 503);
  const text = await response.text();
  assert.match(text, /"code":"service_unavailable"/);
  assert.doesNotMatch(text, /private|path|token|secret/);
});

test("a legitimate 501 returns the documented non-retryable unsupported code", async () => {
  const response = translateInitialChatResponse(
    new Response(null, { status: 501, headers: { "content-type": "application/json" } }),
    context,
  );
  assert.equal(response.status, 501);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: {
      code: "unsupported",
      message: "This run is not supported.",
      retryable: false,
    },
  });
});

test("initial translation stays pull-bounded and cancellation aborts upstream", async () => {
  let produced = 0;
  let cancelled = false;
  const source = new ReadableStream<Uint8Array>({
    pull(controller) {
      produced += 1;
      controller.enqueue(new TextEncoder().encode(
        `id: ${produced}\ndata: ${JSON.stringify({ kind: "assistant_chunk", text: "x".repeat(1024) })}\n\n`,
      ));
    },
    cancel() {
      cancelled = true;
    },
  }, { highWaterMark: 1 });
  const response = translateInitialChatResponse(
    new Response(source, { headers: { "content-type": "text/event-stream" } }),
    context,
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(produced < 100, `slow consumer caused ${produced} upstream pulls`);
  await response.body?.cancel();
  assert.equal(cancelled, true);
});

test("a truncated initial response (no terminal ever seen) publishes one canonical run.failed", async () => {
  resetRunBuffersForTest();
  const bufferKey = "run-truncated-initial";
  openRunBuffer([bufferKey]);
  const upstream = new Response(
    `id: 1\ndata: ${JSON.stringify({ kind: "assistant_chunk", text: "partial" })}\n\n`,
    { headers: { "content-type": "text/event-stream" } },
  );
  const response = translateInitialChatResponse(upstream, context, bufferKey);
  const text = await response.text();
  assert.match(text, /"type":"message.delta"/);
  assert.equal(text.match(/"type":"run.failed"/g)?.length, 1, "exactly one synthetic terminal is emitted");
  assert.match(text, /"code":"upstream_disconnected"/);

  // The canonical buffer itself is now terminated with that SAME entry —
  // any other subscriber (concurrent or later) converges on it too.
  assert.equal(getRunBufferStatus(bufferKey)?.done, true);
  const late = subscribeRunStream(bufferKey, 0, () => {}, () => {});
  assert.ok(late?.done);
  const terminalJson = late!.replay[late!.replay.length - 1].json;
  assert.match(terminalJson, /"code":"upstream_disconnected"/);
  resetRunBuffersForTest();
});

test("a truncated initial response with no buffer key falls back to a local synthetic terminal", async () => {
  const upstream = new Response(
    `id: 1\ndata: ${JSON.stringify({ kind: "assistant_chunk", text: "partial" })}\n\n`,
    { headers: { "content-type": "text/event-stream" } },
  );
  const text = await translateInitialChatResponse(upstream, context).text();
  assert.match(text, /"type":"message.delta"/);
  assert.equal(text.match(/"type":"run.failed"/g)?.length, 1);
  assert.match(text, /"code":"invalid_stream_event"/);
});

test("never synthesizes a terminal for a completed run — a finished stream just ends", async () => {
  const upstream = new Response(
    `id: 1\ndata: ${JSON.stringify({ kind: "assistant_chunk", text: "hi" })}\n\n`
      + `id: 2\ndata: ${JSON.stringify({ kind: "done", isError: false })}\n\n`,
    { headers: { "content-type": "text/event-stream" } },
  );
  const text = await translateInitialChatResponse(upstream, context).text();
  assert.equal(text.match(/"type":"run.completed"/g)?.length, 1);
  assert.equal(text.match(/"type":"run.failed"/g), null, "a completed run is never overwritten with a synthetic failure");
});

test("a truncated run's resumed stream replays the guaranteed terminal and closes", async () => {
  resetRunBuffersForTest();
  const run = openRunBuffer([context.runId]);
  run.record({ kind: "assistant_chunk", text: "partial" });
  run.finish(); // Upstream disconnected mid-turn — done/error was never recorded.
  const response = createResumedRunStream(
    context.runId,
    0,
    context,
    new AbortController().signal,
  );
  assert.ok(response);
  const text = await response.text();
  assert.match(text, /"type":"message.delta"/);
  assert.equal(text.match(/"type":"run.failed"/g)?.length, 1);
  assert.match(text, /"code":"upstream_disconnected"/);
  resetRunBuffersForTest();
});

test("concurrent resumed subscribers observe exactly one terminal when the producer truncates", async () => {
  resetRunBuffersForTest();
  const run = openRunBuffer([context.runId]);
  run.record({ kind: "assistant_chunk", text: "partial" });
  const first = createResumedRunStream(context.runId, 0, context, new AbortController().signal);
  const second = createResumedRunStream(context.runId, 0, context, new AbortController().signal);
  assert.ok(first && second);
  run.finish();
  const [firstText, secondText] = await Promise.all([first.text(), second.text()]);
  for (const text of [firstText, secondText]) {
    assert.equal(text.match(/"type":"run.failed"/g)?.length, 1, "each subscriber sees exactly one terminal");
    assert.match(text, /"code":"upstream_disconnected"/);
  }
  assert.equal(lastFrameSeq(firstText), lastFrameSeq(secondText), "both converge on the identical synthetic entry");
  resetRunBuffersForTest();
});

test("resuming past an already-recorded terminal replays nothing extra", async () => {
  resetRunBuffersForTest();
  const run = openRunBuffer([context.runId]);
  run.record({ kind: "assistant_chunk", text: "hi" });
  run.record({ kind: "done", isError: false });
  run.finish();
  const response = createResumedRunStream(
    context.runId,
    2,
    context,
    new AbortController().signal,
  );
  assert.ok(response);
  const text = await response.text();
  assert.equal(text, "", "cursor already at the real terminal — nothing to replay, no synthetic addition");
  resetRunBuffersForTest();
});

test("resumed subscriber cancellation does not fail the run while the producer is still active", async () => {
  resetRunBuffersForTest();
  const run = openRunBuffer([context.runId]);
  const controller = new AbortController();
  const response = createResumedRunStream(context.runId, 0, context, controller.signal);
  assert.ok(response);
  controller.abort();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(
    getRunBufferStatus(context.runId)?.done,
    false,
    "cancelling one subscriber must not fail the still-active run",
  );
  run.record({ kind: "done", isError: false });
  run.finish();
  assert.equal(getRunBufferStatus(context.runId)?.done, true);
  resetRunBuffersForTest();
});

function lastFrameSeq(text: string): number {
  const frames = text.split("\n\n").filter(Boolean);
  const last = frames[frames.length - 1];
  const match = last.match(/^id: (\d+)/);
  assert.ok(match, "the final frame carries a canonical id");
  return Number(match![1]);
}
