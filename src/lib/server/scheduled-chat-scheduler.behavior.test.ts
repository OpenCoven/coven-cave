import { afterEach, beforeEach, expect, test, vi } from "vitest";

const store = vi.hoisted(() => ({ tick: vi.fn() }));
vi.mock("./scheduled-chat-store.ts", () => ({
  createScheduledChatStore: () => ({ tick: store.tick }),
}));

type Scheduler = typeof import("./scheduled-chat-scheduler.ts") & {
  stopScheduledChatScheduler: () => Promise<void>;
};
let scheduler: Scheduler;
let releases: Array<() => void>;

function holdPass() {
  let release!: () => void;
  const pass = new Promise<void>(resolve => { release = resolve; });
  releases.push(release);
  store.tick.mockReturnValueOnce(pass);
  return release;
}

beforeEach(async () => {
  vi.useFakeTimers();
  delete (globalThis as { __caveStartupWorkerShutdown?: unknown }).__caveStartupWorkerShutdown;
  vi.stubEnv("NEXT_PHASE", "phase-production-server");
  vi.resetModules();
  store.tick.mockReset().mockResolvedValue(undefined);
  releases = [];
  scheduler = await import("./scheduled-chat-scheduler.ts") as Scheduler;
});

afterEach(async () => {
  for (const release of releases) release();
  await Promise.resolve();
  await scheduler.stopScheduledChatScheduler?.();
  vi.clearAllTimers();
  // The old timer exists on the unchanged baseline. Remove only this test's
  // synthetic owner after every case so one failure cannot affect the next.
  delete (globalThis as { __caveScheduledChatTimer?: unknown }).__caveScheduledChatTimer;
  delete (globalThis as { __caveStartupWorkerShutdown?: unknown }).__caveStartupWorkerShutdown;
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

test("repeated starts own one timer and preserve the 15-second cadence", async () => {
  await scheduler.startScheduledChatScheduler();
  await scheduler.startScheduledChatScheduler();
  expect(vi.getTimerCount()).toBe(1);
  expect(store.tick).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(15_000);
  expect(store.tick).toHaveBeenCalledTimes(2);
});

test("a slow admitted pass cannot overlap later timer passes", async () => {
  holdPass();
  await scheduler.startScheduledChatScheduler();
  await vi.advanceTimersByTimeAsync(45_000);
  expect(store.tick).toHaveBeenCalledTimes(1);
});

test("stop clears admission immediately and waits for the admitted pass", async () => {
  const release = holdPass();
  await scheduler.startScheduledChatScheduler();
  expect(scheduler.stopScheduledChatScheduler).toBeTypeOf("function");
  let drained = false;
  const stopping = scheduler.stopScheduledChatScheduler().then(() => { drained = true; });
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(45_000);
  expect(store.tick).toHaveBeenCalledTimes(1);
  expect(drained).toBe(false);
  release();
  await stopping;
  expect(drained).toBe(true);
});

test("restart waits for the previous owner's admitted work", async () => {
  const release = holdPass();
  await scheduler.startScheduledChatScheduler();
  expect(scheduler.stopScheduledChatScheduler).toBeTypeOf("function");
  const stopping = scheduler.stopScheduledChatScheduler();
  const restarting = scheduler.startScheduledChatScheduler();
  await Promise.resolve();
  expect(vi.getTimerCount()).toBe(0);
  expect(store.tick).toHaveBeenCalledTimes(1);
  release();
  await stopping;
  await restarting;
  expect(vi.getTimerCount()).toBe(1);
  expect(store.tick).toHaveBeenCalledTimes(2);
});

test("a later stop fences a restart waiting for the old pass", async () => {
  const release = holdPass();
  await scheduler.startScheduledChatScheduler();
  expect(scheduler.stopScheduledChatScheduler).toBeTypeOf("function");
  const firstStop = scheduler.stopScheduledChatScheduler();
  const restarting = scheduler.startScheduledChatScheduler();
  const finalStop = scheduler.stopScheduledChatScheduler();
  release();
  await Promise.all([firstStop, restarting, finalStop]);
  expect(vi.getTimerCount()).toBe(0);
  expect(store.tick).toHaveBeenCalledTimes(1);
});

test("production compilation starts no timer or scheduled pass", async () => {
  vi.stubEnv("NEXT_PHASE", "phase-production-build");
  await scheduler.startScheduledChatScheduler();
  expect(vi.getTimerCount()).toBe(0);
  expect(store.tick).not.toHaveBeenCalled();
});

test("a request finishing after coordinated shutdown cannot restart scheduled work", async () => {
  await scheduler.startScheduledChatScheduler();
  const shutdown = await import("./startup-worker-shutdown");
  shutdown.registerStartupWorker("scheduled-chat", scheduler.stopScheduledChatScheduler);
  shutdown.registerStartupWorker("backup-sync", async () => undefined);
  await shutdown.coordinateStartupWorkerShutdown(async () => undefined);
  await scheduler.startScheduledChatScheduler();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(vi.getTimerCount()).toBe(0);
  expect(store.tick).toHaveBeenCalledTimes(1);
});
