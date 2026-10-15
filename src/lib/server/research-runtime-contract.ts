/**
 * Core-owned Research host contracts: managed paths and private process ownership.
 * Keep these available when the optional Research engine is absent. No mission
 * parsing, artifacts, indexing, media jobs, or engine startup belongs here.
 */
import { lstat, mkdir, readFile, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { caveHome } from "../coven-paths.ts";
import { hasUnpairedUtf16Surrogate } from "../utf16.ts";
import { writeJsonAtomic } from "./atomic-write.ts";
import { acquireProcessIntentLock } from "./process-intent-lock.ts";
import {
  parseResearchSessionAuthority,
  type ResearchSessionAuthority,
  type ResearchSessionOwnerKind,
} from "./research-session-authority.ts";

const MISSION_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const RESEARCH_SESSION_OWNER_VERSION = 1;
const RESEARCH_SESSION_ID_MAX_LENGTH = 512;

export const RESEARCH_SESSION_OWNER_WRITE_GRANT_DIAGNOSTIC =
  "Research cannot start because its write access overlaps Cave's private session-ownership directory. Choose a narrower project root outside Cave's runtime data.";

export function researchMissionsRoot(): string {
  return (
    process.env.COVEN_RESEARCH_MISSIONS_DIR?.trim() ||
    path.join(/* turbopackIgnore: true */ caveHome(), "research-missions")
  );
}

function privateResearchRuntimeRoot(
  override: string | undefined,
  defaultDirectory: string,
  label: string,
): string {
  if (override && !path.isAbsolute(override)) {
    throw new Error(`Research ${label} directory must be absolute`);
  }
  const root = path.resolve(
    override || path.join(/* turbopackIgnore: true */ caveHome(), defaultDirectory),
  );
  const missionRoot = path.resolve(researchMissionsRoot());
  if (isWithin(root, missionRoot) || isWithin(missionRoot, root)) {
    throw new Error(`Research ${label} directory must be outside mission workspaces`);
  }
  return root;
}

/**
 * Private process ownership lives beside, never inside, agent-writable mission
 * workspaces. It is intentionally not part of the public Research DTO or Cave
 * backup manifest: restoring stale live-process handles on another machine
 * would be unsafe.
 */
export function researchMissionSessionOwnersRoot(): string {
  return privateResearchRuntimeRoot(
    process.env.COVEN_RESEARCH_SESSION_OWNERS_DIR?.trim(),
    "research-session-owners",
    "session ownership",
  );
}

/**
 * Cross-process action intents live beside the private session-owner ledger,
 * never beneath a familiar-writable research workspace.
 */
export function researchMissionActionLocksRoot(): string {
  return privateResearchRuntimeRoot(
    process.env.COVEN_RESEARCH_ACTION_LOCKS_DIR?.trim(),
    "research-mission-action-locks",
    "mission action lock",
  );
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

async function assertPrivateResearchRuntimeRoot(
  root: string,
  label: string,
): Promise<string> {
  await mkdir(/* turbopackIgnore: true */ root, { recursive: true });
  const info = await lstat(/* turbopackIgnore: true */ root);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error(`Research ${label} directory must be a real directory`);
  }
  const resolvedRoot = await realpath(/* turbopackIgnore: true */ root);
  try {
    const resolvedMissions = await realpath(/* turbopackIgnore: true */ researchMissionsRoot());
    if (isWithin(resolvedRoot, resolvedMissions) || isWithin(resolvedMissions, resolvedRoot)) {
      throw new Error(`Research ${label} directory resolves inside mission workspaces`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return resolvedRoot;
}

async function assertPrivateSessionOwnerRoot(): Promise<string> {
  return assertPrivateResearchRuntimeRoot(
    researchMissionSessionOwnersRoot(),
    "session ownership",
  );
}

export async function assertResearchMissionActionLockRoot(): Promise<string> {
  return assertPrivateResearchRuntimeRoot(
    researchMissionActionLocksRoot(),
    "mission action lock",
  );
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

export function assertMissionId(id: string): void {
  if (!isValidResearchMissionId(id)) throw new Error("invalid mission id");
}

function isWithin(candidate: string, root: string): boolean {
  const comparedCandidate = process.platform === "win32" ? candidate.toLowerCase() : candidate;
  const comparedRoot = process.platform === "win32" ? root.toLowerCase() : root;
  return comparedCandidate === comparedRoot || comparedCandidate.startsWith(comparedRoot + path.sep);
}
