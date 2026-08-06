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
const TRANSITIONAL_INTENT_NAME = /^(\d{24})\.lock$/;
const INTENT_DRAFT_NAME =
  /^\.intent-(\d+)-([a-f0-9]{16})-([a-f0-9]+)\.tmp$/;
const INTENT_STATE_NAME =
  /^\.published-(\d{24}-\d+-[a-f0-9]{16}-[a-f0-9]+\.lock)\.intent$/;
const RELEASED_INTENT_NAME = /^\.released-/;
const INTENT_OWNER_FILE = "owner.json";
const MALFORMED_INTENT_GRACE_MS = 30_000;
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
    await fsyncDirectoryIfSupported(path.dirname(pathname));
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
      const { stdout } = await execFileAsync("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        script,
      ]);
      const startedAt = stdout.trim();
      if (startedAt) return `win32:${startedAt}`;
    } else {
      const { stdout } = await execFileAsync("ps", [
        "-o",
        "lstart=",
        "-p",
        String(pid),
      ]);
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
  /** Test/diagnostic crash boundary for durability conformance. */
  publicationStage?: (
    stage:
      | "owner-file-synced"
      | "draft-directory-synced"
      | "gate-name-selected"
      | "gate-parent-synced"
      | "state-renamed"
      | "state-parent-synced",
  ) => Promise<void>;
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
  modifiedAtMs: number;
};

function intentOrder(name: string): bigint | null {
  const match =
    LEGACY_INTENT_NAME.exec(name) ?? TRANSITIONAL_INTENT_NAME.exec(name);
  return match ? BigInt(match[1]) : null;
}

