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
const execFileAsync = promisify(execFile);
const pendingIntentRemovals = new Map<
  string,
  { cleanup: Promise<void>; firstAttempt: Promise<boolean> }
>();

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
  const order = process.hrtime.bigint().toString().padStart(24, "0");
  const ownName =
    `${order}-${process.pid}-${identityHash(ownStartIdentity)}-` +
    `${randomBytes(8).toString("hex")}.lock`;
  const ownPath = path.join(
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
        const names = (
          await readdir(
            /* turbopackIgnore: true */ options.intentsDirectory,
          )
        )
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
