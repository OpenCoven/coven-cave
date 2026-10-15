import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
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
import { assertRealMissionDirectory, isWithin, researchMissionWorkspacePath, withResearchMissionLock } from "./research-workspace-files.ts";
export { researchMissionWorkspacePath, withResearchMissionLock } from "./research-workspace-files.ts";
export {
  RESEARCH_MISSION_X_RUNTIME_DIR,
  writeResearchMissionXRuntimeFiles,
  removeResearchMissionXRuntime,
  sweepResearchMissionXRuntimeResidue,
} from "./research-runtime-privacy.ts";
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

export function missionArtifactPath(id: string, fileName: string): string {
  if (!ARTIFACT_FILE_RE.test(fileName) || path.basename(fileName) !== fileName) {
    throw new Error("invalid artifact filename");
  }
  return path.join(/* turbopackIgnore: true */ researchMissionWorkspacePath(id), "artifacts", fileName);
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