async function readIntentEntry(
  intentsDirectory: string,
  name: string,
): Promise<IntentEntry | null> {
  const order = intentOrder(name);
  if (order === null) return null;
  const legacyOwner = legacyIntentOwner(name);
  const intentPath = path.join(
    /* turbopackIgnore: true */ intentsDirectory,
    name,
  );
  let info: Awaited<ReturnType<typeof lstat>>;
  try {
    info = await lstat(/* turbopackIgnore: true */ intentPath);
  } catch {
    return null;
  }
  if (legacyOwner) {
    return {
      name,
      order,
      owner: legacyOwner,
      modifiedAtMs: info.mtimeMs,
    };
  }
  if (info.isSymbolicLink() || !info.isDirectory()) {
    return { name, order, owner: null, modifiedAtMs: info.mtimeMs };
  }
  let ownerRaw: string;
  try {
    ownerRaw = await readFile(
      /* turbopackIgnore: true */ path.join(intentPath, INTENT_OWNER_FILE),
      "utf8",
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return { name, order, owner: null, modifiedAtMs: info.mtimeMs };
  }
  try {
    const parsed = JSON.parse(ownerRaw) as Partial<IntentOwner>;
    return {
      name,
      order,
      modifiedAtMs: info.mtimeMs,
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
    // Transitional directory intents are published only after their owner
    // file is durable. A malformed entry therefore receives a grace period
    // before stale recovery rather than blocking the repository forever.
    return { name, order, owner: null, modifiedAtMs: info.mtimeMs };
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

async function removeStaleIntentArtifacts(
  intentsDirectory: string,
): Promise<void> {
  const names = await readdir(/* turbopackIgnore: true */ intentsDirectory);
  await Promise.all(
    names.map(async (name) => {
      const pathname = path.join(
        /* turbopackIgnore: true */ intentsDirectory,
        name,
      );
      if (RELEASED_INTENT_NAME.test(name)) {
        await removeIntent(pathname);
        return;
      }
      const stateMatch = INTENT_STATE_NAME.exec(name);
      if (!stateMatch) return;
      const gatePath = path.join(
        /* turbopackIgnore: true */ intentsDirectory,
        stateMatch[1],
      );
      try {
        await lstat(/* turbopackIgnore: true */ gatePath);
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") return;
      }
      // The compatibility gate is always durable before this sidecar rename
      // and is retired last. With no gate, the sidecar is never authoritative
      // and cannot represent an in-progress publication.
      await removeIntent(pathname);
    }),
  );
}

const UNSUPPORTED_DIRECTORY_SYNC_CODES = new Set([
  "EACCES",
  "EBADF",
  "EISDIR",
  "EINVAL",
  "ENOSYS",
  "ENOTSUP",
  "EPERM",
]);

function isUnsupportedDirectorySync(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code ?? "";
  return process.platform === "win32"
    ? UNSUPPORTED_DIRECTORY_SYNC_CODES.has(code)
    : code === "EINVAL" || code === "ENOSYS" || code === "ENOTSUP";
}

async function fsyncDirectoryIfSupported(directory: string): Promise<void> {
  let handle;
  try {
    handle = await open(/* turbopackIgnore: true */ directory, "r");
  } catch (error) {
    if (isUnsupportedDirectorySync(error)) return;
    throw error;
  }
  try {
    try {
      await handle.sync();
    } catch (error) {
      if (!isUnsupportedDirectorySync(error)) throw error;
    }
  } finally {
    await handle.close();
  }
}

async function ensureIntentDirectory(
  directory: string,
  label: string,
): Promise<Awaited<ReturnType<typeof lstat>>> {
  const missing: string[] = [];
  let existing = directory;
  let existingInfo: Awaited<ReturnType<typeof lstat>>;
  for (;;) {
    try {
      existingInfo = await lstat(/* turbopackIgnore: true */ existing);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = path.dirname(existing);
      if (parent === existing) throw error;
      missing.push(path.basename(existing));
      existing = parent;
    }
  }
  assertIntentDirectory(existingInfo, label);
  for (const name of missing.reverse()) {
    const child = path.join(/* turbopackIgnore: true */ existing, name);
    try {
      await mkdir(/* turbopackIgnore: true */ child, { mode: 0o700 });
      await fsyncDirectoryIfSupported(existing);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    existing = child;
    existingInfo = await lstat(/* turbopackIgnore: true */ existing);
    assertIntentDirectory(existingInfo, label);
  }
  return existingInfo;
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
        await options.publicationStage?.("owner-file-synced");
        await fsyncDirectoryIfSupported(draftPath);
        await options.publicationStage?.("draft-directory-synced");
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

async function publishCompatibilityGate(
  intentsDirectory: string,
  owner: IntentOwner,
  options: ProcessIntentLockOptions,
  minimumOrder = BigInt(0),
): Promise<{ name: string; path: string }> {
  for (;;) {
    const now = process.hrtime.bigint();
    const order = (now > minimumOrder ? now : minimumOrder)
      .toString()
      .padStart(24, "0");
    const name =
      `${order}-${owner.pid}-${owner.startIdentityHash}-` +
      `${randomBytes(8).toString("hex")}.lock`;
    await options.publicationStage?.("gate-name-selected");
    const pathname = path.join(
      /* turbopackIgnore: true */ intentsDirectory,
      name,
    );
    let created = false;
    try {
      const handle = await open(
        /* turbopackIgnore: true */ pathname,
        "wx",
        0o600,
      );
      created = true;
      try {
        await handle.writeFile(`${JSON.stringify(owner)}\n`);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fsyncDirectoryIfSupported(intentsDirectory);
      await options.publicationStage?.("gate-parent-synced");
      return { name, path: pathname };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
      if (created) await removeIntent(pathname);
      throw error;
    }
  }
}

/**
 * Cross-process lock with a legacy-shaped compatibility gate plus a durable
 * owner directory. The gate is published only after the diagnostic pause, so
 * a late contender cannot carry pre-publication priority into an active
 * critical section. Deployed legacy processes recognize the gate and current
 * processes retain the owner directory for crash-stage recovery.
 */
export async function acquireProcessIntentLock(
  options: ProcessIntentLockOptions,
): Promise<() => Promise<void>> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const deadline = Date.now() + timeoutMs;
  const intentsInfo = await ensureIntentDirectory(
    options.intentsDirectory,
    options.label,
  );
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
  await removeStaleIntentArtifacts(options.intentsDirectory);
  const draftPath = await prepareIntentDraft(options, owner);
  let ownName: string | null = null;
  let ownPath: string | null = null;
  let ownStatePath: string | null = null;
  let yieldedPrepublicationPriority = false;
  try {
    assertCanContinue(deadline, options.label, options.signal);
    await waitAtPublicationBoundary(options, deadline);
    const gate = await publishCompatibilityGate(
      options.intentsDirectory,
      owner,
      options,
    );
    ownName = gate.name;
    ownPath = gate.path;
    ownStatePath = path.join(
      /* turbopackIgnore: true */ options.intentsDirectory,
      `.published-${ownName}.intent`,
    );
    await rename(
      /* turbopackIgnore: true */ draftPath,
      /* turbopackIgnore: true */ ownStatePath,
    );
    await options.publicationStage?.("state-renamed");
    await fsyncDirectoryIfSupported(options.intentsDirectory);
    await options.publicationStage?.("state-parent-synced");

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
          // A contender can be descheduled after choosing its lexical order
          // but before creating the gate. Yield once behind every intent it
          // then observes. A single yield is deliberate: two current
          // contenders that repeatedly yield would leapfrog forever.
          if (entries.length > 1 && !yieldedPrepublicationPriority) {
            const highestOrder = entries.reduce(
              (highest, entry) =>
                entry.order > highest ? entry.order : highest,
              oldest.order,
            );
            const replacement = await publishCompatibilityGate(
              options.intentsDirectory,
              owner,
              options,
              highestOrder + BigInt(1),
            );
            const replacementStatePath = path.join(
              /* turbopackIgnore: true */ options.intentsDirectory,
              `.published-${replacement.name}.intent`,
            );
            try {
              await rename(
                /* turbopackIgnore: true */ ownStatePath!,
                /* turbopackIgnore: true */ replacementStatePath,
              );
              await fsyncDirectoryIfSupported(options.intentsDirectory);
            } catch (error) {
              await retireIntent(replacement.path);
              throw error;
            }
            const previousPath = ownPath!;
            ownName = replacement.name;
            ownPath = replacement.path;
            ownStatePath = replacementStatePath;
            yieldedPrepublicationPriority = true;
            await retireIntent(previousPath);
            continue;
          }
          let released = false;
          return async () => {
            if (released) return;
            released = true;
            await retireIntent(ownStatePath!);
            await retireIntent(ownPath!);
          };
        }
        if (oldest) {
          if (!oldest.owner) {
            if (
              Date.now() - oldest.modifiedAtMs >=
              MALFORMED_INTENT_GRACE_MS
            ) {
              const removed = await removeIntent(
                path.join(
                  /* turbopackIgnore: true */ options.intentsDirectory,
                  oldest.name,
                ),
              );
              if (removed) continue;
            }
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
    if (ownStatePath) await removeIntent(ownStatePath);
    else await removeIntent(draftPath);
    if (ownPath) await removeIntent(ownPath);
    throw error;
  }
}
