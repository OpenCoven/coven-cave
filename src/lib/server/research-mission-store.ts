import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  rmdir,
  unlink,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import type { ResearchMission } from "../research-missions.ts";
import {
  ensureStandardArtifactRefs,
  parseResearchMission,
  repairResearchMissionState,
} from "../research-missions.ts";
import { writeFileAtomic, writeJsonAtomic } from "./atomic-write.ts";
import { assertMissionId, isValidResearchMissionId, researchMissionsRoot } from "./research-runtime-contract.ts";
export {
  RESEARCH_SESSION_OWNER_WRITE_GRANT_DIAGNOSTIC,
  researchMissionsRoot,
  researchMissionSessionOwnersRoot,
  researchMissionActionLocksRoot,
  assertResearchMissionActionLockRoot,
  assertResearchSessionOwnerOutsideWriteRoots,
  loadResearchMissionSessionOwner,
  recordResearchMissionSessionOwner,
  clearResearchMissionSessionOwner,
  isValidResearchMissionId,
  type ResearchMissionSessionOwner,
} from "./research-runtime-contract.ts";

const ARTIFACT_FILE_RE = /^[a-z0-9][a-z0-9._-]{0,127}$/i;
const SOURCE_FILE_RE = /^x-article-[a-f0-9]{24}\.md$/;

export const MAX_RESEARCH_FILE_BYTES = 2 * 1024 * 1024;

/**
 * A mission-file read that fails the workspace sandbox: the path escapes the
 * mission workspace, resolves through a symlink, isn't a regular file, or
 * exceeds the read cap. The request was well-formed — these are client-visible
 * *containment* outcomes, not server faults — so routes surface them as 4xx,
 * never 500 (cave-v73d). Missing files (ENOENT) are NOT integrity failures:
 * they carry Node's errno code and callers special-case them separately.
 */
export class ResearchFileIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResearchFileIntegrityError";
  }
}

export function isResearchFileIntegrityError(
  error: unknown,
): error is ResearchFileIntegrityError {
  return error instanceof Error && error.name === "ResearchFileIntegrityError";
}

declare global {
  var __caveResearchMissionLocks: Map<string, Promise<void>> | undefined;
}

function missionLocks(): Map<string, Promise<void>> {
  globalThis.__caveResearchMissionLocks ??= new Map();
  return globalThis.__caveResearchMissionLocks;
}

export function researchMissionWorkspacePath(id: string): string {
  assertMissionId(id);
  return path.join(/* turbopackIgnore: true */ researchMissionsRoot(), id);
}

export function missionArtifactPath(id: string, fileName: string): string {
  if (!ARTIFACT_FILE_RE.test(fileName) || path.basename(fileName) !== fileName) {
    throw new Error("invalid artifact filename");
  }
  return path.join(/* turbopackIgnore: true */ researchMissionWorkspacePath(id), "artifacts", fileName);
}

function isWithin(candidate: string, root: string): boolean {
  const comparedCandidate = process.platform === "win32" ? candidate.toLowerCase() : candidate;
  const comparedRoot = process.platform === "win32" ? root.toLowerCase() : root;
  return comparedCandidate === comparedRoot || comparedCandidate.startsWith(comparedRoot + path.sep);
}

export function withResearchMissionLock<T>(
  id: string,
  operation: () => Promise<T>,
): Promise<T> {
  assertMissionId(id);
  const locks = missionLocks();
  const previous = locks.get(id) ?? Promise.resolve();
  const result = previous.then(operation, operation);
  const tail = result.then(
    () => undefined,
    () => undefined,
  );
  locks.set(id, tail);
  void tail.then(() => {
    if (locks.get(id) === tail) locks.delete(id);
  });
  return result;
}

async function assertRealMissionDirectory(id: string): Promise<string> {
  const directory = researchMissionWorkspacePath(id);
  // Research workspaces live beneath the user's runtime cave home. They are
  // validated below, but are never build inputs for the Next server bundle.
  const stat = await lstat(/* turbopackIgnore: true */ directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error("mission workspace must be a real directory");
  }
  const [resolvedDirectory, resolvedRoot] = await Promise.all([
    realpath(/* turbopackIgnore: true */ directory),
    realpath(/* turbopackIgnore: true */ researchMissionsRoot()),
  ]);
  if (!isWithin(resolvedDirectory, resolvedRoot)) {
    throw new Error("mission workspace is outside research root");
  }
  return resolvedDirectory;
}

