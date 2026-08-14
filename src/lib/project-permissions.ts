import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { caveHome } from "./coven-paths.ts";
import {
  caveHomeStoreNeedsRecoveryNormalization,
  markCaveHomeStoreRecoveryNormalized,
  withCaveHomeReconciledStore,
} from "./server/cave-home-migration.ts";
import { writeJsonAtomic } from "./server/atomic-write.ts";
import { invalidateSessionsListCache } from "./server/sessions-list-cache.ts";
import {
  projectPermissionsStorePath,
  withProjectAuthorizationGuard,
} from "./server/project-authorization-lock.ts";

import {
  deleteProjectAlreadyAuthorized,
  loadProjects,
  loadProjectsAlreadyAuthorized,
  projectForRoot,
} from "./cave-projects.ts";
import type { CaveProject } from "./cave-projects-types.ts";
import {
  accessLevelSatisfies,
  normalizeAccessLevel,
  requiredAccessLevel,
  resolveEffectiveAccess,
  type EffectiveProjectAccess,
  type ProjectAccessLevel,
  type ProjectPermissionSurface,
} from "./project-access-levels.ts";

export {
  requiredAccessLevel,
  type EffectiveProjectAccess,
  type ProjectAccessLevel,
  type ProjectPermissionSurface,
} from "./project-access-levels.ts";

export type ProjectGrantSource = "bootstrap" | "human";
export type ProjectAccessDecision = "allow" | "deny";

export type ProjectGrant = {
  familiarId: string;
  projectId: string;
  /** v1 grants predate levels and unlocked every surface → migrate as "write". */
  access: ProjectAccessLevel;
  source: ProjectGrantSource;
  grantedAt: string;
};

export type GroupProjectGrant = {
  projectId: string;
  access: ProjectAccessLevel;
  grantedAt: string;
};

/**
 * A named group of familiars sharing a base set of project grants. Membership
 * is by explicit familiar id — deliberately NOT keyed off the free-text
 * `role` display label, which can be renamed at any time and must never
 * silently change access.
 */
export type FamiliarAccessGroup = {
  id: string;
  name: string;
  description?: string;
  memberFamiliarIds: string[];
  projectGrants: GroupProjectGrant[];
  createdAt: string;
  updatedAt: string;
};

export type GrantProposal = {
  id: string;
  proposedBy: string;
  targetFamiliarId: string;
  projectId: string;
  /** Level the grant will carry when accepted; legacy proposals imply "write". */
  access?: ProjectAccessLevel;
  status: "pending" | "accepting" | "accepted" | "rejected";
  createdAt: string;
  /** Set when the human accepts; the grant only materializes at `finalizesAt`. */
  acceptedAt?: string;
  /** End of the undo window. Absent on legacy/pending/rejected proposals. */
  finalizesAt?: string;
};

/**
 * Delayed acceptance (cave-6mdg): accepting a proposal opens a short undo
 * window instead of granting instantly. The grant materializes lazily once
 * the window elapses; until then the human can undo back to `pending`.
 */
export const GRANT_ACCEPT_UNDO_WINDOW_MS = 30_000;

export type PermissionAuditReason =
  | "grant"
  | "group"
  | "supreme"
  | "missing-grant"
  | "insufficient-access";

export type PermissionAuditEntry = {
  id: string;
  at: string;
  familiarId: string;
  projectId: string;
  surface: ProjectPermissionSurface;
  decision: ProjectAccessDecision;
  reason: PermissionAuditReason;
  /** Level the surface demanded. Legacy entries (v1, binary grants) omit it. */
  requiredAccess?: ProjectAccessLevel;
};

/**
 * Who performed a grant change. `permissionAudit` answers "was this familiar
 * allowed to do X"; this answers "who widened this, when, and from what" —
 * a different question the check log structurally cannot serve.
 */
export type GrantChangeActor = "loopback" | "mobile" | "system";

export type GrantChangeKind = "direct" | "group" | "project-removed" | "bootstrap";

export type GrantChangeEntry = {
  id: string;
  at: string;
  familiarId: string;
  projectId: string;
  /** Level before the change; null when there was no grant. */
  from: ProjectAccessLevel | null;
  /** Level after the change; null when the grant was removed. */
  to: ProjectAccessLevel | null;
  /** Where the write came from — the desktop, the paired phone, or the app itself. */
  actor: GrantChangeActor;
  /** Which surface of the model changed: a direct grant, a group grant, … */
  kind: GrantChangeKind;
  /** Provenance recorded on the grant itself (human, bootstrap, …). */
  source?: ProjectGrantSource;
  /** Access group id, when kind is "group". */
  groupId?: string;
};

export type ProjectPermissionRepairAudit = {
  at: string;
  kind: "orphan-project-repair";
  directGrants: number;
  groupGrants: number;
  proposals: number;
  orphanProjectIds: string[];
};

export type ProjectPermissionIntegrityReport = {
  directGrants: number;
  groupGrants: number;
  proposals: number;
  orphanProjectIds: string[];
};

type ProjectPermissionsFile = {
  version: 2;
  projectGrants: ProjectGrant[];
  accessGroups: FamiliarAccessGroup[];
  grantProposals: GrantProposal[];
  permissionAudit: PermissionAuditEntry[];
  /**
   * Grant-change log. Separate from permissionAudit on purpose: that array
   * holds 1000s of check decisions with a check-shaped schema, and widening it
   * would force every existing entry to be reinterpreted.
   */
  grantAudit: GrantChangeEntry[];
  repairAudit: ProjectPermissionRepairAudit[];
  /**
   * Cross-process session-list cache visibility nonce (Task 5/7 finding:
   * process-local `sessionsListCache.clear()` alone is not enough — another
   * process's grant/group mutation must be visible to THIS process's cache
   * key, not just its own in-memory cache). Regenerated inside
   * `saveProjectPermissions`'s SAME atomic write whenever a mutation changes
   * effective access (grant/revoke/group membership/materialization/repair), so
   * audit/proposal-only/no-op writes keep it stable and failures never advance it.
   * A cryptographic nonce, not a counter or timestamp: no cross-process
   * coordination is needed to hand out the next value, and two writes in the
   * same millisecond (or a clock that moves backward) can never collide or
   * be read as "no change" the way a timestamp comparison could.
   * `readCanonicalSessionListGenerations` (@/lib/server/client-v1/read-model.ts)
   * folds this into the canonical sessions-list cache key ahead of every
   * cache lookup, so a revocation that lands in another process is observed
   * by this one on its very next read — never served stale for up to the
   * cache's normal stale-serve window. Absent on every store written before
   * this field existed — "unversioned" (not a random value) so an
   * unmutated legacy file keeps producing the SAME cache key on every read
   * instead of a fresh one each time, which would otherwise defeat caching
   * entirely for a store nothing has touched yet.
   */
  visibilityGeneration: string;
};

type LegacyV1ProjectGrant = Omit<ProjectGrant, "access">;

type LegacyV1GrantProposal = Omit<
  GrantProposal,
  "access" | "status" | "acceptedAt" | "finalizesAt"
> & {
  status: "pending" | "accepted" | "rejected";
};

type LegacyV1PermissionAuditEntry = Omit<PermissionAuditEntry, "reason" | "requiredAccess"> & {
  reason: "grant" | "supreme" | "missing-grant";
};

type LegacyV1ProjectPermissionsFile = {
  version: 1;
  projectGrants: LegacyV1ProjectGrant[];
  grantProposals: LegacyV1GrantProposal[];
  permissionAudit: LegacyV1PermissionAuditEntry[];
};

type LegacyV2ProjectPermissionsFile = Omit<
  ProjectPermissionsFile,
  "visibilityGeneration" | "grantAudit" | "repairAudit"
> & Partial<Pick<ProjectPermissionsFile, "grantAudit" | "repairAudit">>;

type LegacyPermissionsFile =
  | LegacyV2ProjectPermissionsFile
  | LegacyV1ProjectPermissionsFile;

const MISSING_VISIBILITY_GENERATION = "missing";

type HumanPermissionConfigFile = {
  version: 1;
  supremeFamiliarId: string;
  /**
   * Desktop opt-in (default false): verified-mobile requests — the human's
   * paired phone — may grant/revoke projects and decide grant proposals.
   * Mutable only from a loopback (desktop) origin; the phone can never flip
   * its own write access on.
   */
  allowMobileGrantMutations: boolean;
  /**
   * Desktop opt-in (default false): the human's paired phone may write
   * project files without a familiar context (the iOS Code editor's Save).
   * Familiar-scoped writes keep full grant enforcement regardless.
   */
  allowMobileFileWrites: boolean;
  /**
   * Desktop opt-in (default false): the human's paired phone may mutate the
   * canvas (generate/refine/annotate/delete artifacts, move layout). Off
   * keeps the iOS Canvas tab in view mode — the gallery and previews stay
   * fully readable.
   */
  allowMobileCanvasWrites: boolean;
};

export type ProjectAccessContext = {
  familiarId: string | null | undefined;
};

const DEFAULT_SUPREME_FAMILIAR_ID = "supreme";

function permissionsFilePath(): string {
  return projectPermissionsStorePath();
}

