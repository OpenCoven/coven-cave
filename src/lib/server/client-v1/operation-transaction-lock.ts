// Crash-safe cross-process mutual exclusion for the client-v1 idempotency
// operation ledger (`idempotency-store.ts`), built on Node 24's built-in
// `node:sqlite` rather than a bespoke lock protocol of this module's own.
//
// This is a DELIBERATE, narrowly-scoped sibling of
// `credential-transaction-lock.ts` (the client-v1 credential store's own
// lock) rather than a shared import of it: that module's exported names,
// options type, and top-of-file rationale are all written specifically in
// terms of "the credential store", and this ledger is — on purpose, per its
// own header comment — a completely separate persisted store with its own
// retention/eviction policy. Coupling the two locks would blur that same
// boundary `idempotency-store.ts` already goes out of its way to keep clean
// by never importing from `credential-store.ts`. The underlying mechanism
// below is intentionally identical, though: it is the same `BEGIN
// IMMEDIATE`-on-an-adjacent-SQLite-file approach, for the same reasons.
//
// A fixed-path lock file with a "steal it from a dead owner" reclaim
// heuristic (check whether the recorded owner looks dead, then rename a
// successor lock into place) is inherently racy: two reclaimers can both
// decide the same owner is dead and both rename a successor lock into
// place, with the loser's rename silently clobbering the winner's — an
// unavoidable race in ANY fixed-path check-then-act reclaim protocol, no
// matter how carefully the "is it dead" heuristic is tuned. Worse, if this
// process's own acquire or release step itself failed partway (e.g. an
// EACCES on unlink, or a crash between writing the lock file and recording
// ownership), a fixed lock file could be left in a state no later caller
// could safely interpret, poisoning every subsequent acquisition attempt.
// This module never invents that protocol.
//
// SQLite's `BEGIN IMMEDIATE` sidesteps all of this: the OS-level file lock
// SQLite takes to implement it (a POSIX advisory lock, or the platform
// equivalent) is granted and released entirely by the kernel, not by
// anything this process writes to disk and later has to re-interpret. A
// process that dies while holding the lock — however it dies, including
// SIGKILL — has its open file descriptor torn down by the kernel, which
// releases the OS lock automatically; there is no owner record to reclaim,
// no staleness heuristic to get wrong, and no window where two survivors
// can race each other to "fix" the same stale state. A failed acquire or
// release here can, at worst, leave THIS process unable to get the lock —
// it can never corrupt or poison the lock for anyone else.
//
// `DatabaseSync` is used purely as a mutex primitive here: the lock
// database's own content (a trivial single-row metadata table, never read
// back for any decision) is never the source of truth for anything, and it
// never contains any operation/credential/secret data. The operation ledger
// JSON file `idempotency-store.ts` reads and writes remains the sole
// persisted store; this module only ever runs the caller's read-modify-write
// `operation` while a `BEGIN IMMEDIATE` transaction on the adjacent lock
// database stays open, so it is provably true — not just documented — that
// at most one process is inside that critical section at a time.

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

export type OperationTransactionLockOptions = {
  /** The resolved operation ledger JSON store path this call is guarding. */
  storePath: string;
  /** Maximum time to wait to acquire the lock before giving up. */
  timeoutMs?: number;
  /** Short, non-secret label used only in diagnostic log lines. */
  label?: string;
};

const DEFAULT_TIMEOUT_MS = 15_000;
// Every failed acquisition attempt (SQLite contention, not a real failure)
// waits a random duration in this window before retrying, so many
// processes woken at the same instant don't all retry in lockstep and keep
// losing to the same contention indefinitely.
const MIN_RETRY_DELAY_MS = 5;
const MAX_RETRY_DELAY_MS = 35;

/**
 * Derive an operation ledger's adjacent SQLite lock database path. Exported
 * so tests and cleanup code can find (or remove) the sidecar lock file(s)
 * without duplicating this rule.
 */
export function operationLockDbPath(storePath: string): string {
  return `${storePath}.lock.sqlite3`;
}

// Test-only seam: lets a test point a specific call at a different lock db
// path than `operationLockDbPath` would derive, without ever touching the
// derivation `operationLockDbPath` itself performs in production. Never set
// outside tests; production code never calls the setter, so the derivation
// above is exactly what every real caller gets.
let lockDbPathResolverForTest: ((storePath: string) => string) | null = null;

/** Test-only: install (or, given `null`, clear) an override for which lock
 * db path a given store path resolves to. */
export function setOperationLockDbPathForTest(
  resolver: ((storePath: string) => string) | null,
): void {
  lockDbPathResolverForTest = resolver;
}

function resolveLockDbPath(storePath: string): string {
  return (lockDbPathResolverForTest ?? operationLockDbPath)(storePath);
}