function assertSourceFileName(fileName: string): void {
  if (!SOURCE_FILE_RE.test(fileName)) {
    throw new Error("invalid source filename");
  }
}

async function assertRealSourceFilesDirectory(missionDirectory: string): Promise<string> {
  const directory = path.join(/* turbopackIgnore: true */ missionDirectory, "source-files");
  await mkdir(/* turbopackIgnore: true */ directory, { recursive: true });
  const stat = await lstat(/* turbopackIgnore: true */ directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error("source-files must be a real directory");
  }
  const resolvedDirectory = await realpath(/* turbopackIgnore: true */ directory);
  if (!isWithin(resolvedDirectory, missionDirectory)) {
    throw new Error("source-files is outside mission workspace");
  }
  return resolvedDirectory;
}

async function sourceFileTarget(
  missionDirectory: string,
  fileName: string,
): Promise<{ sourceDirectory: string; target: string }> {
  const sourceDirectory = await assertRealSourceFilesDirectory(missionDirectory);
  const target = path.resolve(/* turbopackIgnore: true */ sourceDirectory, fileName);
  if (!isWithin(target, sourceDirectory)) {
    throw new Error("source file is outside source-files");
  }
  return { sourceDirectory, target };
}

async function readExistingSourceFile(
  sourceDirectory: string,
  target: string,
): Promise<string | null> {
  let stat;
  try {
    stat = await lstat(/* turbopackIgnore: true */ target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (stat.isSymbolicLink()) throw new Error("source files cannot be symlinks");
  if (!stat.isFile()) throw new Error("source path is not a file");
  const resolvedTarget = await realpath(/* turbopackIgnore: true */ target);
  if (!isWithin(resolvedTarget, sourceDirectory)) {
    throw new Error("source file is outside source-files");
  }
  return readFile(/* turbopackIgnore: true */ resolvedTarget, "utf8");
}

export type ResearchMissionSourceFileWriteToken = {
  content: string;
  sha256: string;
};

function sourceFileWriteToken(content: string): ResearchMissionSourceFileWriteToken {
  // This is the exact text that reaches writeFileAtomic after Node's UTF-8
  // conversion, including replacement characters for malformed JS strings.
  const utf8Content = Buffer.from(content, "utf8").toString("utf8");
  return {
    content: utf8Content,
    sha256: createHash("sha256").update(utf8Content, "utf8").digest("hex"),
  };
}

function assertSourceFileWriteToken(
  expected: ResearchMissionSourceFileWriteToken,
): void {
  if (
    typeof expected?.content !== "string" ||
    !/^[a-f0-9]{64}$/.test(expected.sha256) ||
    sourceFileWriteToken(expected.content).sha256 !== expected.sha256
  ) {
    throw new Error("invalid expected source file write token");
  }
}

export async function writeResearchMissionSourceFile(
  missionId: string,
  fileName: string,
  content: string,
): Promise<{
  path: string;
  previous: string | null;
  expected: ResearchMissionSourceFileWriteToken;
}> {
  assertMissionId(missionId);
  assertSourceFileName(fileName);
  return withResearchMissionLock(missionId, async () => {
    const missionDirectory = await assertRealMissionDirectory(missionId);
    const { sourceDirectory, target } = await sourceFileTarget(missionDirectory, fileName);
    const previous = await readExistingSourceFile(sourceDirectory, target);
    const expected = sourceFileWriteToken(content);
    await writeFileAtomic(target, expected.content);
    return { path: path.posix.join("source-files", fileName), previous, expected };
  });
}

export async function restoreResearchMissionSourceFile(
  missionId: string,
  fileName: string,
  previous: string | null,
  expected: ResearchMissionSourceFileWriteToken,
): Promise<void> {
  assertMissionId(missionId);
  assertSourceFileName(fileName);
  assertSourceFileWriteToken(expected);
  return withResearchMissionLock(missionId, async () => {
    const missionDirectory = await assertRealMissionDirectory(missionId);
    const { sourceDirectory, target } = await sourceFileTarget(missionDirectory, fileName);
    const existing = await readExistingSourceFile(sourceDirectory, target);
    if (existing === null) {
      throw new Error("Research source file is missing after materialization; rollback refused");
    }
    if (
      existing !== expected.content ||
      createHash("sha256").update(existing, "utf8").digest("hex") !== expected.sha256
    ) {
      throw new Error("Research source file changed after materialization; rollback refused");
    }
    if (previous !== null) {
      await writeFileAtomic(target, previous);
      return;
    }
    await unlink(/* turbopackIgnore: true */ target);
  });
}

/**
 * Temporary, run-scoped external content lives here and nowhere else.
 *
 * `source-files/` is the DURABLE half of the workspace: an X Article
 * materialized through attach-saved-link is meant to persist. `runtime/x/` is
 * the opposite contract — normalized X post text hydrated just in time for one
 * iteration and removed the moment that iteration settles. Keeping the two in
 * separate directories is what lets removal be a whole-directory `rm` that
 * cannot take a durable file with it.
 */
export const RESEARCH_MISSION_X_RUNTIME_DIR = "runtime/x";
const X_RUNTIME_FILE_RE = /^x-post-\d{1,25}\.md$/;

function assertXRuntimeFileName(fileName: string): void {
  if (!X_RUNTIME_FILE_RE.test(fileName) || path.basename(fileName) !== fileName) {
    throw new Error("invalid X runtime filename");
  }
}

function missionXRuntimeTarget(missionDirectory: string): string {
  return path.join(/* turbopackIgnore: true */ missionDirectory, "runtime", "x");
}

async function assertRealXRuntimeDirectory(missionDirectory: string): Promise<string> {
  const runtimeRoot = path.join(/* turbopackIgnore: true */ missionDirectory, "runtime");
  const directory = missionXRuntimeTarget(missionDirectory);
  await mkdir(/* turbopackIgnore: true */ directory, { recursive: true });
  for (const candidate of [runtimeRoot, directory]) {
    const stat = await lstat(/* turbopackIgnore: true */ candidate);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error("mission X runtime must be a real directory");
    }
  }
  const resolvedDirectory = await realpath(/* turbopackIgnore: true */ directory);
  if (!isWithin(resolvedDirectory, missionDirectory)) {
    throw new Error("mission X runtime is outside the mission workspace");
  }
  return resolvedDirectory;
}

/**
 * Replace the mission's hydrated X runtime with exactly `files`.
 *
 * The directory is dropped first, so a previous run's residue can never be
 * presented to this iteration as if it had been rehydrated now.
 */
export async function writeResearchMissionXRuntimeFiles(
  missionId: string,
  files: ReadonlyArray<{ fileName: string; content: string }>,
): Promise<string[]> {
  assertMissionId(missionId);
  for (const file of files) assertXRuntimeFileName(file.fileName);
  const names = files.map((file) => file.fileName);
  if (new Set(names).size !== names.length) {
    throw new Error("duplicate X runtime filename");
  }
  return withResearchMissionLock(missionId, async () => {
    const missionDirectory = await assertRealMissionDirectory(missionId);
    await removeMissionXRuntimeUnlocked(missionDirectory);
    if (files.length === 0) return [];
    const directory = await assertRealXRuntimeDirectory(missionDirectory);
    const written: string[] = [];
    for (const file of files) {
      const target = path.resolve(/* turbopackIgnore: true */ directory, file.fileName);
      if (!isWithin(target, directory)) {
        throw new Error("X runtime file is outside the runtime directory");
      }
      await writeFileAtomic(target, file.content);
      written.push(path.posix.join("runtime", "x", file.fileName));
    }
    return written;
  });
}

async function removeMissionXRuntimeUnlocked(missionDirectory: string): Promise<void> {
  const directory = missionXRuntimeTarget(missionDirectory);
  let stat;
  try {
    stat = await lstat(/* turbopackIgnore: true */ directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    // Never recurse through a link an agent may have planted in its own
    // writable workspace: drop the entry itself, never what it points at.
    await unlink(/* turbopackIgnore: true */ directory);
  } else {
    const resolved = await realpath(/* turbopackIgnore: true */ directory);
    if (!isWithin(resolved, missionDirectory)) {
      throw new Error("mission X runtime is outside the mission workspace");
    }
    await rm(/* turbopackIgnore: true */ directory, { recursive: true, force: true });
  }
  // Leave no empty scaffolding behind, but never disturb a `runtime/`
  // directory something else is using. `rmdir` is the operation that expresses
  // exactly that: it removes an empty directory and refuses a populated one
  // with ENOTEMPTY. `rm(..., { recursive: false })` cannot be used here — Node
  // throws ERR_FS_EISDIR for ANY directory, empty or not, so that form removed
  // nothing at all and left the empty `runtime/` behind on every call.
  await rmdir(path.join(/* turbopackIgnore: true */ missionDirectory, "runtime")).catch(() => {});
}

/**
 * Remove every hydrated X post file for a mission. Safe to call when the
 * mission, its workspace, or the runtime directory does not exist — removal
 * runs from several independent places on purpose (see
 * research-mission-x-runtime.ts) and none of them may fail because another
 * already did the work.
 */
export async function removeResearchMissionXRuntime(missionId: string): Promise<void> {
  assertMissionId(missionId);
  await withResearchMissionLock(missionId, async () => {
    let missionDirectory: string;
    try {
      missionDirectory = await assertRealMissionDirectory(missionId);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    await removeMissionXRuntimeUnlocked(missionDirectory);
  });
}

/**
 * Crash residue sweep: remove `runtime/x` for every mission whose runtime
 * directory has not been touched inside `maxAgeMs`.
 *
 * A research iteration is bounded in minutes, so a runtime directory older
 * than the sweep window belongs to a run whose process died — no in-process
 * cleanup will ever reach it. The age gate is what keeps this from robbing a
 * live run started by another process.
 */
export async function sweepResearchMissionXRuntimeResidue(
  maxAgeMs: number,
  now: Date = new Date(),
): Promise<string[]> {
  if (!Number.isFinite(maxAgeMs) || maxAgeMs < 0) {
    throw new Error("invalid X runtime residue age");
  }
  let entries;
  try {
    entries = await readdir(/* turbopackIgnore: true */ researchMissionsRoot(), {
      withFileTypes: true,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const cutoff = now.getTime() - maxAgeMs;
  const swept: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !isValidResearchMissionId(entry.name)) continue;
    const directory = missionXRuntimeTarget(researchMissionWorkspacePath(entry.name));
    let stat;
    try {
      stat = await lstat(/* turbopackIgnore: true */ directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    if (stat.mtimeMs > cutoff) continue;
    await removeResearchMissionXRuntime(entry.name);
    swept.push(entry.name);
  }
  return swept;
}

/**
 * Read-modify-write the durable source ledger under the mission lock.
 *
 * `saveResearchMission` takes the same non-reentrant lock, so a caller that
 * needs load-then-save as one unit cannot compose the two public functions.
 */
export async function updateResearchMissionSources(
  missionId: string,
  update: (sources: ResearchMission["sources"]) => ResearchMission["sources"],
): Promise<ResearchMission | null> {
  assertMissionId(missionId);
  return withResearchMissionLock(missionId, async () => {
    // `loadResearchMission` deliberately takes no lock, so it composes inside
    // this one; `saveResearchMission` does, hence the unlocked save below.
    const mission = await loadResearchMission(missionId);
    if (!mission) return null;
    const updated: ResearchMission = {
      ...mission,
      sources: update(mission.sources),
    };
    await saveResearchMissionUnlocked(updated);
    return updated;
  });
}

export async function createResearchMissionWorkspace(
  mission: ResearchMission,
): Promise<ResearchMission> {
  assertMissionId(mission.id);
  return withResearchMissionLock(mission.id, async () => {
    const root = researchMissionsRoot();
    const directory = researchMissionWorkspacePath(mission.id);
    await mkdir(/* turbopackIgnore: true */ root, { recursive: true });
    await mkdir(/* turbopackIgnore: true */ directory);
    try {
      await mkdir(path.join(/* turbopackIgnore: true */ directory, "artifacts"));
      await Promise.all([
        writeJsonAtomic(path.join(/* turbopackIgnore: true */ directory, "mission.json"), mission),
        writeFileAtomic(
          path.join(/* turbopackIgnore: true */ directory, "research-state.yaml"),
          `version: 1\nmission: ${mission.id}\nstatus: ${mission.status}\niteration: 0\n`,
        ),
        writeFileAtomic(path.join(/* turbopackIgnore: true */ directory, "findings.md"), "# Findings\n"),
        writeFileAtomic(path.join(/* turbopackIgnore: true */ directory, "research-log.md"), "# Research log\n"),
        writeJsonAtomic(path.join(/* turbopackIgnore: true */ directory, "sources.json"), mission.sources),
      ]);
      return mission;
    } catch (error) {
      await rm(/* turbopackIgnore: true */ directory, { recursive: true, force: true });
      throw error;
    }
  });
}

export async function removeResearchMissionWorkspace(id: string): Promise<void> {
  assertMissionId(id);
  await withResearchMissionLock(id, async () => {
    const directory = await assertRealMissionDirectory(id);
    await rm(/* turbopackIgnore: true */ directory, { recursive: true, force: false });
  });
}

async function saveResearchMissionUnlocked(mission: ResearchMission): Promise<void> {
  const directory = await assertRealMissionDirectory(mission.id);
  await writeJsonAtomic(path.join(/* turbopackIgnore: true */ directory, "mission.json"), mission);
}

export async function saveResearchMission(mission: ResearchMission): Promise<void> {
  assertMissionId(mission.id);
  await withResearchMissionLock(mission.id, () => saveResearchMissionUnlocked(mission));
}

export async function loadResearchMission(id: string): Promise<ResearchMission | null> {
  assertMissionId(id);
  try {
    const directory = await assertRealMissionDirectory(id);
    const raw = await readFile(path.join(/* turbopackIgnore: true */ directory, "mission.json"), "utf8");
    const parsed = parseResearchMission(JSON.parse(raw));
    if (!parsed || parsed.id !== id) return null;
    // Additive read-time backfill: missions created before the standard refs
    // existed gain them on load; the refs persist on the next save.
    return ensureStandardArtifactRefs(repairResearchMissionState(parsed));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

export async function listResearchMissions(): Promise<ResearchMission[]> {
  let entries;
  try {
    entries = await readdir(/* turbopackIgnore: true */ researchMissionsRoot(), { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const missions = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && isValidResearchMissionId(entry.name))
      .map((entry) => loadResearchMission(entry.name)),
  );
  return missions
    .filter((mission): mission is ResearchMission => mission !== null)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function readValidatedMissionFile(
  id: string,
  relativePath: string,
): Promise<string> {
  const directory = await assertRealMissionDirectory(id);
  const candidate = path.resolve(/* turbopackIgnore: true */ directory, relativePath);
  if (!relativePath || path.isAbsolute(relativePath) || !isWithin(candidate, directory)) {
    throw new ResearchFileIntegrityError("file is outside mission workspace");
  }
  const stat = await lstat(/* turbopackIgnore: true */ candidate);
  if (stat.isSymbolicLink()) throw new ResearchFileIntegrityError("research files cannot be symlinks");
  if (!stat.isFile()) throw new ResearchFileIntegrityError("research path is not a file");
  if (stat.size > MAX_RESEARCH_FILE_BYTES) throw new ResearchFileIntegrityError("research file is too large");
  const resolvedCandidate = await realpath(/* turbopackIgnore: true */ candidate);
  if (!isWithin(resolvedCandidate, directory)) {
    throw new ResearchFileIntegrityError("file is outside mission workspace");
  }
  return readFile(/* turbopackIgnore: true */ resolvedCandidate, "utf8");
}
