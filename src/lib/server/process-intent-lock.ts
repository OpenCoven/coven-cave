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
const INTENT_STATE_NAME = /^\.current-(\d{24})\.intent$/;
const PREVIOUS_INTENT_STATE_NAME =
  /^\.published-(\d{24}-\d+-[a-f0-9]{16}-[a-f0-9]+\.lock)\.intent$/;
const RELEASED_INTENT_NAME = /^\.released-/;
const QUIESCENCE_PROBE_NAME =
  /^\.quiescence-(\d+)-([a-f0-9]{16})-([a-f0-9]+)\.probe$/;
const INTENT_OWNER_FILE = "owner.json";
const INTENT_GATE_FILE = "gate.json";
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
  /** Test/diagnostic crash boundary for durability conformance. */
  publicationStage?: (
    stage:
      | "owner-file-synced"
      | "draft-directory-synced"
      | "quiescence-probe-published"
      | "quiescence-probe-retired"
      | "gate-name-selected"
      | "gate-parent-synced"
      | "state-renamed"
      | "state-parent-synced",
  ) => Promise<void>;
  /** Deterministic acquisition boundaries used by compatibility conformance. */
  acquisitionStage?: (
    stage:
      | "waiting-for-pre-barrier-legacy"
      | "waiting-for-current"
      | "acquired",
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
  currentOrder: bigint | null;
};

function intentOrder(name: string): bigint | null {
  const match =
    LEGACY_INTENT_NAME.exec(name) ?? TRANSITIONAL_INTENT_NAME.exec(name);
  return match ? BigInt(match[1]) : null;
}

type CurrentPublication = {
  gateName: string;
  order: bigint;
  owner: IntentOwner;
  preBarrierLegacyNames: ReadonlySet<string>;
  statePath: string;
};

function sameOwner(left: IntentOwner, right: IntentOwner): boolean {
  return (
    left.pid === right.pid &&
    left.startIdentityHash === right.startIdentityHash
  );
}

async function readCurrentPublication(
  intentsDirectory: string,
  name: string,
): Promise<CurrentPublication | null> {
  const match = INTENT_STATE_NAME.exec(name);
  if (!match) return null;
  const statePath = path.join(
    /* turbopackIgnore: true */ intentsDirectory,
    name,
  );
  try {
    const info = await lstat(/* turbopackIgnore: true */ statePath);
    if (info.isSymbolicLink() || !info.isDirectory()) return null;
    const [ownerRaw, gateRaw] = await Promise.all([
      readFile(
        /* turbopackIgnore: true */ path.join(statePath, INTENT_OWNER_FILE),
        "utf8",
      ),
      readFile(
        /* turbopackIgnore: true */ path.join(statePath, INTENT_GATE_FILE),
        "utf8",
      ),
    ]);
    const owner = JSON.parse(ownerRaw) as Partial<IntentOwner>;
    const gate = JSON.parse(gateRaw) as {
      gateName?: unknown;
      preBarrierLegacyNames?: unknown;
      protocol?: unknown;
    };
    if (
      !Number.isSafeInteger(owner.pid) ||
      Number(owner.pid) <= 0 ||
      typeof owner.startIdentityHash !== "string" ||
      !/^[a-f0-9]{16}$/.test(owner.startIdentityHash) ||
      typeof gate.gateName !== "string" ||
      gate.protocol !== 2 ||
      !Array.isArray(gate.preBarrierLegacyNames) ||
      gate.preBarrierLegacyNames.some(
        (entry) =>
          typeof entry !== "string" ||
          intentOrder(entry) === null,
      ) ||
      new Set(gate.preBarrierLegacyNames).size !==
        gate.preBarrierLegacyNames.length
    ) {
      return null;
    }
    const preBarrierLegacyNames = gate.preBarrierLegacyNames as string[];
    const gateOwner = legacyIntentOwner(gate.gateName);
    const publicationOwner = {
      pid: Number(owner.pid),
      startIdentityHash: owner.startIdentityHash,
    };
    if (!gateOwner || !sameOwner(gateOwner, publicationOwner)) return null;
    const barrier = JSON.parse(
      await readFile(
        /* turbopackIgnore: true */ path.join(
          intentsDirectory,
          gate.gateName,
        ),
        "utf8",
      ),
    ) as Partial<IntentOwner> & {
      protocol?: unknown;
      preBarrierLegacyNames?: unknown;
    };
    if (
      barrier.protocol !== 2 ||
      !Number.isSafeInteger(barrier.pid) ||
      Number(barrier.pid) !== publicationOwner.pid ||
      barrier.startIdentityHash !== publicationOwner.startIdentityHash ||
      !Array.isArray(barrier.preBarrierLegacyNames) ||
      barrier.preBarrierLegacyNames.length !==
        preBarrierLegacyNames.length ||
      barrier.preBarrierLegacyNames.some(
        (entry, index) => entry !== preBarrierLegacyNames[index],
      )
    ) {
      return null;
    }
    return {
      gateName: gate.gateName,
      order: BigInt(match[1]),
      owner: publicationOwner,
      preBarrierLegacyNames: new Set(preBarrierLegacyNames),
      statePath,
    };
  } catch {
    return null;
  }
}

