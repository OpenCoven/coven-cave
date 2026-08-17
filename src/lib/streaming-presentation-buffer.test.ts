import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";

import {
  createStreamingPresentationBuffer,
  type SchedulerHandle,
} from "./streaming-presentation-buffer.ts";

function makeQueues() {
  let nextHandle = 1;
  const frames = new Map<number, () => void>();
  const timers = new Map<number, { callback: () => void; delay: number }>();

  return {
    scheduleFrame(callback: () => void) {
      const handle = nextHandle++;
      frames.set(handle, callback);
      return handle;
    },
    cancelFrame(handle: SchedulerHandle) {
      frames.delete(handle as number);
    },
    scheduleTimer(callback: () => void, delay: number) {
      const handle = nextHandle++;
      timers.set(handle, { callback, delay });
      return handle;
    },
    cancelTimer(handle: SchedulerHandle) {
      timers.delete(handle as number);
    },
    fireFrame(handle?: number) {
      const id = handle ?? frames.keys().next().value;
      if (id === undefined) return false;
      const callback = frames.get(id);
      frames.delete(id);
      callback?.();
      return !!callback;
    },
    fireTimer(handle?: number) {
      const id = handle ?? timers.keys().next().value;
      if (id === undefined) return false;
      const entry = timers.get(id);
      timers.delete(id);
      entry?.callback();
      return !!entry;
    },
    timersByDelay(delay: number) {
      return [...timers.entries()]
        .filter(([, entry]) => entry.delay === delay)
        .map(([handle]) => handle);
    },
    counts() {
      return { frames: frames.size, timers: timers.size };
    },
  };
}

test("burst snapshots H→He→Hello schedule one frame and flush newest Hello", () => {
  const queues = makeQueues();
  const flushed: string[] = [];
  const buffer = createStreamingPresentationBuffer({
    initialSource: "",
    onFlush: (source) => flushed.push(source),
    scheduleFrame: queues.scheduleFrame,
    cancelFrame: queues.cancelFrame,
    scheduleTimer: queues.scheduleTimer,
    cancelTimer: queues.cancelTimer,
  });

  buffer.update("H", false);
  buffer.update("He", false);
  buffer.update("Hello", false);

  assert.equal(queues.counts().frames, 1);
  assert.equal(queues.counts().timers, 2);
  queues.fireFrame();
  assert.deepEqual(flushed, ["Hello"]);
});

test("presented quiet tails wait for idle while internal punctuation stays quiet", () => {
  const queues = makeQueues();
  const flushed: string[] = [];
  const buffer = createStreamingPresentationBuffer({
    initialSource: "",
    onFlush: (source) => flushed.push(source),
    scheduleFrame: queues.scheduleFrame,
    cancelFrame: queues.cancelFrame,
    scheduleTimer: queues.scheduleTimer,
    cancelTimer: queues.cancelTimer,
  });

  buffer.update("Version 1.2", false);
  queues.fireFrame();
  assert.deepEqual(flushed, ["Version 1.2"]);

  buffer.update("Version 1.2 tail", false);
  assert.equal(queues.counts().frames, 0, "quiet tail does not queue a new frame");
  assert.equal(queues.timersByDelay(90).length, 1, "quiet tail keeps only the resettable idle timer");
  assert.equal(queues.timersByDelay(180).length, 1, "quiet tail keeps the non-resetting max timer");

  const idleHandle = queues.timersByDelay(90)[0];
  queues.fireTimer(idleHandle);
  assert.deepEqual(flushed, ["Version 1.2", "Version 1.2 tail"]);
});

test("a newly introduced newline queues one frame for the newest snapshot", () => {
  const queues = makeQueues();
  const flushed: string[] = [];
  const buffer = createStreamingPresentationBuffer({
    initialSource: "Alpha",
    onFlush: (source) => flushed.push(source),
    scheduleFrame: queues.scheduleFrame,
    cancelFrame: queues.cancelFrame,
    scheduleTimer: queues.scheduleTimer,
    cancelTimer: queues.cancelTimer,
  });

  buffer.update("Alpha\nBeta", false);
  buffer.update("Alpha\nBeta grows", false);

  assert.equal(queues.counts().frames, 1);
  queues.fireFrame();
  assert.deepEqual(flushed, ["Alpha\nBeta grows"]);
});

