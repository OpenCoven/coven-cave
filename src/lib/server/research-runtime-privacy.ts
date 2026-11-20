/** Retained privacy maintenance for existing mission files, even without Research. */
import { lstat, mkdir, readdir, realpath, rm, rmdir, unlink } from "node:fs/promises";
import path from "node:path";
import { writeFileAtomic } from "./atomic-write.ts";
import { assertMissionId, isValidResearchMissionId, researchMissionsRoot } from "./research-runtime-contract.ts";
import { assertRealMissionDirectory, isWithin, researchMissionWorkspacePath, withResearchMissionLock } from "./research-workspace-files.ts";

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
    // Reject a linked parent before inspecting/unlinking its child: lstat(x)
    // alone can still follow runtime/ into another workspace.
    const runtimeRoot = path.join(/* turbopackIgnore: true */ missionDirectory, "runtime");
    const parent = await lstat(/* turbopackIgnore: true */ runtimeRoot);
    if (parent.isSymbolicLink() || !parent.isDirectory()) {
      throw new Error("mission X runtime must be a real directory");
    }
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

/** Same lifetime as the X post cache; retain the age gate for live runs. */
export const X_RUNTIME_RESIDUE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export async function sweepResearchMissionXRuntime(now: Date = new Date()): Promise<string[]> {
  return sweepResearchMissionXRuntimeResidue(X_RUNTIME_RESIDUE_MAX_AGE_MS, now);
}
