// Lifecycle ownership of the inbox reminder worker (#6295): one timer, one
// pass in flight, synchronous stop admission, a retained drain, restart
// fencing, coordinated shutdown, and the automations-domain gate. The real
// store, filesystem and catch-up semantics stay in inbox-scheduler.test.ts.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { registerAllStartupWorkersExcept } from "./server/startup-worker-shutdown-fixtures.ts";

type Item = { id: string; status: string; fireAt: string | null; firedAt?: string | null };
type File = { version: number; items: Item[] };

const store = vi.hoisted(() => ({
  file: { version: 1, items: [] as Item[] } as File,
  passes: 0,
  gates: [] as Array<Promise<void>>,
  withInboxLock: vi.fn(),
  loadInbox: vi.fn(),
  computeNextOccurrence: vi.fn(() => null),
}));
vi.mock("@/lib/cave-inbox", () => ({
  withInboxLock: store.withInboxLock,
  loadInbox: store.loadInbox,
  computeNextOccurrence: store.computeNextOccurrence,
}));

type Scheduler = typeof import("./inbox-scheduler.ts") & {
  stopScheduler: () => Promise<void>;
};
let scheduler: Scheduler;
let releases: Array<() => void>;

function holdPass() {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  releases.push(release);
  store.gates.push(gate);
  return release;
}

function dueItem(id: string): Item {
  return { id, status: "pending", fireAt: "2000-01-01T00:00:00.000Z", firedAt: null };
}

beforeEach(async () => {
  vi.useFakeTimers();
  delete (globalThis as { __caveStartupWorkerShutdown?: unknown }).__caveStartupWorkerShutdown;
  delete (globalThis as { __caveInboxScheduler?: unknown }).__caveInboxScheduler;
  vi.resetModules();
  releases = [];
  store.gates.length = 0;
  store.passes = 0;
  store.file = { version: 1, items: [] };
  store.withInboxLock.mockReset().mockImplementation(async (fn: (s: { load: () => Promise<File>; save: (next: File) => Promise<void> }) => Promise<unknown>) => {
    store.passes += 1;
    const gate = store.gates.shift();
    return fn({
      load: async () => { if (gate) await gate; return structuredClone(store.file); },
      save: async next => { store.file = structuredClone(next); },
    });
  });
  store.loadInbox.mockReset().mockImplementation(async () => structuredClone(store.file));
  scheduler = await import("./inbox-scheduler.ts") as Scheduler;
});

afterEach(async () => {
  for (const release of releases) release();
  await Promise.resolve();
  await scheduler.stopScheduler?.();
  vi.clearAllTimers();
  delete (globalThis as { __caveInboxScheduler?: unknown }).__caveInboxScheduler;
  delete (globalThis as { __caveStartupWorkerShutdown?: unknown }).__caveStartupWorkerShutdown;
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

test("repeated starts own one timer, run one catch-up pass, and keep the 15-second cadence", async () => {
  await scheduler.startScheduler();
  await scheduler.startScheduler();
  expect(vi.getTimerCount()).toBe(1);
  expect(store.passes).toBe(1);
  await vi.advanceTimersByTimeAsync(15_000);
  expect(store.passes).toBe(2);
});

test("a slow admitted pass cannot overlap later timer passes", async () => {
  holdPass();
  await scheduler.startScheduler();
  await vi.advanceTimersByTimeAsync(45_000);
  expect(store.passes).toBe(1);
});

test("stop clears admission immediately and retains the admitted delivery", async () => {
  store.file.items.push(dueItem("due"));
  const release = holdPass();
  await scheduler.startScheduler();
  expect(scheduler.stopScheduler).toBeTypeOf("function");
  let drained = false;
  const stopping = scheduler.stopScheduler().then(() => { drained = true; });
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(45_000);
  expect(store.passes).toBe(1);
  expect(drained).toBe(false);
  expect(store.file.items[0].status).toBe("pending");
  release();
  await stopping;
  expect(drained).toBe(true);
  // The pass that was admitted before stop completes its delivery; stop is
  // not a cancellation and the fired item is never left half-written.
  expect(store.file.items[0].status).toBe("fired");
});

test("restart waits for the previous owner's admitted pass", async () => {
  const release = holdPass();
  await scheduler.startScheduler();
  const stopping = scheduler.stopScheduler();
  const restarting = scheduler.startScheduler();
  await Promise.resolve();
  expect(vi.getTimerCount()).toBe(0);
  expect(store.passes).toBe(1);
  release();
  await stopping;
  await restarting;
  expect(vi.getTimerCount()).toBe(1);
  expect(store.passes).toBe(2);
});

test("a later stop fences a restart waiting for the old pass", async () => {
  const release = holdPass();
  await scheduler.startScheduler();
  const firstStop = scheduler.stopScheduler();
  const restarting = scheduler.startScheduler();
  const finalStop = scheduler.stopScheduler();
  release();
  await Promise.all([firstStop, restarting, finalStop]);
  expect(vi.getTimerCount()).toBe(0);
  expect(store.passes).toBe(1);
});

test("a failed pass releases admission for the next interval without a retry storm", async () => {
  store.withInboxLock.mockRejectedValueOnce(new Error("synthetic unreadable inbox"));
  await scheduler.startScheduler();
  await vi.advanceTimersByTimeAsync(0);
  expect(vi.getTimerCount()).toBe(1);
  await vi.advanceTimersByTimeAsync(15_000);
  expect(store.withInboxLock).toHaveBeenCalledTimes(2);
});

test("a request finishing after coordinated shutdown cannot restart reminders", async () => {
  await scheduler.startScheduler();
  const shutdown = await import("./server/startup-worker-shutdown.ts");
  shutdown.registerStartupWorker("inbox-reminders", scheduler.stopScheduler);
  registerAllStartupWorkersExcept("inbox-reminders");
  const result = await shutdown.coordinateStartupWorkerShutdown(async () => undefined);
  expect(result.workers["inbox-reminders"].status).toBe("drained");
  await scheduler.startScheduler();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(vi.getTimerCount()).toBe(0);
  expect(store.passes).toBe(1);
});

test("a disabled automations domain owns no timer and admits no pass; enabling then starts one owner", async () => {
  vi.stubEnv("COVEN_CAVE_AUTOMATIONS_ENABLED", "0");
  store.file.items.push(dueItem("retained"));
  await scheduler.startScheduler();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(vi.getTimerCount()).toBe(0);
  expect(store.passes).toBe(0);
  expect(store.withInboxLock).not.toHaveBeenCalled();
  // Admitted intent is paused, not dropped: the due item is untouched.
  expect(store.file.items[0].status).toBe("pending");
  vi.unstubAllEnvs();
  await scheduler.startScheduler();
  expect(vi.getTimerCount()).toBe(1);
  expect(store.passes).toBe(1);
  expect(store.file.items[0].status).toBe("fired");
});
