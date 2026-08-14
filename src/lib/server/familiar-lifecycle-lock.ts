// Crash-safe cross-process mutual exclusion for the familiar LIFECYCLE
// (create/remove/rebind — every write through `cave-config.ts`'s central
// `withConfigLock` path) together with the EFFECTS that depend on a familiar
// still existing mid-flight: a standalone client's conversation
// create/PATCH/DELETE (@/lib/server/client-v1/chat-service.ts). Built on
// Node's built-in `node:sqlite` rather than a bespoke lock protocol of this
// module's own — the SAME `BEGIN IMMEDIATE`-on-an-adjacent-SQLite-file
// technique `credential-transaction-lock.ts`, `operation-transaction-lock.ts`
// (client-v1), and `project-authorization-lock.ts` already use, adjacent to
// `config.json` this time.
//
// The race this closes: a client conversation create resolves a familiar
// binding, then (possibly much later, after project-launch authorization and
// the actual save) persists a conversation stamped with that familiar's id.
// Without a shared lock, `DELETE /api/familiars/[id]` could strip the
// familiar's `familiars.toml` block and `cave-config.json` binding at any
// point in between — the create would still succeed with a binding that no
// longer exists the instant it lands, and a PATCH/DELETE against an existing
// conversation could similarly race a removal of its owning familiar. Every
// familiar config write and every client conversation create/PATCH/DELETE
// effect now serializes through this ONE dedicated lock — familiar removal
// requested while an effect is in flight queues behind it and only takes
// effect once that effect has fully returned; a NEW guarded call started
// after a completed removal is guaranteed to observe it.
//
// `DatabaseSync` is used purely as a mutex primitive here: the lock
// database's own content (a trivial single-row metadata table, never read
// back for any decision) is never the source of truth for anything, and it
// never contains any familiar/config data. The config JSON file
// `cave-config.ts` reads and writes remains the sole persisted store; this
// module only ever runs the caller's opaque `operation` while a `BEGIN
// IMMEDIATE` transaction on the adjacent lock database stays open, so it is
// provably true — not just documented — that at most one process is inside
// that critical section at a time.
//
// A process that dies while holding this lock — however it dies, including
// SIGKILL — has its open file descriptor torn down by the kernel, which
// releases the underlying OS advisory lock automatically; there is no owner
// record to reclaim, no staleness heuristic to get wrong, and no window
// where two survivors race each other to "fix" the same stale state.

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

export type FamiliarLifecycleLockOptions = {
  /** The resolved cave-config JSON store path this call is guarding. */
  storePath: string;
  /** Maximum time to wait to acquire the lock before giving up. */
  timeoutMs?: number;
  /** Short, non-secret label used only in diagnostic log lines. */
  label?: string;
};

const DEFAULT_TIMEOUT_MS = 15_000;
// Every failed acquisition attempt (SQLite contention, not a real failure)
// waits a random duration in this window before retrying, so many processes
// woken at the same instant don't all retry in lockstep and keep losing to
// the same contention indefinitely.
const MIN_RETRY_DELAY_MS = 5;
const MAX_RETRY_DELAY_MS = 35;

/**
 * Derive the cave-config store's adjacent SQLite lock database path.
 * Exported so tests and cleanup code can find (or remove) the sidecar lock
 * file(s) without duplicating this rule.
 */
export function familiarLifecycleLockDbPath(storePath: string): string {
  return `${storePath}.lifecycle-lock.sqlite3`;
}

// Test-only seam: lets a test point a specific call at a different lock db
// path than `familiarLifecycleLockDbPath` would derive, without ever
// touching the derivation `familiarLifecycleLockDbPath` itself performs in
// production. Never set outside tests; production code never calls the
// setter, so the derivation above is exactly what every real caller gets.
let lockDbPathResolverForTest: ((storePath: string) => string) | null = null;

/** Test-only: install (or, given `null`, clear) an override for which lock
 * db path a given store path resolves to. */
export function setFamiliarLifecycleLockDbPathForTest(
  resolver: ((storePath: string) => string) | null,
): void {
  lockDbPathResolverForTest = resolver;
}

