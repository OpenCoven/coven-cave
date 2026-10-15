import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { register } from "./instrumentation";

const jobs = vi.hoisted(() => ({
  migration: vi.fn(), restore: vi.fn(), media: vi.fn(), xCache: vi.fn(), xRuntime: vi.fn(),
  inbox: vi.fn(), scheduled: vi.fn(), github: vi.fn(), backup: vi.fn(),
  daemon: vi.fn(), familiars: vi.fn(), board: vi.fn(),
}));
vi.mock("@/lib/server/cave-home-migration", () => ({ migrateCaveHomeOnce: jobs.migration }));
vi.mock("@/lib/server/research-resource-recovery", () => ({ recoverInterruptedResearchResourceRestore: jobs.restore }));
vi.mock("@/lib/server/research-package", () => ({ startOptionalResearch: jobs.media }));
vi.mock("@/lib/server/x-sources", () => ({ sweepExpiredXCache: jobs.xCache }));
vi.mock("@/lib/server/research-runtime-privacy", () => ({ sweepResearchMissionXRuntime: jobs.xRuntime }));
vi.mock("@/lib/inbox-scheduler", () => ({ startScheduler: jobs.inbox }));
vi.mock("@/lib/server/scheduled-chat-scheduler", () => ({ startScheduledChatScheduler: jobs.scheduled }));
vi.mock("@/lib/github-watcher", () => ({ startGithubWatcher: jobs.github }));
vi.mock("@/lib/server/backup-sync", () => ({ startBackupSyncScheduler: jobs.backup }));
vi.mock("@/lib/server/daemon-event-watcher", () => ({ startDaemonEventWatcher: jobs.daemon }));
vi.mock("@/lib/server/familiar-roster-watch", () => ({ startFamiliarRosterWatch: jobs.familiars }));
vi.mock("@/lib/server/board-file-watch", () => ({ startBoardFileWatch: jobs.board }));

beforeEach(() => {
  for (const fn of Object.values(jobs)) fn.mockReset().mockResolvedValue(undefined);
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  vi.stubEnv("COVEN_CAVE_EVENT_PLANE_ENABLED", "0");
});
afterEach(() => { vi.unstubAllEnvs(); });

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