async function listCurrentPublications(
  intentsDirectory: string,
  names: string[],
): Promise<Map<string, CurrentPublication>> {
  const publications = (
    await Promise.all(
      names.map((name) => readCurrentPublication(intentsDirectory, name)),
    )
  ).filter(
    (publication): publication is CurrentPublication => publication !== null,
  );
  const byGate = new Map<string, CurrentPublication>();
  const duplicates = new Set<string>();
  for (const publication of publications) {
    if (byGate.has(publication.gateName)) {
      duplicates.add(publication.gateName);
    } else {
      byGate.set(publication.gateName, publication);
    }
  }
  for (const duplicate of duplicates) byGate.delete(duplicate);
  return byGate;
}

async function readIntentEntry(
  intentsDirectory: string,
  name: string,
  currentPublications: Map<string, CurrentPublication>,
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
    const publication = currentPublications.get(name);
    return {
      name,
      order,
      owner: legacyOwner,
      modifiedAtMs: info.mtimeMs,
      currentOrder:
        publication && sameOwner(publication.owner, legacyOwner)
          ? publication.order
          : null,
    };
  }
  if (info.isSymbolicLink() || !info.isDirectory()) {
    return {
      name,
      order,
      owner: null,
      modifiedAtMs: info.mtimeMs,
      currentOrder: null,
    };
  }
  let ownerRaw: string;
  try {
    ownerRaw = await readFile(
      /* turbopackIgnore: true */ path.join(intentPath, INTENT_OWNER_FILE),
      "utf8",
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return {
      name,
      order,
      owner: null,
      modifiedAtMs: info.mtimeMs,
      currentOrder: null,
    };
  }
  try {
    const parsed = JSON.parse(ownerRaw) as Partial<IntentOwner>;
    return {
      name,
      order,
      modifiedAtMs: info.mtimeMs,
      currentOrder: null,
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
    return {
      name,
      order,
      owner: null,
      modifiedAtMs: info.mtimeMs,
      currentOrder: null,
    };
  }
}

async function listIntentEntries(
  intentsDirectory: string,
): Promise<IntentEntry[]> {
  const names = await readdir(/* turbopackIgnore: true */ intentsDirectory);
  const currentPublications = await listCurrentPublications(
    intentsDirectory,
    names,
  );
  const entries = (
    await Promise.all(
      names.map((name) =>
        readIntentEntry(intentsDirectory, name, currentPublications),
      ),
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
      const quiescenceProbe = QUIESCENCE_PROBE_NAME.exec(name);
      if (quiescenceProbe) {
        const pid = Number(quiescenceProbe[1]);
        if (!Number.isSafeInteger(pid) || pid <= 0) return;
        const identity = await processStartIdentity(pid);
        if (
          identity !== null &&
          identityHash(identity) === quiescenceProbe[2]
        ) {
          return;
        }
        await removeIntent(pathname);
        return;
      }
      if (RELEASED_INTENT_NAME.test(name)) {
        await removeIntent(pathname);
        return;
      }
      const previousState = PREVIOUS_INTENT_STATE_NAME.exec(name);
      if (previousState) {
        try {
          await lstat(
            /* turbopackIgnore: true */ path.join(
              intentsDirectory,
              previousState[1],
            ),
          );
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            await removeIntent(pathname);
          }
        }
        return;
      }
      if (!INTENT_STATE_NAME.test(name)) return;
      const publication = await readCurrentPublication(
        intentsDirectory,
        name,
      );
      if (!publication) return;
      const gatePath = path.join(
        /* turbopackIgnore: true */ intentsDirectory,
        publication.gateName,
      );
      try {
        await lstat(/* turbopackIgnore: true */ gatePath);
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") return;
      }
      // The compatibility gate is durable before the sequenced state rename
      // and is retired last. With no gate, the state is never authoritative.
      await removeIntent(pathname);
    }),
  );
}

function legacySnapshot(entries: IntentEntry[]): string[] {
  return entries
    .filter((entry) => entry.currentOrder === null)
    .map((entry) => entry.name)
    .sort();
}

