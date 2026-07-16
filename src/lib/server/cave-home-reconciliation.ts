import { createHash, randomBytes } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  copyFile,
  cp,
  link,
  lstat,
  mkdir,
  readFile,
  readlink,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { caveHome, covenHome } from "../coven-paths.ts";
import { normalizeCavePreferences, type CavePreferences } from "../preferences-schema.ts";
import { writeJsonAtomic } from "./atomic-write.ts";

export type ReconciliationStrategy = "inbox" | "state" | "preferences" | "directory" | "manual";

export type CaveHomeReconciliationEntry = {
  legacy: string;
  next: string;
  strategy: ReconciliationStrategy;
};

export type ReconciliationDecision =
  | "absent"
  | "moved"
  | "linked"
  | "managed-mirror"
  | "identical"
  | "merged"
  | "kept-canonical"
  | "recovered-legacy"
  | "unresolved"
  | "deferred";

export type MigrationJournalEntry = {
  legacy: string;
  next: string;
  strategy: ReconciliationStrategy;
  legacyPath: string;
  canonicalPath: string;
  legacyHash?: string;
  canonicalHash?: string;
  legacyMtimeMs?: number;
  canonicalMtimeMs?: number;
  decision: ReconciliationDecision;
  compatibility?: "symlink" | "mirror";
  managedMirrorHash?: string;
  backupId?: string;
  decidedAt: string;
  summary?: string;
};

export type MigrationJournal = {
  version: 1;
  migrationVersion: 2;
  updatedAt: string;
  entries: Record<string, MigrationJournalEntry>;
};

export type CaveHomeConflictDetail = {
  legacy: string;
  next: string;
  strategy: ReconciliationStrategy;
  legacyPath: string;
  canonicalPath: string;
  legacyHash?: string;
  canonicalHash?: string;
  legacyMtimeMs?: number;
  canonicalMtimeMs?: number;
  state: "pending" | "unresolved" | "managed";
  summary: string;
  differences: string[];
  backupPath?: string;
  actions: Array<"merge" | "keep-canonical" | "recover-legacy" | "defer">;
};

export type CaveHomeReconciliationStatus = {
  pending: string[];
  conflicts: string[];
  migrated: boolean;
  details: CaveHomeConflictDetail[];
  backupRoot: string;
  journalPath: string;
};

export type CaveHomeReconciliationResult = {
  moved: string[];
  linked: string[];
  skipped: string[];
  merged: Array<{ legacy: string; files: number; collisions: number }>;
  backedUp: string[];
  resolved: string[];
  errors: Array<{ legacy: string; error: string }>;
};

export type ReconciliationAction = "merge" | "keep-canonical" | "recover-legacy" | "defer";

export type ReconciliationOptions = {
  action?: ReconciliationAction;
  legacy?: string;
  /** Test-only fault boundary. Production callers must omit it. */
  faultAt?: string;
  /** Test-only compatibility bridge override. */
  createSymlink?: typeof symlink;
  /** Test-only lock lifecycle probe. */
  lockProbe?: (event: "stale-observed" | "acquired" | "released") => void | Promise<void>;
  /** Test-only hook before a legacy path is replaced by its compatibility bridge. */
  compatibilityProbe?: (legacyPath: string) => void | Promise<void>;
  /** Test-only hook after managed-mirror canonical validation. */
  managedMirrorProbe?: (canonicalPath: string) => void | Promise<void>;
  /** Test-only hook before an explicit/automatic canonical replacement. */
  resolutionProbe?: (canonicalPath: string) => void | Promise<void>;
};

type PathInfo = {
  kind: "missing" | "symlink" | "file" | "dir";
  hash?: string;
  mtimeMs?: number;
  size?: number;
};

type MergeOutcome =
  | { ok: true; value: unknown; summary: string }
  | { ok: false; summary: string };

const JOURNAL_VERSION = 1 as const;
const MIGRATION_VERSION = 2 as const;
const BACKUP_RETENTION = 10;
const LOCK_STALE_MS = 5 * 60_000;
const LOCK_WAIT_MS = 10_000;

export const migrationJournalPath = () => path.join(caveHome(), "migration-state.json");
export const migrationBackupRoot = () => path.join(caveHome(), "migration-backups");
const migrationLockPath = () => path.join(caveHome(), ".migration.lock");

function canonicalPathFor(entry: CaveHomeReconciliationEntry): string {
  const override = entry.next === "preferences.json"
    ? process.env.COVEN_PREFERENCES_PATH?.trim()
    : entry.next === "theme.json"
      ? process.env.COVEN_THEME_PATH?.trim()
      : entry.next === "backdrop.jpg"
        ? process.env.COVEN_BACKDROP_PATH?.trim()
        : undefined;
  return override || path.join(caveHome(), entry.next);
}

function samePath(left: string, right: string): boolean {
  return path.relative(path.resolve(left), path.resolve(right)) === "";
}

async function isCanonicalCompatibilityLink(legacyPath: string, canonicalPath: string): Promise<boolean> {
  try {
    const target = await readlink(legacyPath);
    return samePath(path.resolve(path.dirname(legacyPath), target), canonicalPath);
  } catch {
    return false;
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function fault(options: ReconciliationOptions, boundary: string): void {
  if (options.faultAt === boundary) throw new Error(`injected migration fault at ${boundary}`);
}

async function sha256File(target: string): Promise<string> {
  return createHash("sha256").update(await readFile(target)).digest("hex");
}

async function sha256Dir(target: string): Promise<string> {
  const hash = createHash("sha256");
  for (const name of (await readdir(target)).sort()) {
    if (name === ".DS_Store") continue;
    const child = path.join(target, name);
    const info = await lstat(child);
    hash.update(name);
    if (info.isSymbolicLink()) hash.update(`l:${await readlink(child)}`);
    else hash.update(info.isDirectory() ? `d:${await sha256Dir(child)}` : `f:${await sha256File(child)}`);
  }
  return hash.digest("hex");
}

async function pathInfo(target: string): Promise<PathInfo> {
  try {
    const info = await lstat(target);
    if (info.isSymbolicLink()) {
      const linkTarget = await readlink(target);
      return {
        kind: "symlink",
        hash: createHash("sha256").update(`symlink\0${linkTarget}`).digest("hex"),
        mtimeMs: info.mtimeMs,
        size: info.size,
      };
    }
    if (info.isDirectory()) return { kind: "dir", hash: await sha256Dir(target), mtimeMs: info.mtimeMs, size: info.size };
    return { kind: "file", hash: await sha256File(target), mtimeMs: info.mtimeMs, size: info.size };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { kind: "missing" };
    throw error;
  }
}

async function readJournal(): Promise<MigrationJournal> {
  try {
    const parsed = JSON.parse(await readFile(migrationJournalPath(), "utf8")) as Partial<MigrationJournal>;
    if (parsed.version !== JOURNAL_VERSION || parsed.migrationVersion !== MIGRATION_VERSION || !parsed.entries) {
      throw new Error("unsupported migration journal");
    }
    return parsed as MigrationJournal;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: JOURNAL_VERSION, migrationVersion: MIGRATION_VERSION, updatedAt: "", entries: {} };
    }
    throw error;
  }
}

