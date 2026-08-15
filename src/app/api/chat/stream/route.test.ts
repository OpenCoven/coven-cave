import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { GET } from "./route.ts";
import { wireRunDetachCleanup } from "@/lib/server/chat-detach-cleanup";
import {
  canonicalizeAndRecordRunStreamEvent,
  getRunBufferStatus,
  openRunBuffer,
  resetRunBuffersForTest,
  RUN_STREAM_EVENT_MAX_BYTES,
  subscribeRunStream,
} from "@/lib/server/chat-stream-buffer";
import { chatSse } from "../send/chat-send-sse.ts";

// GET /api/chat/stream (cave-h40l): re-attach to a live chat run mid-turn.
// Behavior: 400 without a key, 404 for unknown runs (client falls back to
// post-hoc resync), SSE replay past the cursor with `id:` carrying the seq,
// live tailing, and stream close when the run finishes.

async function drain(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out;
}

test("400 without a key; 404 for unknown runs", async () => {
  resetRunBuffersForTest();
  const bad = await GET(new Request("http://127.0.0.1/api/chat/stream"));
  assert.equal(bad.status, 400);
  const missing = await GET(new Request("http://127.0.0.1/api/chat/stream?runId=ghost"));
  assert.equal(missing.status, 404);
  const body = (await missing.json()) as { ok: boolean };
  assert.equal(body.ok, false, "404 is a JSON miss the client can branch on");
});

test("replays past the cursor with seq ids, tails live events, closes on finish", async () => {
  resetRunBuffersForTest();
  const handle = openRunBuffer(["run-sse", "conv-sse"]);
  handle.record({ kind: "user", text: "hi" });
  handle.record({ kind: "assistant_chunk", text: "partial " });

  const res = await GET(new Request("http://127.0.0.1/api/chat/stream?runId=conv-sse&cursor=1"));
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /text\/event-stream/);

  const drained = drain(res);
  // Tail two more live events, then finish — the stream must close itself.
  handle.record({ kind: "assistant_chunk", text: "reply" });
  handle.record({ kind: "done" });
  handle.finish();

  const text = await drained;
  assert.doesNotMatch(text, /"text":"hi"/, "events at or before the cursor do not replay");
  assert.match(text, /id: 2\ndata: \{"kind":"assistant_chunk","text":"partial "\}/, "replay carries the seq as the SSE id");
  assert.match(text, /id: 3\ndata: \{"kind":"assistant_chunk","text":"reply"\}/, "live events tail after the replay");
  assert.match(text, /"kind":"done"/, "the terminal event reaches the resumed client");
  resetRunBuffersForTest();
});

test("a finished run drains its replay and closes immediately", async () => {
  resetRunBuffersForTest();
  const handle = openRunBuffer(["run-done"]);
  handle.record({ kind: "assistant_chunk", text: "all of it" });
  handle.record({ kind: "done" });
  handle.finish();

  const res = await GET(new Request("http://127.0.0.1/api/chat/stream?runId=run-done"));
  const text = await drain(res);
  assert.match(text, /all of it/);
  assert.match(text, /"kind":"done"/);
  resetRunBuffersForTest();
});

test("a pre-aborted stream request detaches its live tail without body cancellation", async (t) => {
  resetRunBuffersForTest();
  t.mock.timers.enable({ apis: ["setTimeout"] });

  const abort = new AbortController();
  const run = openRunBuffer(["run-pre-aborted-stream"]);
  let childKills = 0;
  const complete = wireRunDetachCleanup({
    runBuffer: run,
    signal: abort.signal,
    isStopRequested: () => false,
    timeoutMs: 100,
    onTimeout: () => { childKills += 1; },
  });
  abort.abort();

  const response = await GET(new Request(
    "http://127.0.0.1/api/chat/stream?runId=run-pre-aborted-stream",
    { signal: abort.signal },
  ));
  assert.equal(response.status, 200);
  assert.equal(
    getRunBufferStatus("run-pre-aborted-stream")?.liveTails,
    0,
    "the already-aborted request must not retain a live tail until body cancellation",
  );

  t.mock.timers.tick(100);
  assert.equal(childKills, 1, "last-tail detach re-arms native child cleanup");
  complete();
  resetRunBuffersForTest();
});

function assistantChunkAtSerializedSize(byteLength: number) {
  const empty = JSON.stringify({ kind: "assistant_chunk", text: "" });
  const text = "x".repeat(byteLength - Buffer.byteLength(empty, "utf8"));
  const event = { kind: "assistant_chunk", text } as const;
  assert.equal(Buffer.byteLength(JSON.stringify(event), "utf8"), byteLength);
  return event;
}

function rawSseFrames(text: string) {
  return text
    .split("\n\n")
    .filter(Boolean)
    .map((frame) => {
      const id = frame.match(/^id: (\d+)$/m);
      const data = frame.match(/^data: (.+)$/m);
      assert.ok(id, "every canonical event frame has an id");
      assert.ok(data, "every canonical event frame has a payload");
      return { id: Number(id[1]), payload: JSON.parse(data[1]) };
    });
}