function sameSnapshot(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((entry, index) => entry === right[index])
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

async function establishLegacyQuiescence(
  options: ProcessIntentLockOptions,
  owner: IntentOwner,
  deadline: number,
): Promise<string[]> {
  let stableSnapshot: string[] | null = null;
  let stableProbeCount = 0;
  while (stableProbeCount < 2) {
    assertCanContinue(deadline, options.label, options.signal);
    const before = legacySnapshot(
      await listIntentEntries(options.intentsDirectory),
    );
    const probeName =
      `.quiescence-${owner.pid}-${owner.startIdentityHash}-` +
      `${randomBytes(8).toString("hex")}.probe`;
    const probePath = path.join(
      /* turbopackIgnore: true */ options.intentsDirectory,
      probeName,
    );
    if (!QUIESCENCE_PROBE_NAME.test(probeName)) {
      throw new Error("invalid compatibility quiescence probe");
    }
    const probe = await open(
      /* turbopackIgnore: true */ probePath,
      "wx",
      0o600,
    );
    try {
      await probe.writeFile(`${JSON.stringify(owner)}\n`);
      await probe.sync();
    } finally {
      await probe.close();
    }
    await fsyncDirectoryIfSupported(options.intentsDirectory);
    await options.publicationStage?.("quiescence-probe-published");
    const during = legacySnapshot(
      await listIntentEntries(options.intentsDirectory),
    );
    await retireIntent(probePath);
    await fsyncDirectoryIfSupported(options.intentsDirectory);
    await options.publicationStage?.("quiescence-probe-retired");
    const after = legacySnapshot(
      await listIntentEntries(options.intentsDirectory),
    );

    if (
      sameSnapshot(before, during) &&
      sameSnapshot(during, after) &&
      stableSnapshot !== null &&
      sameSnapshot(stableSnapshot, after)
    ) {
      stableProbeCount += 1;
    } else if (
      sameSnapshot(before, during) &&
      sameSnapshot(during, after)
    ) {
      stableSnapshot = after;
      stableProbeCount = 1;
    } else {
      stableSnapshot = null;
      stableProbeCount = 0;
    }
    if (stableProbeCount < 2) {
      await waitBeforeRetry(deadline, options.label, options.signal);
    }
  }
  return stableSnapshot ?? [];
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
  deadline: number,
): Promise<{ name: string; path: string; preBarrierLegacyNames: string[] }> {
  for (;;) {
    const order = "000000000000000000000000";
    const name =
      `${order}-${owner.pid}-${owner.startIdentityHash}-` +
      `${randomBytes(8).toString("hex")}.lock`;
    await options.publicationStage?.("gate-name-selected");
    const preBarrierLegacyNames = await establishLegacyQuiescence(
      options,
      owner,
      deadline,
    );
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
        await handle.writeFile(
          `${JSON.stringify({
            ...owner,
            protocol: 2,
            preBarrierLegacyNames,
          })}\n`,
        );
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fsyncDirectoryIfSupported(intentsDirectory);
      await options.publicationStage?.("gate-parent-synced");
      return { name, path: pathname, preBarrierLegacyNames };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
      if (created) await removeIntent(pathname);
      throw error;
    }
  }
}

async function renameCollision(
  error: unknown,
  destination: string,
): Promise<boolean> {
    const code = (error as NodeJS.ErrnoException).code ?? "";
    if (code === "EEXIST" || code === "ENOTEMPTY") return true;
    if (code !== "EACCES" && code !== "EPERM") return false;
    try {
      await lstat(/* turbopackIgnore: true */ destination);
      return true;
    } catch {
      return false;
    }
}

async function publishCurrentState(
  intentsDirectory: string,
  draftPath: string,
  gateName: string,
  preBarrierLegacyNames: string[],
  options: ProcessIntentLockOptions,
): Promise<{ order: bigint; path: string }> {
    const gateHandle = await open(
      /* turbopackIgnore: true */ path.join(draftPath, INTENT_GATE_FILE),
      "wx",
      0o600,
    );
    try {
      await gateHandle.writeFile(
        `${JSON.stringify({
          protocol: 2,
          gateName,
          preBarrierLegacyNames,
        })}\n`,
      );
      await gateHandle.sync();
    } finally {
      await gateHandle.close();
    }
    await fsyncDirectoryIfSupported(draftPath);

    for (;;) {
      const names = await readdir(
        /* turbopackIgnore: true */ intentsDirectory,
      );
      const highest = names.reduce((current, name) => {
        const match = INTENT_STATE_NAME.exec(name);
        if (!match) return current;
        const order = BigInt(match[1]);
        return order > current ? order : current;
      }, BigInt(0));
      const order = highest + BigInt(1);
      const statePath = path.join(
        /* turbopackIgnore: true */ intentsDirectory,
        `.current-${order.toString().padStart(24, "0")}.intent`,
      );
      try {
        await rename(
          /* turbopackIgnore: true */ draftPath,
          /* turbopackIgnore: true */ statePath,
        );
        await options.publicationStage?.("state-renamed");
        await fsyncDirectoryIfSupported(intentsDirectory);
        await options.publicationStage?.("state-parent-synced");
        return { order, path: statePath };
      } catch (error) {
        if (await renameCollision(error, statePath)) continue;
        throw error;
    }
  }
}

