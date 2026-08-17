import assert from "node:assert/strict";
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

test("natural boundary flushes next frame and idle timer flushes quiet tail", () => {
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

  buffer.update("Sentence.", false);
  queues.fireFrame();
  assert.deepEqual(flushed, ["Sentence."]);

  buffer.update("Sentence. tail", false);
  const idleHandle = queues.timersByDelay(90).at(-1);
  assert.ok(idleHandle, "idle timer is scheduled for the quiet tail");
  queues.fireTimer(idleHandle);
  assert.deepEqual(flushed, ["Sentence.", "Sentence. tail"]);
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