function humanPermissionConfigPath(): string {
  return (
    process.env.CAVE_PERMISSION_CONFIG_PATH_OVERRIDE ??
    path.join(caveHome(), "permission-config.json")
  );
}

function emptyFile(): ProjectPermissionsFile {
  return {
    version: 2,
    projectGrants: [],
    accessGroups: [],
    grantProposals: [],
    permissionAudit: [],
    grantAudit: [],
    repairAudit: [],
    visibilityGeneration: MISSING_VISIBILITY_GENERATION,
  };
}

/**
 * The dedicated cross-process authorization/effect mutex (Task 7 followup):
 * OUTER to every project grant/group/proposal write in this module AND to
 * `withProjectAccessGuard` itself. See
 * `@/lib/server/project-authorization-lock.ts` for the full rationale and the
 * deadlock this replaces.
 */
function withProjectAuthLock<T>(operation: () => Promise<T>): Promise<T> {
  return withProjectAuthorizationGuard(operation);
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

export class ProjectPermissionsIntegrityError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ProjectPermissionsIntegrityError";
  }
}

async function readPermissionsRaw(): Promise<string | null> {
  try {
    return await readFile(permissionsFilePath(), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new ProjectPermissionsIntegrityError("Unable to read project permissions.", {
      cause: error,
    });
  }
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeJsonAtomic(filePath, value);
}

let writeMutex: Promise<unknown> = Promise.resolve();
function withWriteMutex<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeMutex.then(fn, fn);
  writeMutex = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

function withProjectPermissionsStore<T>(operation: () => Promise<T>): Promise<T> {
  if (process.env.CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE) return operation();
  return withCaveHomeReconciledStore("cave-project-permissions.json", operation);
}

async function loadHumanPermissionConfigUnlocked(): Promise<HumanPermissionConfigFile> {
  const parsed = await readJsonFile<Partial<HumanPermissionConfigFile>>(humanPermissionConfigPath());
  const supremeFamiliarId = parsed?.supremeFamiliarId?.trim() || DEFAULT_SUPREME_FAMILIAR_ID;
  // The mobile write-access flags fail closed: anything but literal true is off.
  return {
    version: 1,
    supremeFamiliarId,
    allowMobileGrantMutations: parsed?.allowMobileGrantMutations === true,
    allowMobileFileWrites: parsed?.allowMobileFileWrites === true,
    allowMobileCanvasWrites: parsed?.allowMobileCanvasWrites === true,
  };
}

export async function loadHumanPermissionConfig(): Promise<HumanPermissionConfigFile> {
  const config = process.env.CAVE_PERMISSION_CONFIG_PATH_OVERRIDE
    ? await loadHumanPermissionConfigUnlocked()
    : await withCaveHomeReconciledStore("cave-permission-config.json", loadHumanPermissionConfigUnlocked);
  const fromEnv = process.env.CAVE_SUPREME_FAMILIAR_ID?.trim();
  if (fromEnv) return { ...config, supremeFamiliarId: fromEnv };
  return config;
}

export type MobileWriteAccessConfig = {
  allowMobileGrantMutations: boolean;
  allowMobileFileWrites: boolean;
  allowMobileCanvasWrites: boolean;
};

export async function loadMobileWriteAccess(): Promise<MobileWriteAccessConfig> {
  const { allowMobileGrantMutations, allowMobileFileWrites, allowMobileCanvasWrites } =
    await loadHumanPermissionConfig();
  return { allowMobileGrantMutations, allowMobileFileWrites, allowMobileCanvasWrites };
}

/**
 * Persist the desktop's mobile write-access opt-ins. Callers are responsible
 * for gating this behind a loopback-origin check — the phone must never be
 * able to enable its own write access.
 */
export async function updateMobileWriteAccess(
  patch: Partial<MobileWriteAccessConfig>,
): Promise<MobileWriteAccessConfig> {
  return withWriteMutex(async () => {
    const operation = async () => {
      const current = await loadHumanPermissionConfigUnlocked();
      const next: HumanPermissionConfigFile = {
        ...current,
        allowMobileGrantMutations:
          patch.allowMobileGrantMutations ?? current.allowMobileGrantMutations,
        allowMobileFileWrites: patch.allowMobileFileWrites ?? current.allowMobileFileWrites,
        allowMobileCanvasWrites: patch.allowMobileCanvasWrites ?? current.allowMobileCanvasWrites,
      };
      await writeJsonFile(humanPermissionConfigPath(), next);
      return {
        allowMobileGrantMutations: next.allowMobileGrantMutations,
        allowMobileFileWrites: next.allowMobileFileWrites,
        allowMobileCanvasWrites: next.allowMobileCanvasWrites,
      };
    };
    if (process.env.CAVE_PERMISSION_CONFIG_PATH_OVERRIDE) return operation();
    return withCaveHomeReconciledStore("cave-permission-config.json", operation);
  });
}

function normalizeGrant(grant: Partial<ProjectGrant>): ProjectGrant | null {
  if (typeof grant?.familiarId !== "string" || typeof grant?.projectId !== "string") return null;
  return {
    familiarId: grant.familiarId,
    projectId: grant.projectId,
    // v1 grants have no `access` and unlocked every surface — migrate as write.
    access: normalizeAccessLevel(grant.access),
    source: grant.source === "bootstrap" ? "bootstrap" : "human",
    grantedAt: typeof grant.grantedAt === "string" ? grant.grantedAt : new Date().toISOString(),
  };
}

function normalizeAccessGroup(group: Partial<FamiliarAccessGroup>): FamiliarAccessGroup | null {
  if (typeof group?.id !== "string" || typeof group?.name !== "string") return null;
  const now = new Date().toISOString();
  return {
    id: group.id,
    name: group.name,
    ...(typeof group.description === "string" && group.description
      ? { description: group.description }
      : {}),
    memberFamiliarIds: Array.isArray(group.memberFamiliarIds)
      ? group.memberFamiliarIds.filter((id): id is string => typeof id === "string" && !!id.trim())
      : [],
    projectGrants: Array.isArray(group.projectGrants)
      ? group.projectGrants
          .filter((grant) => typeof grant?.projectId === "string" && !!grant.projectId)
          .map((grant) => ({
            projectId: grant.projectId,
            access: normalizeAccessLevel(grant.access),
            grantedAt: typeof grant.grantedAt === "string" ? grant.grantedAt : now,
          }))
      : [],
    createdAt: typeof group.createdAt === "string" ? group.createdAt : now,
    updatedAt: typeof group.updatedAt === "string" ? group.updatedAt : now,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isAccess(value: unknown): value is ProjectAccessLevel {
  return value === "read" || value === "write";
}

function isProjectPermissionSurface(value: unknown): value is ProjectPermissionSurface {
  return [
    "chat",
    "session-launch",
    "shell",
    "file-browse",
    "file-read",
    "file-write",
    "project-api",
    "mobile",
    "project-picker",
  ].includes(String(value));
}

function isPermissionAuditReason(value: unknown): value is PermissionAuditReason {
  return ["grant", "group", "supreme", "missing-grant", "insufficient-access"].includes(String(value));
}

function isStrictGrant(value: unknown): value is ProjectGrant {
  if (!isRecord(value)) return false;
  return (
    hasOnlyKeys(value, ["familiarId", "projectId", "access", "source", "grantedAt"]) &&
    typeof value.familiarId === "string" &&
    typeof value.projectId === "string" &&
    isAccess(value.access) &&
    (value.source === "bootstrap" || value.source === "human") &&
    typeof value.grantedAt === "string"
  );
}

function isStrictGroupGrant(value: unknown): value is GroupProjectGrant {
  return isRecord(value) &&
    hasOnlyKeys(value, ["projectId", "access", "grantedAt"]) &&
    typeof value.projectId === "string" &&
    isAccess(value.access) &&
    typeof value.grantedAt === "string";
}

function isStrictAccessGroup(value: unknown): value is FamiliarAccessGroup {
  if (!isRecord(value)) return false;
  return (
    hasOnlyKeys(value, [
      "id",
      "name",
      "description",
      "memberFamiliarIds",
      "projectGrants",
      "createdAt",
      "updatedAt",
    ]) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    (value.description === undefined || typeof value.description === "string") &&
    Array.isArray(value.memberFamiliarIds) &&
    value.memberFamiliarIds.every((id) => typeof id === "string") &&
    Array.isArray(value.projectGrants) &&
    value.projectGrants.every(isStrictGroupGrant) &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

function isStrictProposal(value: unknown): value is GrantProposal {
  if (!isRecord(value)) return false;
  const common = (
    hasOnlyKeys(value, [
      "id",
      "proposedBy",
      "targetFamiliarId",
      "projectId",
      "access",
      "status",
      "createdAt",
      "acceptedAt",
      "finalizesAt",
    ]) &&
    typeof value.id === "string" &&
    typeof value.proposedBy === "string" &&
    typeof value.targetFamiliarId === "string" &&
    typeof value.projectId === "string" &&
    (value.access === undefined || isAccess(value.access)) &&
    ["pending", "accepting", "accepted", "rejected"].includes(String(value.status)) &&
    typeof value.createdAt === "string"
  );
  if (!common) return false;

  const hasNoAcceptanceWindow = value.acceptedAt === undefined && value.finalizesAt === undefined;
  const acceptedAt = typeof value.acceptedAt === "string" ? Date.parse(value.acceptedAt) : NaN;
  const finalizesAt = typeof value.finalizesAt === "string" ? Date.parse(value.finalizesAt) : NaN;
  const hasAcceptanceWindow =
    Number.isFinite(acceptedAt) &&
    Number.isFinite(finalizesAt) &&
    finalizesAt - acceptedAt === GRANT_ACCEPT_UNDO_WINDOW_MS;

  if (value.status === "accepting") return hasAcceptanceWindow;
  if (value.status === "accepted") return hasNoAcceptanceWindow || hasAcceptanceWindow;
  return hasNoAcceptanceWindow;
}

function isStrictPermissionAudit(value: unknown): value is PermissionAuditEntry {
  if (!isRecord(value)) return false;
  return (
    hasOnlyKeys(value, [
      "id",
      "at",
      "familiarId",
      "projectId",
      "surface",
      "decision",
      "reason",
      "requiredAccess",
    ]) &&
    typeof value.id === "string" &&
    typeof value.at === "string" &&
    typeof value.familiarId === "string" &&
    typeof value.projectId === "string" &&
    isProjectPermissionSurface(value.surface) &&
    (value.decision === "allow" || value.decision === "deny") &&
    isPermissionAuditReason(value.reason) &&
    (value.requiredAccess === undefined || isAccess(value.requiredAccess))
  );
}

function isStrictGrantAudit(value: unknown): value is GrantChangeEntry {
  if (!isRecord(value)) return false;
  return (
    hasOnlyKeys(value, [
      "id",
      "at",
      "familiarId",
      "projectId",
      "from",
      "to",
      "actor",
      "kind",
      "source",
      "groupId",
    ]) &&
    typeof value.id === "string" &&
    typeof value.at === "string" &&
    typeof value.familiarId === "string" &&
    typeof value.projectId === "string" &&
    (value.from === null || isAccess(value.from)) &&
    (value.to === null || isAccess(value.to)) &&
    ["loopback", "mobile", "system"].includes(String(value.actor)) &&
    ["direct", "group", "project-removed", "bootstrap"].includes(String(value.kind)) &&
    (value.source === undefined || value.source === "bootstrap" || value.source === "human") &&
    (value.groupId === undefined || typeof value.groupId === "string")
  );
}

function isStrictRepairAudit(value: unknown): value is ProjectPermissionRepairAudit {
  if (!isRecord(value)) return false;
  return (
    hasOnlyKeys(value, [
      "at",
      "kind",
      "directGrants",
      "groupGrants",
      "proposals",
      "orphanProjectIds",
    ]) &&
    typeof value.at === "string" &&
    value.kind === "orphan-project-repair" &&
    Number.isInteger(value.directGrants) &&
    Number.isInteger(value.groupGrants) &&
    Number.isInteger(value.proposals) &&
    Array.isArray(value.orphanProjectIds) &&
    value.orphanProjectIds.every((id) => typeof id === "string")
  );
}

function parseStrictPermissions(raw: string): ProjectPermissionsFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new ProjectPermissionsIntegrityError("Project permissions contain invalid JSON.", {
      cause: error,
    });
  }
  if (!isRecord(parsed)) {
    throw new ProjectPermissionsIntegrityError("Project permissions have an invalid schema.");
  }
  const allowedKeys = new Set([
    "version",
    "projectGrants",
    "accessGroups",
    "grantProposals",
    "permissionAudit",
    "grantAudit",
    "repairAudit",
    "visibilityGeneration",
  ]);
  const invalidSection =
    Object.keys(parsed).some((key) => !allowedKeys.has(key)) ? "top-level keys"
      : parsed.version !== 2 ? "version"
      : !Array.isArray(parsed.projectGrants) || !parsed.projectGrants.every(isStrictGrant) ? "projectGrants"
      : !Array.isArray(parsed.accessGroups) || !parsed.accessGroups.every(isStrictAccessGroup) ? "accessGroups"
      : !Array.isArray(parsed.grantProposals) || !parsed.grantProposals.every(isStrictProposal) ? "grantProposals"
      : !Array.isArray(parsed.permissionAudit) || !parsed.permissionAudit.every(isStrictPermissionAudit) ? "permissionAudit"
      : !Array.isArray(parsed.grantAudit) || !parsed.grantAudit.every(isStrictGrantAudit) ? "grantAudit"
      : !Array.isArray(parsed.repairAudit) || !parsed.repairAudit.every(isStrictRepairAudit) ? "repairAudit"
      : typeof parsed.visibilityGeneration !== "string" ||
          !parsed.visibilityGeneration ||
          parsed.visibilityGeneration === "unversioned" ? "visibilityGeneration"
      : null;
  if (invalidSection) {
    throw new ProjectPermissionsIntegrityError(
      `Project permissions have an invalid ${invalidSection} schema.`,
    );
  }
  return parsed as ProjectPermissionsFile;
}

function normalizeRecoveredPermissions(raw: string): ProjectPermissionsFile {
  let parsed: Partial<Omit<ProjectPermissionsFile, "version">> & { version?: number };
  try {
    parsed = JSON.parse(raw) as Partial<ProjectPermissionsFile> & { version?: number };
  } catch (error) {
    throw new ProjectPermissionsIntegrityError("Recovered project permissions contain invalid JSON.", {
      cause: error,
    });
  }
  if (!isRecord(parsed) || (parsed.version !== 1 && parsed.version !== 2)) {
    throw new ProjectPermissionsIntegrityError("Recovered project permissions have an invalid schema.");
  }
  const file: ProjectPermissionsFile = {
    version: 2,
    projectGrants: Array.isArray(parsed.projectGrants)
      ? parsed.projectGrants
          .map((grant) => normalizeGrant(grant))
          .filter((grant): grant is ProjectGrant => grant !== null)
      : [],
    accessGroups: Array.isArray(parsed.accessGroups)
      ? parsed.accessGroups
          .map((group) => normalizeAccessGroup(group))
          .filter((group): group is FamiliarAccessGroup => group !== null)
      : [],
    grantProposals: Array.isArray(parsed.grantProposals) ? parsed.grantProposals : [],
    permissionAudit: Array.isArray(parsed.permissionAudit) ? parsed.permissionAudit : [],
    // Absent on every store written before this log existed — an empty array
    // is the honest answer there, not a reconstruction.
    grantAudit: Array.isArray(parsed.grantAudit) ? parsed.grantAudit : [],
    repairAudit: Array.isArray(parsed.repairAudit) ? parsed.repairAudit : [],
    // Absent on every store written before this cache-visibility nonce
    // existed — the fixed sentinel (never a freshly random value) keeps an
    // unmutated legacy file producing the SAME cache key on every read; see
    // this field's doc comment on `ProjectPermissionsFile`.
    visibilityGeneration: MISSING_VISIBILITY_GENERATION,
  };
  return file;
}

/**
 * True when `record` is the genuine durable legacy (pre-`visibilityGeneration`)
 * project-permissions shape: version 2, ONLY known historical top-level keys
 * (no `visibilityGeneration` key present at all — not merely one holding an
 * invalid value), and every present section independently passes the exact
 * same strict per-entry validation the current schema requires. `grantAudit`
 * and `repairAudit` arrived in later v2 revisions, so their absence is
 * normalized to an empty log rather than rejecting otherwise valid v2 data.
 *
 * This is a pure content check, exactly mirroring `isLegacyProjectsRecord`
 * (@/lib/cave-projects.ts) — see that function's doc comment for the full
 * rationale. It is deliberately never combined with, or gated by,
 * `caveHomeStoreNeedsRecoveryNormalization`'s process-local marker or
 * whether the file was previously absent, so it classifies a store another
 * process already migrated (no marker in THIS process) and a store that
 * simply already sits at the canonical path on a cold start identically.
 *
 * Anything else — extra/missing top-level keys, the wrong `version`, or a
 * single grant/group/proposal/audit entry that fails strict validation — is
 * NOT legacy here; it falls through to {@link parseStrictPermissions}, which
 * fails closed. The distinct strict v1 classifier below converts only the
 * exact historical binary-grant schema; a malformed v1-shaped file is never
 * mistaken for either durable legacy format. Best-effort reconstruction stays
 * `normalizeRecoveredPermissions`'s job, gated by explicit recover-legacy
 * authority, never this automatic content check.
 */
function isLegacyV2PermissionsRecord(
  record: Record<string, unknown>,
): record is LegacyV2ProjectPermissionsFile {
  return (
    hasOnlyKeys(record, [
      "version",
      "projectGrants",
      "accessGroups",
      "grantProposals",
      "permissionAudit",
      "grantAudit",
      "repairAudit",
    ]) &&
    record.version === 2 &&
    Array.isArray(record.projectGrants) && record.projectGrants.every(isStrictGrant) &&
    Array.isArray(record.accessGroups) && record.accessGroups.every(isStrictAccessGroup) &&
    Array.isArray(record.grantProposals) && record.grantProposals.every(isStrictProposal) &&
    Array.isArray(record.permissionAudit) && record.permissionAudit.every(isStrictPermissionAudit) &&
    (record.grantAudit === undefined ||
      Array.isArray(record.grantAudit) && record.grantAudit.every(isStrictGrantAudit)) &&
    (record.repairAudit === undefined ||
      Array.isArray(record.repairAudit) && record.repairAudit.every(isStrictRepairAudit))
  );
}

function isStrictLegacyV1Grant(value: unknown): value is LegacyV1ProjectGrant {
  return isRecord(value) &&
    hasOnlyKeys(value, ["familiarId", "projectId", "source", "grantedAt"]) &&
    typeof value.familiarId === "string" &&
    typeof value.projectId === "string" &&
    (value.source === "bootstrap" || value.source === "human") &&
    typeof value.grantedAt === "string";
}

function isStrictLegacyV1Proposal(value: unknown): value is LegacyV1GrantProposal {
  return isRecord(value) &&
    hasOnlyKeys(value, [
      "id",
      "proposedBy",
      "targetFamiliarId",
      "projectId",
      "status",
      "createdAt",
    ]) &&
    typeof value.id === "string" &&
    typeof value.proposedBy === "string" &&
    typeof value.targetFamiliarId === "string" &&
    typeof value.projectId === "string" &&
    ["pending", "accepted", "rejected"].includes(String(value.status)) &&
    typeof value.createdAt === "string";
}

function isStrictLegacyV1PermissionAudit(value: unknown): value is LegacyV1PermissionAuditEntry {
  return isRecord(value) &&
    hasOnlyKeys(value, ["id", "at", "familiarId", "projectId", "surface", "decision", "reason"]) &&
    typeof value.id === "string" &&
    typeof value.at === "string" &&
    typeof value.familiarId === "string" &&
    typeof value.projectId === "string" &&
    isProjectPermissionSurface(value.surface) &&
    (value.decision === "allow" || value.decision === "deny") &&
    ["grant", "supreme", "missing-grant"].includes(String(value.reason));
}

function isLegacyV1PermissionsRecord(
  record: Record<string, unknown>,
): record is LegacyV1ProjectPermissionsFile {
  return (
    hasOnlyKeys(record, ["version", "projectGrants", "grantProposals", "permissionAudit"]) &&
    record.version === 1 &&
    Array.isArray(record.projectGrants) && record.projectGrants.every(isStrictLegacyV1Grant) &&
    Array.isArray(record.grantProposals) && record.grantProposals.every(isStrictLegacyV1Proposal) &&
    Array.isArray(record.permissionAudit) && record.permissionAudit.every(isStrictLegacyV1PermissionAudit)
  );
}

/**
 * Content-only detection, never throwing: malformed JSON or a non-object
 * top level simply means "not legacy" here — the strict parse path is what
 * reports those failures to the caller. Both durable schemas that predate the
 * current shape are recognized only when every key and nested value matches
 * the historical schema exactly; an arbitrary v1-shaped object never grants
 * migration authority.
 */
function parseLegacyPermissionsFile(raw: string): LegacyPermissionsFile | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  if (isLegacyV2PermissionsRecord(parsed) || isLegacyV1PermissionsRecord(parsed)) return parsed;
  return null;
}

/** Converts a previously validated historical record without broadening authority. */
function normalizeLegacyPermissionsFile(record: LegacyPermissionsFile): ProjectPermissionsFile {
  if (record.version === 1) {
    return {
      version: 2,
      projectGrants: record.projectGrants.map((grant) => ({ ...grant, access: "write" })),
      accessGroups: [],
      grantProposals: record.grantProposals.map((proposal) => ({ ...proposal, access: "write" })),
      permissionAudit: record.permissionAudit,
      grantAudit: [],
      repairAudit: [],
      visibilityGeneration: MISSING_VISIBILITY_GENERATION,
    };
  }
  return {
    version: 2,
    projectGrants: record.projectGrants,
    accessGroups: record.accessGroups,
    grantProposals: record.grantProposals,
    permissionAudit: record.permissionAudit,
    grantAudit: record.grantAudit ?? [],
    repairAudit: record.repairAudit ?? [],
    // `saveProjectPermissions` generates this exactly once as part of the
    // successful atomic replacement. It must not be generated before a write
    // that could fail, nor on a subsequent ordinary read.
    visibilityGeneration: MISSING_VISIBILITY_GENERATION,
  };
}

async function loadProjectPermissionsUnlocked(
  options: { normalizeRecovered?: boolean } = {},
): Promise<ProjectPermissionsFile> {
  const raw = await readPermissionsRaw();
  if (raw === null) return emptyFile();
  // Durable legacy normalization: detected purely from the ACTUAL on-disk
  // bytes at the canonical path — never from
  // `caveHomeStoreNeedsRecoveryNormalization`'s process-local marker or from
  // the file having been absent (`options.normalizeRecovered` below is a
  // SEPARATE, more lenient fallback for the explicit recover-legacy flow).
  // Fires identically whether another process already performed the
  // physical cave-home migration move (this process never ran it, so it has
  // no marker) or the legacy-schema file simply already sits at the
  // canonical path on a cold start. Every concurrent reader that observes
  // legacy bytes here runs while holding the SAME project-authorization
  // lock (`loadProjectPermissions`/`withProjectAccessGuard` always route
  // through it before reaching this function), so racing readers normalize
  // exactly once — there is no lock-free fast path into this function that
  // could race a normalizing write.
  const legacy = parseLegacyPermissionsFile(raw);
  const file = legacy
    ? normalizeLegacyPermissionsFile(legacy)
    : options.normalizeRecovered
      ? normalizeRecoveredPermissions(raw)
      : parseStrictPermissions(raw);
  const materialized = materializeDueGrantProposalsDetailed(file, new Date());
  const needsMigrationWrite = Boolean(legacy || options.normalizeRecovered);
  if (needsMigrationWrite || materialized.changed) {
    try {
      await saveProjectPermissions(
        file,
        needsMigrationWrite || materialized.visibilityChanged,
      );
    } catch (error) {
      if (needsMigrationWrite) {
        throw new ProjectPermissionsIntegrityError(
          legacy
            ? "Unable to migrate legacy project permissions."
            : "Unable to normalize recovered project permissions.",
          { cause: error },
        );
      }
      throw error;
    }
    if (options.normalizeRecovered) {
      markCaveHomeStoreRecoveryNormalized("cave-project-permissions.json");
    }
  }
  return file;
}

async function loadProjectPermissionsAlreadyAuthorized(): Promise<ProjectPermissionsFile> {
  return withProjectPermissionsStore(() =>
    withWriteMutex(() => loadProjectPermissionsUnlocked({
      normalizeRecovered: caveHomeStoreNeedsRecoveryNormalization("cave-project-permissions.json"),
    })),
  );
}

async function withProjectPermissionsWriteAlreadyAuthorized<T>(
  operation: (file: ProjectPermissionsFile) => Promise<T>,
): Promise<T> {
  return withProjectPermissionsStore(() =>
    withWriteMutex(async () =>
      operation(await loadProjectPermissionsUnlocked({
        normalizeRecovered: caveHomeStoreNeedsRecoveryNormalization("cave-project-permissions.json"),
      }))),
  );
}

export async function loadProjectPermissions(): Promise<ProjectPermissionsFile> {
  return withProjectAuthLock(loadProjectPermissionsAlreadyAuthorized);
}

/**
 * The current cross-process session-list cache visibility nonce for the
 * project-permissions store — see `ProjectPermissionsFile.visibilityGeneration`'s
 * doc comment. Read by `@/lib/server/client-v1/read-model.ts` ahead of every
 * canonical sessions-list cache lookup so a permission mutation committed by
 * ANOTHER process is observed on this process's very next read.
 */
export async function projectPermissionsVisibilityGeneration(): Promise<string> {
  return (await loadProjectPermissions()).visibilityGeneration;
}

/**
 * The read-only snapshot shape `withProjectAccessGuard`'s callback receives
 * — exactly what `canAccessProject`/`effectiveProjectAccess` need, and
 * nothing else (never proposals/audit logs a guarded caller has no business
 * reading).
 */
export type ProjectAccessSnapshot = Pick<ProjectPermissionsFile, "projectGrants" | "accessGroups">;

/**
 * Serializes project-grant AUTHORIZATION together with the EFFECT it gates
 * (a conversation create/PATCH/DELETE, cave-client-v1 plan Task 7) against
 * grant/group REVOCATION, closing the race where a revoke lands between an
 * authorization check and the mutation it was meant to gate.
 *
 * Holds the DEDICATED cross-process `withProjectAuthLock`
 * (`@/lib/server/project-authorization-lock.ts` — a `BEGIN IMMEDIATE` SQLite
 * transaction on a lock database adjacent to `project-permissions.json`, plus
 * an in-process FIFO queue) for `callback`'s ENTIRE duration — not merely a
 * snapshot read — and EVERY grant/revoke/group/proposal mutation function in
 * this module acquires the exact SAME dedicated lock as its own outermost
 * step. Concretely:
 *
 *   - A revocation (`revokeProjectFromFamiliar`, a group revoke, ...)
 *     requested while `callback` is still running queues behind it on the
 *     SAME dedicated lock, and only takes effect once `callback` has fully
 *     returned.
 *   - A mutation that starts its OWN `withProjectAccessGuard` call after a
 *     revocation has resolved is guaranteed to load the state AFTER that
 *     revocation, because both go through the same dedicated lock.
 *
 * This guard is DELIBERATELY NOT the same construction as the one it
 * replaced: the previous implementation held `withProjectPermissionsStore`'s
 * cross-process RECONCILIATION lock (`withCaveHomeReconciledStore`) open
 * across `callback`. That reconciliation lock is not scoped to this store —
 * it is ONE global lock shared by every Cave-owned store (`cave-config.json`,
 * `cave-projects.json`, `cave-state.json`, ...) — so a `callback` that itself
 * loaded config/projects/state (exactly what every real conversation
 * create/PATCH/DELETE effect does) deadlocked trying to re-acquire the same
 * non-reentrant lock its own guard was still holding. This implementation
 * NEVER holds the reconciliation lock across `callback`: it acquires the
 * DEDICATED authorization lock OUTER, then reconciles+loads a permission
 * snapshot (`loadProjectPermissions`, which acquires and releases the
 * reconciliation lock for JUST that load), and only THEN runs `callback` —
 * by the time `callback` starts, the reconciliation lock has already been
 * released, so `callback` is free to load config/projects/state (each of
 * which briefly acquires and releases that same global reconciliation lock
 * on its own) without ever contending with anything this guard holds open.
 *
 * `callback` is handed the loaded snapshot directly
 * (`ProjectAccessSnapshot`) so it can compute access with the pure,
 * synchronous `canAccessProject`/`effectiveProjectAccess` — NEVER
 * `assertProjectAccess`, and never any grant/revoke/group mutator or this
 * function itself. Those all acquire the SAME dedicated `withProjectAuthLock`
 * as their own outermost step, which is a promise chain, not a reentrant
 * lock: a nested call from inside an already-running `callback` would chain
 * onto a link of that SAME chain that cannot resolve until `callback` itself
 * returns — a deadlock this guard's own construction cannot protect against.
 *
 * Lock order for a caller composing this with a familiar-lifecycle guard
 * (@/lib/cave-config.ts's `withFamiliarLifecycleGuard`) or a conversation
 * lock: familiar lifecycle is OUTER, this guard is acquired INSIDE it (when
 * the effect is project-rooted), and any conversation/state lock is acquired
 * INSIDE this guard's `callback` — never any of these reversed. Reversing the
 * order for even one caller would let two callers acquire the same locks in
 * opposite orders and deadlock each other.
 *
 * `withProjectPermissionsStore` (used by `loadProjectPermissions` inside this
 * guard, and by every mutator's own read/write) bypasses ONLY the
 * cross-process reconciliation lock under the test-only
 * `CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE` override — the dedicated
 * `withProjectAuthLock` is a real SQLite-backed lock even under that
 * override, so tests exercising it still get genuine cross-process exclusion
 * semantics; only the reconciliation-lock bypass is test-only.
 */
export async function withProjectAccessGuard<T>(
  callback: (permissions: ProjectAccessSnapshot, projects: readonly CaveProject[]) => Promise<T>,
): Promise<T> {
  return withProjectAuthLock(async () => {
    // Reconciles + loads INSIDE the dedicated lock, but only holds the
    // (separate, global) reconciliation lock for the duration of THIS load —
    // it is fully released before `callback` runs. See this function's doc
    // comment for why that ordering is what avoids the deadlock the previous
    // implementation had.
    const projects = await loadProjectsAlreadyAuthorized();
    const permissions = await loadProjectPermissionsAlreadyAuthorized();
    return callback(permissions, projects);
  });
}

/**
 * Flip `accepting` proposals whose undo window has elapsed to `accepted` and
 * materialize their grants. Runs in-memory on every load — reads converge on
 * the finalized state even if nothing writes; the next save persists it.
 * Returns true when anything changed.
 */
export function materializeDueGrantProposals(
  file: ProjectPermissionsFile,
  now: Date,
): boolean {
  return materializeDueGrantProposalsDetailed(file, now).changed;
}

function materializeDueGrantProposalsDetailed(
  file: ProjectPermissionsFile,
  now: Date,
): { changed: boolean; visibilityChanged: boolean } {
  let changed = false;
  let visibilityChanged = false;
  for (const proposal of file.grantProposals) {
    if (proposal.status !== "accepting") continue;
    const finalizesAt = proposal.finalizesAt ? Date.parse(proposal.finalizesAt) : NaN;
    // Malformed/missing deadline: fail safe by finalizing (the human already
    // accepted; losing the undo window beats losing the decision).
    if (Number.isFinite(finalizesAt) && finalizesAt > now.getTime()) continue;
    proposal.status = "accepted";
    visibilityChanged = ensureProjectGrant(file, {
      familiarId: proposal.targetFamiliarId,
      projectId: proposal.projectId,
      source: "human",
      access: normalizeAccessLevel(proposal.access),
    }) || visibilityChanged;
    changed = true;
  }
  return { changed, visibilityChanged };
}

async function saveProjectPermissions(
  file: ProjectPermissionsFile,
  visibilityChanged = false,
): Promise<void> {
  const filePath = permissionsFilePath();
  await mkdir(path.dirname(filePath), { recursive: true });
  // Cross-process cache-visibility nonce (Task 5/7 followup): regenerated as
  // part of THIS SAME in-memory object right before the atomic write below,
  // so a failed write (writeJsonAtomic throws) never advances it. Audit-only,
  // proposal-only, and no-op writes keep the existing generation.
  // See `ProjectPermissionsFile.visibilityGeneration`'s doc comment.
  if (visibilityChanged) file.visibilityGeneration = randomUUID();
  // Repairs remove grants and append their audit record as one atomic state
  // change. A crash before rename leaves the prior valid permission file
  // authoritative; a later retry can safely inspect and repair it again.
  await writeJsonAtomic(filePath, file);
  // Visibility-changing callers include direct grants/revokes, effective group
  // edits, due proposal materialization, orphan repair, and project removal.
  // Busting the shared sessions-list cache HERE after the write
  // durably lands means a revoked familiar's next list/detail/search read
  // recomputes/denies immediately instead of possibly being served the
  // pre-revocation payload for up to the 30s stale-serve window. Placed AFTER
  // `writeJsonAtomic` succeeds (which throws on failure) so a failed write
  // never invalidates a cache that still correctly reflects the prior,
  // unchanged, on-disk state. Audit/proposal-only and no-op writes deliberately
  // skip invalidation because they retain the generation.
  if (visibilityChanged) invalidateSessionsListCache();
}

function ensureProjectGrant(
  file: ProjectPermissionsFile,
  input: {
    familiarId: string;
    projectId: string;
    source: ProjectGrantSource;
    access?: ProjectAccessLevel;
  },
): boolean {
  const access = normalizeAccessLevel(input.access);
  const existing = file.projectGrants.find(
    (grant) => grant.familiarId === input.familiarId && grant.projectId === input.projectId,
  );
  if (existing) {
    // Re-granting can move the level in either direction (write→read is the
    // human downgrading a familiar); source/grantedAt track the latest action.
    if (existing.access === access) return false;
    existing.access = access;
    existing.source = input.source;
    existing.grantedAt = new Date().toISOString();
    return true;
  }
  file.projectGrants.push({
    familiarId: input.familiarId,
    projectId: input.projectId,
    access,
    source: input.source,
    grantedAt: new Date().toISOString(),
  });
  return true;
}

export async function listProjectGrants(): Promise<ProjectGrant[]> {
  return (await loadProjectPermissions()).projectGrants;
}

export async function listGrantProposals(): Promise<GrantProposal[]> {
  return (await loadProjectPermissions()).grantProposals;
}

/**
 * Most-recent access-decision audit entries, newest first, capped to `limit`.
 * Powers the Permissions console's audit log; the audit array is append-only and
 * can grow without bound, so callers always read a bounded recent window.
 */
export async function listRecentPermissionAudit(limit = 200): Promise<PermissionAuditEntry[]> {
  const audit = (await loadProjectPermissions()).permissionAudit;
  return audit
    .slice()
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, Math.max(0, limit));
}

/**
 * A familiar's effective access to one project: union-max of its direct grant
 * and every access-group grant it inherits through membership. Supreme is
 * handled by callers (it bypasses grants entirely).
 */
export function effectiveProjectAccess(
  file: Pick<ProjectPermissionsFile, "projectGrants" | "accessGroups">,
  familiarId: string,
  projectId: string,
): EffectiveProjectAccess {
  return resolveEffectiveAccess({
    directGrants: file.projectGrants,
    groups: file.accessGroups ?? [],
    familiarId,
    projectId,
  });
}

export function canAccessProject(
  file: Pick<ProjectPermissionsFile, "projectGrants"> &
    Partial<Pick<ProjectPermissionsFile, "accessGroups">>,
  ctx: ProjectAccessContext,
  projectId: string,
  required: ProjectAccessLevel = "read",
): boolean {
  const familiarId = ctx.familiarId?.trim();
  if (!familiarId) return false;
  const effective = effectiveProjectAccess(
    { projectGrants: file.projectGrants, accessGroups: file.accessGroups ?? [] },
    familiarId,
    projectId,
  );
  return accessLevelSatisfies(effective.level, required);
}

/**
 * Filters a roster to the familiars that can use a project surface.  Keeping
 * this alongside the project filter makes the two sides of a Project →
 * Familiar picker use the same effective direct and group-grant rules as the
 * final server-side authorization check.
 */
export function filterFamiliarsForProject<T extends { id: string }>(
  file: Pick<ProjectPermissionsFile, "projectGrants"> &
    Partial<Pick<ProjectPermissionsFile, "accessGroups">>,
  familiars: readonly T[],
  projectId: string,
  surface: ProjectPermissionSurface = "session-launch",
): T[] {
  const required = requiredAccessLevel(surface);
  return familiars.filter((familiar) =>
    canAccessProject(file, { familiarId: familiar.id }, projectId, required),
  );
}

/** Every project the familiar can reach, with its effective level. */
export async function listAccessibleProjects(
  projects: CaveProject[],
  familiarId: string,
): Promise<{ project: CaveProject; access: ProjectAccessLevel }[]> {
  const permissions = await loadProjectPermissions();
  const accessible: { project: CaveProject; access: ProjectAccessLevel }[] = [];
  for (const project of projects) {
    const { level } = effectiveProjectAccess(permissions, familiarId, project.id);
    if (level) accessible.push({ project, access: level });
  }
  return accessible;
}

export async function filterProjectsForFamiliar(
  projects: CaveProject[],
  familiarId: string,
): Promise<CaveProject[]> {
  return (await listAccessibleProjects(projects, familiarId)).map((entry) => entry.project);
}

export class ProjectAccessDeniedError extends Error {
  status = 403;

  constructor(message = "project access denied") {
    super(message);
    this.name = "ProjectAccessDeniedError";
  }
}

export async function assertProjectAccess(
  ctx: ProjectAccessContext,
  projectId: string,
  surface: ProjectPermissionSurface,
): Promise<void> {
  const familiarId = ctx.familiarId?.trim();
  const permissions = await loadProjectPermissions();
  const required = requiredAccessLevel(surface);
  const effective = familiarId
    ? effectiveProjectAccess(permissions, familiarId, projectId)
    : null;
  const allowed = accessLevelSatisfies(effective?.level, required);

  let reason: PermissionAuditReason;
  if (allowed) {
    reason = effective?.direct ? "grant" : "group";
  } else {
    reason = effective?.level ? "insufficient-access" : "missing-grant";
  }

  await appendAudit({
    familiarId: familiarId || "unknown",
    projectId,
    surface,
    decision: allowed ? "allow" : "deny",
    reason,
    requiredAccess: required,
  });

  if (!allowed) throw new ProjectAccessDeniedError();
}

export async function assertProjectRootAccess(
  ctx: ProjectAccessContext,
  projectRoot: string | null | undefined,
  surface: ProjectPermissionSurface,
  options: { allowUnregisteredRoot?: boolean } = {},
): Promise<CaveProject | null> {
  if (!projectRoot?.trim()) return null;
  const project = projectForRoot(projectRoot, await loadProjects());
  if (!project) {
    if (options.allowUnregisteredRoot) return null;
    await assertProjectAccess(ctx, `unregistered:${projectRoot}`, surface);
    return null;
  }
  await assertProjectAccess(ctx, project.id, surface);
  return project;
}

/**
 * Append a grant-change record to an already-loaded file. Takes the file so it
 * lands inside the SAME lock+save as the mutation it describes — recording it
 * separately could leave a change with no record if the second write failed.
 */
function recordGrantChange(
  file: ProjectPermissionsFile,
  entry: Omit<GrantChangeEntry, "id" | "at">,
): void {
  file.grantAudit.push({ id: randomUUID(), at: new Date().toISOString(), ...entry });
}

/**
 * Effective access for a set of (familiar, project) pairs, as one snapshot.
 *
 * Group edits are logged by DIFFING effective access, not by echoing the edit:
 * adding a member to a group grants nothing they already hold directly, and
 * removing a group grant takes nothing away if another group still confers it.
 * Logging the edit itself would claim changes that did not happen.
 */
type EffectivePair = { familiarId: string; projectId: string };

function pairKey(familiarId: string, projectId: string): string {
  return `${familiarId}\u0000${projectId}`;
}

function effectiveSnapshot(
  file: ProjectPermissionsFile,
  pairs: readonly EffectivePair[],
): Map<string, ProjectAccessLevel | null> {
  const snapshot = new Map<string, ProjectAccessLevel | null>();
  for (const { familiarId, projectId } of pairs) {
    snapshot.set(
      pairKey(familiarId, projectId),
      effectiveProjectAccess(file, familiarId, projectId).level ?? null,
    );
  }
  return snapshot;
}

/**
 * Every (familiar, project) pair a group edit could move: the union of members
 * and project grants on BOTH sides of the edit, so removals are covered too.
 */
function groupPairs(
  before: Pick<FamiliarAccessGroup, "memberFamiliarIds" | "projectGrants"> | null,
  after: Pick<FamiliarAccessGroup, "memberFamiliarIds" | "projectGrants"> | null,
): EffectivePair[] {
  const familiars = new Set<string>([
    ...(before?.memberFamiliarIds ?? []),
    ...(after?.memberFamiliarIds ?? []),
  ]);
  const projects = new Set<string>([
    ...(before?.projectGrants ?? []).map((grant) => grant.projectId),
    ...(after?.projectGrants ?? []).map((grant) => grant.projectId),
  ]);
  const pairs: EffectivePair[] = [];
  for (const familiarId of familiars) {
    for (const projectId of projects) pairs.push({ familiarId, projectId });
  }
  return pairs;
}

/** Record one entry per pair whose EFFECTIVE level actually moved. */
function recordGroupEffectiveChanges(
  file: ProjectPermissionsFile,
  pairs: readonly EffectivePair[],
  before: Map<string, ProjectAccessLevel | null>,
  groupId: string,
  actor: GrantChangeActor,
): number {
  let changed = 0;
  for (const { familiarId, projectId } of pairs) {
    const from = before.get(pairKey(familiarId, projectId)) ?? null;
    const to = effectiveProjectAccess(file, familiarId, projectId).level ?? null;
    if (from === to) continue;
    changed += 1;
    recordGrantChange(file, {
      familiarId,
      projectId,
      from,
      to,
      actor,
      kind: "group",
      groupId,
    });
  }
  return changed;
}

/**
 * Most-recent grant changes, newest first, capped to `limit`.
 *
 * Ties on `at` break on append order, not arbitrarily: a bulk "Set all" writes
 * many entries inside the same millisecond, and sorting on the timestamp alone
 * would report that burst in reverse.
 */
export async function listRecentGrantChanges(limit = 200): Promise<GrantChangeEntry[]> {
  const log = (await loadProjectPermissions()).grantAudit;
  return log
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => b.entry.at.localeCompare(a.entry.at) || b.index - a.index)
    .slice(0, Math.max(0, limit))
    .map(({ entry }) => entry);
}