/**
 * Cross-version safety invariant:
 *
 * A current contender first obtains two identical snapshots across complete,
 * durable probe publication/retirement cycles. It records that pre-barrier
 * legacy set in an order-zero compatibility barrier, then joins the current
 * queue. Recorded owners block it; later legacy publishers sort behind the
 * retained barrier and are safe to ignore while they naturally wait. A legacy
 * publisher paused before publication is therefore fenced without creating a
 * current/legacy wait cycle.
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
  let ownCurrentOrder: bigint | null = null;
  let preBarrierLegacyNames = new Set<string>();
  try {
    assertCanContinue(deadline, options.label, options.signal);
    await waitAtPublicationBoundary(options, deadline);
    const gate = await publishCompatibilityGate(
      options.intentsDirectory,
      owner,
      options,
      deadline,
    );
    const quiescentLegacyNames = gate.preBarrierLegacyNames;
    preBarrierLegacyNames = new Set(quiescentLegacyNames);
    ownName = gate.name;
    ownPath = gate.path;
    const currentState = await publishCurrentState(
      options.intentsDirectory,
      draftPath,
      ownName,
      quiescentLegacyNames,
      options,
    );
    ownStatePath = currentState.path;
    ownCurrentOrder = currentState.order;

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
        const ownEntry = entries.find(
          (entry) =>
            entry.name === ownName &&
            entry.currentOrder === ownCurrentOrder,
        );
        if (!ownEntry) {
          await waitBeforeRetry(deadline, options.label, options.signal);
          continue;
        }

        let removedBlocker = false;
        let legacyBlocked = false;
        let currentQueueBlocked = false;
        for (const entry of entries) {
          if (entry.name === ownName) continue;
          const isPreBarrierLegacy =
            entry.currentOrder === null &&
            preBarrierLegacyNames.has(entry.name);
          const isEarlierCurrent =
            entry.currentOrder !== null &&
            entry.currentOrder < ownCurrentOrder!;
          if (!isPreBarrierLegacy && !isEarlierCurrent) continue;

          if (!entry.owner) {
            if (
              Date.now() - entry.modifiedAtMs >=
              MALFORMED_INTENT_GRACE_MS
            ) {
              const removed = await removeIntent(
                path.join(
                  /* turbopackIgnore: true */ options.intentsDirectory,
                  entry.name,
                ),
              );
              if (removed) {
                removedBlocker = true;
                continue;
              }
            }
            if (isPreBarrierLegacy) legacyBlocked = true;
            else currentQueueBlocked = true;
            continue;
          }

          const currentIdentity = await processStartIdentity(entry.owner.pid);
          assertCanContinue(deadline, options.label, options.signal);
          if (
            currentIdentity === null ||
            identityHash(currentIdentity) !== entry.owner.startIdentityHash
          ) {
            if (entry.currentOrder !== null) {
              await removeIntent(
                path.join(
                  /* turbopackIgnore: true */ options.intentsDirectory,
                  `.current-${entry.currentOrder
                    .toString()
                    .padStart(24, "0")}.intent`,
                ),
              );
            }
            const removed = await removeIntent(
              path.join(
                /* turbopackIgnore: true */ options.intentsDirectory,
                entry.name,
              ),
            );
            assertCanContinue(deadline, options.label, options.signal);
            if (removed) {
              removedBlocker = true;
              continue;
            }
          }
          if (isPreBarrierLegacy) legacyBlocked = true;
          else currentQueueBlocked = true;
        }

        if (removedBlocker) continue;
        if (legacyBlocked) {
          await options.acquisitionStage?.(
            "waiting-for-pre-barrier-legacy",
          );
        }
        if (currentQueueBlocked) {
          await options.acquisitionStage?.("waiting-for-current");
        }
        if (legacyBlocked || currentQueueBlocked) {
          await waitBeforeRetry(deadline, options.label, options.signal);
          continue;
        }

        await options.acquisitionStage?.("acquired");
        let released = false;
        return async () => {
          if (released) return;
          released = true;
          await retireIntent(ownStatePath!);
          await retireIntent(ownPath!);
        };
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
