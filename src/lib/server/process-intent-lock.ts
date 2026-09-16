import { AsyncLocalStorage } from "node:async_hooks";
import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  mkdir,
  lstat,
  open,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const INTENT_NAME =
  /^(\d{24})-(\d+)-([a-f0-9]{16})-([a-f0-9]+)\.lock$/;
// Lamport's "choosing" marker. It carries no order field on purpose: it exists
// only during the window in which its owner has not yet published one.
const CHOOSING_NAME = /^(\d+)-([a-f0-9]{16})-([a-f0-9]+)\.choosing$/;
const execFileAsync = promisify(execFile);
const pendingIntentRemovals = new Map<
  string,
  { cleanup: Promise<void>; firstAttempt: Promise<boolean> }
>();
type HeldIntentLease = {
  active: boolean;
  pending: Set<Promise<void>>;
};
const heldIntentDirectories = new AsyncLocalStorage<ReadonlyMap<string, HeldIntentLease>>();

class InvalidIntentDirectoryError extends Error {}

function retryDelay(delayMs: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, delayMs);
    timer.unref();
  });
}

/**
 * Retain cleanup ownership inside this module until the unique path is gone.
 * Callers may safely discard their release closure after one invocation.
 */
function scheduleIntentRemoval(pathname: string): Promise<boolean> {
  const existing = pendingIntentRemovals.get(pathname);
  if (existing) return existing.firstAttempt;

  let firstAttemptSettled = false;
  let resolveFirstAttempt!: (removed: boolean) => void;
  const firstAttempt = new Promise<boolean>((resolve) => {
    resolveFirstAttempt = resolve;
  });
  let cleanup!: Promise<void>;
  cleanup = (async () => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        await rm(/* turbopackIgnore: true */ pathname, { force: true });
        if (!firstAttemptSettled) {
          firstAttemptSettled = true;
          resolveFirstAttempt(true);
        }
        return;
      } catch {
        if (!firstAttemptSettled) {
          firstAttemptSettled = true;
          resolveFirstAttempt(false);
        }
        await retryDelay(Math.min(1_000, 2 ** Math.min(attempt + 2, 10)));
      }
    }
  })().finally(() => {
    if (pendingIntentRemovals.get(pathname)?.cleanup === cleanup) {
      pendingIntentRemovals.delete(pathname);
    }
  });
  pendingIntentRemovals.set(pathname, { cleanup, firstAttempt });
  // The loop owns and observes every retry; callers only wait for the first
  // attempt so a persistent filesystem fault cannot stall the request path.
  void cleanup;
  return firstAttempt;
}