async function appendAudit(entry: Omit<PermissionAuditEntry, "id" | "at">): Promise<void> {
  await withProjectAuthLock(() =>
    withProjectPermissionsWriteAlreadyAuthorized(async (file) => {
      file.permissionAudit.push({ id: randomUUID(), at: new Date().toISOString(), ...entry });
      await saveProjectPermissions(file, false);
    }),
  );
}

export async function grantProjectToFamiliar(input: {
  familiarId: string;
  projectId: string;
  source: ProjectGrantSource;
  access?: ProjectAccessLevel;
  /** Who is making the change; defaults to the app itself. */
  actor?: GrantChangeActor;
}): Promise<void> {
  await withProjectAuthLock(() =>
    withProjectPermissionsWriteAlreadyAuthorized(async (file) => {
      // Read the prior level first — ensureProjectGrant mutates in place, so
      // after it runs the "from" side of the change is gone.
      const before =
        file.projectGrants.find(
          (grant) => grant.familiarId === input.familiarId && grant.projectId === input.projectId,
        )?.access ?? null;
      if (ensureProjectGrant(file, input)) {
        recordGrantChange(file, {
          familiarId: input.familiarId,
          projectId: input.projectId,
          from: before,
          to: normalizeAccessLevel(input.access),
          actor: input.actor ?? "system",
          kind: "direct",
          source: input.source,
        });
        await saveProjectPermissions(file, true);
      }
    }),
  );
}

