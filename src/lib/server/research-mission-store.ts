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
import {
  ensureStandardArtifactRefs,
  parseResearchMission,
} from "../research-missions.ts";
import { hasUnpairedUtf16Surrogate } from "../utf16.ts";
import { writeFileAtomic, writeJsonAtomic } from "./atomic-write.ts";
import { acquireProcessIntentLock } from "./process-intent-lock.ts";
import {
  parseResearchSessionAuthority,
  type ResearchSessionAuthority,
  type ResearchSessionOwnerKind,
} from "./research-session-authority.ts";

const MISSION_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const ARTIFACT_FILE_RE = /^[a-z0-9][a-z0-9._-]{0,127}$/i;
const RESEARCH_SESSION_OWNER_VERSION = 1;
const RESEARCH_SESSION_ID_MAX_LENGTH = 512;

export const RESEARCH_SESSION_OWNER_WRITE_GRANT_DIAGNOSTIC =
  "Research cannot start because its write access overlaps Cave's private session-ownership directory. Choose a narrower project root outside Cave's runtime data.";

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

export function researchMissionsRoot(): string {
  return (
    process.env.COVEN_RESEARCH_MISSIONS_DIR?.trim() ||
    path.join(/* turbopackIgnore: true */ caveHome(), "research-missions")
  );
}

/**
 * Private process ownership lives beside, never inside, agent-writable mission
 * workspaces. It is intentionally not part of the public Research DTO or Cave
 * backup manifest: restoring stale live-process handles on another machine
 * would be unsafe.
 */
export function researchMissionSessionOwnersRoot(): string {
  const override = process.env.COVEN_RESEARCH_SESSION_OWNERS_DIR?.trim();
  if (override && !path.isAbsolute(override)) {
    throw new Error("Research session ownership directory must be absolute");
  }
  const root = path.resolve(
    override || path.join(/* turbopackIgnore: true */ caveHome(), "research-session-owners"),
  );
  if (isWithin(root, path.resolve(researchMissionsRoot()))) {
    throw new Error("Research session ownership directory must be outside mission workspaces");
  }
  return root;
}

export type ResearchMissionSessionOwner = {
  missionId: string;
  iteration: number;
  sessionId: string;
  ownerKind: ResearchSessionOwnerKind;
  authority?: ResearchSessionAuthority;
  recordedAt: string;
};