async function liveAndReplayFrames(
  key: string,
  events: Array<Parameters<typeof canonicalizeAndRecordRunStreamEvent>[1]>,
) {
  const run = openRunBuffer([key]);
  const live: Uint8Array[] = [];
  for (const event of events) {
    const recorded = canonicalizeAndRecordRunStreamEvent(run, event);
    if (recorded) live.push(chatSse(recorded.event, recorded.seq));
  }
  run.finish();
  const replay = await GET(new Request(`http://127.0.0.1/api/chat/stream?runId=${key}`));
  return {
    live: rawSseFrames(new TextDecoder().decode(Buffer.concat(live))),
    replay: rawSseFrames(await drain(replay)),
  };
}

test("live and replay sequences are identical at the canonical event-size boundary", async () => {
  resetRunBuffersForTest();
  const boundary = assistantChunkAtSerializedSize(RUN_STREAM_EVENT_MAX_BYTES);
  const { live, replay } = await liveAndReplayFrames("run-live-boundary", [
    boundary,
    { kind: "done", isError: false },
  ]);
  const expected = [
    { id: 1, payload: boundary },
    { id: 2, payload: { kind: "done", isError: false } },
  ];

  assert.deepEqual(live, expected, "the live producer preserves an exactly-at-limit event");
  assert.deepEqual(replay, expected, "the replay buffer preserves the same ids and payloads");
  assert.deepEqual(live, replay);
  resetRunBuffersForTest();
});

test("an initial user event has the same canonical id and payload live and on replay", async () => {
  resetRunBuffersForTest();
  const user = { kind: "user", text: "first direct-harness prompt" } as const;
  const { live, replay } = await liveAndReplayFrames("run-initial-user", [
    user,
    { kind: "done", isError: false },
  ]);
  const expected = [
    { id: 1, payload: user },
    { id: 2, payload: { kind: "done", isError: false } },
  ];

  assert.deepEqual(live, expected, "the initial live user frame carries its canonical SSE id");
  assert.deepEqual(replay, expected, "the resumed frame preserves the canonical id and payload");
  assert.deepEqual(live, replay);
  resetRunBuffersForTest();
});

test("runtime diagnostics and their final error done preserve live, replay, and reconnect cursors", async () => {
  resetRunBuffersForTest();
  const key = "run-runtime-unavailable";
  const run = openRunBuffer([key]);
  const live: Uint8Array[] = [];
  const events = [
    {
      kind: "error",
      code: "runtime_unavailable",
      message: "The requested runtime is unavailable.",
    },
    {
      kind: "error",
      code: "runtime_probe_failed",
      message: "The runtime probe failed.",
    },
    { kind: "done", isError: true },
  ] as const;
  for (const event of events) {
    const recorded = canonicalizeAndRecordRunStreamEvent(run, event);
    assert.ok(recorded);
    live.push(chatSse(recorded.event, recorded.seq));
  }
  run.finish();

  const expected = [
    { id: 1, payload: events[0] },
    { id: 2, payload: events[1] },
    { id: 3, payload: events[2] },
  ];
  assert.deepEqual(
    rawSseFrames(new TextDecoder().decode(Buffer.concat(live))),
    expected,
    "the direct producer emits each diagnostic and its required terminal done with canonical ids",
  );

  const replay = await GET(new Request(`http://127.0.0.1/api/chat/stream?runId=${key}`));
  assert.deepEqual(rawSseFrames(await drain(replay)), expected);

  const reconnect = await GET(new Request(
    `http://127.0.0.1/api/chat/stream?runId=${key}&cursor=1`,
  ));
  assert.deepEqual(rawSseFrames(await drain(reconnect)), expected.slice(1));
  resetRunBuffersForTest();
});

test("an oversized canonical terminal is the complete identical live and replay sequence", async () => {
  resetRunBuffersForTest();
  const oversized = {
    kind: "assistant_chunk",
    text: `${assistantChunkAtSerializedSize(RUN_STREAM_EVENT_MAX_BYTES).text}x`,
  } as const;
  assert.ok(Buffer.byteLength(JSON.stringify(oversized), "utf8") > RUN_STREAM_EVENT_MAX_BYTES);
  const { live, replay } = await liveAndReplayFrames("run-live-oversized", [
    { kind: "assistant_chunk", text: "before" },
    oversized,
    { kind: "assistant_chunk", text: "must-not-leak" },
    { kind: "done", isError: false },
  ]);
  const expected = [
    { id: 1, payload: { kind: "assistant_chunk", text: "before" } },
    {
      id: 2,
      payload: {
        kind: "error",
        code: "stream_event_too_large",
        message: "The run failed.",
        terminal: true,
      },
    },
  ];

  assert.deepEqual(live, expected, "live emission replaces the oversized event and stops");
  assert.deepEqual(replay, expected, "replay retains the exact same terminal sequence");
  assert.deepEqual(live, replay);
  assert.doesNotMatch(JSON.stringify(live), /must-not-leak/);
  resetRunBuffersForTest();
});