export async function revokeProjectFromFamiliar(input: {
  familiarId: string;
  projectId: string;
  /** Who is making the change; defaults to the app itself. */
  actor?: GrantChangeActor;
}): Promise<boolean> {
  return withProjectAuthLock(() =>
    withProjectPermissionsWriteAlreadyAuthorized(async (file) => {
      const removed = file.projectGrants.find(
        (grant) => grant.familiarId === input.familiarId && grant.projectId === input.projectId,
      );
      const next = file.projectGrants.filter(
        (grant) => !(grant.familiarId === input.familiarId && grant.projectId === input.projectId),
      );
      if (next.length === file.projectGrants.length) return false;
      file.projectGrants = next;
      recordGrantChange(file, {
        familiarId: input.familiarId,
        projectId: input.projectId,
        from: removed?.access ?? null,
        to: null,
        actor: input.actor ?? "system",
        kind: "direct",
        source: removed?.source,
      });
      await saveProjectPermissions(file, true);
      return true;
    }),
  );
}

/**
 * Remove every trace of a project from the permission store — direct grants,
 * access-group project grants, and pending proposals. Called when the project
 * is removed from the registry so no grant is orphaned (and can't silently
 * reactivate if the same project id is ever reused). Returns the counts cleaned.
 */
export async function revokeAllGrantsForProject(
  projectId: string,
): Promise<{ grants: number; groupGrants: number; proposals: number }> {
  return withProjectAuthLock(() =>
    revokeAllGrantsForProjectAlreadyAuthorized(projectId),
  );
}