async function removeIntent(pathname: string): Promise<boolean> {
  return scheduleIntentRemoval(pathname);
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

async function processStartIdentity(pid: number): Promise<string | null> {
  if (!processIsAlive(pid)) return null;
  try {
    if (process.platform === "linux") {
      const [stat, bootId] = await Promise.all([
        readFile(`/proc/${pid}/stat`, "utf8"),
        readFile("/proc/sys/kernel/random/boot_id", "utf8"),
      ]);
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
        { windowsHide: true },
      );
      const startedAt = stdout.trim();
      if (startedAt) return `win32:${startedAt}`;
    } else {
      const { stdout } = await execFileAsync(
        "ps",
        ["-o", "lstart=", "-p", String(pid)],
        { windowsHide: true },
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

function identityHash(identity: string): string {
  return createHash("sha256").update(identity).digest("hex").slice(0, 16);
}

function intentOwner(
  name: string,
): { pid: number; startIdentityHash: string } | null {
  const match = INTENT_NAME.exec(name);
  if (!match) return null;
  const pid = Number(match[2]);
  return Number.isSafeInteger(pid) && pid > 0
    ? { pid, startIdentityHash: match[3] }
    : null;
}

function choosingOwner(
  name: string,
): { pid: number; startIdentityHash: string } | null {
  const match = CHOOSING_NAME.exec(name);
  if (!match) return null;
  const pid = Number(match[1]);
  return Number.isSafeInteger(pid) && pid > 0
    ? { pid, startIdentityHash: match[2] }
    : null;
}

export type ProcessIntentLockOptions = {
  intentsDirectory: string;
  timeoutMs?: number;
  label: string;
};

function timeoutError(label: string): Error {
  return new Error(`timed out waiting for ${label} lock`);
}

function assertBeforeDeadline(deadline: number, label: string): void {
  if (Date.now() >= deadline) throw timeoutError(label);
}

async function waitBeforeRetry(deadline: number, label: string): Promise<void> {
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) throw timeoutError(label);
  await new Promise<void>((resolve) =>
    setTimeout(
      resolve,
      Math.min(remainingMs, 10 + Math.floor(Math.random() * 20)),
    ),
  );
  assertBeforeDeadline(deadline, label);
}

function assertIntentDirectory(
  info: Awaited<ReturnType<typeof lstat>>,
  label: string,
): void {
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new InvalidIntentDirectoryError(
      `${label} lock directory must be a real directory, not a symlink`,
    );
  }
}

/**
 * Cross-process FIFO lock where every contender owns one immutable intent
 * file. Release removes only the caller's unique file. Dead owners are
 * recoverable by PID plus verified process-start identity; a live owner is
 * never reclaimed merely because an I/O stall made its intent old.
 */
export async function acquireProcessIntentLock(
  options: ProcessIntentLockOptions,
): Promise<() => Promise<void>> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const deadline = Date.now() + timeoutMs;
  let intentsInfo;
  try {
    intentsInfo = await lstat(
      /* turbopackIgnore: true */ options.intentsDirectory,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await mkdir(
      /* turbopackIgnore: true */ options.intentsDirectory,
      { recursive: true },
    );
    intentsInfo = await lstat(
      /* turbopackIgnore: true */ options.intentsDirectory,
    );
  }
  assertIntentDirectory(intentsInfo, options.label);
  const ownStartIdentity = await processStartIdentity(process.pid);
  if (!ownStartIdentity) {
    throw new Error(`could not verify current process identity for ${options.label}`);
  }
  const ownIdentityHash = identityHash(ownStartIdentity);
  // ── Lamport's choosing phase ───────────────────────────────────────────────
  // The ticket below is taken BEFORE the intent file exists, and an `await`
  // separates the two. A process descheduled in that window registers late
  // carrying an early ticket, and can then win the comparison against a
  // contender that has already decided it was oldest — so both enter the
  // critical section and one update is lost. The window is not theoretical:
  // measured at median 2.6 ms, p95 10.4 ms and max 19.8 ms under 10x CPU load,
  // against contenders that reach this function well under a millisecond
  // apart (issue #5443).
  //
  // This marker closes it. It is published before the ticket is taken and
  // removed once the intent is visible, and no contender compares tickets
  // while any marker is live. That is the guard the bakery algorithm requires
  // and this implementation was missing.
  const choosingName =
    `${process.pid}-${ownIdentityHash}-${randomBytes(8).toString("hex")}.choosing`;
  const choosingPath = path.join(
    /* turbopackIgnore: true */ options.intentsDirectory,
    choosingName,
  );
  const choosingHandle = await open(
    /* turbopackIgnore: true */ choosingPath,
    "wx",
    0o600,
  );
  let ownPath: string;
  try {
    // Inside the removal guard, not before it: a rejecting close() would
    // otherwise escape with the marker still on disk, and because the marker
    // names a process that is still running, the liveness check below would
    // read it as an active chooser and stall every other contender until they
    // timed out. The guard this change adds is exactly what would make that
    // stall total, so its cleanup cannot depend on close() succeeding.
    try {
      await choosingHandle.writeFile(`${process.pid} ${new Date().toISOString()}\n`);
    } finally {
      await choosingHandle.close();
    }
    const order = process.hrtime.bigint().toString().padStart(24, "0");
    const ownName =
      `${order}-${process.pid}-${ownIdentityHash}-` +
      `${randomBytes(8).toString("hex")}.lock`;
    ownPath = path.join(
      /* turbopackIgnore: true */ options.intentsDirectory,
      ownName,
    );
    const handle = await open(
      /* turbopackIgnore: true */ ownPath,
      "wx",
      0o600,
    );
    try {
      await handle.writeFile(`${process.pid} ${new Date().toISOString()}\n`);
    } finally {
      await handle.close();
    }
  } finally {
    // Cleared whether or not the intent was published: a marker outliving its
    // owner's attempt would stall every other contender until the liveness
    // reclaim below noticed, and on the success path it must be gone before
    // this process waits, so it never blocks on itself.
    await removeIntent(choosingPath);
  }
  const ownName = path.basename(ownPath);
  try {
    while (true) {
      assertBeforeDeadline(deadline, options.label);
      try {
        assertIntentDirectory(
          await lstat(
            /* turbopackIgnore: true */ options.intentsDirectory,
          ),
          options.label,
        );
        const entries = await readdir(
          /* turbopackIgnore: true */ options.intentsDirectory,
        );
        assertBeforeDeadline(deadline, options.label);
        // Lamport: do not compare tickets while anyone is still choosing one.
        // A live marker means some process has taken a ticket that may sort
        // ahead of ours and has not published it yet; deciding now is exactly
        // the double-acquisition this guard exists to prevent.
        let chooserIsLive = false;
        for (const entry of entries) {
          if (entry === choosingName) continue;
          const chooser = choosingOwner(entry);
          if (!chooser) continue;
          const chooserIdentity = await processStartIdentity(chooser.pid);
          assertBeforeDeadline(deadline, options.label);
          // Same policy as intents: age proves nothing. Only a dead PID or a
          // different process incarnation makes a marker reclaimable, so a
          // stalled-but-live chooser is waited for rather than stepped over.
          if (
            chooserIdentity === null ||
            identityHash(chooserIdentity) !== chooser.startIdentityHash
          ) {
            await removeIntent(
              path.join(
                /* turbopackIgnore: true */ options.intentsDirectory,
                entry,
              ),
            );
            continue;
          }
          chooserIsLive = true;
          break;
        }
        if (chooserIsLive) {
          await waitBeforeRetry(deadline, options.label);
          continue;
        }
        const names = entries
          .filter((name) => intentOwner(name) !== null)
          .sort();
        assertBeforeDeadline(deadline, options.label);
        const oldest = names[0];
        if (oldest === ownName) {
          let released = false;
          return async () => {
            if (released) return;
            released = true;
            await removeIntent(ownPath);
          };
        }
        if (oldest) {
          const owner = intentOwner(oldest)!;
          const currentIdentity = await processStartIdentity(owner.pid);
          assertBeforeDeadline(deadline, options.label);
          // Never infer death from age: only a dead PID or a demonstrably
          // different process incarnation can make an intent reclaimable.
          if (
            currentIdentity === null ||
            identityHash(currentIdentity) !== owner.startIdentityHash
          ) {
            const removed = await removeIntent(
              path.join(
                /* turbopackIgnore: true */ options.intentsDirectory,
                oldest,
              ),
            );
            assertBeforeDeadline(deadline, options.label);
            if (!removed) {
              await waitBeforeRetry(deadline, options.label);
            }
            continue;
          }
        }
        await waitBeforeRetry(deadline, options.label);
      } catch (error) {
        if (error instanceof InvalidIntentDirectoryError) throw error;
        if (Date.now() >= deadline) throw timeoutError(options.label);
        await waitBeforeRetry(deadline, options.label);
      }
    }
  } catch (error) {
    await removeIntent(ownPath);
    throw error;
  }
}

/**
 * Runs an operation under the process-intent lock while allowing nested store
 * transactions in the same async call chain to reuse that exact lock. Other
 * processes and unrelated async callers still queue on the on-disk intent.
 */
export function withProcessIntentLock<T>(
  options: ProcessIntentLockOptions,
  operation: () => Promise<T>,
): Promise<T> {
  const key = path.resolve(options.intentsDirectory);
  const held = heldIntentDirectories.getStore();
  const inheritedLease = held?.get(key);
  if (inheritedLease?.active) {
    let nested: Promise<T>;
    try {
      nested = operation();
    } catch (error) {
      nested = Promise.reject(error);
    }
    const observed = nested.then(
      () => {},
      () => {},
    );
    inheritedLease.pending.add(observed);
    void observed.then(() => inheritedLease.pending.delete(observed));
    return nested;
  }
  return (async () => {
    const release = await acquireProcessIntentLock(options);
    const lease: HeldIntentLease = { active: true, pending: new Set() };
    const next = new Map(held ?? []);
    next.set(key, lease);
    let result: T | undefined;
    let operationError: unknown;
    let operationFailed = false;
    try {
      result = await heldIntentDirectories.run(next, operation);
    } catch (error) {
      operationFailed = true;
      operationError = error;
    } finally {
      while (lease.pending.size > 0) {
        await Promise.all([...lease.pending]);
      }
      lease.active = false;
      try {
        await release();
      } catch (releaseError) {
        if (!operationFailed) throw releaseError;
      }
    }
    if (operationFailed) throw operationError;
    return result as T;
  })();
}
