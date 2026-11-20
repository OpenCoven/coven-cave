import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import fsPromises from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const archive = vi.hoisted(() => ({ build: vi.fn() }));
vi.mock("@/lib/server/backup-archive", () => ({ buildBackupArchive: archive.build }));
vi.mock("@/lib/local-encrypted-vault", () => ({
  deleteLocalEncryptedSecret: vi.fn(), setLocalEncryptedSecret: vi.fn(),
  getLocalEncryptedSecret: () => "synthetic backup passphrase", hasLocalEncryptedSecret: () => true,
}));

type Backup = typeof import("./backup-sync.ts") & {
  stopBackupSyncScheduler: (options?: { pushOnQuit?: boolean }) => Promise<void>;
};
let backup: Backup;
let fixture: string;
let statePath: string;
let releases: Array<() => void>;
let pendingReads: Set<Promise<unknown>>;
let holdRead: Promise<void> | undefined;
let readSpy: ReturnType<typeof vi.spyOn>;
const TICK_MS = 15 * 60_000;

function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  releases.push(release);
  return { promise, release };
}

async function configure(enabled: boolean, lastSuccessAt: string | null = null, intervalHours = 24) {
  await writeFile(statePath, JSON.stringify({
    version: 1,
    config: { ...backup.defaultBackupSyncConfig(), enabled, intervalHours, directory: path.join(fixture, "snapshots") },
    status: { lastSuccessAt },
  }));
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("NEXT_PHASE", "phase-production-server");
  fixture = await mkdtemp(path.join(tmpdir(), "c6-backup-"));
  vi.stubEnv("COVEN_HOME", path.join(fixture, "coven"));
  vi.stubEnv("COVEN_CAVE_HOME", path.join(fixture, "coven", "cave"));
  statePath = path.join(fixture, "coven", "cave", "backup-sync.json");
  await mkdir(path.dirname(statePath), { recursive: true });
  releases = [];
  pendingReads = new Set();
  holdRead = undefined;
  archive.build.mockReset().mockResolvedValue({ archive: Buffer.from("synthetic archive") });
  const originalRead = fsPromises.readFile;
  readSpy = vi.spyOn(fsPromises, "readFile").mockImplementation((...args: Parameters<typeof fsPromises.readFile>) => {
    const pending = Reflect.apply(originalRead, fsPromises, args);
    if (args[0] !== statePath) return pending;
    const held = holdRead;
    holdRead = undefined;
    const observed = pending.then(async bytes => { await held; return bytes; });
    pendingReads.add(observed);
    void observed.then(() => pendingReads.delete(observed), () => pendingReads.delete(observed));
    return observed;
  });
  syncBuiltinESMExports();
  vi.resetModules();
  backup = await import("./backup-sync.ts") as Backup;
});

afterEach(async () => {
  vi.clearAllTimers();
  for (const release of releases) release();
  await backup.stopBackupSyncScheduler?.();
  do {
    await Promise.allSettled([...pendingReads, globalThis.__backupSyncInFlight]);
    await Promise.resolve();
  } while (pendingReads.size || globalThis.__backupSyncInFlight);
  delete (globalThis as { __backupSyncSchedulerStarted?: boolean }).__backupSyncSchedulerStarted;
  delete globalThis.__backupSyncInFlight;
  delete globalThis.__backupSyncQuitHookInstalled;
  delete (globalThis as { __caveStartupWorkerShutdown?: unknown }).__caveStartupWorkerShutdown;
  vi.restoreAllMocks();
  delete (globalThis as { __backupSyncScheduler?: unknown }).__backupSyncScheduler;
  readSpy.mockRestore();
  syncBuiltinESMExports();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  await rm(fixture, { recursive: true, force: true });
});

test("missing configuration starts no recurring backup work", async () => {
  await backup.startBackupSyncScheduler();
  expect(vi.getTimerCount()).toBe(0);
  const reads = readSpy.mock.calls.length;
  await vi.advanceTimersByTimeAsync(TICK_MS * 3);
  expect(readSpy).toHaveBeenCalledTimes(reads);
  expect(archive.build).not.toHaveBeenCalled();
});

test("disabled configuration starts no recurring backup work", async () => {
  await configure(false);
  await backup.startBackupSyncScheduler();
  expect(vi.getTimerCount()).toBe(0);
  const reads = readSpy.mock.calls.length;
  await vi.advanceTimersByTimeAsync(TICK_MS * 3);
  expect(readSpy).toHaveBeenCalledTimes(reads);
  expect(archive.build).not.toHaveBeenCalled();
});

test("configuration updates do not start a stopped maintenance caller's worker", async () => {
  await configure(false);
  await backup.updateBackupSyncConfig({ enabled: true });
  expect(vi.getTimerCount()).toBe(0);
  expect(archive.build).not.toHaveBeenCalled();
});