async function revokeAllGrantsForProjectAlreadyAuthorized(
  projectId: string,
): Promise<{ grants: number; groupGrants: number; proposals: number }> {
  return withProjectPermissionsWriteAlreadyAuthorized(async (file) => {

      const removedGrants = file.projectGrants.filter((grant) => grant.projectId === projectId);
      const nextGrants = file.projectGrants.filter((grant) => grant.projectId !== projectId);
      const grants = file.projectGrants.length - nextGrants.length;
      file.projectGrants = nextGrants;
      // A registry removal drops access for every familiar at once; without a
      // record per familiar the cascade is the least visible change of all.
      for (const grant of removedGrants) {
        recordGrantChange(file, {
          familiarId: grant.familiarId,
          projectId,
          from: grant.access,
          to: null,
          actor: "system",
          kind: "project-removed",
          source: grant.source,
        });
      }

      let groupGrants = 0;
      for (const group of file.accessGroups) {
        const before = group.projectGrants.length;
        const dropped = group.projectGrants.filter((grant) => grant.projectId === projectId);
        group.projectGrants = group.projectGrants.filter((grant) => grant.projectId !== projectId);
        groupGrants += before - group.projectGrants.length;
        for (const grant of dropped) {
          for (const familiarId of group.memberFamiliarIds) {
            recordGrantChange(file, {
              familiarId,
              projectId,
              from: grant.access,
              to: null,
              actor: "system",
              kind: "project-removed",
              groupId: group.id,
            });
          }
        }
      }

      const nextProposals = file.grantProposals.filter((proposal) => proposal.projectId !== projectId);
      const proposals = file.grantProposals.length - nextProposals.length;
      file.grantProposals = nextProposals;

      if (grants > 0 || groupGrants > 0 || proposals > 0) {
        await saveProjectPermissions(file, grants > 0 || groupGrants > 0);
      }
      return { grants, groupGrants, proposals };
  });
}

