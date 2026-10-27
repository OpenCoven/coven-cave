// The packaged desktop shell ends the Cave server by closing a private stdin
// pipe (its exact parent lease), not by a signal. Worker drain must run on that
// path too, beside direct-run teardown and inside the same lease; the lease
// expiring reports incomplete drain and never cancels or replays admitted work.
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { coordinateStartupWorkerShutdown, registerStartupWorker } from "./lib/server/startup-worker-shutdown";

beforeEach(() => {
  vi.useFakeTimers();
  delete (globalThis as { __caveStartupWorkerShutdown?: unknown }).__caveStartupWorkerShutdown;
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  delete (globalThis as { __caveStartupWorkerShutdown?: unknown }).__caveStartupWorkerShutdown;
});

function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

/** Load the packaged parent-lease section of server.ts into a sandbox. */
function packagedLease(platform: "darwin" | "win32", terminateDirectRuns?: () => Promise<void>) {
  const source = readFileSync("server.ts", "utf8");
  const start = source.indexOf("const PACKAGED_CHILD_SHUTDOWN_BUDGET_MS");
  const end = source.indexOf("// Recent-output ring replayed", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const stdin = Object.assign(new EventEmitter(), { resume: vi.fn() });
  const process = {
    platform,
    pid: 4242,
    env: { COVEN_CAVE_PARENT_WATCHDOG: "stdin-eof" },
    stdin,
    kill: vi.fn(),
    exit: vi.fn(),
  };
  const sandbox = {
    process,
    sessions: new Map(),
    coordinateStartupWorkerShutdown,
    cleanupStandaloneClientV1Discovery: vi.fn(),
    console: { warn: vi.fn(), error: vi.fn() },
    setTimeout,
    clearTimeout,
    __covenCaveTerminateCopilotFlowRuns: terminateDirectRuns,
  };
  runInNewContext(transformSync(source.slice(start, end), { loader: "ts", format: "esm", target: "node24" }).code, sandbox);
  return { ...sandbox, stdin };
}

test("parent EOF drains workers beside direct-run teardown and kills the Unix group only after both settle", async () => {
  const direct = gate();
  const worker = gate();
  const terminateDirectRuns = vi.fn(() => direct.promise);
  const stop = vi.fn(() => worker.promise);
  registerStartupWorker("inbox-reminders", async () => undefined);
  registerStartupWorker("scheduled-chat", async () => undefined);
  registerStartupWorker("backup-sync", stop);
  const lease = packagedLease("darwin", terminateDirectRuns);
  expect(lease.stdin.resume).toHaveBeenCalledOnce();

  lease.stdin.emit("end");
  lease.stdin.emit("end");
  await vi.advanceTimersByTimeAsync(0);
  expect(terminateDirectRuns).toHaveBeenCalledOnce();
  expect(stop).toHaveBeenCalledOnce();
  expect(lease.process.kill).not.toHaveBeenCalled();

  direct.release();
  await vi.advanceTimersByTimeAsync(0);
  expect(lease.process.kill).not.toHaveBeenCalled();

  worker.release();
  await vi.advanceTimersByTimeAsync(0);
  expect(lease.process.kill).toHaveBeenCalledExactlyOnceWith(-4242, "SIGKILL");
  expect(lease.cleanupStandaloneClientV1Discovery).toHaveBeenCalledOnce();
  expect(lease.console.warn).not.toHaveBeenCalled();
  expect(lease.console.error).not.toHaveBeenCalled();
  expect(lease.process.exit).not.toHaveBeenCalled();
});

test("a worker that outlives the parent lease is reported, never replayed, and the group still dies on time", async () => {
  const held = gate();
  const stop = vi.fn(() => held.promise);
  registerStartupWorker("inbox-reminders", async () => undefined);
  registerStartupWorker("scheduled-chat", async () => undefined);
  registerStartupWorker("backup-sync", stop);
  const lease = packagedLease("darwin", vi.fn(async () => undefined));

  lease.stdin.emit("end");
  await vi.advanceTimersByTimeAsync(1_199);
  expect(lease.process.kill).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(lease.process.kill).toHaveBeenCalledExactlyOnceWith(-4242, "SIGKILL");
  expect(stop).toHaveBeenCalledOnce();
  expect(lease.console.warn).toHaveBeenCalledWith(
    "[startup-workers] Worker drain did not finish inside the native parent lease:",
    expect.objectContaining({ workers: expect.objectContaining({ "backup-sync": { status: "pending" } }) }),
  );
  // Direct runs settled, so their fail-closed boundary is not misreported.
  expect(lease.console.error).not.toHaveBeenCalled();
});

test("an unproved direct-run tree keeps its fail-closed report while workers drained", async () => {
  registerStartupWorker("inbox-reminders", async () => undefined);
  registerStartupWorker("scheduled-chat", async () => undefined);
  registerStartupWorker("backup-sync", async () => undefined);
  const lease = packagedLease("darwin", vi.fn(() => new Promise<void>(() => undefined)));

  lease.stdin.emit("end");
  await vi.advanceTimersByTimeAsync(1_200);
  expect(lease.process.kill).toHaveBeenCalledExactlyOnceWith(-4242, "SIGKILL");
  expect(lease.console.error).toHaveBeenCalledWith(
    "[cave] direct Copilot process-tree shutdown could not be proved",
    // The sandbox has its own Error realm, so match the message instead.
    expect.objectContaining({ message: "direct Copilot shutdown exceeded its native parent lease" }),
  );
  expect(lease.console.warn).not.toHaveBeenCalled();
});

test("on Windows the same lease drains workers and ends with a normal exit for the Job to reap", async () => {
  const worker = gate();
  const stop = vi.fn(() => worker.promise);
  const terminateDirectRuns = vi.fn(async () => undefined);
  registerStartupWorker("inbox-reminders", async () => undefined);
  registerStartupWorker("scheduled-chat", async () => undefined);
  registerStartupWorker("backup-sync", stop);
  const lease = packagedLease("win32", terminateDirectRuns);
  expect(lease.stdin.resume).toHaveBeenCalledOnce();

  lease.stdin.emit("end");
  await vi.advanceTimersByTimeAsync(0);
  expect(terminateDirectRuns).toHaveBeenCalledOnce();
  expect(stop).toHaveBeenCalledOnce();
  expect(lease.process.exit).not.toHaveBeenCalled();

  worker.release();
  await vi.advanceTimersByTimeAsync(0);
  expect(lease.process.exit).toHaveBeenCalledExactlyOnceWith(0);
  expect(lease.process.kill).not.toHaveBeenCalled();
  expect(lease.cleanupStandaloneClientV1Discovery).toHaveBeenCalledOnce();
});

test("on Windows an unfinished drain exits unsuccessfully at the lease without cancelling the work", async () => {
  const held = gate();
  let completed = false;
  const stop = vi.fn(async () => { await held.promise; completed = true; });
  registerStartupWorker("inbox-reminders", async () => undefined);
  registerStartupWorker("scheduled-chat", async () => undefined);
  registerStartupWorker("backup-sync", stop);
  const lease = packagedLease("win32");

  lease.stdin.emit("error", new Error("pipe gone"));
  // Windows keeps a shorter drain window beneath the native Job fallback.
  await vi.advanceTimersByTimeAsync(399);
  expect(lease.process.exit).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(lease.process.exit).toHaveBeenCalledExactlyOnceWith(1);
  expect(completed).toBe(false);
  expect(stop).toHaveBeenCalledOnce();
  held.release();
  await vi.advanceTimersByTimeAsync(0);
  expect(completed).toBe(true);
});

test("the watchdog is not installed without the packaged lease environment", () => {
  const source = readFileSync("server.ts", "utf8");
  const start = source.indexOf("const PACKAGED_CHILD_SHUTDOWN_BUDGET_MS");
  const end = source.indexOf("// Recent-output ring replayed", start);
  const stdin = Object.assign(new EventEmitter(), { resume: vi.fn() });
  runInNewContext(transformSync(source.slice(start, end), { loader: "ts", format: "esm", target: "node24" }).code, {
    process: { platform: "win32", env: {}, stdin, pid: 1, kill: vi.fn(), exit: vi.fn() },
    sessions: new Map(), coordinateStartupWorkerShutdown, cleanupStandaloneClientV1Discovery: vi.fn(),
    console: { warn: vi.fn(), error: vi.fn() }, setTimeout, clearTimeout,
  });
  expect(stdin.resume).not.toHaveBeenCalled();
  expect(stdin.listenerCount("end")).toBe(0);
});

test("a reminder delivery that outlives the parent lease is reported, never replayed, and the group still dies on time", async () => {
  const held = gate();
  let completed = false;
  const stop = vi.fn(async () => { await held.promise; completed = true; });
  registerStartupWorker("inbox-reminders", stop);
  registerStartupWorker("scheduled-chat", async () => undefined);
  registerStartupWorker("backup-sync", async () => undefined);
  const lease = packagedLease("darwin", vi.fn(async () => undefined));

  lease.stdin.emit("end");
  await vi.advanceTimersByTimeAsync(1_199);
  expect(lease.process.kill).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(lease.process.kill).toHaveBeenCalledExactlyOnceWith(-4242, "SIGKILL");
  expect(stop).toHaveBeenCalledOnce();
  expect(completed).toBe(false);
  expect(lease.console.warn).toHaveBeenCalledWith(
    "[startup-workers] Worker drain did not finish inside the native parent lease:",
    expect.objectContaining({ workers: expect.objectContaining({ "inbox-reminders": { status: "pending" } }) }),
  );
  held.release();
  await vi.advanceTimersByTimeAsync(0);
  expect(completed).toBe(true);
  expect(stop).toHaveBeenCalledOnce();
});

test("on Windows the reminder worker drains inside the same 400 ms lease window", async () => {
  const worker = gate();
  const stop = vi.fn(() => worker.promise);
  registerStartupWorker("inbox-reminders", stop);
  registerStartupWorker("scheduled-chat", async () => undefined);
  registerStartupWorker("backup-sync", async () => undefined);
  const lease = packagedLease("win32", vi.fn(async () => undefined));

  lease.stdin.emit("end");
  await vi.advanceTimersByTimeAsync(0);
  expect(stop).toHaveBeenCalledOnce();
  expect(lease.process.exit).not.toHaveBeenCalled();
  worker.release();
  await vi.advanceTimersByTimeAsync(0);
  expect(lease.process.exit).toHaveBeenCalledExactlyOnceWith(0);
});

for (const [platform, deadline] of [["darwin", 1_200], ["win32", 400]] as const) {
  test(`${platform} reports an unavailable worker when the parent lease expires during startup`, async () => {
    registerStartupWorker("inbox-reminders", async () => undefined);
    registerStartupWorker("scheduled-chat", async () => undefined);
    const lease = packagedLease(platform);
    lease.stdin.emit("end");
    await vi.advanceTimersByTimeAsync(deadline);
    expect(lease.console.warn).toHaveBeenCalledWith(
      "[startup-workers] Worker drain did not finish inside the native parent lease:",
      expect.objectContaining({ workers: {
        "inbox-reminders": { status: "drained" },
        "scheduled-chat": { status: "drained" },
        "backup-sync": { status: "unavailable" },
      } }),
    );
    if (platform === "win32") expect(lease.process.exit).toHaveBeenCalledExactlyOnceWith(1);
    else expect(lease.process.kill).toHaveBeenCalledExactlyOnceWith(-4242, "SIGKILL");
    const lateStop = vi.fn(async () => undefined);
    expect(registerStartupWorker("backup-sync", lateStop)).toBe(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(lateStop).toHaveBeenCalledOnce();
  });
}
