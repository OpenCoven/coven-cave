import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyDaemonHealthResponse,
  createDaemonEventWatcher,
  type DaemonClassification,
} from "./daemon-event-watcher.ts";

function sequence(...values: DaemonClassification[]) {
  let index = 0;
  return async () => values[Math.min(index++, values.length - 1)]!;
}

test("publishes only when the observed classification changes", async () => {
  const published: string[] = [];
  const watcher = createDaemonEventWatcher({
    probe: sequence("healthy", "healthy", "offline", "offline", "healthy"),
    publish: () => published.push("daemon"),
  });
  for (let i = 0; i < 5; i += 1) await watcher.tick();
  assert.deepEqual(published, ["daemon", "daemon", "daemon"], "first sight, healthy→offline, offline→healthy");
  assert.equal(watcher.current(), "healthy");
});

test("a probe that throws reads as offline, and probes never overlap", async () => {
  let release!: () => void;
  let calls = 0;
  const published: string[] = [];
  const watcher = createDaemonEventWatcher({
    probe: () => {
      calls += 1;
      return new Promise<DaemonClassification>((_resolve, reject) => {
        release = () => reject(new Error("socket gone"));
      });
    },
    publish: () => published.push("daemon"),
  });
  const first = watcher.tick();
  const second = watcher.tick();
  assert.equal(calls, 1, "a slow probe is joined, not repeated");
  release();
  await Promise.all([first, second]);
  assert.equal(watcher.current(), "offline");
  assert.deepEqual(published, ["daemon"]);
});

test("the classifier separates offline from degraded", () => {
  assert.equal(classifyDaemonHealthResponse({ ok: true, status: 200, data: { ok: true } } as never), "healthy");
  assert.equal(classifyDaemonHealthResponse({ ok: true, status: 200, data: { ok: false } } as never), "degraded");
  assert.equal(classifyDaemonHealthResponse({ ok: false, status: 503, data: null } as never), "degraded");
  assert.equal(classifyDaemonHealthResponse({ ok: false, status: 0, data: null } as never), "offline");
});

test("start schedules the next probe after each one, and stop cancels it", async () => {
  const timers: { callback: () => void; ms: number }[] = [];
  let cleared = 0;
  const watcher = createDaemonEventWatcher({
    probe: sequence("healthy"),
    publish: () => {},
    intervalMs: 5_000,
    setTimeout: (callback, ms) => { timers.push({ callback, ms }); return timers.length; },
    clearTimeout: () => { cleared += 1; },
  });
  watcher.start();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(timers.length, 1);
  assert.equal(timers[0]!.ms, 5_000);
  watcher.stop();
  assert.equal(cleared, 1);
});