test("enabling activates one owner and disabling removes its timer", async () => {
  await configure(false);
  await backup.startBackupSyncScheduler();
  await backup.updateBackupSyncConfig({ enabled: true });
  await backup.startBackupSyncScheduler();
  expect(vi.getTimerCount()).toBe(1);
  await vi.waitFor(() => expect(archive.build).toHaveBeenCalledTimes(1));
  await backup.updateBackupSyncConfig({ enabled: false });
  expect(vi.getTimerCount()).toBe(0);
});

test("stop clears admission while an admitted archive drains", async () => {
  await configure(true);
  const held = gate();
  archive.build.mockImplementationOnce(async () => { await held.promise; return { archive: Buffer.from("held archive") }; });
  await backup.startBackupSyncScheduler();
  await vi.waitFor(() => expect(archive.build).toHaveBeenCalledTimes(1));
  expect(backup.stopBackupSyncScheduler).toBeTypeOf("function");
  let drained = false;
  const stopping = backup.stopBackupSyncScheduler().then(() => { drained = true; });
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(TICK_MS * 2);
  expect(drained).toBe(false);
  expect(archive.build).toHaveBeenCalledTimes(1);
  held.release();
  await stopping;
  expect((await backup.loadBackupSyncStatus()).lastSuccessFile).toBeTruthy();
});

test("stop fences an unresolved startup read", async () => {
  await configure(true);
  const held = gate();
  holdRead = held.promise;
  const starting = backup.startBackupSyncScheduler();
  expect(backup.stopBackupSyncScheduler).toBeTypeOf("function");
  const stopping = backup.stopBackupSyncScheduler();
  held.release();
  await Promise.all([starting, stopping]);
  expect(vi.getTimerCount()).toBe(0);
  expect(archive.build).not.toHaveBeenCalled();
});

test("configuration changes retain an unresolved startup read for drain", async () => {
  await configure(true);
  const held = gate();
  holdRead = held.promise;
  const starting = backup.startBackupSyncScheduler();
  await backup.updateBackupSyncConfig({ enabled: false });
  let drained = false;
  const stopping = backup.stopBackupSyncScheduler().then(() => { drained = true; });
  await vi.advanceTimersByTimeAsync(TICK_MS);
  expect(drained).toBe(false);
  held.release();
  await Promise.all([starting, stopping]);
  expect(vi.getTimerCount()).toBe(0);
  expect(archive.build).not.toHaveBeenCalled();
});

test("stop fences a slow eligibility read before archive admission", async () => {
  // Not due at boot; due at the first 15-minute eligibility pass.
  await configure(true, new Date(Date.now() - 50 * 60_000).toISOString(), 1);
  await backup.startBackupSyncScheduler();
  await vi.waitFor(() => expect(pendingReads.size).toBe(0));
  const held = gate();
  holdRead = held.promise;
  await vi.advanceTimersByTimeAsync(TICK_MS);
  expect(holdRead).toBeUndefined();
  expect(backup.stopBackupSyncScheduler).toBeTypeOf("function");
  const stopping = backup.stopBackupSyncScheduler();
  held.release();
  await stopping;
  expect(vi.getTimerCount()).toBe(0);
  expect(archive.build).not.toHaveBeenCalled();
});

test("restart waits for the prior admitted archive and keeps one timer", async () => {
  await configure(true);
  const held = gate();
  archive.build.mockImplementationOnce(async () => { await held.promise; return { archive: Buffer.from("held archive") }; });
  await backup.startBackupSyncScheduler();
  await vi.waitFor(() => expect(archive.build).toHaveBeenCalledTimes(1));
  const stopping = backup.stopBackupSyncScheduler();
  const restarting = backup.startBackupSyncScheduler();
  expect(vi.getTimerCount()).toBe(0);
  held.release();
  await Promise.all([stopping, restarting]);
  await backup.startBackupSyncScheduler();
  expect(vi.getTimerCount()).toBe(1);
  await vi.waitFor(() => expect(pendingReads.size).toBe(0));
  expect(archive.build).toHaveBeenCalledTimes(1);
});

test("a later stop fences a restart waiting on the previous drain", async () => {
  await configure(true);
  const held = gate();
  archive.build.mockImplementationOnce(async () => { await held.promise; return { archive: Buffer.from("held archive") }; });
  await backup.startBackupSyncScheduler();
  await vi.waitFor(() => expect(archive.build).toHaveBeenCalledTimes(1));
  const stopping = backup.stopBackupSyncScheduler();
  const restarting = backup.startBackupSyncScheduler();
  const stoppedAgain = backup.stopBackupSyncScheduler();
  held.release();
  await Promise.all([stopping, restarting, stoppedAgain]);
  expect(vi.getTimerCount()).toBe(0);
  expect(archive.build).toHaveBeenCalledTimes(1);
});

test("repeated quit stops share the same admitted snapshot", async () => {
  await configure(true, new Date().toISOString());
  await backup.startBackupSyncScheduler();
  const held = gate();
  archive.build.mockImplementationOnce(async () => { await held.promise; return { archive: Buffer.from("quit archive") }; });
  const first = backup.stopBackupSyncScheduler({ pushOnQuit: true });
  await vi.waitFor(() => expect(archive.build).toHaveBeenCalledTimes(1));
  const second = backup.stopBackupSyncScheduler({ pushOnQuit: true });
  expect(second).toBe(first);
  held.release();
  await Promise.all([first, second]);
  await backup.stopBackupSyncScheduler({ pushOnQuit: true });
  expect(archive.build).toHaveBeenCalledTimes(1);
});

