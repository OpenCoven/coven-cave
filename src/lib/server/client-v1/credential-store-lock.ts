import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 15_000;
const PUBLICATION_GRACE_MS = 1_000;
const OWNER_DIRECTORY = "owner";
const OWNER_RECORD = "owner.json";
const QUARANTINE_PREFIX = "quarantine-";
const RETIRED_PREFIX = "retired-";

type DatabaseSyncInstance = {
  exec(sql: string): void;
  close(): void;
};

type DatabaseSyncCtor = new (
  location: string,
  options?: { open?: boolean; timeout?: number },
) => DatabaseSyncInstance;

type OwnerRecord = {
  version: 1;
  nonce: string;
  pid: number;
  processStartIdentity: string;
  createdAt: number;
};

type OwnershipSnapshot = {
  directoryIdentity: { dev: number; ino: number };
  modifiedAt: number;
  record: OwnerRecord | null;
};

type LockPaths = {
  root: string;
  owner: string;
  ownerRecord: string;
  arbiter: string;
};

export type CredentialStoreLockOptions = {
  storePath: string;
  timeoutMs?: number;
};

export function credentialStoreLockDirectory(storePath: string): string {
  return `${storePath}.lock`;
}

function lockPaths(storePath: string): LockPaths {
  const root = credentialStoreLockDirectory(storePath);
  const owner = path.join(root, OWNER_DIRECTORY);
  return {
    root,
    owner,
    ownerRecord: path.join(owner, OWNER_RECORD),
    arbiter: path.join(root, "arbitration.sqlite3"),
  };
}

function timeoutError(): Error {
  return new Error("timed out waiting for client-v1 credential store lock");
}

function assertBeforeDeadline(deadline: number): void {
  if (Date.now() >= deadline) throw timeoutError();
}

function remainingTime(deadline: number): number {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw timeoutError();
  return remaining;
}

async function waitBeforeRetry(deadline: number, attempt: number): Promise<void> {
  const remaining = remainingTime(deadline);
  const ceiling = Math.min(50, 5 * 2 ** Math.min(attempt, 3));
  const delay = Math.min(remaining, 5 + Math.floor(Math.random() * ceiling));
  await new Promise<void>((resolve) => setTimeout(resolve, delay));
  assertBeforeDeadline(deadline);
}

async function withDeadline<T>(
  promise: Promise<T>,
  deadline: number,
  message: string,
): Promise<T> {
  const remaining = remainingTime(deadline);
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), remaining);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function processIsAlive(pid: number): boolean {
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function processStartIdentity(pid: number, deadline: number): Promise<string | null> {
  if (!processIsAlive(pid)) return null;
  try {
    if (process.platform === "linux") {
      const [stat, bootId] = await withDeadline(
        Promise.all([
          readFile(`/proc/${pid}/stat`, "utf8"),
          readFile("/proc/sys/kernel/random/boot_id", "utf8"),
        ]),
        deadline,
        `could not verify process identity for PID ${pid}`,
      );
      const commandEnd = stat.lastIndexOf(") ");
      const fields = stat.slice(commandEnd + 2).trim().split(/\s+/);
      const startTicks = fields[19];
      if (commandEnd < 0 || !/^\d+$/.test(startTicks ?? "")) {
        throw new Error(`invalid /proc stat for PID ${pid}`);
      }
      return `linux:${bootId.trim()}:${startTicks}`;
    }

    if (process.platform === "win32") {
      const script = [
        `$p = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}"`,
        `if ($null -ne $p) { $p.CreationDate.ToUniversalTime().Ticks }`,
      ].join("; ");
      const { stdout } = await execFileAsync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", script],
        {
          timeout: remainingTime(deadline),
          windowsHide: true,
        },
      );
      const startedAt = stdout.trim();
      if (startedAt) return `win32:${startedAt}`;
    } else {
      const { stdout } = await execFileAsync(
        "ps",
        ["-o", "lstart=", "-p", String(pid)],
        {
          timeout: remainingTime(deadline),
          windowsHide: true,
        },
      );
      const startedAt = stdout.trim().replace(/\s+/g, " ");
      if (startedAt) return `${process.platform}:${startedAt}`;
    }
  } catch (error) {
    if (!processIsAlive(pid)) return null;
    throw new Error(`could not verify process identity for PID ${pid}`, {
      cause: error,
    });
  }
  if (!processIsAlive(pid)) return null;
  throw new Error(`could not verify process identity for PID ${pid}`);
}