// ── Send-route wiring pins ────────────────────────────────────────────────────
// The buffer only works if the send route tees events BEFORE its
// closed/aborted guard (a dropped transport must keep recording) and pairs
// the detach-cap kill with the buffer's attach/detach hooks.
const sendRoute = readFileSync(new URL("../send/route.ts", import.meta.url), "utf8");
assert.match(
  sendRoute,
  /executeChatSend/,
  "chat/send route should expose the canonical send entrypoint",
);
const send = sendRoute;

test("send route tees both harness stream paths through the run buffer", () => {
  const canonicalRecords = send.match(/const recorded = canonicalizeAndRecordRunStreamEvent\(runBuffer, e(?:vent)?\);/g);
  assert.equal(canonicalRecords?.length, 3, "all SSE producers canonicalize before recording or emitting");
  const tees = send.match(/const recorded = canonicalizeAndRecordRunStreamEvent\(runBuffer, e(?:vent)?\);\s*\n\s*if \(!recorded\) return;\s*\n\s*if \(closed \|\| (?:args\.)?req\.signal\.aborted\) return;/g);
  assert.equal(tees?.length, 2, "both push() implementations record before the closed/aborted guard");
  const seqEmits = send.match(/controller\.enqueue\(chatSse\(recorded\.event, recorded\.seq\)\)/g);
  assert.equal(seqEmits?.length, 3, "all three SSE producers emit the seq as the SSE id — live clients always hold a resume cursor");
  const opens = send.match(/openRunBuffer\(\[/g);
  assert.equal(opens?.length, 3, "OpenClaw opens one canonical buffer before Gateway callbacks and reuses it for CLI fallback");
  const finishes = send.match(/runBuffer(?:\?\.)?\.finish\(\)/g);
  assert.ok((finishes?.length ?? 0) >= 3, "every stream exit (error + close paths) finishes the buffer");
});

test("direct harness opens its canonical history before its initial user event", () => {
  const directBuffer = send.indexOf("const runBuffer = openRunBuffer([body.runId, body.sessionId]);");
  const directStream = send.indexOf("const stream = new ReadableStream<Uint8Array>({", directBuffer);
  const initialUser = send.indexOf('push({ kind: "user", text: promptText });', directStream);
  const lateOpen = send.indexOf("runBuffer = openRunBuffer", directStream);

  assert.ok(directBuffer >= 0 && directBuffer < directStream);
  assert.ok(directStream < initialUser, "the direct initial user must be recorded by the canonical buffer");
  assert.equal(lateOpen, -1, "the direct harness never replaces its canonical buffer after emitting");
});

test("native child detach cleanup reconciles pre-abort, reattach, and completion through real buffer hooks", (t) => {
  resetRunBuffersForTest();
  t.mock.timers.enable({ apis: ["setTimeout"] });

  const abort = new AbortController();
  abort.abort();
  const run = openRunBuffer(["run-detach-lifecycle"]);
  const firstTail = subscribeRunStream("run-detach-lifecycle", 0, () => {}, () => {});
  assert.ok(firstTail && !firstTail.done, "the tail attaches before cleanup hooks are installed");

  let childKills = 0;
  const complete = wireRunDetachCleanup({
    runBuffer: run,
    signal: abort.signal,
    isStopRequested: () => false,
    timeoutMs: 100,
    onTimeout: () => { childKills += 1; },
  });
  t.mock.timers.tick(100);
  assert.equal(childKills, 0, "a pre-aborted native child never arms a kill while the existing tail is live");

  firstTail.unsubscribe();
  const reattachedTail = subscribeRunStream("run-detach-lifecycle", 0, () => {}, () => {});
  assert.ok(reattachedTail && !reattachedTail.done, "the replacement tail attaches after a detach");
  t.mock.timers.tick(100);
  assert.equal(childKills, 0, "reattach clears the native child timer armed by the last detach");

  reattachedTail!.unsubscribe();
  complete();
  t.mock.timers.tick(100);
  assert.equal(childKills, 0, "native child completion clears pending cleanup and disables later tail transitions");
  resetRunBuffersForTest();
});

test("a pre-aborted request with no live tail arms exactly one detach cleanup", (t) => {
  resetRunBuffersForTest();
  t.mock.timers.enable({ apis: ["setTimeout"] });

  const abort = new AbortController();
  abort.abort();
  const run = openRunBuffer(["run-detach-zero-tail"]);
  let kills = 0;
  const complete = wireRunDetachCleanup({
    runBuffer: run,
    signal: abort.signal,
    isStopRequested: () => false,
    timeoutMs: 100,
    onTimeout: () => { kills += 1; },
  });

  t.mock.timers.tick(100);
  assert.equal(kills, 1, "the zero-tail pre-abort cleanup fires once");
  const lateTail = subscribeRunStream("run-detach-zero-tail", 0, () => {}, () => {});
  assert.ok(lateTail && !lateTail.done, "a late tail can still attach after the timeout fires");
  lateTail!.unsubscribe();
  t.mock.timers.tick(100);
  assert.equal(kills, 1, "a fired cleanup cannot be re-armed by later tail transitions");
  complete();
  t.mock.timers.tick(100);
  assert.equal(kills, 1, "completion remains idempotent after the timeout");
  resetRunBuffersForTest();
});