test("quit joins an admitted archive instead of making a second snapshot", async () => {
  await configure(true);
  const held = gate();
  archive.build.mockImplementationOnce(async () => { await held.promise; return { archive: Buffer.from("held archive") }; });
  await backup.startBackupSyncScheduler();
  await vi.waitFor(() => expect(archive.build).toHaveBeenCalledTimes(1));
  expect(backup.stopBackupSyncScheduler).toBeTypeOf("function");
  const stopping = backup.stopBackupSyncScheduler({ pushOnQuit: true });
  held.release();
  await stopping;
  expect(archive.build).toHaveBeenCalledTimes(1);
});

test("an enabled idle worker preserves its explicit quit snapshot", async () => {
  await configure(true, new Date().toISOString());
  await backup.startBackupSyncScheduler();
  expect(backup.stopBackupSyncScheduler).toBeTypeOf("function");
  await backup.stopBackupSyncScheduler({ pushOnQuit: true });
  expect(archive.build).toHaveBeenCalledTimes(1);
});

test("rejected startup state stays intact and owns no timer", async () => {
  const invalid = "{synthetic rejected backup state";
  await writeFile(statePath, invalid);
  await expect(Promise.resolve(backup.startBackupSyncScheduler())).rejects.toThrow(/invalid.*restore/i);
  expect(vi.getTimerCount()).toBe(0);
  expect(await readFile(statePath, "utf8")).toBe(invalid);
  expect(archive.build).not.toHaveBeenCalled();
});

test("a rejected config update preserves the active owner's cadence and bytes", async () => {
  await configure(true, new Date().toISOString());
  await backup.startBackupSyncScheduler();
  await vi.waitFor(() => expect(pendingReads.size).toBe(0));
  const invalid = "{synthetic rejected update";
  await writeFile(statePath, invalid);
  await expect(backup.updateBackupSyncConfig({ enabled: false })).rejects.toThrow(/invalid.*restore/i);
  expect(vi.getTimerCount()).toBe(1);
  expect(await readFile(statePath, "utf8")).toBe(invalid);
  expect(archive.build).not.toHaveBeenCalled();
});

test("production compilation starts no backup work", async () => {
  vi.stubEnv("NEXT_PHASE", "phase-production-build");
  await configure(true);
  await backup.startBackupSyncScheduler();
  expect(vi.getTimerCount()).toBe(0);
  expect(archive.build).not.toHaveBeenCalled();
});


test("custom coordination suppresses backup's competing production signal hook", async () => {
  vi.stubEnv("NODE_ENV", "production");
  const once = vi.spyOn(process, "once").mockReturnValue(process);
  (await import("./startup-worker-shutdown")).ownStartupWorkerShutdown();
  await configure(false);
  await backup.startBackupSyncScheduler();
  expect(once.mock.calls.filter(([signal]) => signal === "SIGTERM" || signal === "SIGINT")).toHaveLength(0);
});

test("standalone production retains the bounded quit snapshot fallback", async () => {
  vi.stubEnv("NODE_ENV", "production");
  const once = vi.spyOn(process, "once").mockReturnValue(process);
  const kill = vi.spyOn(process, "kill").mockReturnValue(true);
  await configure(true, new Date().toISOString());
  await backup.startBackupSyncScheduler();
  const signalHandler = once.mock.calls.find(([signal]) => signal === "SIGTERM")?.[1];
  expect(signalHandler).toBeTypeOf("function");
  signalHandler!();
  await vi.waitFor(() => expect(kill).toHaveBeenCalledWith(process.pid, "SIGTERM"));
  expect(archive.build).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

test("config updates cannot bypass a pending quit drain during restart", async () => {
  await configure(true, new Date().toISOString());
  await backup.startBackupSyncScheduler();
  const held = gate();
  archive.build.mockImplementationOnce(async () => { await held.promise; return { archive: Buffer.from("quit archive") }; });
  const stopping = backup.stopBackupSyncScheduler({ pushOnQuit: true });
  await vi.waitFor(() => expect(archive.build).toHaveBeenCalledOnce());
  const restarting = backup.startBackupSyncScheduler();
  let updated = false;
  const updating = backup.updateBackupSyncConfig({ retainCount: 3 }).then(() => { updated = true; });
  // Wait for the actual config write, rather than a timing-only pause.
  await vi.waitFor(async () => expect(JSON.parse(await readFile(statePath, "utf8")).config.retainCount).toBe(3));
  await vi.advanceTimersByTimeAsync(0);
  expect(updated).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
  held.release();
  await Promise.all([stopping, restarting, updating]);
  expect(vi.getTimerCount()).toBe(1);
  expect(archive.build).toHaveBeenCalledOnce();
});
