import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canonicalizeAndRecordRunStreamEvent,
  ensureTerminalFailure,
  hasRunBuffer,
  getRunBufferStatus,
  openRunBuffer,
  resetRunBuffersForTest,
  RUN_STREAM_EVENT_MAX_BYTES,
  RUN_STREAM_RING_MAX_EVENTS,
  subscribeRunStream,
} from "./chat-stream-buffer.ts";
import type { StreamEvent } from "@/lib/stream-events";

// Per-run stream buffer (cave-h40l): the send route tees every StreamEvent
// through a bounded ring so GET /api/chat/stream can replay from a cursor and
// tail the live run. These are the resumability semantics the iOS re-attach
// will build on.

test("synchronous Gateway callbacks record canonical events before accepted returns", () => {
  resetRunBuffersForTest();
  const run = openRunBuffer(["gateway-sync-early"]);
  const live: Array<{ event: StreamEvent; seq: number | undefined }> = [];
  const push = (event: StreamEvent) => {
    const recorded = canonicalizeAndRecordRunStreamEvent(run, event);
    if (recorded) live.push(recorded);
  };

  const dispatch = () => {
    push({ kind: "assistant_chunk", text: "early Gateway text" });
    return { kind: "accepted" as const };
  };
  const accepted = dispatch();

  assert.equal(accepted.kind, "accepted");
  assert.deepEqual(live, [{
    event: { kind: "assistant_chunk", text: "early Gateway text" },
    seq: 1,
  }], "the live callback receives the exact canonical entry and its stable cursor");
  const resumed = subscribeRunStream("gateway-sync-early", 0, () => {}, () => {});
  assert.ok(resumed && !resumed.done);
  assert.deepEqual(
    resumed.replay.map((entry) => ({ seq: entry.seq, event: JSON.parse(entry.json) })),
    live,
    "a client reconnecting after the accepted response replays the early event verbatim",
  );
  resetRunBuffersForTest();
});

test("an oversized synchronous Gateway callback terminates the canonical run and drops later callbacks", () => {
  resetRunBuffersForTest();
  const run = openRunBuffer(["gateway-sync-oversized"]);
  const live: Array<{ event: StreamEvent; seq: number | undefined }> = [];
  const push = (event: StreamEvent) => {
    const recorded = canonicalizeAndRecordRunStreamEvent(run, event);
    if (recorded) live.push(recorded);
  };

  const dispatch = () => {
    push({ kind: "assistant_chunk", text: "x".repeat(RUN_STREAM_EVENT_MAX_BYTES) });
    push({ kind: "assistant_chunk", text: "must not be recorded or emitted" });
    return { kind: "accepted" as const };
  };
  assert.equal(dispatch().kind, "accepted");

  assert.deepEqual(live, [{
    event: {
      kind: "error",
      code: "stream_event_too_large",
      message: "The run failed.",
      terminal: true,
    },
    seq: 1,
  }], "the replacement is the sole emitted terminal and later callbacks are rejected");
  assert.equal(
    run.record({ kind: "done", isError: true }),
    undefined,
    "a synthesized terminal error rejects the producer's later done",
  );
  const resumed = subscribeRunStream("gateway-sync-oversized", 0, () => {}, () => {});
  assert.ok(resumed);
  assert.deepEqual(
    resumed.replay.map((entry) => ({ seq: entry.seq, event: JSON.parse(entry.json) })),
    live,
    "resume exposes the exact replacement sent live, never the oversized payload or later event",
  );
  assert.equal(getRunBufferStatus("gateway-sync-oversized")?.latestSeq, 1);
  run.finish();
  assert.equal(getRunBufferStatus("gateway-sync-oversized")?.done, true);
  resetRunBuffersForTest();
});

