// Scheduled encrypted backup sync (Persistence P2, issue #3812 / cave-clyh).
//
// Reuses the P1 passphrase-wrapped archive engine (backup-archive.ts) to push
// periodic snapshots into a user-owned folder — iCloud Drive by default on
// macOS — so machine loss costs at most a day, not everything. The passphrase
// is kept in the local encrypted vault for unattended runs; restore stays
// manual (Settings → Backup), so a lost machine never needs this vault.
//
// Three triggers share one runner:
//   - a 15-minute scheduler tick that fires when the last success is older
//     than the configured interval (daily by default) — this also catches up
//     after the app was quit for days;
//   - an on-quit push (SIGTERM/SIGINT, production only) bounded well inside
//     the desktop shell's 5s DAEMON_STOP_TIMEOUT;
//   - a manual "Back up now" from Settings via POST /api/backup/sync/run.

import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { buildBackupArchive } from "@/lib/server/backup-archive";
import { writeFileAtomic, writeJsonAtomic } from "@/lib/server/atomic-write";
import {
  deleteLocalEncryptedSecret,
  getLocalEncryptedSecret,
  hasLocalEncryptedSecret,
  setLocalEncryptedSecret,
} from "@/lib/local-encrypted-vault";
import { caveHome, covenHome } from "@/lib/coven-paths";

export const BACKUP_SYNC_STATE_FILE = "backup-sync.json";
export const BACKUP_SYNC_PASSPHRASE_KEY = "BACKUP_SYNC_PASSPHRASE";
export const BACKUP_FILE_PREFIX = "coven-cave-backup-";
export const BACKUP_FILE_SUFFIX = ".ccbackup";

const DEFAULT_RETAIN_COUNT = 14;
const DEFAULT_INTERVAL_HOURS = 24;
const MIN_PASSPHRASE_LENGTH = 8;
const TICK_MS = 15 * 60 * 1000;
// The desktop shell SIGKILLs the sidecar DAEMON_STOP_TIMEOUT (5s) after asking
// it to stop — leave headroom for process teardown after the push.
const QUIT_PUSH_BUDGET_MS = 3000;

export type BackupSyncReason = "scheduled" | "quit" | "manual";

export type BackupSyncConfig = {
  enabled: boolean;
  /** Destination folder; null means "use defaultBackupSyncDirectory()". */
  directory: string | null;
  retainCount: number;
  intervalHours: number;
  onQuitPush: boolean;
};

export type BackupSyncStatus = {
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastSuccessFile: string | null;
  lastError: string | null;
  lastReason: BackupSyncReason | null;
  lastDurationMs: number | null;
  lastBytes: number | null;
  retainedCount: number | null;
};

type BackupSyncState = {
  version: 1;
  config: BackupSyncConfig;
  status: BackupSyncStatus;
};

export type BackupSyncOverview = {
  config: BackupSyncConfig;
  status: BackupSyncStatus;
  defaultDirectory: string;
  effectiveDirectory: string;
  passphraseSet: boolean;
  due: boolean;
};

declare global {
  // eslint-disable-next-line no-var
  var __backupSyncSchedulerStarted: boolean | undefined;
  // eslint-disable-next-line no-var
  var __backupSyncQuitHookInstalled: boolean | undefined;
  // eslint-disable-next-line no-var
  var __backupSyncInFlight: Promise<BackupSyncStatus> | undefined;
}

export function defaultBackupSyncConfig(): BackupSyncConfig {
  return {
    enabled: false,
    directory: null,
    retainCount: DEFAULT_RETAIN_COUNT,
    intervalHours: DEFAULT_INTERVAL_HOURS,
    onQuitPush: true,
  };
}

function emptyStatus(): BackupSyncStatus {
  return {
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastSuccessFile: null,
    lastError: null,
    lastReason: null,
    lastDurationMs: null,
    lastBytes: null,
    retainedCount: null,
  };
}

function stateFilePath(): string {
  return path.join(caveHome(), BACKUP_SYNC_STATE_FILE);
}

function sanitizeConfig(raw: unknown): BackupSyncConfig {
  const defaults = defaultBackupSyncConfig();
  if (!raw || typeof raw !== "object") return defaults;
  const candidate = raw as Partial<BackupSyncConfig>;
  const retain = Number(candidate.retainCount);
  const interval = Number(candidate.intervalHours);
  return {
    enabled: candidate.enabled === true,
    directory:
      typeof candidate.directory === "string" && candidate.directory.trim()
        ? candidate.directory
        : null,
    retainCount:
      Number.isFinite(retain) && retain >= 1 && retain <= 365
        ? Math.floor(retain)
        : defaults.retainCount,
    intervalHours:
      Number.isFinite(interval) && interval >= 1 && interval <= 24 * 30
        ? Math.floor(interval)
        : defaults.intervalHours,
    onQuitPush: candidate.onQuitPush !== false,
  };
}

