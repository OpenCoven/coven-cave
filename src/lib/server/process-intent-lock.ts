import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  mkdir,
  lstat,
  open,
  readFile,
  readdir,
  rename,
  rm,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const LEGACY_INTENT_NAME =
  /^(\d{24})-(\d+)-([a-f0-9]{16})-([a-f0-9]+)\.lock$/;
const INTENT_NAME = /^(\d{24})\.lock$/;
const INTENT_DRAFT_NAME =
  /^\.intent-(\d+)-([a-f0-9]{16})-([a-f0-9]+)\.tmp$/;
const INTENT_OWNER_FILE = "owner.json";
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
        await rm(
          /* turbopackIgnore: true */ pathname,
          { force: true, recursive: true },
        );
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

async function retireIntent(pathname: string): Promise<boolean> {
  const retiredPath = path.join(
    /* turbopackIgnore: true */ path.dirname(pathname),
    `.released-${path.basename(pathname)}-${randomBytes(8).toString("hex")}`,
  );
  try {
    await rename(
      /* turbopackIgnore: true */ pathname,
      /* turbopackIgnore: true */ retiredPath,
    );
    return removeIntent(retiredPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    // A failed retirement keeps the public intent blocking successors until
    // the existing retry owner removes that exact path.
    return removeIntent(pathname);
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

function legacyIntentOwner(
  name: string,
): { pid: number; startIdentityHash: string } | null {
  const match = LEGACY_INTENT_NAME.exec(name);
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
  signal?: AbortSignal;
  /** Test/diagnostic boundary immediately before atomic intent publication. */
  beforePublish?: () => Promise<void>;
};

function timeoutError(label: string): Error {
  return new Error(`timed out waiting for ${label} lock`);
}

function cancellationError(label: string): Error {
  return Object.assign(new Error(`cancelled waiting for ${label} lock`), {
    name: "AbortError",
  });
}

function assertCanContinue(
  deadline: number,
  label: string,
  signal?: AbortSignal,
): void {
  if (signal?.aborted) throw cancellationError(label);
  if (Date.now() >= deadline) throw timeoutError(label);
}

async function waitBeforeRetry(
  deadline: number,
  label: string,
  signal?: AbortSignal,
): Promise<void> {
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) throw timeoutError(label);
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(cancellationError(label));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, Math.min(remainingMs, 10 + Math.floor(Math.random() * 20)));
    signal?.addEventListener("abort", onAbort, { once: true });
  });
  assertCanContinue(deadline, label, signal);
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

type IntentOwner = {
  pid: number;
  startIdentityHash: string;
};

type IntentEntry = {
  name: string;
  order: bigint;
  owner: IntentOwner | null;
};

function intentOrder(name: string): bigint | null {
  const match = INTENT_NAME.exec(name) ?? LEGACY_INTENT_NAME.exec(name);
  return match ? BigInt(match[1]) : null;
}

async function readIntentEntry(
  intentsDirectory: string,
  name: string,
): Promise<IntentEntry | null> {
  const order = intentOrder(name);
  if (order === null) return null;
  const legacyOwner = legacyIntentOwner(name);
  if (legacyOwner) return { name, order, owner: legacyOwner };

  const intentPath = path.join(
    /* turbopackIgnore: true */ intentsDirectory,
    name,
  );
  try {
    const info = await lstat(/* turbopackIgnore: true */ intentPath);
    if (info.isSymbolicLink() || !info.isDirectory()) {
      return { name, order, owner: null };
    }
    const parsed = JSON.parse(
      await readFile(
        /* turbopackIgnore: true */ path.join(intentPath, INTENT_OWNER_FILE),
        "utf8",
      ),
    ) as Partial<IntentOwner>;
    return {
      name,
      order,
      owner:
        Number.isSafeInteger(parsed.pid) &&
        Number(parsed.pid) > 0 &&
        typeof parsed.startIdentityHash === "string" &&
        /^[a-f0-9]{16}$/.test(parsed.startIdentityHash)
          ? {
              pid: Number(parsed.pid),
              startIdentityHash: parsed.startIdentityHash,
            }
          : null,
    };
  } catch {
    // A malformed published entry must block rather than disappear from the
    // queue and let two owners overlap.
    return { name, order, owner: null };
  }
}

async function listIntentEntries(
  intentsDirectory: string,
): Promise<IntentEntry[]> {
  const names = await readdir(/* turbopackIgnore: true */ intentsDirectory);
  const entries = (
    await Promise.all(
      names.map((name) => readIntentEntry(intentsDirectory, name)),
    )
  ).filter((entry): entry is IntentEntry => entry !== null);
  entries.sort(
    (left, right) =>
      (left.order < right.order ? -1 : left.order > right.order ? 1 : 0) ||
      left.name.localeCompare(right.name),
  );
  return entries;
}

async function removeStaleIntentDrafts(
  intentsDirectory: string,
): Promise<void> {
  const names = await readdir(/* turbopackIgnore: true */ intentsDirectory);
  await Promise.all(
    names.map(async (name) => {
      const match = INTENT_DRAFT_NAME.exec(name);
      if (!match) return;
      const pid = Number(match[1]);
      if (!Number.isSafeInteger(pid) || pid <= 0) return;
      const identity = await processStartIdentity(pid);
      if (identity !== null && identityHash(identity) === match[2]) return;
      await removeIntent(
        path.join(/* turbopackIgnore: true */ intentsDirectory, name),
      );
    }),
  );
}