export async function deleteProjectAndRevokeGrants(
  projectId: string,
): Promise<
  | { deleted: false; cleaned: { grants: number; groupGrants: number; proposals: number } | null }
  | { deleted: true; cleaned: { grants: number; groupGrants: number; proposals: number } }
> {
  return withProjectAuthLock(async () => {
    const projects = await loadProjectsAlreadyAuthorized();
    if (!projects.some((project) => project.id === projectId)) {
      // A previously interrupted deletion can leave permission residue after
      // its registry row is gone. Clean that residue under the same lock; a
      // truly unknown id remains a normal 404 with `cleaned: null`.
      const cleaned = await revokeAllGrantsForProjectAlreadyAuthorized(projectId);
      const hadResidue = cleaned.grants > 0 || cleaned.groupGrants > 0 || cleaned.proposals > 0;
      return { deleted: false, cleaned: hadResidue ? cleaned : null };
    }
    // Permission cleanup (direct grants, group grants, proposals) runs
    // BEFORE the registry delete, and is fully idempotent — every branch
    // filters by project id, so re-running it once nothing is left to clean
    // finds zero records and performs no write. That ordering plus
    // idempotency is what makes recovery safe on both sides of a failure:
    //
    //   - If cleanup itself fails (throws), execution never reaches the
    //     registry delete below: the project remains exactly as it was —
    //     fully registered AND fully granted. Nothing is orphaned, and the
    //     caller can simply retry from the same state.
    //   - If cleanup succeeds but the registry delete then fails, the
    //     project remains registered — so a retry finds it by id and
    //     completes the deletion instead of the caller ever seeing an
    //     unrecoverable 404 — while every grant is already gone (fail-closed:
    //     nobody can act on a project mid-deletion). A retry re-runs cleanup
    //     (a safe no-op, since nothing matches this id anymore) and then
    //     completes the registry delete.
    //
    // The previous delete-then-clean order could leave grants permanently
    // orphaned: once the registry entry was gone, nothing would ever revisit
    // this project id to finish the cleanup if the process died in between.
    const cleaned = await revokeAllGrantsForProjectAlreadyAuthorized(projectId);
    const deleted = await deleteProjectAlreadyAuthorized(projectId);
    if (!deleted) {
      // The project vanished from the registry between the existence check
      // above and this delete despite holding the SAME authorization lock
      // for the entire critical section — this should never happen. Report
      // it as a failure rather than a false "deleted": cleanup has already
      // run (and is safely idempotent), so a retry is exactly the right
      // recovery path either way.
      throw new Error(
        `project registry delete failed for ${projectId} after permission cleanup already completed`,
      );
    }
    return { deleted: true, cleaned };
  });
}

