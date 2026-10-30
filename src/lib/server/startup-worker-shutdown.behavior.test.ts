import { afterEach, beforeEach, expect, test, vi } from "vitest";
import * as shutdown from "./startup-worker-shutdown";

function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

beforeEach(() => {
  vi.useFakeTimers();
  delete (globalThis as { __caveStartupWorkerShutdown?: unknown }).__caveStartupWorkerShutdown;
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  delete (globalThis as { __caveStartupWorkerShutdown?: unknown }).__caveStartupWorkerShutdown;
});

test("separate module instances share the custom coordinator and registered owners", async () => {
  shutdown.ownStartupWorkerShutdown();
  vi.resetModules();
  const other = await import("./startup-worker-shutdown");
  expect(other.isStartupWorkerShutdownCoordinated()).toBe(true);
  const stop = vi.fn().mockResolvedValue(undefined);
  expect(other.registerStartupWorker("scheduled-chat", stop)).toBe(true);
  shutdown.registerStartupWorker("backup-sync", async () => undefined);
  const result = await shutdown.coordinateStartupWorkerShutdown(async () => undefined);
  expect(stop).toHaveBeenCalledOnce();
  expect(result.workers["scheduled-chat"].status).toBe("drained");
});

test("HTTP close and worker drains start together; HTTP close cannot truncate a slow backup", async () => {
  const held = gate();
  const stop = vi.fn(() => held.promise);
  shutdown.registerStartupWorker("scheduled-chat", async () => undefined);
  shutdown.registerStartupWorker("backup-sync", stop);
  const close = vi.fn().mockResolvedValue(undefined);
  let finished = false;
  const pending = shutdown.coordinateStartupWorkerShutdown(close).then(result => { finished = true; return result; });
  expect(close).toHaveBeenCalledOnce();
  expect(stop).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(2_000);
  expect(finished).toBe(false);
  held.release();
  const result = await pending;
  expect(result.http.status).toBe("drained");
  expect(result.workers["backup-sync"].status).toBe("drained");
  expect(vi.getTimerCount()).toBe(0);
});

test("deadline reports pending work without cancelling or replaying it", async () => {
  const held = gate();
  let completed = false;
  const stop = vi.fn(async () => { await held.promise; completed = true; });
  shutdown.registerStartupWorker("scheduled-chat", async () => undefined);
  shutdown.registerStartupWorker("backup-sync", stop);
  const close = vi.fn().mockResolvedValue(undefined);
  const pending = shutdown.coordinateStartupWorkerShutdown(close);
  expect(shutdown.coordinateStartupWorkerShutdown(close)).toBe(pending);
  await vi.advanceTimersByTimeAsync(3_000);
  const result = await pending;
  expect(result.workers["backup-sync"].status).toBe("pending");
  expect(completed).toBe(false);
  held.release();
  await vi.advanceTimersByTimeAsync(0);
  expect(completed).toBe(true);
  expect(stop).toHaveBeenCalledOnce();
  expect(close).toHaveBeenCalledOnce();
  // The deadline receipt is a snapshot, not a later rewritten success claim.
  expect(result.workers["backup-sync"].status).toBe("pending");
});

test("failed callbacks and an unavailable owner remain distinct", async () => {
  shutdown.registerStartupWorker("backup-sync", () => { throw new Error("synthetic stop failure"); });
  const pending = shutdown.coordinateStartupWorkerShutdown(async () => { throw new Error("synthetic HTTP failure"); });
  await vi.advanceTimersByTimeAsync(3_000);
  const result = await pending;
  expect(result.http).toEqual({ status: "failed", error: "synthetic HTTP failure" });
  expect(result.workers["backup-sync"]).toEqual({ status: "failed", error: "synthetic stop failure" });
  expect(result.workers["scheduled-chat"].status).toBe("unavailable");
});

test("a worker registered during shutdown drains and cannot start afterward", async () => {
  shutdown.registerStartupWorker("scheduled-chat", async () => undefined);
  const pending = shutdown.coordinateStartupWorkerShutdown(async () => undefined);
  await vi.advanceTimersByTimeAsync(100);
  const stop = vi.fn().mockResolvedValue(undefined);
  expect(shutdown.registerStartupWorker("backup-sync", stop)).toBe(false);
  const result = await pending;
  expect(stop).toHaveBeenCalledOnce();
  expect(result.workers["backup-sync"].status).toBe("drained");
});

test("a slow HTTP close is reported honestly after workers drain", async () => {
  const held = gate();
  shutdown.registerStartupWorker("scheduled-chat", async () => undefined);
  shutdown.registerStartupWorker("backup-sync", async () => undefined);
  const pending = shutdown.coordinateStartupWorkerShutdown(() => held.promise);
  await vi.advanceTimersByTimeAsync(3_000);
  expect((await pending).http.status).toBe("pending");
  held.release();
});

test("a packaged parent lease observes with its own shorter deadline, and the first deadline wins", async () => {
  const held = gate();
  shutdown.registerStartupWorker("scheduled-chat", async () => undefined);
  shutdown.registerStartupWorker("backup-sync", () => held.promise);
  const pending = shutdown.coordinateStartupWorkerShutdown(async () => undefined, { deadlineMs: 400 });
  expect(shutdown.coordinateStartupWorkerShutdown(async () => undefined, { deadlineMs: 3_000 })).toBe(pending);
  let finished = false;
  void pending.then(() => { finished = true; });
  await vi.advanceTimersByTimeAsync(399);
  expect(finished).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect((await pending).workers["backup-sync"].status).toBe("pending");
  held.release();
});