test("sentence boundaries require newly completed punctuation or following whitespace", () => {
  const scenarios = [
    { label: "new end punctuation", initial: "Alpha", source: "Alpha.", frameCount: 1 },
    { label: "new separator", initial: "Alpha.", source: "Alpha. ", frameCount: 1 },
    { label: "old punctuation and separator", initial: "Alpha. ", source: "Alpha. tail", frameCount: 0 },
  ] as const;

  for (const scenario of scenarios) {
    const queues = makeQueues();
    const buffer = createStreamingPresentationBuffer({
      initialSource: scenario.initial,
      onFlush: () => {},
      scheduleFrame: queues.scheduleFrame,
      cancelFrame: queues.cancelFrame,
      scheduleTimer: queues.scheduleTimer,
      cancelTimer: queues.cancelTimer,
    });

    buffer.update(scenario.source, false);
    assert.equal(queues.counts().frames, scenario.frameCount, scenario.label);
  }
});

test("list markers queue only when their following whitespace becomes complete", () => {
  const scenarios = [
    { label: "unordered", partial: "Alpha\n-", complete: "Alpha\n- ", appended: "Alpha\n- item" },
    { label: "ordered", partial: "Alpha\n1.", complete: "Alpha\n1. ", appended: "Alpha\n1. item" },
  ] as const;

  for (const scenario of scenarios) {
    const queues = makeQueues();
    const flushed: string[] = [];
    const buffer = createStreamingPresentationBuffer({
      initialSource: "Alpha\n",
      onFlush: (source) => flushed.push(source),
      scheduleFrame: queues.scheduleFrame,
      cancelFrame: queues.cancelFrame,
      scheduleTimer: queues.scheduleTimer,
      cancelTimer: queues.cancelTimer,
    });

    buffer.update(scenario.partial, false);
    assert.equal(queues.counts().frames, 0, `${scenario.label}: incomplete marker stays quiet`);
    buffer.update(scenario.complete, false);
    assert.equal(queues.counts().frames, 1, `${scenario.label}: split marker completion queues a frame`);
    queues.fireFrame();
    assert.deepEqual(flushed, [scenario.complete]);

    buffer.update(scenario.appended, false);
    assert.equal(queues.counts().frames, 0, `${scenario.label}: appending text to a complete marker stays quiet`);
  }
});

test("fences queue when the run first reaches three markers and do not retrigger", () => {
  const scenarios = [
    { label: "backtick", partial: "Alpha\n``", complete: "Alpha\n```", appended: "Alpha\n```ts" },
    { label: "tilde", partial: "Alpha\n~~", complete: "Alpha\n~~~", appended: "Alpha\n~~~text" },
  ] as const;

  for (const scenario of scenarios) {
    const queues = makeQueues();
    const flushed: string[] = [];
    const buffer = createStreamingPresentationBuffer({
      initialSource: "Alpha\n",
      onFlush: (source) => flushed.push(source),
      scheduleFrame: queues.scheduleFrame,
      cancelFrame: queues.cancelFrame,
      scheduleTimer: queues.scheduleTimer,
      cancelTimer: queues.cancelTimer,
    });

    buffer.update(scenario.partial, false);
    assert.equal(queues.counts().frames, 0, `${scenario.label}: a two-marker run stays quiet`);
    buffer.update(scenario.complete, false);
    assert.equal(queues.counts().frames, 1, `${scenario.label}: third marker queues a frame`);
    queues.fireFrame();
    assert.deepEqual(flushed, [scenario.complete]);

    buffer.update(scenario.appended, false);
    assert.equal(queues.counts().frames, 0, `${scenario.label}: language or text after a complete fence stays quiet`);
  }
});