function orphanProjectIntegrity(
  file: Pick<ProjectPermissionsFile, "projectGrants" | "accessGroups" | "grantProposals">,
  knownProjectIds: ReadonlySet<string>,
): ProjectPermissionIntegrityReport {
  const orphanIds = new Set<string>();
  let directGrants = 0;
  let groupGrants = 0;
  let proposals = 0;
  for (const grant of file.projectGrants) {
    if (knownProjectIds.has(grant.projectId)) continue;
    directGrants += 1;
    orphanIds.add(grant.projectId);
  }
  for (const group of file.accessGroups) for (const grant of group.projectGrants) {
    if (knownProjectIds.has(grant.projectId)) continue;
    groupGrants += 1;
    orphanIds.add(grant.projectId);
  }
  for (const proposal of file.grantProposals) {
    if (knownProjectIds.has(proposal.projectId)) continue;
    proposals += 1;
    orphanIds.add(proposal.projectId);
  }
  return { directGrants, groupGrants, proposals, orphanProjectIds: [...orphanIds].sort() };
}

/** Read-only integrity check. It deliberately does not grant or prune anything. */
export async function inspectProjectPermissionIntegrity(): Promise<ProjectPermissionIntegrityReport> {
  return withProjectAuthLock(async () => {
    const projects = await loadProjectsAlreadyAuthorized();
    const permissions = await loadProjectPermissionsAlreadyAuthorized();
    return orphanProjectIntegrity(permissions, new Set(projects.map((project) => project.id)));
  });
}

/**
 * Explicit human-invoked repair for legacy orphan grants. Removing records for
 * projects absent from the registry can only reduce access; an audit record is
 * persisted atomically with the cleanup, making retries after interruption
 * idempotent and reviewable.
 */
export async function repairOrphanProjectPermissions(): Promise<ProjectPermissionIntegrityReport> {
  return withProjectAuthLock(async () => {
    const projects = await loadProjectsAlreadyAuthorized();
    const knownProjectIds = new Set(projects.map((project) => project.id));
    return withProjectPermissionsWriteAlreadyAuthorized(async (file) => {
        const report = orphanProjectIntegrity(file, knownProjectIds);
        if (report.directGrants + report.groupGrants + report.proposals === 0) return report;
        file.projectGrants = file.projectGrants.filter((grant) => knownProjectIds.has(grant.projectId));
        for (const group of file.accessGroups) {
          group.projectGrants = group.projectGrants.filter((grant) => knownProjectIds.has(grant.projectId));
        }
        file.grantProposals = file.grantProposals.filter((proposal) => knownProjectIds.has(proposal.projectId));
        file.repairAudit.push({ at: new Date().toISOString(), kind: "orphan-project-repair", ...report });
        await saveProjectPermissions(file, report.directGrants > 0 || report.groupGrants > 0);
        return report;
    });
  });
}

export async function bootstrapSupremeProjectGrants(projects: CaveProject[]): Promise<void> {
  const { supremeFamiliarId } = await loadHumanPermissionConfig();
  for (const project of projects) {
    await grantProjectToFamiliar({
      familiarId: supremeFamiliarId,
      projectId: project.id,
      source: "bootstrap",
    });
  }
}

export async function createGrantProposal(input: {
  proposedBy: string;
  targetFamiliarId: string;
  projectId: string;
  access?: ProjectAccessLevel;
  claimedHumanApproval?: boolean;
}): Promise<GrantProposal> {
  const { supremeFamiliarId } = await loadHumanPermissionConfig();
  if (input.proposedBy !== supremeFamiliarId) {
    throw new ProjectAccessDeniedError("only Supreme can draft grant proposals");
  }
  if (input.targetFamiliarId === supremeFamiliarId) {
    throw new ProjectAccessDeniedError("Supreme cannot draft self-grants");
  }
  if (input.claimedHumanApproval) {
    throw new ProjectAccessDeniedError("relayed human approval is not accepted");
  }

  return withProjectAuthLock(() =>
    withProjectPermissionsWriteAlreadyAuthorized(async (file) => {
      const proposal: GrantProposal = {
        id: randomUUID(),
        proposedBy: input.proposedBy,
        targetFamiliarId: input.targetFamiliarId,
        projectId: input.projectId,
        access: normalizeAccessLevel(input.access),
        status: "pending",
        createdAt: new Date().toISOString(),
      };
      file.grantProposals.push(proposal);
      await saveProjectPermissions(file, false);
      return proposal;
    }),
  );
}