type ResearchSessionOwnerFile = {
  version: typeof RESEARCH_SESSION_OWNER_VERSION;
  owner: ResearchMissionSessionOwner;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validSessionId(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= RESEARCH_SESSION_ID_MAX_LENGTH
    && !value.includes("\0")
    && !hasUnpairedUtf16Surrogate(value);
}

function parseResearchMissionSessionOwner(value: unknown): ResearchMissionSessionOwner | null {
  if (!isRecord(value)
    || !isValidResearchMissionId(value.missionId)
    || !Number.isSafeInteger(value.iteration)
    || (value.iteration as number) < 1
    || !validSessionId(value.sessionId)
    || (value.ownerKind !== "direct-copilot" && value.ownerKind !== "owner-local-daemon")
    || typeof value.recordedAt !== "string"
    || !Number.isFinite(Date.parse(value.recordedAt))) {
    return null;
  }
  if (value.ownerKind === "direct-copilot") {
    if (value.authority !== undefined) return null;
    return {
      missionId: value.missionId,
      iteration: value.iteration as number,
      sessionId: value.sessionId,
      ownerKind: "direct-copilot",
      recordedAt: value.recordedAt,
    };
  }
  const authority = parseResearchSessionAuthority(value.authority);
  if (!authority) return null;
  return {
    missionId: value.missionId,
    iteration: value.iteration as number,
    sessionId: value.sessionId,
    ownerKind: "owner-local-daemon",
    authority,
    recordedAt: value.recordedAt,
  };
}

function researchMissionSessionOwnerPath(missionId: string, root = researchMissionSessionOwnersRoot()): string {
  assertMissionId(missionId);
  return path.join(/* turbopackIgnore: true */ root, `${missionId}.json`);
}

async function assertPrivateSessionOwnerRoot(): Promise<string> {
  const root = researchMissionSessionOwnersRoot();
  await mkdir(/* turbopackIgnore: true */ root, { recursive: true });
  const info = await lstat(/* turbopackIgnore: true */ root);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error("Research session ownership directory must be a real directory");
  }
  const resolvedRoot = await realpath(/* turbopackIgnore: true */ root);
  try {
    const resolvedMissions = await realpath(/* turbopackIgnore: true */ researchMissionsRoot());
    if (isWithin(resolvedRoot, resolvedMissions)) {
      throw new Error("Research session ownership directory resolves inside mission workspaces");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return resolvedRoot;
}

/**
 * A Research child must never receive write access to the private ownership
 * ledger or one of its ancestors. Both directions are rejected so the ledger
 * and every granted root remain disjoint after canonical path resolution.
 */
export async function assertResearchSessionOwnerOutsideWriteRoots(
  writeRoots: string[],
): Promise<void> {
  const ownerRoot = await assertPrivateSessionOwnerRoot();
  for (const rawRoot of new Set(writeRoots)) {
    if (!path.isAbsolute(rawRoot)) {
      throw new Error(RESEARCH_SESSION_OWNER_WRITE_GRANT_DIAGNOSTIC);
    }
    let writeRoot: string;
    try {
      writeRoot = await realpath(/* turbopackIgnore: true */ rawRoot);
    } catch {
      throw new Error(RESEARCH_SESSION_OWNER_WRITE_GRANT_DIAGNOSTIC);
    }
    if (isWithin(ownerRoot, writeRoot) || isWithin(writeRoot, ownerRoot)) {
      throw new Error(RESEARCH_SESSION_OWNER_WRITE_GRANT_DIAGNOSTIC);
    }
  }
}

async function withResearchSessionOwnerFileLock<T>(
  missionId: string,
  operation: (resolvedRoot: string) => Promise<T>,
): Promise<T> {
  const root = await assertPrivateSessionOwnerRoot();
  const target = path.join(/* turbopackIgnore: true */ root, `${missionId}.json`);
  const release = await acquireProcessIntentLock({
    intentsDirectory: `${target}.locks`,
    label: `Research session owner ${missionId}`,
  });
  try {
    return await operation(root);
  } finally {
    await release();
  }
}

async function readResearchSessionOwnerFile(
  missionId: string,
  resolvedRoot?: string,
): Promise<ResearchMissionSessionOwner | null> {
  const root = resolvedRoot ?? await assertPrivateSessionOwnerRoot();
  const target = researchMissionSessionOwnerPath(missionId, root);
  let raw: string;
  try {
    raw = await readFile(/* turbopackIgnore: true */ target, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("Research session ownership ledger is malformed");
  }
  if (!isRecord(value)
    || value.version !== RESEARCH_SESSION_OWNER_VERSION
    || !isRecord(value.owner)) {
    throw new Error("Research session ownership ledger is malformed");
  }
  const owner = parseResearchMissionSessionOwner(value.owner);
  if (!owner || owner.missionId !== missionId) {
    throw new Error("Research session ownership ledger is malformed");
  }
  return owner;
}

export async function loadResearchMissionSessionOwner(
  missionId: string,
): Promise<ResearchMissionSessionOwner | null> {
  assertMissionId(missionId);
  return readResearchSessionOwnerFile(missionId);
}

export async function recordResearchMissionSessionOwner(
  owner: ResearchMissionSessionOwner,
): Promise<void> {
  const parsed = parseResearchMissionSessionOwner(owner);
  if (!parsed) throw new Error("invalid Research session owner");
  await withResearchSessionOwnerFileLock(parsed.missionId, async (root) => {
    const existing = await readResearchSessionOwnerFile(parsed.missionId, root);
    if (existing) {
      if (existing.iteration !== parsed.iteration
        || existing.sessionId !== parsed.sessionId
        || existing.ownerKind !== parsed.ownerKind
        || existing.authority?.socketPath !== parsed.authority?.socketPath) {
        throw new Error("Research mission already has a different active session owner");
      }
      return;
    }
    await writeJsonAtomic(
      researchMissionSessionOwnerPath(parsed.missionId, root),
      { version: RESEARCH_SESSION_OWNER_VERSION, owner: parsed } satisfies ResearchSessionOwnerFile,
    );
  });
}

export async function clearResearchMissionSessionOwner(
  owner: Pick<ResearchMissionSessionOwner, "missionId" | "iteration" | "sessionId">,
): Promise<void> {
  assertMissionId(owner.missionId);
  await withResearchSessionOwnerFileLock(owner.missionId, async (root) => {
    const existing = await readResearchSessionOwnerFile(owner.missionId, root);
    if (!existing) return;
    if (existing.iteration !== owner.iteration || existing.sessionId !== owner.sessionId) {
      throw new Error("Research session owner changed before it could be cleared");
    }
    await rm(/* turbopackIgnore: true */ researchMissionSessionOwnerPath(owner.missionId, root), { force: true });
  });
}

export function isValidResearchMissionId(id: unknown): id is string {
  return typeof id === "string" && MISSION_ID_RE.test(id);
}

function assertMissionId(id: string): void {
  if (!isValidResearchMissionId(id)) throw new Error("invalid mission id");
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

export async function saveResearchMission(mission: ResearchMission): Promise<void> {
  assertMissionId(mission.id);
  await withResearchMissionLock(mission.id, async () => {
    const directory = await assertRealMissionDirectory(mission.id);
    await writeJsonAtomic(path.join(/* turbopackIgnore: true */ directory, "mission.json"), mission);
  });
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
    return ensureStandardArtifactRefs(parsed);
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