function sanitizeStatus(raw: unknown): BackupSyncStatus {
  const empty = emptyStatus();
  if (!raw || typeof raw !== "object") return empty;
  const candidate = raw as Partial<BackupSyncStatus>;
  const str = (value: unknown): string | null => (typeof value === "string" && value ? value : null);
  const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
  const reason = candidate.lastReason;
  return {
    lastAttemptAt: str(candidate.lastAttemptAt),
    lastSuccessAt: str(candidate.lastSuccessAt),
    lastSuccessFile: str(candidate.lastSuccessFile),
    lastError: str(candidate.lastError),
    lastReason: reason === "scheduled" || reason === "quit" || reason === "manual" ? reason : null,
    lastDurationMs: num(candidate.lastDurationMs),
    lastBytes: num(candidate.lastBytes),
    retainedCount: num(candidate.retainedCount),
  };
}

async function loadState(): Promise<BackupSyncState> {
  try {
    const raw = JSON.parse(await readFile(stateFilePath(), "utf8")) as Partial<BackupSyncState>;
    return {
      version: 1,
      config: sanitizeConfig(raw.config),
      status: sanitizeStatus(raw.status),
    };
  } catch {
    return { version: 1, config: defaultBackupSyncConfig(), status: emptyStatus() };
  }
}

async function saveState(state: BackupSyncState): Promise<void> {
  await mkdir(caveHome(), { recursive: true });
  await writeJsonAtomic(stateFilePath(), state);
}

export async function loadBackupSyncConfig(): Promise<BackupSyncConfig> {
  return (await loadState()).config;
}

export async function loadBackupSyncStatus(): Promise<BackupSyncStatus> {
  return (await loadState()).status;
}

/**
 * iCloud Drive when this Mac has it (`com~apple~CloudDocs` exists), otherwise
 * a Documents folder — both user-owned and outside every Coven home, so
 * snapshots never feed back into the next snapshot.
 */
export function defaultBackupSyncDirectory(): string {
  const cloudDocs = path.join(homedir(), "Library", "Mobile Documents", "com~apple~CloudDocs");
  if (existsSync(cloudDocs)) return path.join(cloudDocs, "Coven Cave Backups");
  return path.join(homedir(), "Documents", "Coven Cave Backups");
}

export function resolveBackupSyncDirectory(config: BackupSyncConfig): string {
  return config.directory && config.directory.trim() ? config.directory : defaultBackupSyncDirectory();
}

/**
 * Snapshots written inside a backed-up root would be swallowed into the next
 * snapshot (archives growing archives). Reject destinations under either home.
 */
export function validateBackupSyncDirectory(directory: string): string | null {
  const resolved = path.resolve(directory);
  for (const home of [covenHome(), caveHome()]) {
    const rel = path.relative(path.resolve(home), resolved);
    if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) {
      return "Backup destination cannot live inside the Coven home directory.";
    }
  }
  return null;
}

export function setBackupSyncPassphrase(passphrase: string): void {
  if (typeof passphrase !== "string" || passphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw new Error(`passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters`);
  }
  setLocalEncryptedSecret(BACKUP_SYNC_PASSPHRASE_KEY, passphrase);
}

export function clearBackupSyncPassphrase(): void {
  deleteLocalEncryptedSecret(BACKUP_SYNC_PASSPHRASE_KEY);
}

export function hasBackupSyncPassphrase(): boolean {
  return hasLocalEncryptedSecret(BACKUP_SYNC_PASSPHRASE_KEY);
}

export async function updateBackupSyncConfig(
  patch: Partial<BackupSyncConfig>,
): Promise<BackupSyncConfig> {
  if (typeof patch.directory === "string" && patch.directory.trim()) {
    const invalid = validateBackupSyncDirectory(patch.directory);
    if (invalid) throw new Error(invalid);
  }
  const state = await loadState();
  const next = sanitizeConfig({ ...state.config, ...patch });
  await saveState({ ...state, config: next });
  return next;
}

export function isBackupSyncDue(
  config: BackupSyncConfig,
  status: BackupSyncStatus,
  now: number = Date.now(),
): boolean {
  if (!config.enabled) return false;
  if (!status.lastSuccessAt) return true;
  const last = Date.parse(status.lastSuccessAt);
  if (!Number.isFinite(last)) return true;
  return now - last >= config.intervalHours * 60 * 60 * 1000;
}

export async function getBackupSyncOverview(): Promise<BackupSyncOverview> {
  const state = await loadState();
  return {
    config: state.config,
    status: state.status,
    defaultDirectory: defaultBackupSyncDirectory(),
    effectiveDirectory: resolveBackupSyncDirectory(state.config),
    passphraseSet: hasBackupSyncPassphrase(),
    due: isBackupSyncDue(state.config, state.status),
  };
}