export async function resolveGrantProposal(input: {
  proposalId: string;
  decision: "accepted" | "rejected";
}): Promise<GrantProposal> {
  return withProjectAuthLock(() =>
    withProjectPermissionsWriteAlreadyAuthorized(async (file) => {
      const grantProposal = file.grantProposals.find((proposal) => proposal.id === input.proposalId);
      if (!grantProposal) {
        throw new ProjectAccessDeniedError("grant proposal not found");
      }
      if (grantProposal.status !== "pending") {
        throw new ProjectAccessDeniedError("grant proposal is already resolved");
      }
      if (input.decision === "accepted") {
        // Delayed acceptance: no grant yet — the proposal parks in `accepting`
        // until the undo window elapses (materialized on the next load), so the
        // human can undo before it takes effect.
        const now = new Date();
        grantProposal.status = "accepting";
        grantProposal.acceptedAt = now.toISOString();
        grantProposal.finalizesAt = new Date(
          now.getTime() + GRANT_ACCEPT_UNDO_WINDOW_MS,
        ).toISOString();
      } else {
        grantProposal.status = "rejected";
      }
      await saveProjectPermissions(file, false);
      return grantProposal;
    }),
  );
}

/**
 * Revert an accepted-but-not-yet-finalized proposal back to `pending`. Only
 * possible during the undo window — once `finalizesAt` passes, loads have
 * already materialized the grant and the proposal reads as `accepted`.
 */
export async function undoGrantProposal(input: { proposalId: string }): Promise<GrantProposal> {
  return withProjectAuthLock(() =>
    withProjectPermissionsWriteAlreadyAuthorized(async (file) => {
      const grantProposal = file.grantProposals.find((proposal) => proposal.id === input.proposalId);
      if (!grantProposal) {
        throw new ProjectAccessDeniedError("grant proposal not found");
      }
      // Load already finalized due proposals, so `accepting` here is guaranteed
      // to still be inside its window.
      if (grantProposal.status !== "accepting") {
        throw new ProjectAccessDeniedError(
          grantProposal.status === "accepted"
            ? "grant already finalized — revoke the grant instead"
            : "grant proposal is not awaiting finalization",
        );
      }
      grantProposal.status = "pending";
      delete grantProposal.acceptedAt;
      delete grantProposal.finalizesAt;
      await saveProjectPermissions(file, false);
      return grantProposal;
    }),
  );
}

// --- Access groups -----------------------------------------------------------
//
// Groups are mutated only through human-confirmed API routes (the same
// rejectRelayedApproval discipline as direct grants): a group grant is a real
// grant of project access to every member, so familiars must never be able to
// add themselves to a group or raise a group's level.

export class AccessGroupNotFoundError extends Error {
  status = 404;

  constructor(message = "access group not found") {
    super(message);
    this.name = "AccessGroupNotFoundError";
  }
}

function normalizeMemberIds(ids: string[] | undefined): string[] {
  if (!Array.isArray(ids)) return [];
  const seen = new Set<string>();
  const members: string[] = [];
  for (const raw of ids) {
    const id = typeof raw === "string" ? raw.trim() : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    members.push(id);
  }
  return members;
}

function normalizeGroupGrants(
  grants: { projectId: string; access?: ProjectAccessLevel }[] | undefined,
  previous: GroupProjectGrant[],
): GroupProjectGrant[] {
  if (!Array.isArray(grants)) return previous;
  const now = new Date().toISOString();
  const previousById = new Map(previous.map((grant) => [grant.projectId, grant]));
  const seen = new Set<string>();
  const next: GroupProjectGrant[] = [];
  for (const raw of grants) {
    const projectId = typeof raw?.projectId === "string" ? raw.projectId.trim() : "";
    if (!projectId || seen.has(projectId)) continue;
    seen.add(projectId);
    const access = normalizeAccessLevel(raw.access);
    const before = previousById.get(projectId);
    next.push({
      projectId,
      access,
      grantedAt: before && before.access === access ? before.grantedAt : now,
    });
  }
  return next;
}

export async function listAccessGroups(): Promise<FamiliarAccessGroup[]> {
  return (await loadProjectPermissions()).accessGroups;
}

export async function createAccessGroup(input: {
  name: string;
  description?: string;
  memberFamiliarIds?: string[];
  projectGrants?: { projectId: string; access?: ProjectAccessLevel }[];
  /** Who is making the change; defaults to the app itself. */
  actor?: GrantChangeActor;
}): Promise<FamiliarAccessGroup> {
  const name = input.name.trim();
  if (!name) throw new Error("access group name is required");
  return withProjectAuthLock(() =>
    withProjectPermissionsWriteAlreadyAuthorized(async (file) => {
      const now = new Date().toISOString();
      const group: FamiliarAccessGroup = {
        id: randomUUID(),
        name,
        ...(input.description?.trim() ? { description: input.description.trim() } : {}),
        memberFamiliarIds: normalizeMemberIds(input.memberFamiliarIds),
        projectGrants: normalizeGroupGrants(input.projectGrants, []),
        createdAt: now,
        updatedAt: now,
      };
      // A group can arrive already populated with members AND project grants,
      // granting several familiars access in one call.
      const pairs = groupPairs(null, group);
      const before = effectiveSnapshot(file, pairs);
      file.accessGroups.push(group);
      const visibilityChanged =
        recordGroupEffectiveChanges(file, pairs, before, group.id, input.actor ?? "system") > 0;
      await saveProjectPermissions(file, visibilityChanged);
      return group;
    }),
  );
}

export async function updateAccessGroup(input: {
  groupId: string;
  name?: string;
  description?: string | null;
  memberFamiliarIds?: string[];
  projectGrants?: { projectId: string; access?: ProjectAccessLevel }[];
  /** Who is making the change; defaults to the app itself. */
  actor?: GrantChangeActor;
}): Promise<FamiliarAccessGroup> {
  return withProjectAuthLock(() =>
    withProjectPermissionsWriteAlreadyAuthorized(async (file) => {
      const group = file.accessGroups.find((candidate) => candidate.id === input.groupId);
      if (!group) throw new AccessGroupNotFoundError();
      // Snapshot BEFORE the in-place edit — members and grants are rewritten
      // wholesale, so the prior side is otherwise unrecoverable.
      const priorShape = {
        memberFamiliarIds: [...group.memberFamiliarIds],
        projectGrants: group.projectGrants.map((grant) => ({ ...grant })),
      };
      if (input.name !== undefined) {
        const name = input.name.trim();
        if (!name) throw new Error("access group name is required");
        group.name = name;
      }
      if (input.description !== undefined) {
        const description = input.description?.trim();
        if (description) group.description = description;
        else delete group.description;
      }
      if (input.memberFamiliarIds !== undefined) {
        group.memberFamiliarIds = normalizeMemberIds(input.memberFamiliarIds);
      }
      group.projectGrants = normalizeGroupGrants(input.projectGrants, group.projectGrants);
      group.updatedAt = new Date().toISOString();
      const pairs = groupPairs(priorShape, group);
      // Recompute "before" against the pre-edit shape: swap the prior members and
      // grants back in, measure, then restore. Cheaper and less error-prone than
      // cloning the whole file.
      const editedMembers = group.memberFamiliarIds;
      const editedGrants = group.projectGrants;
      group.memberFamiliarIds = priorShape.memberFamiliarIds;
      group.projectGrants = priorShape.projectGrants;
      const before = effectiveSnapshot(file, pairs);
      group.memberFamiliarIds = editedMembers;
      group.projectGrants = editedGrants;
      const visibilityChanged =
        recordGroupEffectiveChanges(file, pairs, before, group.id, input.actor ?? "system") > 0;
      await saveProjectPermissions(file, visibilityChanged);
      return group;
    }),
  );
}

export async function deleteAccessGroup(
  groupId: string,
  options: { actor?: GrantChangeActor } = {},
): Promise<boolean> {
  return withProjectAuthLock(() =>
    withProjectPermissionsWriteAlreadyAuthorized(async (file) => {
      const removed = file.accessGroups.find((group) => group.id === groupId) ?? null;
      const next = file.accessGroups.filter((group) => group.id !== groupId);
      if (next.length === file.accessGroups.length) return false;
      // Deleting a group takes away everything it conferred, from every member
      // at once — the widest single change the model allows.
      const pairs = groupPairs(removed, null);
      const before = effectiveSnapshot(file, pairs);
      file.accessGroups = next;
      const visibilityChanged =
        recordGroupEffectiveChanges(file, pairs, before, groupId, options.actor ?? "system") > 0;
      await saveProjectPermissions(file, visibilityChanged);
      return true;
    }),
  );
}