async function ensureDirectory(
  directory: string,
  mode: number,
  label: string,
): Promise<void> {
  try {
    await mkdir(directory, { mode });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const info = await lstat(directory);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error(`${label} must be a real directory`);
  }
  await chmod(directory, mode);
}

async function ensureLockInfrastructure(paths: LockPaths): Promise<void> {
  await mkdir(path.dirname(paths.root), { recursive: true });
  await ensureDirectory(paths.root, 0o700, "credential lock directory");

  let handle;
  try {
    handle = await open(paths.arbiter, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  await handle?.close();
  const info = await lstat(paths.arbiter);
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new Error("credential lock arbiter must be a real file");
  }
  await chmod(paths.arbiter, 0o600);
}

let databaseSyncCtorPromise: Promise<DatabaseSyncCtor> | null = null;

async function loadDatabaseSyncCtor(deadline: number): Promise<DatabaseSyncCtor> {
  databaseSyncCtorPromise ??= import("node:sqlite").then(
    (module) => (module as { DatabaseSync: DatabaseSyncCtor }).DatabaseSync,
  );
  return withDeadline(
    databaseSyncCtorPromise,
    deadline,
    "timed out loading credential lock arbiter",
  );
}

type SqliteError = Error & { code?: string; errcode?: number };

function isLockContention(error: unknown): boolean {
  const sqliteError = error as SqliteError;
  if (
    !sqliteError ||
    sqliteError.code !== "ERR_SQLITE_ERROR" ||
    typeof sqliteError.errcode !== "number"
  ) {
    return false;
  }
  const primaryCode = sqliteError.errcode & 0xff;
  return primaryCode === 5 || primaryCode === 6;
}

async function retrySqlite<T>(
  deadline: number,
  operation: () => T,
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return operation();
    } catch (error) {
      if (!isLockContention(error)) throw error;
      await waitBeforeRetry(deadline, attempt);
    }
  }
}

async function withArbiter<T>(
  paths: LockPaths,
  deadline: number,
  operation: () => Promise<T>,
): Promise<T> {
  const DatabaseSync = await loadDatabaseSyncCtor(deadline);
  const database = new DatabaseSync(paths.arbiter, { timeout: 0 });
  let transactionOpen = false;
  try {
    await retrySqlite(deadline, () => {
      database.exec(
        "CREATE TABLE IF NOT EXISTS lock_meta (id INTEGER PRIMARY KEY CHECK (id = 1));",
      );
    });
    await chmod(paths.arbiter, 0o600);
    await retrySqlite(deadline, () => database.exec("BEGIN IMMEDIATE;"));
    transactionOpen = true;
    return await operation();
  } finally {
    if (transactionOpen) {
      try {
        database.exec("ROLLBACK;");
      } catch {
        // Closing the connection below also releases this process's OS lock.
      }
    }
    database.close();
  }
}

function parseOwnerRecord(value: unknown): OwnerRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    keys.length !== 5 ||
    !["version", "nonce", "pid", "processStartIdentity", "createdAt"].every(
      (key) => Object.hasOwn(record, key),
    )
  ) {
    return null;
  }
  if (
    record.version !== 1 ||
    typeof record.nonce !== "string" ||
    !/^[0-9a-f-]{36}$/.test(record.nonce) ||
    !Number.isSafeInteger(record.pid) ||
    (record.pid as number) <= 0 ||
    typeof record.processStartIdentity !== "string" ||
    record.processStartIdentity.length === 0 ||
    typeof record.createdAt !== "number" ||
    !Number.isFinite(record.createdAt)
  ) {
    return null;
  }
  return record as OwnerRecord;
}