function snapshotFileName(now: Date): string {
  // Keep millisecond precision: names stay unique across rapid runs and still
  // sort chronologically ("2026-07-24T12-30-45-123Z").
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  return `${BACKUP_FILE_PREFIX}${stamp}${BACKUP_FILE_SUFFIX}`;
}

async function pruneSnapshots(directory: string, retainCount: number): Promise<number> {
  let names: string[];
  try {
    names = await readdir(directory);
  } catch {
    return 0;
  }
  const snapshots = names
    .filter((name) => name.startsWith(BACKUP_FILE_PREFIX) && name.endsWith(BACKUP_FILE_SUFFIX))
    // ISO-stamped names sort chronologically; newest first.
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  const excess = snapshots.slice(Math.max(1, retainCount));
  for (const name of excess) {
    await rm(path.join(directory, name), { force: true }).catch(() => undefined);
  }
  return snapshots.length - excess.length;
}

async function saveStatus(status: BackupSyncStatus): Promise<void> {
  // Re-load at save time: an archive build takes a while, and a config PUT
  // landing mid-run must not be clobbered by the state loaded at run start.
  const fresh = await loadState();
  await saveState({ ...fresh, status });
}

async function runBackupSyncOnce(reason: BackupSyncReason): Promise<BackupSyncStatus> {
  const startedAt = Date.now();
  const state = await loadState();
  const attempt: BackupSyncStatus = { ...state.status, lastAttemptAt: new Date(startedAt).toISOString(), lastReason: reason };

  const fail = async (message: string): Promise<BackupSyncStatus> => {
    const status: BackupSyncStatus = { ...attempt, lastError: message, lastDurationMs: Date.now() - startedAt };
    await saveStatus(status);
    return status;
  };

  const passphrase = getLocalEncryptedSecret(BACKUP_SYNC_PASSPHRASE_KEY);
  if (!passphrase) return fail("No backup passphrase saved. Set one in Settings → Backup.");

  const directory = resolveBackupSyncDirectory(state.config);
  const invalid = validateBackupSyncDirectory(directory);
  if (invalid) return fail(invalid);

  try {
    const { archive } = await buildBackupArchive(passphrase);
    await mkdir(directory, { recursive: true });
    const fileName = snapshotFileName(new Date(startedAt));
    const target = path.join(directory, fileName);
    await writeFileAtomic(target, archive);
    const written = await stat(target);
    const retainedCount = await pruneSnapshots(directory, state.config.retainCount);
    const status: BackupSyncStatus = {
      lastAttemptAt: attempt.lastAttemptAt,
      lastSuccessAt: attempt.lastAttemptAt,
      lastSuccessFile: target,
      lastError: null,
      lastReason: reason,
      lastDurationMs: Date.now() - startedAt,
      lastBytes: written.size,
      retainedCount,
    };
    await saveStatus(status);
    return status;
  } catch (error) {
    return fail(error instanceof Error ? error.message : "backup sync failed");
  }
}

/** Runs one snapshot push; concurrent callers share the in-flight run. */
export async function runBackupSync(reason: BackupSyncReason): Promise<BackupSyncStatus> {
  if (globalThis.__backupSyncInFlight) return globalThis.__backupSyncInFlight;
  const run = runBackupSyncOnce(reason).finally(() => {
    globalThis.__backupSyncInFlight = undefined;
  });
  globalThis.__backupSyncInFlight = run;
  return run;
}

async function tick(): Promise<void> {
  const state = await loadState();
  if (!isBackupSyncDue(state.config, state.status)) return;
  if (!hasBackupSyncPassphrase()) return;
  await runBackupSync("scheduled");
}

async function pushOnQuit(): Promise<void> {
  const state = await loadState();
  if (!state.config.enabled || !state.config.onQuitPush) return;
  if (!hasBackupSyncPassphrase()) return;
  await Promise.race([
    runBackupSync("quit"),
    new Promise<void>((resolve) => setTimeout(resolve, QUIT_PUSH_BUDGET_MS).unref?.()),
  ]);
}

function installQuitHook(): void {
  if (globalThis.__backupSyncQuitHookInstalled) return;
  globalThis.__backupSyncQuitHookInstalled = true;
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => {
      void pushOnQuit()
        .catch(() => undefined)
        .finally(() => {
          // The `once` handler is gone now; re-raising restores the default
          // termination path (and its conventional exit code).
          process.kill(process.pid, signal);
        });
    });
  }
}

export function startBackupSyncScheduler(): void {
  if (globalThis.__backupSyncSchedulerStarted) return;
  globalThis.__backupSyncSchedulerStarted = true;
  // Boot tick catches up snapshots missed while Cave was quit.
  void tick().catch(() => undefined);
  setInterval(() => {
    void tick().catch(() => undefined);
  }, TICK_MS).unref?.();
  // Dev servers own their signals (Ctrl-C teardown); only the packaged
  // sidecar should trade quit latency for a final snapshot.
  if (process.env.NODE_ENV === "production") installQuitHook();
}