test("a boundary earlier in newly appended multiline content queues a frame", () => {
  const queues = makeQueues();
  const flushed: string[] = [];
  const buffer = createStreamingPresentationBuffer({
    initialSource: "Alpha\n",
    onFlush: (source) => flushed.push(source),
    scheduleFrame: queues.scheduleFrame,
    cancelFrame: queues.cancelFrame,
    scheduleTimer: queues.scheduleTimer,
    cancelTimer: queues.cancelTimer,
  });
  const source = "Alpha\nFirst sentence. continuation\nquiet tail";

  buffer.update(source, false);

  assert.equal(queues.counts().frames, 1);
  queues.fireFrame();
  assert.deepEqual(flushed, [source]);
});

test("replacement and shrinking snapshots queue a conservative frame with the newest source", () => {
  const scenarios = [
    { label: "same-length replacement", initial: "Alpha tail", source: "Omega tail" },
    { label: "shrinking replacement", initial: "Alpha tail", source: "short" },
    { label: "longer replacement", initial: "Alpha tail", source: "Omega tail grows" },
  ] as const;

  for (const scenario of scenarios) {
    const queues = makeQueues();
    const flushed: string[] = [];
    const buffer = createStreamingPresentationBuffer({
      initialSource: scenario.initial,
      onFlush: (source) => flushed.push(source),
      scheduleFrame: queues.scheduleFrame,
      cancelFrame: queues.cancelFrame,
      scheduleTimer: queues.scheduleTimer,
      cancelTimer: queues.cancelTimer,
    });

    buffer.update(scenario.source, false);
    assert.equal(queues.counts().frames, 1, scenario.label);
    queues.fireFrame();
    assert.deepEqual(flushed, [scenario.source], scenario.label);
  }
});

test("an earlier replacement cannot hide behind an unchanged long tail", () => {
  const queues = makeQueues();
  const flushed: string[] = [];
  const unchangedTail = "x".repeat(300);
  const initialSource = `Alpha old ${unchangedTail}`;
  const source = `Omega.\n!! ${unchangedTail} grows`;
  const buffer = createStreamingPresentationBuffer({
    initialSource,
    onFlush: (value) => flushed.push(value),
    scheduleFrame: queues.scheduleFrame,
    cancelFrame: queues.cancelFrame,
    scheduleTimer: queues.scheduleTimer,
    cancelTimer: queues.cancelTimer,
    sourceMode: "replaceable",
  });

  assert.ok(source.length > initialSource.length);
  assert.equal(source.slice(10, initialSource.length), initialSource.slice(10));
  buffer.update(source, false);

  assert.equal(queues.counts().frames, 1);
  queues.fireFrame();
  assert.deepEqual(flushed, [source]);
});

test("append-only mode trusts longer-prefix metadata and scans the appended delta", () => {
  const queues = makeQueues();
  const flushed: string[] = [];
  const buffer = createStreamingPresentationBuffer({
    initialSource: "Alpha tail",
    onFlush: (source) => flushed.push(source),
    scheduleFrame: queues.scheduleFrame,
    cancelFrame: queues.cancelFrame,
    scheduleTimer: queues.scheduleTimer,
    cancelTimer: queues.cancelTimer,
    sourceMode: "append-only",
  });

  buffer.update("Omega tail grows", false);
  assert.equal(queues.counts().frames, 0, "longer sources do not trigger prefix validation");
  queues.fireTimer(queues.timersByDelay(90)[0]);
  assert.deepEqual(flushed, ["Omega tail grows"]);

  buffer.update("Omega tail grows.", false);
  assert.equal(queues.counts().frames, 1, "a boundary in the appended delta queues a frame");
});