async function commitJournal(journal: MigrationJournal, options: ReconciliationOptions): Promise<void> {
  fault(options, "before-journal-write");
  journal.updatedAt = nowIso();
  await writeJsonAtomic(migrationJournalPath(), journal);
  fault(options, "after-journal-write");
  const reread = JSON.parse(await readFile(migrationJournalPath(), "utf8")) as MigrationJournal;
  if (JSON.stringify(reread) !== JSON.stringify(journal)) {
    throw new Error("migration journal verification failed");
  }
}

async function delay(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function readLockOwner(lock: string): Promise<{ pid: number | null; token: string | null }> {
  const owner = await readFile(path.join(lock, "owner.json"), "utf8")
    .then((value) => JSON.parse(value) as { pid?: unknown; token?: unknown })
    .catch(() => null);
  return {
    pid: typeof owner?.pid === "number" && Number.isSafeInteger(owner.pid) ? owner.pid : null,
    token: typeof owner?.token === "string" ? owner.token : null,
  };
}

async function renameLockCandidate(candidate: string, lock: string): Promise<void> {
  try {
    await rename(candidate, lock);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? "";
    // Windows reports EPERM (rather than EEXIST/ENOTEMPTY) when a directory
    // rename targets the already-held lock directory. Only translate it when
    // the destination really exists so unrelated permission failures still
    // fail closed.
    if (["EACCES", "EPERM"].includes(code)) {
      const lockExists = await stat(lock).then(
        () => true,
        (statError) => {
          if ((statError as NodeJS.ErrnoException).code === "ENOENT") return false;
          throw statError;
        },
      );
      if (lockExists) {
        const contention = new Error("cave home migration lock is already held") as NodeJS.ErrnoException;
        contention.code = "EEXIST";
        throw contention;
      }
    }
    throw error;
  }
}

async function acquireLock(options: ReconciliationOptions): Promise<() => Promise<void>> {
  const lock = migrationLockPath();
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    const token = randomBytes(16).toString("hex");
    const candidate = `${lock}.candidate-${token}`;
    try {
      await mkdir(candidate);
      try {
        await writeJsonAtomic(path.join(candidate, "owner.json"), { pid: process.pid, token, startedAt: nowIso() });
        await renameLockCandidate(candidate, lock);
      } catch (error) {
        await rm(candidate, { recursive: true, force: true });
        throw error;
      }
      await options.lockProbe?.("acquired");
      return async () => {
        const owner = await readLockOwner(lock);
        if (owner.token !== token) return;
        // Mark the end of the test-observed critical section before publishing
        // the unlock. Once the rename below completes, a successor can acquire
        // immediately and must not overlap the prior owner's probe state.
        await options.lockProbe?.("released");
        const released = `${lock}.released-${token}`;
        await rename(lock, released).catch((error) => {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        });
        await rm(released, { recursive: true, force: true });
      };
    } catch (error) {
      await rm(candidate, { recursive: true, force: true }).catch(() => {});
      if (!["EEXIST", "ENOTEMPTY"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
      try {
        const info = await stat(lock);
        const owner = await readLockOwner(lock);
        let alive = false;
        if (owner.pid) {
          try {
            process.kill(owner.pid, 0);
            alive = true;
          } catch (ownerError) {
            alive = (ownerError as NodeJS.ErrnoException).code === "EPERM";
          }
        }
        // A recorded owner that no longer exists is safe to reclaim
        // immediately. The age threshold is only needed for an unreadable or
        // incomplete owner record, where liveness cannot be established.
        const reclaimable = owner.pid ? !alive : Date.now() - info.mtimeMs > LOCK_STALE_MS;
        if (reclaimable) {
          await options.lockProbe?.("stale-observed");
          const takeover = path.join(lock, ".takeover");
          const takeoverToken = randomBytes(16).toString("hex");
          try {
            await writeFile(takeover, JSON.stringify({ takeoverToken, ownerToken: owner.token }), { flag: "wx" });
            const currentOwner = await readLockOwner(lock);
            if (currentOwner.token !== owner.token) {
              await rm(takeover, { force: true });
            } else {
              const reclaimed = `${lock}.reclaimed-${takeoverToken}`;
              await rename(lock, reclaimed);
              await rm(reclaimed, { recursive: true, force: true });
              continue;
            }
          } catch (takeoverError) {
            if (!["EEXIST", "ENOENT"].includes((takeoverError as NodeJS.ErrnoException).code ?? "")) throw takeoverError;
          }
        }
      } catch (lockError) {
        if ((lockError as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw lockError;
      }
      if (Date.now() >= deadline) throw new Error("timed out waiting for cave home migration lock");
      await delay(50);
    }
  }
}

/** Serialize a Cave store operation with reconciliation in every process. */
export async function withCaveHomeReconciliationLock<T>(operation: () => Promise<T>): Promise<T> {
  await mkdir(caveHome(), { recursive: true });
  const release = await acquireLock({});
  try {
    return await operation();
  } finally {
    await release();
  }
}

async function pruneBackups(journal: MigrationJournal): Promise<void> {
  await mkdir(migrationBackupRoot(), { recursive: true });
  const protectedIds = new Set(
    Object.values(journal.entries)
      .filter((entry) => entry.decision === "unresolved" || entry.decision === "deferred")
      .map((entry) => entry.backupId)
      .filter((id): id is string => Boolean(id)),
  );
  const directories: Array<{ name: string; mtimeMs: number }> = [];
  for (const name of await readdir(migrationBackupRoot())) {
    const target = path.join(migrationBackupRoot(), name);
    const info = await lstat(target).catch(() => null);
    if (info?.isDirectory()) directories.push({ name, mtimeMs: info.mtimeMs });
  }
  directories.sort((a, b) => b.mtimeMs - a.mtimeMs);
  // Leave room for the bundle about to be created. Never prune a bundle that
  // is the only recovery source for an unresolved/deferred decision.
  const removable = directories.filter((candidate) => !protectedIds.has(candidate.name));
  const removeCount = Math.max(0, directories.length - (BACKUP_RETENTION - 1));
  for (const stale of removeCount > 0 ? removable.slice(-removeCount) : []) {
    await rm(path.join(migrationBackupRoot(), stale.name), { recursive: true, force: true });
  }
}

async function copyPath(source: string, destination: string, kind: PathInfo["kind"]): Promise<void> {
  if (kind === "dir") await cp(source, destination, { recursive: true, errorOnExist: true, force: false });
  else await copyFile(source, destination, fsConstants.COPYFILE_EXCL);
}

async function copyPathAtomically(
  source: string,
  destination: string,
  kind: PathInfo["kind"],
  expectedHash?: string,
): Promise<void> {
  const temporary = path.join(
    path.dirname(destination),
    `.${path.basename(destination)}.migration-${process.pid}-${randomBytes(6).toString("hex")}`,
  );
  try {
    await copyPath(source, temporary, kind);
    const copied = await pathInfo(temporary);
    if (!expectedHash || copied.hash !== expectedHash) throw new Error("migration copy verification failed");
    // A hard link publishes a file snapshot atomically but, unlike rename(2),
    // fails when a concurrent writer already created the destination. Directory
    // rename already fails when the competing directory contains data.
    if (copied.kind === "file") await link(temporary, destination);
    else await rename(temporary, destination);
    await rm(temporary, { recursive: copied.kind === "dir", force: true }).catch(() => {});
  } catch (error) {
    await rm(temporary, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

async function retireExpectedPath(
  target: string,
  expected: PathInfo,
  probe?: () => void | Promise<void>,
  label = "legacy",
): Promise<string> {
  if (!expected.hash || expected.kind === "missing") {
    throw new Error(`${label} path is unavailable for replacement`);
  }
  await probe?.();
  const retired = path.join(
    path.dirname(target),
    `.${path.basename(target)}.migration-retired-${process.pid}-${randomBytes(6).toString("hex")}`,
  );
  await rename(target, retired);
  const retiredInfo = await pathInfo(retired);
  if (retiredInfo.kind === expected.kind && retiredInfo.hash === expected.hash) return retired;

  // The pathname may have changed after its final inspection but before the
  // atomic rename. Put those bytes back when the old pathname is still vacant;
  // otherwise keep the retired copy so neither concurrent writer is lost.
  const targetMissing = (await pathInfo(target)).kind === "missing";
  if (targetMissing) {
    await rename(retired, target);
  }
  throw new Error(targetMissing
    ? `${label} data changed during replacement`
    : `${label} data changed during replacement; preserved at ${retired}`);
}

async function restoreInterruptedRetirement(target: string): Promise<void> {
  if ((await pathInfo(target)).kind !== "missing") return;
  const parent = path.dirname(target);
  const prefix = `.${path.basename(target)}.migration-retired-`;
  const retired = (await readdir(parent).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  })).filter((name) => name.startsWith(prefix));
  if (retired.length === 0) return;
  if (retired.length > 1) {
    throw new Error(`multiple interrupted replacements require review for ${target}`);
  }
  await rename(path.join(parent, retired[0]), target);
}

async function createRecoveryBundle(
  entry: CaveHomeReconciliationEntry,
  legacyPath: string,
  canonicalPath: string,
  legacyInfo: PathInfo,
  canonicalInfo: PathInfo,
  journal: MigrationJournal,
  options: ReconciliationOptions,
): Promise<{ id: string; directory: string }> {
  await pruneBackups(journal);
  const id = `${nowIso().replace(/[:.]/g, "-")}-${randomBytes(4).toString("hex")}`;
  const directory = path.join(migrationBackupRoot(), id);
  await mkdir(directory, { recursive: true });
  fault(options, "after-backup-directory");

  const files: Array<{ role: string; sourcePath: string; storedPath: string; hash: string; size?: number }> = [];
  for (const [role, source, info] of [
    ["legacy", legacyPath, legacyInfo],
    ["canonical", canonicalPath, canonicalInfo],
  ] as const) {
    if (info.kind === "missing" || info.kind === "symlink") continue;
    const storedName = `${role}-${path.basename(source)}`;
    const storedPath = path.join(directory, storedName);
    await copyPath(source, storedPath, info.kind);
    const storedInfo = await pathInfo(storedPath);
    if (!info.hash || storedInfo.hash !== info.hash) throw new Error(`backup verification failed for ${role}`);
    files.push({ role, sourcePath: source, storedPath: storedName, hash: info.hash, size: info.size });
    fault(options, `after-backup-${role}`);
  }
  const manifest = {
    version: 1,
    createdAt: nowIso(),
    entry: { legacy: entry.legacy, next: entry.next, strategy: entry.strategy },
    files,
  };
  await writeJsonAtomic(path.join(directory, "manifest.json"), manifest);
  const verified = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8")) as typeof manifest;
  if (JSON.stringify(verified) !== JSON.stringify(manifest)) throw new Error("backup manifest verification failed");
  fault(options, "after-backup-manifest");
  return { id, directory };
}

async function verifiedBundleRole(
  directory: string,
  role: "legacy" | "canonical",
): Promise<{ source: string; hash: string; info: PathInfo }> {
  const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8")) as {
    files?: Array<{ role?: string; storedPath?: string; hash?: string }>;
  };
  const file = manifest.files?.find((candidate) => candidate.role === role);
  if (!file?.storedPath || !file.hash) throw new Error(`verified ${role} backup is unavailable`);
  const source = path.resolve(directory, file.storedPath);
  if (path.dirname(source) !== path.resolve(directory)) throw new Error(`${role} backup path is invalid`);
  const sourceInfo = await pathInfo(source);
  if (sourceInfo.hash !== file.hash) throw new Error(`${role} backup hash changed before recovery`);
  return { source, hash: file.hash, info: sourceInfo };
}

async function replaceExpectedPath(
  source: string,
  sourceInfo: PathInfo,
  destination: string,
  expectedDestination: PathInfo,
  verificationError: string,
): Promise<void> {
  const retired = await retireExpectedPath(destination, expectedDestination, undefined, "canonical");
  let installed = false;
  try {
    await copyPathAtomically(source, destination, sourceInfo.kind, sourceInfo.hash);
    if (!sourceInfo.hash || (await pathInfo(destination)).hash !== sourceInfo.hash) throw new Error(verificationError);
    installed = true;
  } finally {
    if (installed) {
      await rm(retired, { recursive: true, force: true });
    } else if ((await pathInfo(destination)).kind === "missing") {
      await rename(retired, destination);
    }
  }
}

async function restoreBundleRole(
  directory: string,
  role: "legacy" | "canonical",
  destination: string,
  expectedDestination: PathInfo,
): Promise<void> {
  const { source, info: sourceInfo } = await verifiedBundleRole(directory, role);
  await replaceExpectedPath(
    source,
    sourceInfo,
    destination,
    expectedDestination,
    `${role} recovery verification failed`,
  );
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function parseDate(value: unknown): number {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;
}

async function describeDifferences(
  entry: CaveHomeReconciliationEntry,
  legacyPath: string,
  canonicalPath: string,
  legacyInfo: PathInfo,
  canonicalInfo: PathInfo,
): Promise<string[]> {
  if (canonicalInfo.kind === "missing") return ["Canonical copy is missing; the legacy copy is the only source."];
  if (legacyInfo.kind !== canonicalInfo.kind) return [`Path types differ: ${legacyInfo.kind} and ${canonicalInfo.kind}.`];
  if (legacyInfo.hash === canonicalInfo.hash) return ["Contents are identical."];
  if (entry.strategy === "directory" && legacyInfo.kind === "dir") {
    const legacyNames = new Set(await readdir(legacyPath));
    const canonicalNames = new Set(await readdir(canonicalPath));
    const legacyOnly = [...legacyNames].filter((name) => !canonicalNames.has(name)).length;
    const canonicalOnly = [...canonicalNames].filter((name) => !legacyNames.has(name)).length;
    const shared = [...legacyNames].filter((name) => canonicalNames.has(name)).length;
    return [`Directory entries: ${legacyOnly} legacy-only, ${canonicalOnly} canonical-only, ${shared} shared.`];
  }
  if (entry.next.endsWith(".json")) {
    try {
      const legacy = record(JSON.parse(await readFile(legacyPath, "utf8")));
      const canonical = record(JSON.parse(await readFile(canonicalPath, "utf8")));
      if (!legacy || !canonical) return ["JSON shapes differ."];
      const keys = [...new Set([...Object.keys(legacy), ...Object.keys(canonical)])]
        .filter((key) => JSON.stringify(legacy[key]) !== JSON.stringify(canonical[key]));
      return keys.length > 0
        ? [`Changed top-level fields: ${keys.slice(0, 8).join(", ")}${keys.length > 8 ? `, and ${keys.length - 8} more` : ""}.`]
        : ["JSON formatting or ordering differs; parsed values match."];
    } catch {
      return ["One or both copies are not valid JSON."];
    }
  }
  return [`Binary contents differ (${legacyInfo.size ?? 0} bytes legacy, ${canonicalInfo.size ?? 0} bytes canonical).`];
}

function mergeInbox(legacy: unknown, canonical: unknown): MergeOutcome {
  const left = record(legacy);
  const right = record(canonical);
  if (!left || !right || !Array.isArray(left.items) || !Array.isArray(right.items)) {
    return { ok: false, summary: "Inbox data is malformed and requires review." };
  }
  const leftIds = new Set<string>();
  const rightIds = new Set<string>();
  for (const [items, ids] of [[left.items, leftIds], [right.items, rightIds]] as const) {
    for (const raw of items) {
      const item = record(raw);
      if (!item || typeof item.id !== "string" || !item.id) {
        return { ok: false, summary: "Inbox item without a stable ID requires review." };
      }
      if (ids.has(item.id)) {
        return { ok: false, summary: `Inbox contains duplicate item ID ${item.id} and requires review.` };
      }
      ids.add(item.id);
    }
  }
  for (const id of new Set([...leftIds, ...rightIds])) {
    if (!leftIds.has(id) || !rightIds.has(id)) {
      // Inbox items can be deleted outright. Without a file-level revision or
      // tombstone, a one-sided ID may be either a new item or a later deletion;
      // unioning snapshots can silently resurrect an item the user removed.
      return { ok: false, summary: `Inbox item ${id} has ambiguous presence and requires review.` };
    }
  }
  const byId = new Map<string, Record<string, unknown>>();
  for (const raw of [...left.items, ...right.items]) {
    const item = record(raw);
    if (!item || typeof item.id !== "string" || !item.id) return { ok: false, summary: "Inbox item without a stable ID requires review." };
    const existing = byId.get(item.id);
    if (!existing) {
      byId.set(item.id, item);
      continue;
    }
    if (JSON.stringify(existing) === JSON.stringify(item)) continue;
    const existingRevision = typeof existing.revision === "number" ? existing.revision : 0;
    const itemRevision = typeof item.revision === "number" ? item.revision : 0;
    const existingTime = parseDate(existing.updatedAt) || parseDate(existing.createdAt);
    const itemTime = parseDate(item.updatedAt) || parseDate(item.createdAt);
    if (existingRevision === itemRevision && existingTime === itemTime) {
      return { ok: false, summary: `Inbox item ${item.id} differs without a newer revision or timestamp.` };
    }
    if (itemRevision > existingRevision || (itemRevision === existingRevision && itemTime > existingTime)) byId.set(item.id, item);
  }
  const items = [...byId.values()].sort((a, b) => parseDate(a.createdAt) - parseDate(b.createdAt));
  return { ok: true, value: { ...right, version: Math.max(Number(left.version) || 1, Number(right.version) || 1), items }, summary: `Merged ${items.length} inbox item(s) by stable ID.` };
}

const STATE_MAPS = [
  "sessionFamiliar",
  "sessionTitles",
  "sessionArchived",
  "sessionSacrificed",
  "sessionKeep",
  "sessionArchiveExtendedUntil",
  "sessionOwned",
  "mergedPrAutoArchived",
] as const;

const TIMESTAMP_STATE_MAPS = new Set<string>([
  "sessionArchived",
  "sessionSacrificed",
  "sessionKeep",
  "sessionArchiveExtendedUntil",
  "sessionOwned",
]);

const DELETABLE_STATE_MAPS = new Set<string>([
  "sessionTitles",
  "sessionArchived",
  "sessionKeep",
]);

function mergeRecordMap(
  name: string,
  leftValue: unknown,
  rightValue: unknown,
): { ok: true; value: Record<string, unknown> } | { ok: false; summary: string } {
  const left = record(leftValue);
  const right = record(rightValue);
  if (!left || !right) return { ok: false, summary: `State map ${name} is malformed.` };
  const value = { ...left, ...right };
  for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
    if (!(key in left) || !(key in right)) {
      // These maps delete keys for ordinary user actions (clear title,
      // summon/unarchive, unmark keep). A key present in only one snapshot may
      // therefore be either an addition or a later deletion; unioning it can
      // silently resurrect state that the user already removed.
      if (DELETABLE_STATE_MAPS.has(name)) {
        return { ok: false, summary: `State map ${name} has ambiguous presence for ${key}.` };
      }
      continue;
    }
    if (JSON.stringify(left[key]) === JSON.stringify(right[key])) continue;
    if (!TIMESTAMP_STATE_MAPS.has(name)) return { ok: false, summary: `State map ${name} has an ambiguous value for ${key}.` };
    const leftTime = parseDate(left[key]);
    const rightTime = parseDate(right[key]);
    if (!leftTime || !rightTime || leftTime === rightTime) return { ok: false, summary: `State map ${name} has an ambiguous timestamp for ${key}.` };
    value[key] = leftTime > rightTime ? left[key] : right[key];
  }
  return { ok: true, value };
}

function mergeTravel(leftValue: unknown, rightValue: unknown): MergeOutcome {
  const left = record(leftValue);
  const right = record(rightValue);
  if (!left || !right) return { ok: false, summary: "Travel state is malformed." };
  const leftQueue = Array.isArray(left.offlineQueue) ? left.offlineQueue : [];
  const rightQueue = Array.isArray(right.offlineQueue) ? right.offlineQueue : [];
  for (const items of [leftQueue, rightQueue]) {
    const ids = new Set<string>();
    for (const raw of items) {
      const item = record(raw);
      if (!item || typeof item.id !== "string" || !item.id) {
        return { ok: false, summary: "Queued travel work without a stable ID requires review." };
      }
      if (ids.has(item.id)) {
        return { ok: false, summary: `Travel queue contains duplicate item ID ${item.id} and requires review.` };
      }
      ids.add(item.id);
    }
  }
  const queue = new Map<string, Record<string, unknown>>();
  for (const raw of [...leftQueue, ...rightQueue]) {
    const item = record(raw);
    if (!item || typeof item.id !== "string") return { ok: false, summary: "Queued travel work without a stable ID requires review." };
    const existing = queue.get(item.id);
    if (!existing) queue.set(item.id, item);
    else if (JSON.stringify(existing) !== JSON.stringify(item)) {
      // Queue status is not monotonic: failed work can be retried and return
      // to syncing. Without an item revision or transition timestamp, ranking
      // statuses can replace a newer retry with an older failed snapshot (or
      // suppress work as already synced). Preserve both files for review.
      return { ok: false, summary: `Queued travel work ${item.id} differs and requires review.` };
    }
  }
  for (const field of ["manualOffline", "staleCache", "hubUnreachableSince", "localSubdaemonWakeRequestedAt"] as const) {
    if (JSON.stringify(left[field]) !== JSON.stringify(right[field])) {
      return { ok: false, summary: `Travel state ${field} differs without a transition revision and requires review.` };
    }
  }
  const latestReachability = parseDate(left.lastHubReachableAt) > parseDate(right.lastHubReachableAt) ? left : right;
  return {
    ok: true,
    value: {
      ...left,
      ...right,
      manualOffline: left.manualOffline === true,
      staleCache: left.staleCache === true,
      lastHubReachableAt: latestReachability.lastHubReachableAt ?? null,
      hubUnreachableSince: left.hubUnreachableSince ?? null,
      localSubdaemonWakeRequestedAt: left.localSubdaemonWakeRequestedAt ?? null,
      localBindHost: "127.0.0.1",
      offlineQueue: [...queue.values()],
    },
    summary: `Merged ${queue.size} queued travel item(s).`,
  };
}

function mergeState(legacy: unknown, canonical: unknown): MergeOutcome {
  const left = record(legacy);
  const right = record(canonical);
  if (!left || !right) return { ok: false, summary: "State data is malformed and requires review." };
  const value: Record<string, unknown> = { ...left, ...right };
  for (const name of STATE_MAPS) {
    const merged = mergeRecordMap(name, left[name] ?? {}, right[name] ?? {});
    if (!merged.ok) return merged;
    value[name] = merged.value;
  }
  const travel = mergeTravel(left.travel ?? {}, right.travel ?? {});
  if (!travel.ok) return travel;
  value.travel = travel.value;
  return { ok: true, value, summary: "Merged state maps by stable session and queue keys." };
}

const PREFERENCE_SECTIONS = [
  ["appearance", "fonts"],
  ["appearance", "screenScale"],
  ["appearance", "reading"],
  ["appearance", "datetime"],
  ["appearance", "recentColors"],
  ["appearance", "cornerRadius"],
  ["appearance", "backdrop"],
  ["general"],
  ["phone"],
] as const;

function getNested(value: Record<string, unknown>, keys: readonly string[]): unknown {
  let cursor: unknown = value;
  for (const key of keys) cursor = record(cursor)?.[key];
  return cursor;
}

function validPreferences(value: unknown): CavePreferences | null {
  const raw = record(value);
  if (
    !raw || raw.version !== 1 || typeof raw.initialized !== "boolean" ||
    typeof raw.revision !== "number" || !Number.isSafeInteger(raw.revision) || raw.revision < 0 ||
    typeof raw.updatedAt !== "string" || !record(raw.appearance) || !record(raw.general) || !record(raw.phone)
  ) return null;
  return normalizeCavePreferences(raw);
}

function mergePreferences(legacy: unknown, canonical: unknown): MergeOutcome {
  const left = validPreferences(legacy);
  const right = validPreferences(canonical);
  if (!left || !right) return { ok: false, summary: "Preferences data is malformed and requires review." };
  const output = structuredClone(right) as unknown as Record<string, unknown>;
  for (const keys of PREFERENCE_SECTIONS) {
    const leftValue = getNested(left as unknown as Record<string, unknown>, keys);
    const rightValue = getNested(right as unknown as Record<string, unknown>, keys);
    if (JSON.stringify(leftValue) === JSON.stringify(rightValue)) continue;
    // Preferences have one file-wide revision, not a revision per section. If
    // two writers changed different sections, choosing every value from the
    // snapshot with the larger global revision would silently discard the
    // other writer's independent change. Only theme has its own revision, so
    // any other divergent section needs an explicit whole-file decision.
    return { ok: false, summary: `Preferences section ${keys.join(".")} differs without an independent revision and requires review.` };
  }
  const leftTheme = left.appearance.theme;
  const rightTheme = right.appearance.theme;
  if (JSON.stringify(leftTheme) !== JSON.stringify(rightTheme)) {
    const leftTime = parseDate(leftTheme.updatedAt);
    const rightTime = parseDate(rightTheme.updatedAt);
    if (leftTime === rightTime && leftTheme.selectionRevision === rightTheme.selectionRevision) {
      return { ok: false, summary: "Theme preferences differ at the same revision and timestamp." };
    }
    (output.appearance as Record<string, unknown>).theme =
      leftTheme.selectionRevision > rightTheme.selectionRevision ||
      (leftTheme.selectionRevision === rightTheme.selectionRevision && leftTime > rightTime)
        ? leftTheme : rightTheme;
  }
  const merged = normalizeCavePreferences(output);
  merged.initialized = left.initialized || right.initialized;
  merged.revision = Math.max(left.revision, right.revision) + 1;
  merged.updatedAt = nowIso();
  return { ok: true, value: merged, summary: "Merged independent preference sections by revision and timestamp." };
}

async function mergeJson(strategy: ReconciliationStrategy, legacyPath: string, canonicalPath: string): Promise<MergeOutcome> {
  let legacy: unknown;
  let canonical: unknown;
  try {
    legacy = JSON.parse(await readFile(legacyPath, "utf8"));
    canonical = JSON.parse(await readFile(canonicalPath, "utf8"));
  } catch {
    return { ok: false, summary: "One or both JSON files are malformed and require review." };
  }
  if (strategy === "inbox") return mergeInbox(legacy, canonical);
  if (strategy === "state") return mergeState(legacy, canonical);
  if (strategy === "preferences") return mergePreferences(legacy, canonical);
  return { ok: false, summary: "This file type requires an explicit choice." };
}

async function validateCanonical(
  entry: CaveHomeReconciliationEntry,
  canonicalPath: string,
  knownInfo?: PathInfo,
): Promise<void> {
  const info = knownInfo ?? await pathInfo(canonicalPath);
  if (info.kind === "missing" || info.kind === "symlink") throw new Error("canonical path is missing");
  if (entry.strategy === "directory") {
    if (info.kind !== "dir") throw new Error("canonical directory is invalid");
    await readdir(canonicalPath);
    return;
  }
  if (info.kind !== "file") throw new Error("canonical file is invalid");
  if (entry.strategy === "inbox" || entry.strategy === "state" || entry.strategy === "preferences" || entry.next.endsWith(".json")) {
    const parsed = JSON.parse(await readFile(canonicalPath, "utf8")) as unknown;
    if (entry.strategy === "inbox") {
      const value = record(parsed);
      if (!value || !Array.isArray(value.items) || value.items.some((item) => typeof record(item)?.id !== "string")) throw new Error("canonical inbox validation failed");
    } else if (entry.strategy === "state") {
      const value = record(parsed);
      if (!value || STATE_MAPS.some((key) => !record(value[key] ?? {})) || !record(value.travel ?? {})) throw new Error("canonical state validation failed");
    } else if (entry.strategy === "preferences" && !validPreferences(parsed)) {
      throw new Error("canonical preferences validation failed");
    }
  }
}

async function ensureCompatibility(
  entry: CaveHomeReconciliationEntry,
  legacyPath: string,
  canonicalPath: string,
  journalEntry: MigrationJournalEntry,
  result: CaveHomeReconciliationResult,
  options: ReconciliationOptions,
): Promise<void> {
  const canonicalInfo = await pathInfo(canonicalPath);
  if (canonicalInfo.kind === "missing" || canonicalInfo.kind === "symlink") throw new Error("canonical path unavailable for compatibility bridge");
  const existingLegacy = await pathInfo(legacyPath);
  if (
    existingLegacy.kind === "missing" || existingLegacy.kind === "symlink" ||
    !journalEntry.legacyHash || existingLegacy.hash !== journalEntry.legacyHash
  ) {
    throw new Error("legacy data changed before compatibility bridge installation");
  }
  const retired = await retireExpectedPath(
    legacyPath,
    existingLegacy,
    () => options.compatibilityProbe?.(legacyPath),
  );
  const createLink = options.createSymlink ?? symlink;
  let installed = false;
  try {
    try {
      const relative = path.relative(path.dirname(legacyPath), canonicalPath);
      await createLink(relative, legacyPath, canonicalInfo.kind === "dir" ? "junction" : "file");
      const linkedCanonical = await pathInfo(canonicalPath);
      await validateCanonical(entry, canonicalPath, linkedCanonical);
      if (linkedCanonical.kind !== canonicalInfo.kind || linkedCanonical.hash !== canonicalInfo.hash) {
        await rm(legacyPath, { recursive: true, force: true });
        throw new Error("canonical data changed during compatibility link installation");
      }
      result.linked.push(entry.legacy);
      journalEntry.compatibility = "symlink";
      journalEntry.managedMirrorHash = undefined;
      installed = true;
    } catch {
      // A link may have been created successfully before validation detected a
      // concurrent/invalid canonical change. Remove that attempted bridge
      // before entering the ordinary-file fallback; otherwise copyFile/cp can
      // follow the link and leave the retired legacy bytes hidden.
      if ((await pathInfo(legacyPath)).kind === "symlink") {
        await rm(legacyPath, { recursive: true, force: true });
      }
      const fallbackCanonical = await pathInfo(canonicalPath);
      await validateCanonical(entry, canonicalPath, fallbackCanonical);
      if (fallbackCanonical.kind !== canonicalInfo.kind || fallbackCanonical.hash !== canonicalInfo.hash) {
        throw new Error("canonical data changed during compatibility bridge installation");
      }
      await copyPath(canonicalPath, legacyPath, canonicalInfo.kind);
      const mirror = await pathInfo(legacyPath);
      if (mirror.hash !== canonicalInfo.hash) throw new Error("compatibility mirror verification failed");
      journalEntry.compatibility = "mirror";
      journalEntry.managedMirrorHash = mirror.hash;
      installed = true;
    }
  } finally {
    if (installed) {
      await rm(retired, { recursive: true, force: true });
    } else {
      const failedLegacy = await pathInfo(legacyPath);
      if (failedLegacy.kind === "missing") {
        await rename(retired, legacyPath);
      } else {
        const currentCanonical = await pathInfo(canonicalPath);
        if (
          failedLegacy.kind === currentCanonical.kind &&
          failedLegacy.hash && failedLegacy.hash === currentCanonical.hash &&
          failedLegacy.hash !== existingLegacy.hash
        ) {
          await rm(legacyPath, { recursive: failedLegacy.kind === "dir", force: true });
          await rename(retired, legacyPath);
        }
      }
    }
  }
}

async function syncManagedMirror(
  entry: CaveHomeReconciliationEntry,
  legacyPath: string,
  canonicalPath: string,
  prior: MigrationJournalEntry,
  result: CaveHomeReconciliationResult,
  options: ReconciliationOptions,
): Promise<MigrationJournalEntry | null> {
  const legacyInfo = await pathInfo(legacyPath);
  const canonicalInfo = await pathInfo(canonicalPath);
  if (legacyInfo.kind === "missing" || canonicalInfo.kind === "missing") return null;
  if (!prior.managedMirrorHash || legacyInfo.hash !== prior.managedMirrorHash) return null;
  // Do not replace the last known-good mirror until the newer canonical copy
  // passes the same schema/type checks used by the initial migration.
  await validateCanonical(entry, canonicalPath, canonicalInfo);
  const current: MigrationJournalEntry = {
    ...prior,
    legacyHash: legacyInfo.hash,
    canonicalHash: canonicalInfo.hash,
    legacyMtimeMs: legacyInfo.mtimeMs,
    canonicalMtimeMs: canonicalInfo.mtimeMs,
    decidedAt: nowIso(),
  };
  if (legacyInfo.hash !== canonicalInfo.hash) {
    await options.managedMirrorProbe?.(canonicalPath);
    const staged = path.join(
      path.dirname(legacyPath),
      `.${path.basename(legacyPath)}.migration-refresh-${process.pid}-${randomBytes(6).toString("hex")}`,
    );
    await copyPathAtomically(canonicalPath, staged, canonicalInfo.kind, canonicalInfo.hash);
    try {
      await validateCanonical(entry, staged);
      const retired = await retireExpectedPath(legacyPath, legacyInfo);
      let installed = false;
      try {
        await copyPath(staged, legacyPath, canonicalInfo.kind);
        const mirror = await pathInfo(legacyPath);
        if (mirror.hash !== canonicalInfo.hash) throw new Error("managed mirror refresh failed");
        current.legacyHash = mirror.hash;
        current.managedMirrorHash = mirror.hash;
        installed = true;
      } finally {
        if (installed) {
          await rm(retired, { recursive: true, force: true });
        } else if ((await pathInfo(legacyPath)).kind === "missing") {
          await rename(retired, legacyPath);
        }
      }
    } finally {
      await rm(staged, { recursive: true, force: true });
    }
  }
  current.compatibility = "mirror";
  current.summary = "Compatibility mirror is managed and unchanged by legacy tools.";
  result.skipped.push(entry.legacy);
  fault(options, "after-managed-mirror");
  return current;
}

async function reconcileDirectory(
  entry: CaveHomeReconciliationEntry,
  legacyPath: string,
  canonicalPath: string,
  legacyInfo: PathInfo,
  canonicalInfo: PathInfo,
  result: CaveHomeReconciliationResult,
  options: ReconciliationOptions,
): Promise<{ outcome: MergeOutcome; files: number; collisions: number }> {
  if (legacyInfo.kind !== "dir" || canonicalInfo.kind !== "dir") return { outcome: { ok: false, summary: "Path types differ and require review." }, files: 0, collisions: 0 };
  let files = 0;
  let collisions = 0;
  for (const name of await readdir(legacyPath)) {
    if (name === ".DS_Store") continue;
    const legacyChild = path.join(legacyPath, name);
    const canonicalChild = path.join(canonicalPath, name);
    const left = await pathInfo(legacyChild);
    const right = await pathInfo(canonicalChild);
    if (left.kind === "symlink") {
      collisions += 1;
      continue;
    }
    if (right.kind === "missing") {
      await copyPathAtomically(legacyChild, canonicalChild, left.kind, left.hash);
      files += 1;
    } else if (left.hash !== right.hash) collisions += 1;
  }
  result.merged.push({ legacy: entry.legacy, files, collisions });
  if (collisions > 0) return { outcome: { ok: false, summary: `${collisions} directory collision(s) require review.` }, files, collisions };
  return { outcome: { ok: true, value: null, summary: `Merged ${files} legacy-only directory entr${files === 1 ? "y" : "ies"}.` }, files, collisions };
}

async function reconcileEntry(
  entry: CaveHomeReconciliationEntry,
  journal: MigrationJournal,
  result: CaveHomeReconciliationResult,
  options: ReconciliationOptions,
): Promise<void> {
  if (options.legacy && options.legacy !== entry.legacy) return;
  const legacyPath = path.join(covenHome(), entry.legacy);
  const canonicalPath = canonicalPathFor(entry);
  await mkdir(path.dirname(canonicalPath), { recursive: true });
  // A hard process termination can bypass finally blocks after the atomic
  // retirement rename. Restore the sole preserved copy before classifying the
  // entry; otherwise a missing legacy path can be journaled as complete, or a
  // missing canonical path can be rebuilt from an older compatibility copy.
  await restoreInterruptedRetirement(legacyPath);
  await restoreInterruptedRetirement(canonicalPath);
  let legacyInfo = await pathInfo(legacyPath);
  let canonicalInfo = await pathInfo(canonicalPath);
  const prior = journal.entries[entry.legacy];

  if (prior?.decision === "deferred" && !options.action) {
    // Deferral may stop automatic reconciliation, but it must not bypass the
    // reader/writer gate. A missing or malformed canonical store would make
    // callers fall back to defaults and later overwrite recoverable data.
    await validateCanonical(entry, canonicalPath, canonicalInfo);
    result.skipped.push(entry.legacy);
    return;
  }

  if (prior?.managedMirrorHash) {
    const managed = await syncManagedMirror(entry, legacyPath, canonicalPath, prior, result, options);
    if (managed) {
      journal.entries[entry.legacy] = managed;
      return;
    }
  }

  const journalEntry: MigrationJournalEntry = {
    legacy: entry.legacy,
    next: entry.next,
    strategy: entry.strategy,
    legacyPath,
    canonicalPath,
    legacyHash: legacyInfo.hash,
    canonicalHash: canonicalInfo.hash,
    legacyMtimeMs: legacyInfo.mtimeMs,
    canonicalMtimeMs: canonicalInfo.mtimeMs,
    decision: "absent",
    backupId: prior?.backupId,
    decidedAt: nowIso(),
  };

  if (options.action === "defer") {
    // Cave continues to read and write canonical storage while a decision is
    // deferred, so only allow deferral when that authoritative copy is usable.
    await validateCanonical(entry, canonicalPath, canonicalInfo);
    if (
      !samePath(legacyPath, canonicalPath) &&
      legacyInfo.kind !== "missing" && legacyInfo.kind !== "symlink" &&
      canonicalInfo.kind !== "missing" && canonicalInfo.kind !== "symlink" &&
      legacyInfo.hash !== canonicalInfo.hash
    ) {
      const backup = await createRecoveryBundle(entry, legacyPath, canonicalPath, legacyInfo, canonicalInfo, journal, options);
      result.backedUp.push(backup.directory);
      journalEntry.backupId = backup.id;
    }
    journalEntry.decision = "deferred";
    journalEntry.summary = "User deferred this migration; existing copies remain in place.";
    journal.entries[entry.legacy] = journalEntry;
    result.skipped.push(entry.legacy);
    return;
  }

  if (legacyInfo.kind === "missing") {
    journalEntry.decision = "absent";
    journalEntry.summary = "No legacy data remains.";
    journal.entries[entry.legacy] = journalEntry;
    result.skipped.push(entry.legacy);
    return;
  }

  if (legacyInfo.kind === "symlink") {
    if (!await isCanonicalCompatibilityLink(legacyPath, canonicalPath)) {
      throw new Error("legacy symlink does not target canonical storage");
    }
    await validateCanonical(entry, canonicalPath, canonicalInfo);
    journalEntry.decision = "linked";
    journalEntry.summary = "Legacy path is a verified compatibility link.";
    journal.entries[entry.legacy] = journalEntry;
    result.skipped.push(entry.legacy);
    return;
  }

  // A supported per-store override may intentionally keep the canonical file
  // at its historical legacy path. In that case there is no bridge to create:
  // removing the "legacy" side would remove the canonical file itself.
  if (samePath(legacyPath, canonicalPath)) {
    await validateCanonical(entry, canonicalPath, canonicalInfo);
    journalEntry.decision = "identical";
    journalEntry.summary = "The configured canonical path is already the legacy path.";
    journal.entries[entry.legacy] = journalEntry;
    result.resolved.push(entry.legacy);
    return;
  }

  if (canonicalInfo.kind === "missing") {
    // Keep the legacy source intact until a fully copied and hash-verified
    // canonical sibling has been atomically installed. A crash can therefore
    // resume through the ordinary identical-copies path without data loss.
    await validateCanonical(entry, legacyPath);
    await copyPathAtomically(legacyPath, canonicalPath, legacyInfo.kind, legacyInfo.hash);
    fault(options, "after-legacy-move");
    await validateCanonical(entry, canonicalPath);
    result.moved.push(entry.legacy);
    journalEntry.decision = "moved";
    journalEntry.summary = "Moved legacy data into the canonical Cave home.";
    await ensureCompatibility(entry, legacyPath, canonicalPath, journalEntry, result, options);
    legacyInfo = await pathInfo(legacyPath);
    canonicalInfo = await pathInfo(canonicalPath);
    journalEntry.legacyHash = legacyInfo.hash;
    journalEntry.canonicalHash = canonicalInfo.hash;
    journalEntry.legacyMtimeMs = legacyInfo.mtimeMs;
    journalEntry.canonicalMtimeMs = canonicalInfo.mtimeMs;
    journal.entries[entry.legacy] = journalEntry;
    return;
  }

  if (legacyInfo.hash && legacyInfo.hash === canonicalInfo.hash) {
    await validateCanonical(entry, canonicalPath);
    journalEntry.decision = "identical";
    journalEntry.summary = "Legacy and canonical data are identical.";
    await ensureCompatibility(entry, legacyPath, canonicalPath, journalEntry, result, options);
    journal.entries[entry.legacy] = journalEntry;
    result.resolved.push(entry.legacy);
    return;
  }

  const backup = await createRecoveryBundle(entry, legacyPath, canonicalPath, legacyInfo, canonicalInfo, journal, options);
  result.backedUp.push(backup.directory);
  journalEntry.backupId = backup.id;

  if (options.action === "keep-canonical" || options.action === "recover-legacy") {
    if (options.action === "recover-legacy") {
      // Restore from the verified bundle, not the live legacy path, so an old
      // writer cannot change the selected bytes between backup and recovery.
      const legacyBackup = await verifiedBundleRole(backup.directory, "legacy");
      await validateCanonical(entry, legacyBackup.source, legacyBackup.info);
      await options.resolutionProbe?.(canonicalPath);
      await restoreBundleRole(backup.directory, "legacy", canonicalPath, canonicalInfo);
      journalEntry.decision = "recovered-legacy";
      journalEntry.summary = "Recovered the legacy copy into canonical storage after verified backup.";
    } else {
      journalEntry.decision = "kept-canonical";
      journalEntry.summary = "Kept the canonical copy after verified backup.";
    }
    fault(options, "after-resolution-write");
    await validateCanonical(entry, canonicalPath);
    await ensureCompatibility(entry, legacyPath, canonicalPath, journalEntry, result, options);
    const finalCanonical = await pathInfo(canonicalPath);
    const finalLegacy = await pathInfo(legacyPath);
    journalEntry.canonicalHash = finalCanonical.hash;
    journalEntry.legacyHash = finalLegacy.hash;
    journal.entries[entry.legacy] = journalEntry;
    result.resolved.push(entry.legacy);
    return;
  }

  let merged: MergeOutcome;
  if (entry.strategy === "directory") {
    // Files in migrated directories are not append-only (conversations, for
    // example, can be deleted). A child present only in the legacy snapshot is
    // therefore ambiguous: it may be a new file or a stale file deleted from
    // canonical storage. Do not resurrect it until the user explicitly asks
    // to merge the two directory snapshots.
    merged = options.action === "merge"
      ? (await reconcileDirectory(entry, legacyPath, canonicalPath, legacyInfo, canonicalInfo, result, options)).outcome
      : { ok: false, summary: "Directory entries differ and require an explicit merge or whole-directory choice." };
  }
  else if (["inbox", "state", "preferences"].includes(entry.strategy)) {
    // Merge the exact snapshots recorded in the verified bundle. Reading the
    // live paths here would let an uncoordinated store writer change either
    // input after backup verification.
    const legacyBackup = await verifiedBundleRole(backup.directory, "legacy");
    const canonicalBackup = await verifiedBundleRole(backup.directory, "canonical");
    merged = await mergeJson(entry.strategy, legacyBackup.source, canonicalBackup.source);
  }
  else merged = { ok: false, summary: "This file has no lossless automatic merge and requires an explicit choice." };

  if (merged.ok && (options.action === "merge" || !options.action)) {
    if (entry.strategy !== "directory") {
      const staged = path.join(
        path.dirname(canonicalPath),
        `.${path.basename(canonicalPath)}.migration-merge-${process.pid}-${randomBytes(6).toString("hex")}`,
      );
      try {
        await writeJsonAtomic(staged, merged.value);
        const stagedInfo = await pathInfo(staged);
        await validateCanonical(entry, staged, stagedInfo);
        await options.resolutionProbe?.(canonicalPath);
        await replaceExpectedPath(
          staged,
          stagedInfo,
          canonicalPath,
          canonicalInfo,
          "merged canonical verification failed",
        );
      } finally {
        await rm(staged, { recursive: true, force: true }).catch(() => {});
      }
    }
    fault(options, "after-merge-write");
    await validateCanonical(entry, canonicalPath);
    journalEntry.decision = "merged";
    journalEntry.summary = merged.summary;
    await ensureCompatibility(entry, legacyPath, canonicalPath, journalEntry, result, options);
    const finalCanonical = await pathInfo(canonicalPath);
    const finalLegacy = await pathInfo(legacyPath);
    journalEntry.canonicalHash = finalCanonical.hash;
    journalEntry.legacyHash = finalLegacy.hash;
    journalEntry.canonicalMtimeMs = finalCanonical.mtimeMs;
    journalEntry.legacyMtimeMs = finalLegacy.mtimeMs;
    journal.entries[entry.legacy] = journalEntry;
    result.resolved.push(entry.legacy);
    return;
  }

  journalEntry.decision = options.action === "merge" ? "unresolved" : "unresolved";
  journalEntry.summary = merged.summary;
  journal.entries[entry.legacy] = journalEntry;
  result.skipped.push(entry.legacy);
}

export async function reconcileCaveHome(
  entries: readonly CaveHomeReconciliationEntry[],
  options: ReconciliationOptions = {},
): Promise<CaveHomeReconciliationResult> {
  const result: CaveHomeReconciliationResult = {
    moved: [], linked: [], skipped: [], merged: [], backedUp: [], resolved: [], errors: [],
  };
  await mkdir(caveHome(), { recursive: true });
  const release = await acquireLock(options);
  try {
    const journal = await readJournal();
    for (const entry of entries) {
      try {
        await reconcileEntry(entry, journal, result, options);
      } catch (error) {
        result.errors.push({ legacy: entry.legacy, error: String(error) });
      }
    }
    await commitJournal(journal, options);
  } finally {
    await release();
  }
  return result;
}

export async function caveHomeReconciliationStatus(
  entries: readonly CaveHomeReconciliationEntry[],
): Promise<CaveHomeReconciliationStatus> {
  const journal = await readJournal();
  const pending: string[] = [];
  const conflicts: string[] = [];
  const details: CaveHomeConflictDetail[] = [];
  for (const entry of entries) {
    const legacyPath = path.join(covenHome(), entry.legacy);
    const canonicalPath = canonicalPathFor(entry);
    const legacyInfo = await pathInfo(legacyPath);
    if (legacyInfo.kind === "missing") continue;
    const canonicalInfo = await pathInfo(canonicalPath);
    const prior = journal.entries[entry.legacy];
    const canonicalValid = await validateCanonical(entry, canonicalPath, canonicalInfo).then(() => true, () => false);
    if (
      legacyInfo.kind === "symlink" && canonicalValid &&
      await isCanonicalCompatibilityLink(legacyPath, canonicalPath)
    ) continue;
    if (samePath(legacyPath, canonicalPath) && canonicalValid) continue;
    const managed = Boolean(
      canonicalValid &&
      prior?.managedMirrorHash &&
      legacyInfo.hash === prior.managedMirrorHash,
    );
    if (managed) continue;
    const isPending = canonicalInfo.kind === "missing" && legacyInfo.kind !== "symlink";
    (isPending ? pending : conflicts).push(entry.legacy);
    const backupPath = prior?.backupId ? path.join(migrationBackupRoot(), prior.backupId) : undefined;
    details.push({
      legacy: entry.legacy,
      next: entry.next,
      strategy: entry.strategy,
      legacyPath,
      canonicalPath,
      legacyHash: legacyInfo.hash,
      canonicalHash: canonicalInfo.hash,
      legacyMtimeMs: legacyInfo.mtimeMs,
      canonicalMtimeMs: canonicalInfo.mtimeMs,
      state: isPending ? "pending" : "unresolved",
      summary: legacyInfo.kind === "symlink"
        ? "Legacy symlink is not a valid compatibility bridge and requires review."
        : prior?.summary ?? (isPending ? "Legacy data is ready to move." : "Legacy and canonical data differ."),
      differences: await describeDifferences(entry, legacyPath, canonicalPath, legacyInfo, canonicalInfo),
      backupPath,
      actions: legacyInfo.kind === "symlink"
        ? canonicalValid ? ["defer"] : []
        : isPending
        ? ["merge"]
        : entry.strategy === "manual"
          ? canonicalValid
            ? ["keep-canonical", "recover-legacy", "defer"]
            : ["recover-legacy"]
          : canonicalValid
            ? ["merge", "keep-canonical", "recover-legacy", "defer"]
            : ["merge", "recover-legacy"],
    });
  }
  return {
    pending,
    conflicts,
    migrated: pending.length === 0 && conflicts.length === 0,
    details,
    backupRoot: migrationBackupRoot(),
    journalPath: migrationJournalPath(),
  };
}

/** Fail closed when a previously preserved conflict loses its canonical store. */
export async function validateCaveHomeReconciliationStore(
  entries: readonly CaveHomeReconciliationEntry[],
  legacy: string,
): Promise<void> {
  const entry = entries.find((candidate) => candidate.legacy === legacy);
  if (!entry) return;
  const prior = (await readJournal()).entries[legacy];
  if (
    prior?.decision !== "unresolved" &&
    prior?.decision !== "deferred" &&
    !prior?.managedMirrorHash
  ) return;
  await validateCanonical(entry, canonicalPathFor(entry));
}
