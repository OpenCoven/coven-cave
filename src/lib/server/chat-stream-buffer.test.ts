import assert from "node:assert/strict";
import { test } from "node:test";
import {
  hasRunBuffer,
  openRunBuffer,
  resetRunBuffersForTest,
  subscribeRunStream,
} from "./chat-stream-buffer.ts";

// Per-run stream buffer (cave-h40l): the send route tees every StreamEvent
// through a bounded ring so GET /api/chat/stream can replay from a cursor and
// tail the live run. These are the resumability semantics the iOS re-attach
// will build on.

test("replays past the cursor, tails live events, and finish closes tails", () => {
  resetRunBuffersForTest();
  const handle = openRunBuffer(["run-1", "conv-1"]);
  handle.record({ kind: "user", text: "hi" });
  handle.record({ kind: "assistant_chunk", text: "he" });
  handle.record({ kind: "assistant_chunk", text: "llo" });

  const seen: string[] = [];
  let finished = false;
  const sub = subscribeRunStream("conv-1", 1, (e) => seen.push(e.json), () => { finished = true; });
  assert.ok(sub && !sub.done, "live run subscribes as not-done under either key");
  assert.deepEqual(
    sub.replay.map((e) => e.seq),
    [2, 3],
    "replay starts strictly after the cursor",
  );
  assert.equal(sub.gapBeforeSeq, null, "no gap while the ring retains everything");

  handle.record({ kind: "assistant_chunk", text: "!" });
  assert.equal(seen.length, 1, "a live tail receives newly recorded events");
  assert.equal(JSON.parse(seen[0]).text, "!");

  handle.finish();
  assert.equal(finished, true, "finish notifies live tails");
  assert.equal(hasRunBuffer("run-1"), true, "a finished run lingers for late re-attach");

  const late = subscribeRunStream("run-1", 0, () => {}, () => {});
  assert.ok(late && late.done, "a late subscriber sees done and drains the replay");
  assert.equal(late.replay.length, 4, "the full retained ring replays after finish");
  resetRunBuffersForTest();
});

test("ring eviction reports a gap so the client knows to full-resync", () => {
  resetRunBuffersForTest();
  const handle = openRunBuffer(["run-big"]);
  const big = "x".repeat(64 * 1024);
  for (let i = 0; i < 12; i += 1) handle.record({ kind: "assistant_chunk", text: big });

  const sub = subscribeRunStream("run-big", 0, () => {}, () => {});
  assert.ok(sub);
  assert.ok(sub.replay.length < 12, "the ring evicted oldest events past the byte cap");
  assert.equal(
    sub.gapBeforeSeq,
    sub.replay[0].seq - 1,
    "the gap names the last evicted seq — everything before it is gone",
  );

  const caughtUp = subscribeRunStream("run-big", sub.replay.at(-1)!.seq, () => {}, () => {});
  assert.ok(caughtUp);
  assert.equal(caughtUp.gapBeforeSeq, null, "a cursor inside the retained ring reports no gap");
  resetRunBuffersForTest();
});

test("attach/detach hooks fire on first tail and last drop only", () => {
  resetRunBuffersForTest();
  const calls: string[] = [];
  const handle = openRunBuffer(["run-h"], {
    attach: () => calls.push("attach"),
    detach: () => calls.push("detach"),
  });

  const a = subscribeRunStream("run-h", 0, () => {}, () => {});
  const b = subscribeRunStream("run-h", 0, () => {}, () => {});
  assert.deepEqual(calls, ["attach"], "only the FIRST tail disarms the detach kill");

  a!.unsubscribe();
  assert.deepEqual(calls, ["attach"], "dropping one of two tails re-arms nothing");
  b!.unsubscribe();
  b!.unsubscribe();
  assert.deepEqual(calls, ["attach", "detach"], "the LAST drop re-arms once (idempotent unsubscribe)");

  handle.finish();
  assert.deepEqual(calls, ["attach", "detach"], "finish never fires hooks");
  resetRunBuffersForTest();
});

test("a follow-up turn owns the shared conversation key; unknown keys return null", () => {
  resetRunBuffersForTest();
  const first = openRunBuffer(["run-a", "conv-shared"]);
  first.record({ kind: "user", text: "turn 1" });
  const second = openRunBuffer(["run-b", "conv-shared"]);
  second.record({ kind: "user", text: "turn 2" });

  const viaShared = subscribeRunStream("conv-shared", 0, () => {}, () => {});
  assert.equal(JSON.parse(viaShared!.replay[0].json).text, "turn 2", "the newest run owns the conversation key");
  const viaOld = subscribeRunStream("run-a", 0, () => {}, () => {});
  assert.equal(JSON.parse(viaOld!.replay[0].json).text, "turn 1", "the older run stays reachable under its own runId");

  assert.equal(subscribeRunStream("nope", 0, () => {}, () => {}), null, "unknown keys are null — caller resyncs post-hoc");
  assert.equal(hasRunBuffer("nope"), false);
  resetRunBuffersForTest();
});

test("recording after finish is a no-op (late child chatter can't grow a dead ring)", () => {
  resetRunBuffersForTest();
  const handle = openRunBuffer(["run-late"]);
  handle.record({ kind: "user", text: "only" });
  handle.finish();
  handle.record({ kind: "assistant_chunk", text: "ghost" });
  const sub = subscribeRunStream("run-late", 0, () => {}, () => {});
  assert.equal(sub!.replay.length, 1, "post-finish records are dropped");
  resetRunBuffersForTest();
});