async function isRenameCollision(
  error: unknown,
  destination: string,
): Promise<boolean> {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "EEXIST" || code === "ENOTEMPTY") return true;
  if (code !== "EPERM" && code !== "EACCES") return false;
  try {
    await lstat(/* turbopackIgnore: true */ destination);
    return true;
  } catch {
    return false;
  }
}

async function waitAtPublicationBoundary(
  options: ProcessIntentLockOptions,
  deadline: number,
): Promise<void> {
  if (!options.beforePublish) return;
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) throw timeoutError(options.label);
  let timer: NodeJS.Timeout | undefined;
  let onAbort: (() => void) | undefined;
  try {
    await Promise.race([
      options.beforePublish(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(timeoutError(options.label)),
          remainingMs,
        );
        if (options.signal) {
          onAbort = () => reject(cancellationError(options.label));
          options.signal.addEventListener("abort", onAbort, { once: true });
        }
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    if (onAbort) options.signal?.removeEventListener("abort", onAbort);
  }
  assertCanContinue(deadline, options.label, options.signal);
}

async function prepareIntentDraft(
  options: ProcessIntentLockOptions,
  owner: IntentOwner,
): Promise<string> {
  for (;;) {
    const draftPath = path.join(
      /* turbopackIgnore: true */ options.intentsDirectory,
      `.intent-${owner.pid}-${owner.startIdentityHash}-` +
        `${randomBytes(8).toString("hex")}.tmp`,
    );
    try {
      await mkdir(/* turbopackIgnore: true */ draftPath, { mode: 0o700 });
      try {
        const ownerHandle = await open(
          /* turbopackIgnore: true */ path.join(draftPath, INTENT_OWNER_FILE),
          "wx",
          0o600,
        );
        try {
          await ownerHandle.writeFile(`${JSON.stringify(owner)}\n`);
          await ownerHandle.sync();
        } finally {
          await ownerHandle.close();
        }
        return draftPath;
      } catch (error) {
        await rm(
          /* turbopackIgnore: true */ draftPath,
          { force: true, recursive: true },
        );
        throw error;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw error;
    }
  }
}

/**
 * Cross-process FIFO lock where every contender owns one atomically published
 * intent directory. An exclusive directory rename assigns the next creation
 * sequence: a contender paused before that rename has no priority to publish
 * later. Release removes only the caller's unique entry. Dead owners are
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
  const owner = {
    pid: process.pid,
    startIdentityHash: identityHash(ownStartIdentity),
  };
  await removeStaleIntentDrafts(options.intentsDirectory);
  const draftPath = await prepareIntentDraft(options, owner);
  let ownName: string | null = null;
  let ownPath: string | null = null;
  try {
    while (!ownName) {
      assertCanContinue(deadline, options.label, options.signal);
      const entries = await listIntentEntries(options.intentsDirectory);
      const nextOrder =
        entries.reduce(
          (highest, entry) => (entry.order > highest ? entry.order : highest),
          BigInt(0),
        ) + BigInt(1);
      const candidateName = `${nextOrder.toString().padStart(24, "0")}.lock`;
      const candidatePath = path.join(
        /* turbopackIgnore: true */ options.intentsDirectory,
        candidateName,
      );
      await waitAtPublicationBoundary(options, deadline);
      try {
        await rename(
          /* turbopackIgnore: true */ draftPath,
          /* turbopackIgnore: true */ candidatePath,
        );
        ownName = candidateName;
        ownPath = candidatePath;
      } catch (error) {
        if (await isRenameCollision(error, candidatePath)) continue;
        throw error;
      }
    }

    while (true) {
      assertCanContinue(deadline, options.label, options.signal);
      try {
        assertIntentDirectory(
          await lstat(
            /* turbopackIgnore: true */ options.intentsDirectory,
          ),
          options.label,
        );
        const entries = await listIntentEntries(options.intentsDirectory);
        assertCanContinue(deadline, options.label, options.signal);
        const oldest = entries[0];
        if (oldest?.name === ownName) {
          let released = false;
          return async () => {
            if (released) return;
            released = true;
            await retireIntent(ownPath!);
          };
        }
        if (oldest) {
          if (!oldest.owner) {
            await waitBeforeRetry(
              deadline,
              options.label,
              options.signal,
            );
            continue;
          }
          const currentIdentity = await processStartIdentity(oldest.owner.pid);
          assertCanContinue(deadline, options.label, options.signal);
          // Never infer death from age: only a dead PID or a demonstrably
          // different process incarnation can make an intent reclaimable.
          if (
            currentIdentity === null ||
            identityHash(currentIdentity) !== oldest.owner.startIdentityHash
          ) {
            const removed = await removeIntent(
              path.join(
                /* turbopackIgnore: true */ options.intentsDirectory,
                oldest.name,
              ),
            );
            assertCanContinue(deadline, options.label, options.signal);
            if (!removed) {
              await waitBeforeRetry(
                deadline,
                options.label,
                options.signal,
              );
            }
            continue;
          }
        }
        await waitBeforeRetry(deadline, options.label, options.signal);
      } catch (error) {
        if (
          error instanceof InvalidIntentDirectoryError ||
          (error as Error).name === "AbortError"
        ) {
          throw error;
        }
        if (Date.now() >= deadline) throw timeoutError(options.label);
        await waitBeforeRetry(deadline, options.label, options.signal);
      }
    }
  } catch (error) {
    await removeIntent(ownPath ?? draftPath);
    throw error;
  }
}