async function inspectOwnership(
  directory: string,
): Promise<OwnershipSnapshot | null> {
  let directoryInfo;
  try {
    directoryInfo = await lstat(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (directoryInfo.isSymbolicLink() || !directoryInfo.isDirectory()) {
    throw new Error("credential lock owner must be a real directory");
  }

  let modifiedAt = Math.max(directoryInfo.ctimeMs, directoryInfo.mtimeMs);
  let record: OwnerRecord | null = null;
  const recordPath = path.join(directory, OWNER_RECORD);
  try {
    const [text, recordInfo] = await Promise.all([
      readFile(recordPath, "utf8"),
      lstat(recordPath),
    ]);
    if (recordInfo.isSymbolicLink() || !recordInfo.isFile()) {
      throw new Error("credential lock owner record must be a real file");
    }
    modifiedAt = Math.max(modifiedAt, recordInfo.ctimeMs, recordInfo.mtimeMs);
    try {
      record = parseOwnerRecord(JSON.parse(text));
    } catch {
      record = null;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  return {
    directoryIdentity: {
      dev: directoryInfo.dev,
      ino: directoryInfo.ino,
    },
    modifiedAt,
    record,
  };
}

function sameOwner(left: OwnerRecord, right: OwnerRecord): boolean {
  return (
    left.version === right.version &&
    left.nonce === right.nonce &&
    left.pid === right.pid &&
    left.processStartIdentity === right.processStartIdentity &&
    left.createdAt === right.createdAt
  );
}

function sameDirectory(
  left: OwnershipSnapshot,
  right: OwnershipSnapshot,
): boolean {
  return (
    left.directoryIdentity.dev === right.directoryIdentity.dev &&
    left.directoryIdentity.ino === right.directoryIdentity.ino
  );
}

async function ownershipIsReclaimable(
  ownership: OwnershipSnapshot,
  deadline: number,
): Promise<boolean> {
  if (!ownership.record) {
    return Date.now() - ownership.modifiedAt >= PUBLICATION_GRACE_MS;
  }
  try {
    const currentIdentity = await processStartIdentity(
      ownership.record.pid,
      deadline,
    );
    return (
      currentIdentity === null ||
      currentIdentity !== ownership.record.processStartIdentity
    );
  } catch {
    return false;
  }
}

async function restoreUnexpectedQuarantine(
  paths: LockPaths,
  quarantinePath: string,
): Promise<void> {
  try {
    await lstat(paths.owner);
    throw new Error("credential lock ownership changed during recovery");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await rename(quarantinePath, paths.owner);
  throw new Error("credential lock ownership changed during recovery");
}

async function retireQuarantine(
  paths: LockPaths,
  quarantinePath: string,
  expected: OwnershipSnapshot,
): Promise<void> {
  const moved = await inspectOwnership(quarantinePath);
  if (
    !moved ||
    !sameDirectory(expected, moved) ||
    (expected.record &&
      (!moved.record || !sameOwner(expected.record, moved.record)))
  ) {
    await restoreUnexpectedQuarantine(paths, quarantinePath);
  }
  const retiredPath = path.join(
    paths.root,
    `${RETIRED_PREFIX}${randomUUID()}`,
  );
  await rename(quarantinePath, retiredPath);
  try {
    await rm(retiredPath, { recursive: true });
  } catch {
    // The retired name is never considered an active owner on later attempts.
  }
}

async function quarantineCanonicalOwner(
  paths: LockPaths,
  expected: OwnershipSnapshot,
): Promise<boolean> {
  const quarantinePath = path.join(
    paths.root,
    `${QUARANTINE_PREFIX}${randomUUID()}`,
  );
  try {
    await rename(paths.owner, quarantinePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  await retireQuarantine(paths, quarantinePath, expected);
  return true;
}

async function cleanRecoveryArtifacts(
  paths: LockPaths,
  deadline: number,
): Promise<boolean> {
  const entries = await readdir(paths.root, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(paths.root, entry.name);
    if (entry.name.startsWith(RETIRED_PREFIX)) {
      try {
        await rm(entryPath, { recursive: true, force: true });
      } catch {
        // A verified retired owner cannot overlap a successor.
      }
      continue;
    }
    if (!entry.name.startsWith(QUARANTINE_PREFIX)) continue;
    const ownership = await inspectOwnership(entryPath);
    if (!ownership) continue;
    if (!(await ownershipIsReclaimable(ownership, deadline))) return false;
    await retireQuarantine(paths, entryPath, ownership);
  }
  return true;
}

async function publishOwnerRecord(
  paths: LockPaths,
  record: OwnerRecord,
): Promise<void> {
  const temporaryPath = path.join(paths.owner, `.owner-${record.nonce}.tmp`);
  const handle = await open(temporaryPath, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(record)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporaryPath, paths.ownerRecord);
  await chmod(paths.ownerRecord, 0o600);
}

async function waitAtTestGate(deadline: number): Promise<void> {
  if (process.env.NODE_ENV !== "test") return;
  const gatePath =
    process.env.COVEN_CAVE_TEST_CREDENTIAL_LOCK_PRE_ACQUIRE_GATE?.trim();
  if (!gatePath) return;
  await writeFile(`${gatePath}.ready`, `${process.pid}\n`, { mode: 0o600 });
  for (;;) {
    try {
      await lstat(gatePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    await waitBeforeRetry(deadline, 0);
  }
}

function releaseOwnedLock(
  paths: LockPaths,
  owner: OwnerRecord,
): () => Promise<void> {
  let released = false;
  let pending: Promise<void> | null = null;
  return async () => {
    if (released) return;
    if (!pending) {
      pending = (async () => {
        const deadline = Date.now() + DEFAULT_TIMEOUT_MS;
        await withArbiter(paths, deadline, async () => {
          const current = await inspectOwnership(paths.owner);
          if (
            !current?.record ||
            !sameOwner(current.record, owner)
          ) {
            return;
          }
          await quarantineCanonicalOwner(paths, current);
        });
        released = true;
      })();
    }
    try {
      await pending;
    } finally {
      if (!released) pending = null;
    }
  };
}

export async function acquireCredentialStoreLock(
  options: CredentialStoreLockOptions,
): Promise<() => Promise<void>> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("credential lock timeout must be positive");
  }
  const deadline = Date.now() + timeoutMs;
  const paths = lockPaths(options.storePath);
  await ensureLockInfrastructure(paths);
  const processIdentity = await processStartIdentity(process.pid, deadline);
  if (!processIdentity) {
    throw new Error("could not verify current process identity for credential lock");
  }
  const owner: OwnerRecord = {
    version: 1,
    nonce: randomUUID(),
    pid: process.pid,
    processStartIdentity: processIdentity,
    createdAt: 0,
  };

  await waitAtTestGate(deadline);

  for (let attempt = 0; ; attempt += 1) {
    assertBeforeDeadline(deadline);
    const acquired = await withArbiter(paths, deadline, async () => {
      if (!(await cleanRecoveryArtifacts(paths, deadline))) return false;
      const current = await inspectOwnership(paths.owner);
      if (current) {
        if (await ownershipIsReclaimable(current, deadline)) {
          await quarantineCanonicalOwner(paths, current);
        }
        return false;
      }

      try {
        await mkdir(paths.owner, { mode: 0o700 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
        throw error;
      }
      await chmod(paths.owner, 0o700);
      const created = await inspectOwnership(paths.owner);
      if (!created) throw new Error("credential lock owner disappeared");
      owner.createdAt = Date.now();
      try {
        await publishOwnerRecord(paths, owner);
        const published = await inspectOwnership(paths.owner);
        if (
          !published ||
          !sameDirectory(created, published) ||
          !published.record ||
          !sameOwner(published.record, owner)
        ) {
          throw new Error("credential lock ownership publication failed");
        }
      } catch (error) {
        const stillOwned = await inspectOwnership(paths.owner);
        if (stillOwned && sameDirectory(created, stillOwned)) {
          await quarantineCanonicalOwner(paths, stillOwned);
        }
        throw error;
      }
      return true;
    });
    if (acquired) return releaseOwnedLock(paths, owner);
    await waitBeforeRetry(deadline, attempt);
  }
}