test("Gateway launch rejection closes its reserved buffer with one terminal failure", () => {
  resetRunBuffersForTest();
  const run = openRunBuffer(["gateway-launch-rejected"]);
  const live: Array<{ event: StreamEvent; seq: number | undefined }> = [];
  const failLaunch = () => {
    const recorded = canonicalizeAndRecordRunStreamEvent(run, {
      kind: "error",
      code: "openclaw_gateway_dispatch_failed",
      message: "Cave could not start the OpenClaw Gateway turn.",
    });
    if (recorded) live.push(recorded);
    const done = canonicalizeAndRecordRunStreamEvent(run, { kind: "done", isError: true });
    if (done) live.push(done);
    run.finish();
  };

  failLaunch();
  const status = getRunBufferStatus("gateway-launch-rejected");
  assert.deepEqual(live.map(({ seq, event }) => ({ seq, kind: event.kind })), [
    { seq: 1, kind: "error" },
    { seq: 2, kind: "done" },
  ]);
  assert.equal(status?.done, true, "a rejected launch cannot leave a false live run behind");
  assert.equal(
    canonicalizeAndRecordRunStreamEvent(run, { kind: "assistant_chunk", text: "late callback" }),
    null,
    "callbacks after rejected launch cannot revive its terminal buffer",
  );
  resetRunBuffersForTest();
});

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
  // None of the four recorded events were terminal (`done`/`error`), so
  // `finish()` appends the guaranteed synthetic `run.failed` before marking
  // the buffer done — the retained ring is the 4 real events plus that one.
  assert.equal(late.replay.length, 5, "the retained ring plus the guaranteed terminal replays after finish");
  const terminal = JSON.parse(late.replay[late.replay.length - 1].json);
  assert.equal(terminal.kind, "error", "finish synthesizes a terminal when none was ever recorded");
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

