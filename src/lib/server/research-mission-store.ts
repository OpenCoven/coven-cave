import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
} from "node:fs/promises";
import path from "node:path";
import { caveHome } from "../coven-paths.ts";
import type { ResearchMission } from "../research-missions.ts";
import { writeFileAtomic, writeJsonAtomic } from "./atomic-write.ts";

const MISSION_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const ARTIFACT_FILE_RE = /^[a-z0-9][a-z0-9._-]{0,127}$/i;

export const MAX_RESEARCH_FILE_BYTES = 2 * 1024 * 1024;

declare global {
  var __caveResearchMissionLocks: Map<string, Promise<void>> | undefined;
}

function missionLocks(): Map<string, Promise<void>> {
  globalThis.__caveResearchMissionLocks ??= new Map();
  return globalThis.__caveResearchMissionLocks;
}

export function researchMissionsRoot(): string {
  return (
    process.env.COVEN_RESEARCH_MISSIONS_DIR?.trim() ||
    path.join(caveHome(), "research-missions")
  );
}

export function isValidResearchMissionId(id: unknown): id is string {
  return typeof id === "string" && MISSION_ID_RE.test(id);
}

function assertMissionId(id: string): void {
  if (!isValidResearchMissionId(id)) throw new Error("invalid mission id");
}

export function researchMissionWorkspacePath(id: string): string {
  assertMissionId(id);
  return path.join(researchMissionsRoot(), id);
}

export function missionArtifactPath(id: string, fileName: string): string {
  if (!ARTIFACT_FILE_RE.test(fileName) || path.basename(fileName) !== fileName) {
    throw new Error("invalid artifact filename");
  }
  return path.join(researchMissionWorkspacePath(id), "artifacts", fileName);
}

function isWithin(candidate: string, root: string): boolean {
  return candidate === root || candidate.startsWith(root + path.sep);
}

function isResearchMission(value: unknown): value is ResearchMission {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const mission = value as Partial<ResearchMission>;
  return (
    mission.version === 1 &&
    typeof mission.id === "string" &&
    MISSION_ID_RE.test(mission.id) &&
    typeof mission.familiarId === "string" &&
    typeof mission.title === "string" &&
    typeof mission.intent === "string" &&
    Array.isArray(mission.iterations) &&
    Array.isArray(mission.artifacts) &&
    Array.isArray(mission.sources)
  );
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
  const stat = await lstat(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error("mission workspace must be a real directory");
  }
  const [resolvedDirectory, resolvedRoot] = await Promise.all([
    realpath(directory),
    realpath(researchMissionsRoot()),
  ]);
  if (!isWithin(resolvedDirectory, resolvedRoot)) {
    throw new Error("mission workspace is outside research root");
  }
  return resolvedDirectory;
}

export async function createResearchMissionWorkspace(
  mission: ResearchMission,
): Promise<ResearchMission> {
  assertMissionId(mission.id);
  return withResearchMissionLock(mission.id, async () => {
    const root = researchMissionsRoot();
    const directory = researchMissionWorkspacePath(mission.id);
    await mkdir(root, { recursive: true });
    await mkdir(directory);
    try {
      await mkdir(path.join(directory, "artifacts"));
      await Promise.all([
        writeJsonAtomic(path.join(directory, "mission.json"), mission),
        writeFileAtomic(
          path.join(directory, "research-state.yaml"),
          `version: 1\nmission: ${mission.id}\nstatus: ${mission.status}\niteration: 0\n`,
        ),
        writeFileAtomic(path.join(directory, "findings.md"), "# Findings\n"),
        writeFileAtomic(path.join(directory, "research-log.md"), "# Research log\n"),
        writeJsonAtomic(path.join(directory, "sources.json"), mission.sources),
      ]);
      return mission;
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
  });
}

export async function saveResearchMission(mission: ResearchMission): Promise<void> {
  assertMissionId(mission.id);
  await withResearchMissionLock(mission.id, async () => {
    const directory = await assertRealMissionDirectory(mission.id);
    await writeJsonAtomic(path.join(directory, "mission.json"), mission);
  });
}

export async function loadResearchMission(id: string): Promise<ResearchMission | null> {
  assertMissionId(id);
  try {
    const directory = await assertRealMissionDirectory(id);
    const raw = await readFile(path.join(directory, "mission.json"), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!isResearchMission(parsed) || parsed.id !== id) return null;
    return parsed;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

export async function listResearchMissions(): Promise<ResearchMission[]> {
  let entries;
  try {
    entries = await readdir(researchMissionsRoot(), { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const missions = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && MISSION_ID_RE.test(entry.name))
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
  const candidate = path.resolve(directory, relativePath);
  if (!relativePath || path.isAbsolute(relativePath) || !isWithin(candidate, directory)) {
    throw new Error("file is outside mission workspace");
  }
  const stat = await lstat(candidate);
  if (stat.isSymbolicLink()) throw new Error("research files cannot be symlinks");
  if (!stat.isFile()) throw new Error("research path is not a file");
  if (stat.size > MAX_RESEARCH_FILE_BYTES) throw new Error("research file is too large");
  const resolvedCandidate = await realpath(candidate);
  if (!isWithin(resolvedCandidate, directory)) {
    throw new Error("file is outside mission workspace");
  }
  return readFile(resolvedCandidate, "utf8");
}
