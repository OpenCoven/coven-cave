import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { registerAllStartupWorkersExcept } from "./lib/server/startup-worker-shutdown-fixtures";
import { coordinateStartupWorkerShutdown, registerStartupWorker } from "./lib/server/startup-worker-shutdown";

beforeEach(() => {
  vi.useFakeTimers();
  delete (globalThis as { __caveStartupWorkerShutdown?: unknown }).__caveStartupWorkerShutdown;
});
afterEach(() => {
  vi.clearAllTimers(); vi.useRealTimers();
  delete (globalThis as { __caveStartupWorkerShutdown?: unknown }).__caveStartupWorkerShutdown;
});
function serverShutdown(ready = true) {
  const source = readFileSync("server.ts", "utf8");
  const section = source.slice(source.indexOf("let httpShutdownStarted = false;"), source.indexOf("\nprocess.", source.indexOf("let httpShutdownStarted = false;")));
  const exit = vi.fn();
  const close = vi.fn((callback: () => void) => { callback(); });
  const sandbox = {
    coordinateStartupWorkerShutdown, closeHttpForShutdown: ready ? () => new Promise<void>(resolve => { close(resolve); }) : undefined, cleanupStandaloneClientV1Discovery: vi.fn(),
    terminatePtySessions: vi.fn(), eventBroker: { shutdown: vi.fn() },
    process: { exit }, server: ready ? { close, listening: true } : undefined, setTimeout, clearTimeout,
    console: { warn: vi.fn(), error: vi.fn() }, shutdown: () => undefined,
  };
  runInNewContext(transformSync(`${section}\nglobalThis.shutdown = shutdownHttpServer;`, {
    loader: "ts", format: "esm", target: "node24",
  }).code, sandbox);
  return { ...sandbox, exit, close };
}

test("the custom server waits for the quit drain even after HTTP closes", async () => {
  let finish!: () => void;
  const held = new Promise<void>(resolve => { finish = resolve; });
  registerAllStartupWorkersExcept("backup-sync");
  registerStartupWorker("backup-sync", () => held);
  const server = serverShutdown();
  server.shutdown();
  server.shutdown();
  expect(server.close).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(2_000);
  expect(server.exit).not.toHaveBeenCalled();
  finish();
  await vi.advanceTimersByTimeAsync(0);
  expect(server.exit).toHaveBeenCalledExactlyOnceWith(0);
});

test("the custom server exits unsuccessfully when the shared deadline leaves work pending", async () => {
  registerAllStartupWorkersExcept("backup-sync");
  registerStartupWorker("backup-sync", () => new Promise<void>(() => undefined));
  const server = serverShutdown();
  server.shutdown();
  await vi.advanceTimersByTimeAsync(3_000);
  expect(server.exit).toHaveBeenCalledExactlyOnceWith(1);
  expect(server.console.warn).toHaveBeenCalledWith("[startup-workers] Incomplete shutdown:", expect.objectContaining({
    workers: expect.objectContaining({ "backup-sync": { status: "pending" } }),
  }));
});


test("signals own shutdown before Next preparation can start workers", () => {
  const source = readFileSync("server.ts", "utf8");
  expect(source.indexOf('process.on("SIGTERM", shutdownHttpServer)')).toBeLessThan(source.indexOf("await app.prepare();"));
});

test("a shutdown during preparation drains registered workers without an HTTP listener", async () => {
  registerAllStartupWorkersExcept();
  const server = serverShutdown(false);
  server.shutdown();
  await vi.advanceTimersByTimeAsync(0);
  expect(server.close).not.toHaveBeenCalled();
  expect(server.exit).toHaveBeenCalledExactlyOnceWith(0);
});

test("the custom server waits for an admitted reminder delivery even after HTTP closes", async () => {
  let finish!: () => void;
  const held = new Promise<void>(resolve => { finish = resolve; });
  registerStartupWorker("inbox-reminders", () => held);
  registerAllStartupWorkersExcept("inbox-reminders");
  const server = serverShutdown();
  server.shutdown();
  expect(server.close).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(2_000);
  expect(server.exit).not.toHaveBeenCalled();
  finish();
  await vi.advanceTimersByTimeAsync(0);
  expect(server.exit).toHaveBeenCalledExactlyOnceWith(0);
});

test("a reminder delivery that outlives the shared deadline is reported, not cancelled", async () => {
  registerStartupWorker("inbox-reminders", () => new Promise<void>(() => undefined));
  registerAllStartupWorkersExcept("inbox-reminders");
  const server = serverShutdown();
  server.shutdown();
  await vi.advanceTimersByTimeAsync(3_000);
  expect(server.exit).toHaveBeenCalledExactlyOnceWith(1);
  expect(server.console.warn).toHaveBeenCalledWith("[startup-workers] Incomplete shutdown:", expect.objectContaining({
    workers: expect.objectContaining({ "inbox-reminders": { status: "pending" } }),
  }));
});