test("installing hooks after an early tail reconciles the active attachment", () => {
  resetRunBuffersForTest();
  const run = openRunBuffer(["run-late-hooks"]);
  const tail = subscribeRunStream("run-late-hooks", 0, () => {}, () => {});
  assert.ok(tail && !tail.done);

  const calls: string[] = [];
  run.setHooks({
    attach: () => calls.push("attach"),
    detach: () => calls.push("detach"),
  });
  assert.deepEqual(calls, ["attach"], "the later stop handle learns a tail already attached");

  tail.unsubscribe();
  assert.deepEqual(calls, ["attach", "detach"], "the same tail re-arms cleanup when it drops");
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

test("a follow-up preserves the predecessor reap timer", (t) => {
  resetRunBuffersForTest();
  t.mock.timers.enable({ apis: ["setTimeout"] });

  const first = openRunBuffer(["run-old", "conv-shared"]);
  first.record({ kind: "assistant_chunk", text: "old transcript" });
  first.finish();

  openRunBuffer(["run-new", "conv-shared"]);
  t.mock.timers.tick(2 * 60_000);

  assert.equal(
    hasRunBuffer("run-old"),
    false,
    "the finished predecessor is reaped under its unique run id",
  );
  assert.equal(
    hasRunBuffer("conv-shared"),
    true,
    "the predecessor timer never deletes the replacement conversation mapping",
  );
  resetRunBuffersForTest();
});

test("getRunBufferStatus returns payload-free metadata without side effects", () => {
  resetRunBuffersForTest();
  let attachCount = 0;
  let detachCount = 0;
  const handle = openRunBuffer(["run-status", "conv-status"], {
    attach: () => {
      attachCount += 1;
    },
    detach: () => {
      detachCount += 1;
    },
  });
  const first = { kind: "user", text: "alpha" } satisfies StreamEvent;
  const second = { kind: "assistant_chunk", text: "bravo" } satisfies StreamEvent;
  handle.record(first);
  handle.record(second);

  const status = getRunBufferStatus("conv-status");
  assert.deepEqual(status, {
    done: false,
    oldestRetainedSeq: 1,
    latestSeq: 2,
    retainedEventCount: 2,
    retainedBytes:
      Buffer.byteLength(JSON.stringify(first), "utf8") +
      Buffer.byteLength(JSON.stringify(second), "utf8"),
    hasEvictedEvents: false,
    liveTails: 0,
  });
  assert.equal(attachCount, 0, "status reads must not invoke hooks");
  assert.equal(detachCount, 0, "status reads must not invoke hooks");
  assert.doesNotMatch(JSON.stringify(status), /alpha|bravo|json/i, "serialized status never exposes buffered payload text");
  assert.equal(getRunBufferStatus("missing"), null, "unknown keys return null");
  resetRunBuffersForTest();
});

test("getRunBufferStatus measures retained UTF-8 bytes", () => {
  resetRunBuffersForTest();
  const handle = openRunBuffer(["run-unicode"]);
  const event = { kind: "assistant_chunk", text: "🧙漢字" } satisfies StreamEvent;
  handle.record(event);

  assert.equal(
    getRunBufferStatus("run-unicode")?.retainedBytes,
    Buffer.byteLength(JSON.stringify(event), "utf8"),
  );

  resetRunBuffersForTest();
});

test("getRunBufferStatus reports an empty buffer without evicting anything", () => {
  resetRunBuffersForTest();
  openRunBuffer(["run-empty"]);

  assert.deepEqual(getRunBufferStatus("run-empty"), {
    done: false,
    oldestRetainedSeq: null,
    latestSeq: 0,
    retainedEventCount: 0,
    retainedBytes: 0,
    hasEvictedEvents: false,
    liveTails: 0,
  });

  resetRunBuffersForTest();
});

test("getRunBufferStatus tracks live tails, eviction, and finish", () => {
  resetRunBuffersForTest();
  const handle = openRunBuffer(["run-health"]);
  const sub = subscribeRunStream("run-health", 0, () => {}, () => {});
  assert.ok(sub);
  assert.equal(getRunBufferStatus("run-health")?.liveTails, 1, "live subscription increments liveTails");

  sub!.unsubscribe();
  assert.equal(getRunBufferStatus("run-health")?.liveTails, 0, "unsubscribe decrements liveTails");

  const big = "x".repeat(64 * 1024);
  for (let i = 0; i < 12; i += 1) handle.record({ kind: "assistant_chunk", text: big });
  const evicted = getRunBufferStatus("run-health");
  assert.ok(evicted);
  assert.equal(evicted?.hasEvictedEvents, true, "ring eviction sets hasEvictedEvents");

  const liveAgain = subscribeRunStream("run-health", evicted!.latestSeq, () => {}, () => {});
  assert.ok(liveAgain);
  handle.finish();
  // None of the 12 recorded chunks were terminal, so `finish()` appends the
  // guaranteed synthetic terminal (one more small event) before marking done
  // — retainedEventCount/latestSeq/retainedBytes advance by that one entry.
  const finished = getRunBufferStatus("run-health");
  assert.deepEqual(finished, {
    done: true,
    oldestRetainedSeq: finished!.oldestRetainedSeq,
    latestSeq: evicted!.latestSeq + 1,
    retainedEventCount: evicted!.retainedEventCount + 1,
    retainedBytes: finished!.retainedBytes,
    hasEvictedEvents: true,
    liveTails: 0,
  }, "finish marks the run done, clears live tails, and appends the guaranteed terminal");
  resetRunBuffersForTest();
});

test("recording after finish is a no-op (late child chatter can't grow a dead ring)", () => {
  resetRunBuffersForTest();
  const handle = openRunBuffer(["run-late"]);
  handle.record({ kind: "user", text: "only" });
  handle.finish();
  handle.record({ kind: "assistant_chunk", text: "ghost" });
  const sub = subscribeRunStream("run-late", 0, () => {}, () => {});
  // The "only" user event plus the guaranteed synthetic terminal finish()
  // appended (no terminal had ever been recorded) — but the post-finish
  // "ghost" record is still dropped.
  assert.equal(sub!.replay.length, 2, "post-finish records are dropped");
  const terminal = JSON.parse(sub!.replay[1].json);
  assert.equal(terminal.kind, "error", "finish synthesizes the missing terminal");
  resetRunBuffersForTest();
});

test("oversized raw events are replaced before append and count plus bytes stay bounded", () => {
  resetRunBuffersForTest();
  const handle = openRunBuffer(["run-bounded"]);
  const secret = `/private/token-${"x".repeat(RUN_STREAM_EVENT_MAX_BYTES + 1)}`;
  handle.record({ kind: "assistant_chunk", text: secret });
  let subscription = subscribeRunStream("run-bounded", 0, () => {}, () => {});
  assert.ok(subscription);
  assert.equal(subscription.replay.length, 1);
  assert.deepEqual(JSON.parse(subscription.replay[0].json), {
    kind: "error",
    code: "stream_event_too_large",
    message: "The run failed.",
    terminal: true,
  });
  assert.doesNotMatch(subscription.replay[0].json, /private|token/);

  for (let index = 0; index < RUN_STREAM_RING_MAX_EVENTS + 100; index += 1) {
    handle.record({ kind: "assistant_chunk", text: "" });
  }
  subscription = subscribeRunStream("run-bounded", 0, () => {}, () => {});
  assert.ok(subscription);
  assert.ok(subscription.replay.length <= RUN_STREAM_RING_MAX_EVENTS);
  const status = getRunBufferStatus("run-bounded");
  assert.ok(status && status.retainedBytes <= 512 * 1024);
  resetRunBuffersForTest();
});

test("an ahead cursor never subscribes to later canonical events", () => {
  resetRunBuffersForTest();
  const handle = openRunBuffer(["run-ahead"]);
  handle.record({ kind: "assistant_chunk", text: "one" });
  const seen: number[] = [];
  const subscription = subscribeRunStream(
    "run-ahead",
    10,
    (entry) => seen.push(entry.seq),
    () => {},
  );
  assert.ok(subscription?.cursorAhead);
  handle.record({ kind: "assistant_chunk", text: "two" });
  assert.deepEqual(seen, []);
  resetRunBuffersForTest();
});

test("ensureTerminalFailure is atomic across concurrent subscribers — exactly one synthetic terminal", () => {
  resetRunBuffersForTest();
  const handle = openRunBuffer(["run-concurrent"]);
  handle.record({ kind: "assistant_chunk", text: "partial" });

  const seenA: string[] = [];
  const seenB: string[] = [];
  let finishedA = false;
  let finishedB = false;
  const subA = subscribeRunStream("run-concurrent", 0, (e) => seenA.push(e.json), () => { finishedA = true; });
  const subB = subscribeRunStream("run-concurrent", 0, (e) => seenB.push(e.json), () => { finishedB = true; });
  assert.ok(subA && !subA.done && subB && !subB.done, "both attach live before any terminal exists");

  // Two independent consumers (e.g. the initial requester's own truncated
  // read, and a concurrently resumed subscriber) both discover the upstream
  // ended without a terminal and race to publish one — only the first call
  // actually inserts an event; the second converges on that same entry.
  const first = ensureTerminalFailure("run-concurrent", "upstream_disconnected");
  const second = ensureTerminalFailure("run-concurrent", "upstream_disconnected");
  assert.ok(first && second, "both calls resolve to an entry");
  assert.equal(first!.seq, second!.seq, "concurrent callers converge on the same synthetic terminal");
  assert.equal(first!.json, second!.json);

  assert.equal(finishedA, true, "attached tail A is notified the run finished");
  assert.equal(finishedB, true, "attached tail B is notified the run finished");
  assert.equal(seenA.length, 1, "tail A observes exactly one terminal event, not two");
  assert.equal(seenB.length, 1, "tail B observes exactly one terminal event, not two");
  assert.equal(seenA[0], first!.json);
  assert.equal(seenB[0], first!.json);

  const status = getRunBufferStatus("run-concurrent");
  assert.equal(status?.retainedEventCount, 2, "only one real event plus one synthetic terminal — never two synthetics");
  resetRunBuffersForTest();
});

test("a terminal at/before the resume cursor closes with no extra synthetic event", () => {
  resetRunBuffersForTest();
  const handle = openRunBuffer(["run-terminal-before-cursor"]);
  handle.record({ kind: "assistant_chunk", text: "hi" });
  handle.record({ kind: "done" });
  handle.finish();

  // ensureTerminalFailure must never synthesize a second terminal once a
  // real one is already in history — "never synthesize failure after
  // completed/failed".
  const result = ensureTerminalFailure("run-terminal-before-cursor", "upstream_disconnected");
  assert.equal(result?.seq, 2, "the real done event remains the one and only terminal");
  assert.deepEqual(JSON.parse(result!.json), { kind: "done" });

  // Resuming with a cursor at (or past) the terminal replays nothing extra —
  // history is already terminal.
  const resumed = subscribeRunStream("run-terminal-before-cursor", 2, () => {}, () => {});
  assert.ok(resumed?.done);
  assert.deepEqual(resumed!.replay, [], "no extra event when the terminal is at/before the cursor");

  // Resuming from before the terminal still replays it exactly once.
  const resumedEarlier = subscribeRunStream("run-terminal-before-cursor", 1, () => {}, () => {});
  assert.ok(resumedEarlier?.done);
  assert.equal(resumedEarlier!.replay.length, 1, "terminal after the cursor is replayed");
  assert.deepEqual(JSON.parse(resumedEarlier!.replay[0].json), { kind: "done" });
  resetRunBuffersForTest();
});

test("subscriber cancellation detaches only — it never marks the run failed while the producer is still active", () => {
  resetRunBuffersForTest();
  const handle = openRunBuffer(["run-cancel-only"]);
  let finished = false;
  const sub = subscribeRunStream("run-cancel-only", 0, () => {}, () => { finished = true; });
  assert.ok(sub && !sub.done);
  assert.equal(getRunBufferStatus("run-cancel-only")?.liveTails, 1);

  sub!.unsubscribe();

  assert.equal(finished, false, "unsubscribe does not fire the finish notification");
  assert.equal(getRunBufferStatus("run-cancel-only")?.done, false, "the run is not marked done by a lone subscriber detaching");
  assert.equal(getRunBufferStatus("run-cancel-only")?.liveTails, 0, "detach only decrements liveTails");

  // The producer is still active and can keep recording / finish normally.
  handle.record({ kind: "assistant_chunk", text: "still going" });
  handle.record({ kind: "done" });
  handle.finish();
  const status = getRunBufferStatus("run-cancel-only");
  assert.equal(status?.done, true);
  assert.equal(ensureTerminalFailure("run-cancel-only", "upstream_disconnected")?.seq, status?.latestSeq, "the real done event stands — no synthetic terminal was ever needed");
  resetRunBuffersForTest();
});

test("diagnostic errors remain canonical until their final error done", () => {
  resetRunBuffersForTest();
  const handle = openRunBuffer(["run-diagnostic-errors"]);

  const unavailable = handle.record({
    kind: "error",
    code: "runtime_unavailable",
    message: "The runtime is unavailable.",
  });
  const retry = handle.record({
    kind: "error",
    code: "runtime_probe_failed",
    message: "The runtime check failed.",
  });
  const done = handle.record({ kind: "done", isError: true });
  handle.finish();

  assert.deepEqual([unavailable, retry, done], [1, 2, 3]);
  const replay = subscribeRunStream("run-diagnostic-errors", 0, () => {}, () => {});
  assert.ok(replay?.done);
  assert.deepEqual(
    replay!.replay.map((entry) => ({ seq: entry.seq, event: JSON.parse(entry.json) })),
    [
      {
        seq: 1,
        event: {
          kind: "error",
          code: "runtime_unavailable",
          message: "The runtime is unavailable.",
        },
      },
      {
        seq: 2,
        event: {
          kind: "error",
          code: "runtime_probe_failed",
          message: "The runtime check failed.",
        },
      },
      { seq: 3, event: { kind: "done", isError: true } },
    ],
    "multiple producer diagnostics remain replayable before the final canonical done",
  );
  resetRunBuffersForTest();
});

test("chunk -> done -> error -> chunk records only the chunk and the done, ignoring everything after the terminal", () => {
  resetRunBuffersForTest();
  const handle = openRunBuffer(["run-post-terminal"]);

  const chunkSeq = handle.record({ kind: "assistant_chunk", text: "hi" });
  const doneSeq = handle.record({ kind: "done" });
  const errorSeq = handle.record({
    kind: "error",
    code: "boom",
    message: "should never land",
    terminal: true,
  });
  const ghostChunkSeq = handle.record({ kind: "assistant_chunk", text: "ghost" });

  assert.equal(chunkSeq, 1, "the leading nonterminal event is recorded normally");
  assert.equal(doneSeq, 2, "the first terminal event is recorded normally");
  assert.equal(errorSeq, undefined, "a second terminal after the first is ignored, not appended");
  assert.equal(ghostChunkSeq, undefined, "nonterminal chatter after the terminal is ignored too");

  const sub = subscribeRunStream("run-post-terminal", 0, () => {}, () => {});
  assert.ok(sub);
  assert.deepEqual(
    sub!.replay.map((e) => JSON.parse(e.json).kind),
    ["assistant_chunk", "done"],
    "only the chunk and the done ever entered the canonical ring",
  );
  resetRunBuffersForTest();
});

test("seq and latestSeq stop advancing the instant a terminal is recorded, even before finish()", () => {
  resetRunBuffersForTest();
  const handle = openRunBuffer(["run-seq-frozen"]);

  handle.record({ kind: "assistant_chunk", text: "hi" });
  handle.record({ kind: "done" });
  const frozen = getRunBufferStatus("run-seq-frozen");
  assert.equal(frozen?.latestSeq, 2, "latestSeq stops at the terminal entry");
  assert.equal(frozen?.retainedEventCount, 2);
  const frozenBytes = frozen?.retainedBytes;

  // Neither seq nor bytes may move for any event recorded after the
  // terminal — whether or not finish() has run yet.
  for (let i = 0; i < 5; i += 1) {
    handle.record({ kind: "assistant_chunk", text: "x".repeat(1024) });
  }
  const stillFrozen = getRunBufferStatus("run-seq-frozen");
  assert.equal(stillFrozen?.latestSeq, 2, "latestSeq is unchanged by post-terminal chatter");
  assert.equal(stillFrozen?.retainedEventCount, 2, "no post-terminal event was appended to the ring");
  assert.equal(stillFrozen?.retainedBytes, frozenBytes, "bytes never grow past the terminal");

  handle.finish();
  const afterFinish = getRunBufferStatus("run-seq-frozen");
  assert.equal(afterFinish?.latestSeq, 2, "finish() does not append or advance seq once a real terminal exists");
  assert.equal(afterFinish?.retainedEventCount, 2);
  assert.equal(afterFinish?.retainedBytes, frozenBytes);
  resetRunBuffersForTest();
});

test("racing terminal publishes through record() converge on exactly one canonical terminal", () => {
  resetRunBuffersForTest();
  const handle = openRunBuffer(["run-race-terminal"]);

  // Two producers racing to close out the same run both attempt to record a
  // terminal event back-to-back (e.g. a real `done` immediately followed by
  // a late upstream `error`). Only the first lands.
  const firstSeq = handle.record({ kind: "done" });
  const secondSeq = handle.record({
    kind: "error",
    code: "late",
    message: "late upstream error",
    terminal: true,
  });
  assert.ok(typeof firstSeq === "number", "the first terminal publish wins and is recorded");
  assert.equal(secondSeq, undefined, "the racing second terminal publish is ignored, not appended");

  const status = getRunBufferStatus("run-race-terminal");
  assert.equal(status?.retainedEventCount, 1, "exactly one terminal entry exists in the ring");

  handle.finish();
  const afterFinish = getRunBufferStatus("run-race-terminal");
  assert.equal(afterFinish?.retainedEventCount, 1, "finish() does not add a second terminal on top of the real one");
  assert.equal(
    ensureTerminalFailure("run-race-terminal", "upstream_disconnected")?.seq,
    firstSeq,
    "ensureTerminalFailure also stays a no-op once the real terminal already won the race",
  );
  resetRunBuffersForTest();
});

test("a subscriber resumed after the terminal never sees any post-terminal event, seeded or replayed", () => {
  resetRunBuffersForTest();
  const handle = openRunBuffer(["run-resume-post-terminal"]);

  handle.record({ kind: "assistant_chunk", text: "hi" });
  handle.record({ kind: "done" });
  // These are ignored by the invariant under test — asserting they truly
  // never reach any subscriber, seeded (<= cursor) or replayed (> cursor).
  handle.record({ kind: "assistant_chunk", text: "ghost-1" });
  handle.record({ kind: "error", code: "ghost", message: "ghost-2" });
  handle.finish();

  const resumedFromZero = subscribeRunStream("run-resume-post-terminal", 0, () => {}, () => {});
  assert.ok(resumedFromZero?.done);
  assert.deepEqual(
    resumedFromZero!.seed.map((e) => JSON.parse(e.json).kind ?? JSON.parse(e.json).text),
    [],
    "cursor 0 seeds nothing — everything is past the cursor",
  );
  assert.deepEqual(
    resumedFromZero!.replay.map((e) => JSON.parse(e.json).kind),
    ["assistant_chunk", "done"],
    "replay from a fresh resume contains only the pre-terminal chunk and the terminal itself",
  );

  const resumedFromTerminal = subscribeRunStream("run-resume-post-terminal", 2, () => {}, () => {});
  assert.ok(resumedFromTerminal?.done);
  assert.deepEqual(
    resumedFromTerminal!.seed.map((e) => JSON.parse(e.json).kind),
    ["assistant_chunk", "done"],
    "a cursor at the terminal seeds exactly the chunk and the terminal, nothing ghosted after",
  );
  assert.deepEqual(resumedFromTerminal!.replay, [], "nothing replays past a cursor already at the terminal");
  assert.equal(resumedFromTerminal?.latestSeq, 2, "latestSeq reported to a resumed subscriber never counts ignored events");

  resetRunBuffersForTest();
});
