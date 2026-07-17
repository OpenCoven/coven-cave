import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { caveHome } from "./coven-paths.ts";

import { loadProjects, projectForRoot } from "./cave-projects.ts";
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

type ProjectPermissionsFile = {
  version: 2;
  projectGrants: ProjectGrant[];
  accessGroups: FamiliarAccessGroup[];
  grantProposals: GrantProposal[];
  permissionAudit: PermissionAuditEntry[];
};

type HumanPermissionConfigFile = {
  version: 1;
  supremeFamiliarId: string;
};

export type ProjectAccessContext = {
  familiarId: string | null | undefined;
};

const DEFAULT_SUPREME_FAMILIAR_ID = "supreme";

function permissionsFilePath(): string {
  return (
    process.env.CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE ??
    path.join(caveHome(), "project-permissions.json")
  );
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
  };
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
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

export async function loadHumanPermissionConfig(): Promise<HumanPermissionConfigFile> {
  const fromEnv = process.env.CAVE_SUPREME_FAMILIAR_ID?.trim();
  if (fromEnv) return { version: 1, supremeFamiliarId: fromEnv };

  const parsed = await readJsonFile<Partial<HumanPermissionConfigFile>>(humanPermissionConfigPath());
  const supremeFamiliarId = parsed?.supremeFamiliarId?.trim() || DEFAULT_SUPREME_FAMILIAR_ID;
  return { version: 1, supremeFamiliarId };
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

export async function loadProjectPermissions(): Promise<ProjectPermissionsFile> {
  const parsed = await readJsonFile<
    Partial<ProjectPermissionsFile> & { version?: number }
  >(permissionsFilePath());
  if (!parsed) return emptyFile();
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
  };
  materializeDueGrantProposals(file, new Date());
  return file;
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
  let changed = false;
  for (const proposal of file.grantProposals) {
    if (proposal.status !== "accepting") continue;
    const finalizesAt = proposal.finalizesAt ? Date.parse(proposal.finalizesAt) : NaN;
    // Malformed/missing deadline: fail safe by finalizing (the human already
    // accepted; losing the undo window beats losing the decision).
    if (Number.isFinite(finalizesAt) && finalizesAt > now.getTime()) continue;
    proposal.status = "accepted";
    ensureProjectGrant(file, {
      familiarId: proposal.targetFamiliarId,
      projectId: proposal.projectId,
      source: "human",
      access: normalizeAccessLevel(proposal.access),
    });
    changed = true;
  }
  return changed;
}

async function saveProjectPermissions(file: ProjectPermissionsFile): Promise<void> {
  await writeJsonFile(permissionsFilePath(), file);
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
  supremeFamiliarId: string,
  required: ProjectAccessLevel = "read",
): boolean {
  const familiarId = ctx.familiarId?.trim();
  if (!familiarId) return false;
  if (familiarId === supremeFamiliarId) return true;
  const effective = effectiveProjectAccess(
    { projectGrants: file.projectGrants, accessGroups: file.accessGroups ?? [] },
    familiarId,
    projectId,
  );
  return accessLevelSatisfies(effective.level, required);
}

/** Every project the familiar can reach, with its effective level. */
export async function listAccessibleProjects(
  projects: CaveProject[],
  familiarId: string,
): Promise<{ project: CaveProject; access: ProjectAccessLevel }[]> {
  const [permissions, config] = await Promise.all([
    loadProjectPermissions(),
    loadHumanPermissionConfig(),
  ]);
  if (familiarId === config.supremeFamiliarId) {
    return projects.map((project) => ({ project, access: "write" as const }));
  }
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
  const [permissions, config] = await Promise.all([
    loadProjectPermissions(),
    loadHumanPermissionConfig(),
  ]);
  const required = requiredAccessLevel(surface);
  const isSupreme = !!familiarId && familiarId === config.supremeFamiliarId;
  const effective = familiarId && !isSupreme
    ? effectiveProjectAccess(permissions, familiarId, projectId)
    : null;
  const allowed = isSupreme || accessLevelSatisfies(effective?.level, required);

  let reason: PermissionAuditReason;
  if (allowed) {
    reason = isSupreme ? "supreme" : effective?.direct ? "grant" : "group";
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

async function appendAudit(entry: Omit<PermissionAuditEntry, "id" | "at">): Promise<void> {
  await withWriteMutex(async () => {
    const file = await loadProjectPermissions();
    file.permissionAudit.push({ id: randomUUID(), at: new Date().toISOString(), ...entry });
    await saveProjectPermissions(file);
  });
}

export async function grantProjectToFamiliar(input: {
  familiarId: string;
  projectId: string;
  source: ProjectGrantSource;
  access?: ProjectAccessLevel;
}): Promise<void> {
  await withWriteMutex(async () => {
    const file = await loadProjectPermissions();
    if (ensureProjectGrant(file, input)) {
      await saveProjectPermissions(file);
    }
  });
}

export async function revokeProjectFromFamiliar(input: {
  familiarId: string;
  projectId: string;
}): Promise<boolean> {
  return withWriteMutex(async () => {
    const file = await loadProjectPermissions();
    const next = file.projectGrants.filter(
      (grant) => !(grant.familiarId === input.familiarId && grant.projectId === input.projectId),
    );
    if (next.length === file.projectGrants.length) return false;
    file.projectGrants = next;
    await saveProjectPermissions(file);
    return true;
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

  return withWriteMutex(async () => {
    const file = await loadProjectPermissions();
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
    await saveProjectPermissions(file);
    return proposal;
  });
}

export async function resolveGrantProposal(input: {
  proposalId: string;
  decision: "accepted" | "rejected";
}): Promise<GrantProposal> {
  return withWriteMutex(async () => {
    const file = await loadProjectPermissions();
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
    await saveProjectPermissions(file);
    return grantProposal;
  });
}

/**
 * Revert an accepted-but-not-yet-finalized proposal back to `pending`. Only
 * possible during the undo window — once `finalizesAt` passes, loads have
 * already materialized the grant and the proposal reads as `accepted`.
 */
export async function undoGrantProposal(input: { proposalId: string }): Promise<GrantProposal> {
  return withWriteMutex(async () => {
    const file = await loadProjectPermissions();
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
    await saveProjectPermissions(file);
    return grantProposal;
  });
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
}): Promise<FamiliarAccessGroup> {
  const name = input.name.trim();
  if (!name) throw new Error("access group name is required");
  return withWriteMutex(async () => {
    const file = await loadProjectPermissions();
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
    file.accessGroups.push(group);
    await saveProjectPermissions(file);
    return group;
  });
}

export async function updateAccessGroup(input: {
  groupId: string;
  name?: string;
  description?: string | null;
  memberFamiliarIds?: string[];
  projectGrants?: { projectId: string; access?: ProjectAccessLevel }[];
}): Promise<FamiliarAccessGroup> {
  return withWriteMutex(async () => {
    const file = await loadProjectPermissions();
    const group = file.accessGroups.find((candidate) => candidate.id === input.groupId);
    if (!group) throw new AccessGroupNotFoundError();
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
    await saveProjectPermissions(file);
    return group;
  });
}

export async function deleteAccessGroup(groupId: string): Promise<boolean> {
  return withWriteMutex(async () => {
    const file = await loadProjectPermissions();
    const next = file.accessGroups.filter((group) => group.id !== groupId);
    if (next.length === file.accessGroups.length) return false;
    file.accessGroups = next;
    await saveProjectPermissions(file);
    return true;
  });
}
