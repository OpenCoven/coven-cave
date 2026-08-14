import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { GET } from "./route.ts";
import {
  canonicalizeAndRecordRunStreamEvent,
  openRunBuffer,
  resetRunBuffersForTest,
  RUN_STREAM_EVENT_MAX_BYTES,
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

test("re-attach disarms the detach-cap kill; the last tail re-arms only after the original abort", () => {
  assert.match(
    send,
    /attach: \(\) => \{\s*if \(detachKillTimer != null\) \{\s*clearTimeout\(detachKillTimer\);\s*detachKillTimer = null;/,
    "attach hook cancels the pending kill",
  );
  const rearms = send.match(/detach: \(\) => \{\s*if \((?:args\.)?req\.signal\.aborted\) armDetachKill\(\);/g);
  assert.equal(rearms?.length, 3, "detach hooks re-arm only when the original request is gone — a resume tail closing can't kill a still-attached turn");
});

test("a pre-aborted Gateway request arms one detach kill and completion clears it", () => {
  const gatewayStart = send.indexOf('if (gatewayDispatch.kind === "accepted")');
  const gatewayEnd = send.indexOf("const openclawLaunch = openClawLaunchCommand()", gatewayStart);
  assert.ok(gatewayStart >= 0 && gatewayEnd > gatewayStart);
  const gateway = send.slice(gatewayStart, gatewayEnd);

  assert.match(
    gateway,
    /const armDetachKill = \(\) => \{\s*if \(runHandle\.stopRequested \|\| detachKillTimer != null\) return;[\s\S]*?runBuffer\.setHooks\([\s\S]*?const onAbort = \(\) => armDetachKill\(\);\s*args\.req\.signal\.addEventListener\("abort", onAbort, \{ once: true \}\);[\s\S]*?if \(args\.req\.signal\.aborted\) onAbort\(\);/,
    "the Gateway path checks a pre-aborted signal only after installing its hook and one-shot listener; the timer guard makes that arm idempotent",
  );
  assert.match(
    gateway,
    /const gatewayResult = await gatewayDispatch\.done;[\s\S]*?args\.req\.signal\.removeEventListener\("abort", onAbort\);\s*if \(detachKillTimer != null\) clearTimeout\(detachKillTimer\);/,
    "an actively completed Gateway turn removes the listener and clears its detach kill",
  );
});

test("a pre-aborted CLI fallback request arms one detach kill and completion clears it", () => {
  const fallbackStart = send.indexOf("const openclawLaunch = openClawLaunchCommand()");
  const fallbackEnd = send.indexOf("const failChild =", fallbackStart);
  assert.ok(fallbackStart >= 0 && fallbackEnd > fallbackStart);
  const fallback = send.slice(fallbackStart, fallbackEnd);

  assert.match(
    fallback,
    /const armDetachKill = \(\) => \{\s*if \(runHandle\.stopRequested \|\| detachKillTimer != null\) return;[\s\S]*?runBuffer\.setHooks\([\s\S]*?const onAbort = \(\) => armDetachKill\(\);\s*args\.req\.signal\.addEventListener\("abort", onAbort, \{ once: true \}\);[\s\S]*?if \(args\.req\.signal\.aborted\) onAbort\(\);/,
    "the CLI fallback checks a pre-aborted signal only after installing its hook and one-shot listener; the timer guard makes that arm idempotent",
  );
  assert.match(
    send.slice(fallbackStart),
    /const onAbort = \(\) => armDetachKill\(\);\s*args\.req\.signal\.addEventListener\("abort", onAbort, \{ once: true \}\);[\s\S]*?args\.req\.signal\.removeEventListener\("abort", onAbort\);\s*if \(detachKillTimer != null\) clearTimeout\(detachKillTimer\);/,
    "an actively completed CLI fallback turn removes the listener and clears its detach kill",
  );
});