// Lazily imported so every consumer of this module that never actually
// acquires the lock doesn't pay for loading `node:sqlite` at all, and so a
// runtime that somehow lacks it only fails when the lock is actually used.
let databaseSyncCtorPromise: Promise<DatabaseSyncCtor> | null = null;

async function loadDatabaseSyncCtor(): Promise<DatabaseSyncCtor> {
  databaseSyncCtorPromise ??= import("node:sqlite").then(
    (mod) => (mod as { DatabaseSync: DatabaseSyncCtor }).DatabaseSync,
  );
  return databaseSyncCtorPromise;
}

/**
 * `lstat`, not `stat`, so a symlinked lock directory is caught rather than
 * silently followed. This lock's exclusion guarantee depends on every
 * contender opening the exact same underlying file; a symlinked directory
 * whose target ever changed between two processes' opens could quietly
 * defeat that, so it is rejected outright instead of trusted.
 */
async function ensureLockDbDirectory(lockDbPath: string): Promise<void> {
  const dir = path.dirname(lockDbPath);
  await mkdir(dir, { recursive: true });
  const info = await lstat(dir);
  if (info.isSymbolicLink()) {
    throw new Error(`operation lock directory must not be a symlink: ${dir}`);
  }
}

type SqliteError = Error & { code?: string; errcode?: number };

/**
 * `node:sqlite` surfaces both primary result codes (5 = `SQLITE_BUSY`,
 * 6 = `SQLITE_LOCKED`) and extended result codes that encode the primary
 * code in their low byte (e.g. 261 = `SQLITE_BUSY_RECOVERY`, seen in
 * practice when several processes race to bootstrap a brand-new lock
 * database file at once). Masking with `& 0xff` recovers the primary code
 * from either shape, so both are recognized as retryable contention rather
 * than only the bare, unextended codes.
 */
function isLockContention(error: unknown): boolean {
  const err = error as SqliteError;
  if (!err || err.code !== "ERR_SQLITE_ERROR" || typeof err.errcode !== "number") return false;
  const primary = err.errcode & 0xff;
  return primary === 5 /* SQLITE_BUSY */ || primary === 6 /* SQLITE_LOCKED */;
}