function resolveLockDbPath(storePath: string): string {
  return (lockDbPathResolverForTest ?? familiarLifecycleLockDbPath)(storePath);
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
    throw new Error(`familiar lifecycle lock directory must not be a symlink: ${dir}`);
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
 * async jittered sleep between attempts rather than SQLite's own synchronous
 * busy handler. `DatabaseSync` is fully synchronous — every call blocks the
 * event loop for its own duration — so every connection here is opened with
 * `timeout: 0` (fail fast on contention) and ALL waiting happens between
 * calls, via `setTimeout`. A `busy_timeout` would instead block this
 * process's entire event loop synchronously for as long as the wait lasts,
 * freezing every other request it might be serving at the same time.
 */
async function withNonblockingRetry<T>(deadline: number, describe: string, attempt: () => T): Promise<T> {
  for (;;) {
    try {
      return attempt();
    } catch (error) {
      if (!isLockContention(error)) throw error;
      if (Date.now() >= deadline) {
        throw new Error(`familiar lifecycle lock: ${describe} timed out waiting for contention to clear`, {
          cause: error,
        });
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
    // more per-transaction I/O, so falling back keeps the lock usable rather
    // than failing every acquisition outright on such a filesystem.
    db.exec("PRAGMA journal_mode = DELETE;");
  }
  db.exec(
    "CREATE TABLE IF NOT EXISTS lock_meta (id INTEGER PRIMARY KEY CHECK (id = 1), created_at INTEGER NOT NULL);",
  );
  db.exec("INSERT OR IGNORE INTO lock_meta (id, created_at) VALUES (1, unixepoch());");
}

/** Deliberately logs only a label/phase and the error's own name/message —
 * never any familiar/config content, none of which this module ever sees
 * (it only ever holds a SQLite transaction open around the caller's opaque
 * `operation`). */
function logCleanupFailure(label: string, phase: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[familiar-lifecycle-lock] ${label}: ${phase} failed after lock acquisition (${message})`);
}

// In-process queue: several callers in THE SAME process racing this lock
// still serialize deterministically (FIFO-ish via promise chaining) rather
// than all hammering the cross-process SQLite lock with independent retry
// loops. This is a plain promise chain — like the write mutexes it
// complements as the OUTER lock — so it is NOT reentrant: a caller that is
// already running inside `withFamiliarLifecycleLock` must never call it
// again from its own `operation` before the outer call has returned, or the
// inner call will wait forever on a link of the same chain the outer call
// itself is holding open. See `withFamiliarLifecycleGuard`'s doc comment
// (@/lib/cave-config.ts) for the contract every guarded callback follows to
// avoid exactly that.
let inProcessQueue: Promise<unknown> = Promise.resolve();

/**
 * Runs `operation` as the sole occupant of the familiar-lifecycle critical
 * section, guarded BOTH by this process's own in-process FIFO queue AND by a
 * `BEGIN IMMEDIATE` SQLite transaction on the lock database adjacent to
 * `options.storePath` — the in-process queue orders same-process contenders
 * cheaply (no SQLite round-trip needed to arbitrate between two callers that
 * are already serialized by the event loop and this promise chain); the
 * SQLite transaction is what extends that same exclusion across OTHER
 * processes sharing the same cave home.
 *
 * `operation` may run for as long as it needs — including awaiting other
 * locks/I/O — the transaction (and therefore the exclusion) stays open for
 * its entire duration, and the lock's own `COMMIT` is only attempted after
 * `operation` has already resolved successfully. If `operation` rejects, the
 * lock transaction is rolled back and the rejection propagates unchanged. If
 * `operation` resolves but the lock's own `COMMIT` (or the subsequent
 * `close()`) then fails, that failure is logged — never thrown — and
 * `operation`'s already-computed result is still returned: a caller whose
 * durable work already succeeded must never see that success reported as a
 * failure just because this module's own bookkeeping cleanup had trouble
 * afterward.
 */
export async function withFamiliarLifecycleLock<T>(
  options: FamiliarLifecycleLockOptions,
  operation: () => Promise<T>,
): Promise<T> {
  // The deadline is computed ONCE, here, before this call ever waits on
  // anything — including the in-process queue below — so a same-process
  // holder that runs (or hangs) far longer than this call's own timeout can
  // never make this call wait past it just because it happened to queue
  // behind that holder. See `waitForInProcessTurn`.
  const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  // Chain onto the in-process queue FIRST — this is what makes same-process
  // callers deterministically FIFO rather than racing the SQLite retry loop
  // against each other.
  const previous = inProcessQueue;
  let releaseInProcess!: () => void;
  inProcessQueue = new Promise<void>((resolve) => {
    releaseInProcess = resolve;
  });
  try {
    await waitForInProcessTurn(previous, deadline);
    return await runWithCrossProcessLock(options, operation, deadline);
  } finally {
    releaseInProcess();
  }
}

/**
 * Waits for `previous` (the prior same-process holder's own completion) to
 * settle, but never past `deadline`. Without this bound, a caller queued
 * behind an in-process holder whose `operation` runs (or hangs)
 * indefinitely would wait forever just to reach the point where its own
 * `timeoutMs` even starts being consulted — silently defeating the very
 * timeout it was given. Rejecting here instead is safe: this call never
 * acquired the cross-process lock (or anything else), so giving up and
 * letting the caller's `finally` release this call's own in-process queue
 * slot holds nothing back from whoever queues up next.
 */
async function waitForInProcessTurn(previous: Promise<unknown>, deadline: number): Promise<void> {
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) {
    throw new Error("familiar lifecycle lock: timed out waiting for the in-process queue to clear");
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error("familiar lifecycle lock: timed out waiting for the in-process queue to clear")),
      remainingMs,
    );
  });
  try {
    await Promise.race([previous.catch(() => {}), timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

async function runWithCrossProcessLock<T>(
  options: FamiliarLifecycleLockOptions,
  operation: () => Promise<T>,
  deadline: number,
): Promise<T> {
  const label = options.label ?? "cave-config";
  const lockDbPath = resolveLockDbPath(options.storePath);
  await ensureLockDbDirectory(lockDbPath);

  const DatabaseSyncCtor = await loadDatabaseSyncCtor();
  // `deadline` is the SAME absolute deadline `withFamiliarLifecycleLock`
  // computed before it ever waited on the in-process queue — time already
  // spent waiting for a same-process turn counts against this call's own
  // timeout budget rather than resetting it.

  // `timeout: 0` — fail immediately on contention. See `withNonblockingRetry`
  // for why all waiting is done via an explicit async loop instead.
  const db = new DatabaseSyncCtor(lockDbPath, { timeout: 0 });
  let transactionOpen = false;
  try {
    // Bootstrapping a brand-new lock file is exactly when several processes
    // are most likely to race each other, so this call — though
    // unconditional and idempotent for a database that's already configured
    // — always runs inside the same nonblocking retry loop as acquisition
    // itself, finishing off a partially-bootstrapped file an earlier crash
    // may have left behind before proceeding.
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
      // Deliberately falls through to `return result` below: `operation`
      // already succeeded (and, for every current caller, already durably
      // wrote whatever it needed to) before this lock's own commit failed.
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
