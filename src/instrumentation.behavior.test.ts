import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { register } from "./instrumentation";
import { coordinateStartupWorkerShutdown } from "./lib/server/startup-worker-shutdown";

const jobs = vi.hoisted(() => ({
  migration: vi.fn(), restore: vi.fn(), media: vi.fn(), xCache: vi.fn(), xRuntime: vi.fn(),
  inbox: vi.fn(), scheduled: vi.fn(), github: vi.fn(), backup: vi.fn(),
  stopScheduled: vi.fn(), stopBackup: vi.fn(), stopInbox: vi.fn(), stopResearch: vi.fn(),
  daemon: vi.fn(), familiars: vi.fn(), board: vi.fn(),
}));
vi.mock("@/lib/server/cave-home-migration", () => ({ migrateCaveHomeOnce: jobs.migration }));
vi.mock("@/lib/server/research-resource-recovery", () => ({ recoverInterruptedResearchResourceRestore: jobs.restore }));
vi.mock("@/lib/server/research-package", () => ({ startOptionalResearch: jobs.media, stopOptionalResearchForShutdown: jobs.stopResearch }));
vi.mock("@/lib/server/x-sources", () => ({ sweepExpiredXCache: jobs.xCache }));
vi.mock("@/lib/server/research-runtime-privacy", () => ({ sweepResearchMissionXRuntime: jobs.xRuntime }));
vi.mock("@/lib/inbox-scheduler", () => ({ startScheduler: jobs.inbox, stopScheduler: jobs.stopInbox }));
vi.mock("@/lib/server/scheduled-chat-scheduler", () => ({ startScheduledChatScheduler: jobs.scheduled, stopScheduledChatScheduler: jobs.stopScheduled }));
vi.mock("@/lib/github-watcher", () => ({ startGithubWatcher: jobs.github }));
vi.mock("@/lib/server/backup-sync", () => ({ startBackupSyncScheduler: jobs.backup, stopBackupSyncScheduler: jobs.stopBackup }));
vi.mock("@/lib/server/daemon-event-watcher", () => ({ startDaemonEventWatcher: jobs.daemon }));
vi.mock("@/lib/server/familiar-roster-watch", () => ({ startFamiliarRosterWatch: jobs.familiars }));
vi.mock("@/lib/server/board-file-watch", () => ({ startBoardFileWatch: jobs.board }));

beforeEach(() => {
  vi.useFakeTimers();
  delete (globalThis as { __caveStartupWorkerShutdown?: unknown }).__caveStartupWorkerShutdown;
  for (const fn of Object.values(jobs)) fn.mockReset().mockResolvedValue(undefined);
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  vi.stubEnv("COVEN_CAVE_EVENT_PLANE_ENABLED", "0");
});
afterEach(() => {
  vi.unstubAllEnvs(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks();
  delete (globalThis as { __caveStartupWorkerShutdown?: unknown }).__caveStartupWorkerShutdown;
});

test("starts background services without importing route entries", async () => {
  await register();
  for (const key of ["migration", "restore", "media", "xCache", "xRuntime", "inbox", "scheduled", "github", "backup"] as const) {
    expect(jobs[key], key).toHaveBeenCalledOnce();
  }
  for (const key of ["daemon", "familiars", "board"] as const) expect(jobs[key]).not.toHaveBeenCalled();
});

test("resource recovery waits for migration without blocking service registration", async () => {
  let finish!: () => void;
  jobs.migration.mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
  await register();
  expect(jobs.restore).not.toHaveBeenCalled();
  expect(jobs.scheduled).toHaveBeenCalledOnce();
  finish();
  await Promise.resolve();
  expect(jobs.restore).toHaveBeenCalledOnce();
});

test("starts event watchers only when enabled", async () => {
  vi.stubEnv("COVEN_CAVE_EVENT_PLANE_ENABLED", "1");
  await register();
  for (const key of ["daemon", "familiars", "board"] as const) expect(jobs[key]).toHaveBeenCalledOnce();
});

test("does not start node services in the edge runtime", async () => {
  vi.stubEnv("NEXT_RUNTIME", "edge");
  await register();
  for (const fn of Object.values(jobs)) expect(fn).not.toHaveBeenCalled();
});


test("registers the actual worker stops before startup and retains quit snapshots", async () => {
  await register();
  const closing = coordinateStartupWorkerShutdown(async () => undefined);
  await vi.advanceTimersByTimeAsync(3_000);
  const result = await closing;
  expect(jobs.stopScheduled).toHaveBeenCalledOnce();
  expect(jobs.stopBackup).toHaveBeenCalledExactlyOnceWith({ pushOnQuit: true });
  expect(jobs.stopInbox).toHaveBeenCalledOnce();
  expect(jobs.stopResearch).toHaveBeenCalledOnce();
  expect(result.workers["inbox-reminders"].status).toBe("drained");
  expect(result.workers["scheduled-chat"].status).toBe("drained");
  expect(result.workers["backup-sync"].status).toBe("drained");
  expect(result.workers.research.status).toBe("drained");
});

test("shutdown during registration fences services that have not started", async () => {
  let closing!: ReturnType<typeof coordinateStartupWorkerShutdown>;
  jobs.scheduled.mockImplementation(() => {
    closing = coordinateStartupWorkerShutdown(async () => undefined);
    return Promise.resolve();
  });
  await register();
  await vi.advanceTimersByTimeAsync(3_000);
  await closing;
  expect(jobs.stopScheduled).toHaveBeenCalledOnce();
  expect(jobs.stopBackup).toHaveBeenCalledOnce();
  expect(jobs.backup).not.toHaveBeenCalled();
  // Research registered and started before the race, so it drains like reminders.
  expect(jobs.stopResearch).toHaveBeenCalledOnce();
  expect(jobs.media).toHaveBeenCalledOnce();
  // Reminders registered and started before the race; their stop is drained, not skipped.
  expect(jobs.stopInbox).toHaveBeenCalledOnce();
  expect(jobs.inbox).toHaveBeenCalledOnce();
});

test("rejected worker startup is reported without blocking shell registration", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  jobs.scheduled.mockRejectedValue(new Error("synthetic scheduled startup refusal"));
  jobs.backup.mockRejectedValue(new Error("synthetic backup startup refusal"));
  await register();
  await Promise.resolve();
  expect(warn).toHaveBeenCalledWith("[instrumentation] scheduled chat failed to start:", expect.any(Error));
  expect(warn).toHaveBeenCalledWith("[instrumentation] backup sync failed to start:", expect.any(Error));
});