test("append-only mode keeps equal and shrinking changes conservative", () => {
  const scenarios = [
    { label: "same-length replacement", initial: "Alpha tail", source: "Omega tail" },
    { label: "shrinking replacement", initial: "Alpha tail", source: "short" },
  ] as const;

  for (const scenario of scenarios) {
    const queues = makeQueues();
    const flushed: string[] = [];
    const buffer = createStreamingPresentationBuffer({
      initialSource: scenario.initial,
      onFlush: (source) => flushed.push(source),
      scheduleFrame: queues.scheduleFrame,
      cancelFrame: queues.cancelFrame,
      scheduleTimer: queues.scheduleTimer,
      cancelTimer: queues.cancelTimer,
      sourceMode: "append-only",
    });

    buffer.update(scenario.source, false);
    assert.equal(queues.counts().frames, 1, scenario.label);
    queues.fireFrame();
    assert.deepEqual(flushed, [scenario.source], scenario.label);
  }
});

test("long accumulated streams process append deltas within a stable budget", () => {
  const queues = makeQueues();
  const buffer = createStreamingPresentationBuffer({
    initialSource: "seed",
    onFlush: () => {},
    scheduleFrame: queues.scheduleFrame,
    cancelFrame: queues.cancelFrame,
    scheduleTimer: queues.scheduleTimer,
    cancelTimer: queues.cancelTimer,
    sourceMode: "append-only",
  });
  const updateCount = 50_000;
  const chunk = "abcdefghij";
  const completeSource = `seed${chunk.repeat(updateCount)}`;

  const startedAt = performance.now();
  for (let index = 1; index <= updateCount; index += 1) {
    const source = completeSource.slice(0, 4 + index * chunk.length);
    buffer.update(source, false);
  }
  const elapsedMs = performance.now() - startedAt;
  buffer.dispose();

  assert.equal(completeSource.length, 500_004);
  assert.ok(
    elapsedMs < 10_000,
    `500k characters across 50k snapshots took ${elapsedMs.toFixed(1)}ms`,
  );
});

test("settled=true cancels pending callbacks and synchronously flushes complete source", () => {
  const queues = makeQueues();
  const flushed: string[] = [];
  const buffer = createStreamingPresentationBuffer({
    initialSource: "",
    onFlush: (source) => flushed.push(source),
    scheduleFrame: queues.scheduleFrame,
    cancelFrame: queues.cancelFrame,
    scheduleTimer: queues.scheduleTimer,
    cancelTimer: queues.cancelTimer,
  });

  buffer.update("unsettled tail", false);
  buffer.update("unsettled tail.", true);

  assert.deepEqual(flushed, ["unsettled tail."]);
  assert.equal(queues.counts().frames, 0);
  assert.equal(queues.counts().timers, 0);
  queues.fireFrame();
  queues.fireTimer();
  assert.deepEqual(flushed, ["unsettled tail."]);
});

test("continuous token updates cannot postpone beyond non-resetting 180ms maximum timer", () => {
  const queues = makeQueues();
  const flushed: string[] = [];
  const buffer = createStreamingPresentationBuffer({
    initialSource: "",
    onFlush: (source) => flushed.push(source),
    scheduleFrame: queues.scheduleFrame,
    cancelFrame: queues.cancelFrame,
    scheduleTimer: queues.scheduleTimer,
    cancelTimer: queues.cancelTimer,
  });

  buffer.update("one", false);
  buffer.update("one two", false);
  buffer.update("one two three", false);

  assert.equal(queues.timersByDelay(180).length, 1);
  const maxHandle = queues.timersByDelay(180)[0];
  queues.fireTimer(maxHandle);
  assert.deepEqual(flushed, ["one two three"]);
});

test("dispose cancels handles and no later flush can run", () => {
  const queues = makeQueues();
  const flushed: string[] = [];
  const buffer = createStreamingPresentationBuffer({
    initialSource: "",
    onFlush: (source) => flushed.push(source),
    scheduleFrame: queues.scheduleFrame,
    cancelFrame: queues.cancelFrame,
    scheduleTimer: queues.scheduleTimer,
    cancelTimer: queues.cancelTimer,
  });

  buffer.update("still pending", false);
  buffer.dispose();
  assert.equal(queues.counts().frames, 0);
  assert.equal(queues.counts().timers, 0);
  queues.fireFrame();
  queues.fireTimer();
  assert.deepEqual(flushed, []);
});

console.log("streaming-presentation-buffer.test.ts: all assertions passed");
