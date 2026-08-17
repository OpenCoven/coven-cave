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

test("plain newlines stay quiet while completed list and fence markers queue a frame", () => {
  const scenarios = [
    {
      label: "sentence",
      updates: ["Alpha."],
      frameCount: 1,
    },
    {
      label: "plain newline",
      updates: ["Alpha\nBeta"],
      frameCount: 0,
    },
    {
      label: "unordered list",
      updates: ["Alpha\n-", "Alpha\n- beta"],
      frameCount: 1,
    },
    {
      label: "ordered list",
      updates: ["Alpha\n1.", "Alpha\n1. beta"],
      frameCount: 1,
    },
    {
      label: "backtick fence",
      updates: ["Alpha\n```", "Alpha\n```ts"],
      frameCount: 1,
    },
    {
      label: "tilde fence",
      updates: ["Alpha\n~~~", "Alpha\n~~~ts"],
      frameCount: 1,
    },
  ] as const;

  for (const scenario of scenarios) {
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

    buffer.update("Alpha", false);
    queues.fireFrame();
    assert.deepEqual(flushed, ["Alpha"], `${scenario.label}: initial visible progress should still coalesce once`);

    for (const update of scenario.updates) {
      buffer.update(update, false);
    }

    assert.equal(queues.counts().frames, scenario.frameCount, `${scenario.label}: marker recognition, not newline alone, controls frame scheduling`);
    assert.equal(queues.timersByDelay(90).length, 1, `${scenario.label}: idle timer stays resettable`);
    assert.equal(queues.timersByDelay(180).length, 1, `${scenario.label}: max timer remains singular`);

    if (scenario.frameCount === 1) {
      queues.fireFrame();
      assert.deepEqual(flushed.at(-1), scenario.updates.at(-1), `${scenario.label}: the queued frame flushes the completed boundary snapshot`);
    }
  }
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