function jitterDelayMs(): number {
  return MIN_RETRY_DELAY_MS + Math.floor(Math.random() * (MAX_RETRY_DELAY_MS - MIN_RETRY_DELAY_MS));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retries `attempt` on SQLite contention errors until `deadline`, using an
 * async jittered sleep between attempts rather than SQLite's own
 * synchronous busy handler. `DatabaseSync` is fully synchronous — every
 * call blocks the event loop for its own duration — so every connection
 * here is opened with `timeout: 0` (fail fast on contention) and ALL
 * waiting happens between calls, via `setTimeout`. A `busy_timeout` would
 * instead block this process's entire event loop synchronously for as long
 * as the wait lasts, freezing every other request it might be serving at
 * the same time.
 */
async function withNonblockingRetry<T>(deadline: number, describe: string, attempt: () => T): Promise<T> {
  for (;;) {
    try {
      return attempt();
    } catch (error) {
      if (!isLockContention(error)) throw error;
      if (Date.now() >= deadline) {
        throw new Error(`operation lock: ${describe} timed out waiting for contention to clear`, { cause: error });
      }
      await sleep(jitterDelayMs());
    }
  }
}

/**
 * Idempotent on purpose: every statement here is safe to run again on a
 * database that's already been configured (`CREATE TABLE IF NOT EXISTS`,
 * `INSERT OR IGNORE`, and re-selecting an already-active journal mode are
 * all no-ops), because bootstrapping a brand-new lock file is itself
 * something several processes can race to do at once, and the whole
 * function runs inside the same nonblocking retry loop as acquisition.
 */
function configureLockDb(db: DatabaseSyncInstance): void {
  try {
    db.exec("PRAGMA journal_mode = WAL;");
  } catch {
    // Some filesystems (e.g. certain network mounts) can't support WAL's
    // shared-memory file. DELETE — SQLite's default rollback-journal mode —
    // still gives correct `BEGIN IMMEDIATE` exclusion, just with a little
    // more per-transaction I/O, so falling back keeps the lock usable
    // rather than failing every acquisition outright on such a filesystem.
    db.exec("PRAGMA journal_mode = DELETE;");
  }
  db.exec(
    "CREATE TABLE IF NOT EXISTS lock_meta (id INTEGER PRIMARY KEY CHECK (id = 1), created_at INTEGER NOT NULL);",
  );
  db.exec("INSERT OR IGNORE INTO lock_meta (id, created_at) VALUES (1, unixepoch());");
}

/** Deliberately logs only a label/phase and the error's own name/message —
 * never any operation ledger content, none of which this module ever sees
 * (it only ever holds a SQLite transaction open around the caller's opaque
 * `operation`). */
function logCleanupFailure(label: string, phase: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[operation-transaction-lock] ${label}: ${phase} failed after lock acquisition (${message})`);
}

export type OperationTransactionLock = {
  /** Commit the mutex transaction and close its SQLite handle. */
  release: () => Promise<void>;
  /** Roll back the mutex transaction and close its SQLite handle. */
  abort: () => Promise<void>;
};

async function acquireOperationTransactionLockInternal(
  options: OperationTransactionLockOptions,
  tryOnly: boolean,
): Promise<OperationTransactionLock | null> {
  const label = options.label ?? "client-v1-idempotency-store";
  const lockDbPath = resolveLockDbPath(options.storePath);
  await ensureLockDbDirectory(lockDbPath);

  const DatabaseSyncCtor = await loadDatabaseSyncCtor();
  const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const db = new DatabaseSyncCtor(lockDbPath, { timeout: 0 });
  let transactionOpen = false;
  try {
    if (tryOnly) {
      try {
        configureLockDb(db);
        db.exec("BEGIN IMMEDIATE;");
      } catch (error) {
        if (isLockContention(error)) {
          try {
            db.close();
          } catch (closeError) {
            logCleanupFailure(label, "close-after-contended-acquisition", closeError);
          }
          return null;
        }
        throw error;
      }
    } else {
      // Bootstrapping and acquisition both retry without blocking this
      // process's event loop while another owner has the SQLite mutex.
      await withNonblockingRetry(deadline, "bootstrap", () => configureLockDb(db));
      await withNonblockingRetry(deadline, "acquisition", () => db.exec("BEGIN IMMEDIATE;"));
    }
    transactionOpen = true;
  } catch (error) {
    try {
      db.close();
    } catch (closeError) {
      logCleanupFailure(label, "close-after-failed-acquisition", closeError);
    }
    throw error;
  }

  let finished = false;
  const finish = async (commit: boolean): Promise<void> => {
    if (finished) return;
    finished = true;
    if (transactionOpen) {
      try {
        db.exec(commit ? "COMMIT;" : "ROLLBACK;");
        transactionOpen = false;
      } catch (finishError) {
        logCleanupFailure(label, commit ? "commit" : "rollback", finishError);
        try {
          db.exec("ROLLBACK;");
        } catch (rollbackError) {
          logCleanupFailure(
            label,
            commit ? "rollback-after-failed-commit" : "rollback-after-failed-rollback",
            rollbackError,
          );
        }
        transactionOpen = false;
      }
    }
    try {
      db.close();
    } catch (closeError) {
      logCleanupFailure(label, "close", closeError);
    }
  };

  return {
    release: () => finish(true),
    abort: () => finish(false),
  };
}

/**
 * Acquires a lock whose lifetime must span independently scoped work. Call
 * `release` after successful durable work, or `abort` if that work throws.
 */
export async function acquireOperationTransactionLock(
  options: OperationTransactionLockOptions,
): Promise<OperationTransactionLock> {
  const lock = await acquireOperationTransactionLockInternal(options, false);
  if (!lock) throw new Error("operation lock acquisition unexpectedly returned no lock");
  return lock;
}

/**
 * Attempts one nonblocking acquisition. `null` means a concurrent owner has
 * the lock; filesystem and non-contention SQLite failures still throw.
 */
export function tryAcquireOperationTransactionLock(
  options: OperationTransactionLockOptions,
): Promise<OperationTransactionLock | null> {
  return acquireOperationTransactionLockInternal(options, true);
}

/**
 * Runs `operation` as the sole occupant of the operation ledger's
 * cross-process critical section, guarded by a `BEGIN IMMEDIATE` SQLite
 * transaction on the lock database adjacent to `options.storePath`.
 *
 * `operation` must do its own read → mutate → write of the operation ledger
 * JSON file: the transaction (and therefore the exclusion) stays open for
 * its entire duration, and the lock's own `COMMIT` is only attempted after
 * `operation` has already resolved successfully. If `operation` rejects,
 * the lock transaction is rolled back and the rejection propagates
 * unchanged. If `operation` resolves but the lock's own `COMMIT` (or the
 * subsequent `close()`) then fails, that failure is logged — never thrown —
 * and `operation`'s already-computed result is still returned: a caller
 * whose JSON write already durably succeeded must never see that success
 * reported as a failure just because this module's own bookkeeping cleanup
 * had trouble afterward.
 */
export async function withOperationTransactionLock<T>(
  options: OperationTransactionLockOptions,
  operation: () => Promise<T>,
): Promise<T> {
  const lock = await acquireOperationTransactionLock(options);
  try {
    const result = await operation();
    await lock.release();
    return result;
  } catch (error) {
    await lock.abort();
    throw error;
  }
}
