// Cross-process fencing for one conversation transcript. This follows the
// repository's SQLite `BEGIN IMMEDIATE` transaction-lock convention: the
// transcript JSON remains the source of truth while the lock database only
// holds an OS-backed mutex for the caller's whole read-modify-write operation.
//
// There is intentionally no fixed-path owner file or stale-owner reclamation
// protocol. SQLite owns the advisory lock in the kernel, so a crashed process
// releases it when its descriptors close. Acquisition retries are explicitly
// bounded, preventing an unavailable lock from indefinitely blocking a chat.

import { lstat, mkdir } from "node:fs/promises";
import path from "node:path";

type DatabaseSyncInstance = {
  exec(sql: string): void;
  close(): void;
};

type DatabaseSyncCtor = new (
  location: string,
  options?: { open?: boolean; timeout?: number },
) => DatabaseSyncInstance;

export type ConversationTransactionLockOptions = {
  /** Resolved transcript JSON path guarded by this transaction. */
  storePath: string;
  /** Maximum time to wait for the OS-backed lock. */
  timeoutMs?: number;
  /** Short non-secret diagnostic label. */
  label?: string;
};

const DEFAULT_TIMEOUT_MS = 15_000;
const MIN_RETRY_DELAY_MS = 5;
const MAX_RETRY_DELAY_MS = 35;

/**
 * SQLite mutex path for a single transcript JSON file. Keep lock databases in
 * Cave's dedicated sibling directory rather than alongside transcript files:
 * a deletion must be able to acquire its existing fence even when a damaged or
 * read-only `conversations/` directory makes the final unlink fail. This also
 * keeps implementation files out of transcript directory scans.
 */
export function conversationLockDbPath(storePath: string): string {
  return path.join(
    path.dirname(path.dirname(storePath)),
    "conversation-locks",
    `${path.basename(storePath)}.sqlite3`,
  );
}

let databaseSyncCtorPromise: Promise<DatabaseSyncCtor> | null = null;

async function loadDatabaseSyncCtor(): Promise<DatabaseSyncCtor> {
  databaseSyncCtorPromise ??= import("node:sqlite").then(
    (mod) => (mod as { DatabaseSync: DatabaseSyncCtor }).DatabaseSync,
  );
  return databaseSyncCtorPromise;
}

async function ensureLockDbDirectory(lockDbPath: string): Promise<void> {
  const dir = path.dirname(lockDbPath);
  await mkdir(dir, { recursive: true });
  const info = await lstat(dir);
  if (info.isSymbolicLink()) {
    throw new Error(`conversation transaction lock directory must not be a symlink: ${dir}`);
  }
}

type SqliteError = Error & { code?: string; errcode?: number };

function isLockContention(error: unknown): boolean {
  const err = error as SqliteError;
  if (!err || err.code !== "ERR_SQLITE_ERROR" || typeof err.errcode !== "number") return false;
  const primary = err.errcode & 0xff;
  return primary === 5 /* SQLITE_BUSY */ || primary === 6 /* SQLITE_LOCKED */;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitterDelayMs(): number {
  return MIN_RETRY_DELAY_MS + Math.floor(Math.random() * (MAX_RETRY_DELAY_MS - MIN_RETRY_DELAY_MS));
}

async function withNonblockingRetry<T>(
  deadline: number,
  describe: string,
  attempt: () => T,
): Promise<T> {
  for (;;) {
    try {
      return attempt();
    } catch (error) {
      if (!isLockContention(error)) throw error;
      if (Date.now() >= deadline) {
        throw new Error(`conversation transaction lock: ${describe} timed out waiting for contention to clear`, {
          cause: error,
        });
      }
      await sleep(jitterDelayMs());
    }
  }
}

function configureLockDb(db: DatabaseSyncInstance): void {
  try {
    db.exec("PRAGMA journal_mode = WAL;");
  } catch {
    // Filesystems without WAL support still get correct exclusion with
    // SQLite's rollback journal.
    db.exec("PRAGMA journal_mode = DELETE;");
  }
  db.exec(
    "CREATE TABLE IF NOT EXISTS lock_meta (id INTEGER PRIMARY KEY CHECK (id = 1), created_at INTEGER NOT NULL);",
  );
  db.exec("INSERT OR IGNORE INTO lock_meta (id, created_at) VALUES (1, unixepoch());");
}

function logCleanupFailure(label: string, phase: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[conversation-transaction-lock] ${label}: ${phase} failed after lock acquisition (${message})`);
}

/**
 * Holds the per-transcript, OS-backed transaction lock while `operation`
 * executes. The caller must read, validate/tombstone, and save/remove the
 * transcript within `operation`; lock acquisition and operation failures
 * propagate unchanged.
 *
 * `withConversationLock` supplies same-process queuing before invoking this
 * helper. Keeping this helper queue-free preserves per-session concurrency:
 * distinct transcript paths have distinct SQLite lock databases.
 */
export async function withConversationTransactionLock<T>(
  options: ConversationTransactionLockOptions,
  operation: () => Promise<T>,
): Promise<T> {
  const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const label = options.label ?? "conversation-transcript";
  const lockDbPath = conversationLockDbPath(options.storePath);
  await ensureLockDbDirectory(lockDbPath);

  const DatabaseSync = await loadDatabaseSyncCtor();
  // `timeout: 0` keeps SQLite from synchronously freezing this process's
  // event loop; retry waits remain asynchronous and bounded above.
  const db = new DatabaseSync(lockDbPath, { timeout: 0 });
  let transactionOpen = false;
  try {
    // All bootstrap statements are idempotent and run through the same
    // bounded contention loop as the actual acquisition.
    await withNonblockingRetry(deadline, "bootstrap", () => configureLockDb(db));
    await withNonblockingRetry(deadline, "acquisition", () => db.exec("BEGIN IMMEDIATE;"));
    transactionOpen = true;

    let result: T;
    try {
      result = await operation();
    } catch (operationError) {
      try {
        db.exec("ROLLBACK;");
      } catch (rollbackError) {
        logCleanupFailure(label, "rollback-after-operation-failure", rollbackError);
      }
      transactionOpen = false;
      throw operationError;
    }

    try {
      db.exec("COMMIT;");
      transactionOpen = false;
    } catch (commitError) {
      logCleanupFailure(label, "commit", commitError);
      try {
        db.exec("ROLLBACK;");
      } catch (rollbackError) {
        logCleanupFailure(label, "rollback-after-failed-commit", rollbackError);
      }
      transactionOpen = false;
    }
    return result;
  } finally {
    if (transactionOpen) {
      try {
        db.exec("ROLLBACK;");
      } catch (rollbackError) {
        logCleanupFailure(label, "rollback-in-finally", rollbackError);
      }
    }
    try {
      db.close();
    } catch (closeError) {
      logCleanupFailure(label, "close", closeError);
    }
  }
}
