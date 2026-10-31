import assert from "node:assert/strict";
import test from "node:test";

import { createPointerPressTracker } from "./pointer-press.ts";

// A minimal capture-phase event target with a manual task queue, so each test
// can say exactly which events fire before the deferred callback runs.
function fakeWindow() {
  const listeners = new Map<string, Set<() => void>>();
  const tasks = new Map<number, () => void>();
  let nextId = 1;
  return {
    addEventListener(type: string, fn: () => void) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: () => void) {
      listeners.get(type)?.delete(fn);
    },
    setTimeout(fn: () => void) {
      const id = nextId++;
      tasks.set(id, fn);
      return id;
    },
    clearTimeout(id: number) {
      tasks.delete(id);
    },
    dispatch(type: string) {
      for (const fn of [...(listeners.get(type) ?? [])]) fn();
    },
    runTasks() {
      const queued = [...tasks.values()];
      tasks.clear();
      for (const fn of queued) fn();
    },
    listenerCount(type: string) {
      return listeners.get(type)?.size ?? 0;
    },
  };
}

function setup() {
  const win = fakeWindow();
  const tracker = createPointerPressTracker(win as unknown as Window);
  return { win, tracker };
}

test("with no press in progress the callback runs on the next task", () => {
  const { win, tracker } = setup();
  let ran = 0;
  tracker.afterPress(() => (ran += 1));
  assert.equal(ran, 0, "never synchronously, so the current event finishes first");
  win.runTasks();
  assert.equal(ran, 1);
});

test("during a press the callback waits for the release, then a fresh task", () => {
  const { win, tracker } = setup();
  let ran = 0;
  win.dispatch("pointerdown");
  tracker.afterPress(() => (ran += 1));
  win.runTasks();
  assert.equal(ran, 0, "the press is still down: the control must stay where it was pressed");
  win.dispatch("pointerup");
  assert.equal(ran, 0, "not inside pointerup: the click is dispatched after it");
  win.runTasks();
  assert.equal(ran, 1);
});

test("a cancelled press also releases the wait", () => {
  const { win, tracker } = setup();
  let ran = 0;
  win.dispatch("pointerdown");
  tracker.afterPress(() => (ran += 1));
  win.dispatch("pointercancel");
  win.runTasks();
  assert.equal(ran, 1);
});

test("cancel stops a pending callback, waiting or queued", () => {
  const { win, tracker } = setup();
  let ran = 0;
  win.dispatch("pointerdown");
  const cancelWaiting = tracker.afterPress(() => (ran += 1));
  cancelWaiting();
  win.dispatch("pointerup");
  win.runTasks();

  const cancelQueued = tracker.afterPress(() => (ran += 1));
  cancelQueued();
  win.runTasks();
  assert.equal(ran, 0);
  assert.equal(win.listenerCount("pointerup"), 1, "only the tracker's own release listener remains");
});

test("dispose removes the tracker's listeners", () => {
  const { win, tracker } = setup();
  tracker.dispose();
  assert.equal(win.listenerCount("pointerdown"), 0);
  assert.equal(win.listenerCount("pointerup"), 0);
  assert.equal(win.listenerCount("pointercancel"), 0);
});
