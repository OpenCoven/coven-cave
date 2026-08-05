import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { caveHome } from "./coven-paths.ts";
import { withCaveHomeReconciledStore } from "./server/cave-home-migration.ts";
import { writeJsonAtomic } from "./server/atomic-write.ts";

import { loadProjects, projectForRoot, withProjectRegistryLock } from "./cave-projects.ts";
import {
  projectIdMigrationMap,
  remapProjectId,
  type CaveProject,
} from "./cave-projects-types.ts";
import {
  accessLevelSatisfies,
  maxAccessLevel,
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
};

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
    grantAudit: [],
    repairAudit: [],
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

function withProjectPermissionsStore<T>(operation: () => Promise<T>): Promise<T> {
  if (process.env.CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE) return operation();
  return withCaveHomeReconciledStore("cave-project-permissions.json", operation);
}

async function withProjectIdMigrations<T>(
  operation: (migrations: ReadonlyMap<string, string>) => Promise<T>,
): Promise<T> {
  const migrations = projectIdMigrationMap(await loadProjects());
  return withProjectPermissionsStore(() => operation(migrations));
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

function remapPermissionProjectIds(
  file: ProjectPermissionsFile,
  migrations: ReadonlyMap<string, string>,
): void {
  for (const grant of file.projectGrants) {
    grant.projectId = remapProjectId(grant.projectId, migrations);
  }
  for (const group of file.accessGroups) {
    for (const grant of group.projectGrants) {
      grant.projectId = remapProjectId(grant.projectId, migrations);
    }
  }
  for (const proposal of file.grantProposals) {
    proposal.projectId = remapProjectId(proposal.projectId, migrations);
  }
  for (const entry of file.permissionAudit) {
    entry.projectId = remapProjectId(entry.projectId, migrations);
  }
  for (const entry of file.grantAudit) {
    entry.projectId = remapProjectId(entry.projectId, migrations);
  }
  for (const entry of file.repairAudit) {
    entry.orphanProjectIds = entry.orphanProjectIds.map((projectId) =>
      remapProjectId(projectId, migrations),
    );
  }

  const directByKey = new Map<string, ProjectGrant>();
  for (const grant of file.projectGrants) {
    const key = `${grant.familiarId}\0${grant.projectId}`;
    const existing = directByKey.get(key);
    if (!existing) {
      directByKey.set(key, grant);
      continue;
    }
    const access = maxAccessLevel(existing.access, grant.access);
    if (access !== existing.access) {
      existing.access = access ?? "read";
      existing.source = grant.source;
      existing.grantedAt = grant.grantedAt;
    }
  }
  file.projectGrants = [...directByKey.values()];

  for (const group of file.accessGroups) {
    const grantsByProject = new Map<string, GroupProjectGrant>();
    for (const grant of group.projectGrants) {
      const existing = grantsByProject.get(grant.projectId);
      if (!existing) {
        grantsByProject.set(grant.projectId, grant);
        continue;
      }
      const access = maxAccessLevel(existing.access, grant.access);
      if (access !== existing.access) {
        existing.access = access ?? "read";
        existing.grantedAt = grant.grantedAt;
      }
    }
    group.projectGrants = [...grantsByProject.values()];
  }
}

async function loadProjectPermissionsUnlocked(
  migrations: ReadonlyMap<string, string> = new Map(),
): Promise<ProjectPermissionsFile> {
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
    // Absent on every store written before this log existed — an empty array
    // is the honest answer there, not a reconstruction.
    grantAudit: Array.isArray(parsed.grantAudit) ? parsed.grantAudit : [],
    repairAudit: Array.isArray(parsed.repairAudit) ? parsed.repairAudit : [],
  };
  materializeDueGrantProposals(file, new Date());
  remapPermissionProjectIds(file, migrations);
  return file;
}

export async function loadProjectPermissions(): Promise<ProjectPermissionsFile> {
  return withProjectIdMigrations(loadProjectPermissionsUnlocked);
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
  const filePath = permissionsFilePath();
  await mkdir(path.dirname(filePath), { recursive: true });
  // Repairs remove grants and append their audit record as one atomic state
  // change. A crash before rename leaves the prior valid permission file
  // authoritative; a later retry can safely inspect and repair it again.
  await writeJsonAtomic(filePath, file);
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
): void {
  for (const { familiarId, projectId } of pairs) {
    const from = before.get(pairKey(familiarId, projectId)) ?? null;
    const to = effectiveProjectAccess(file, familiarId, projectId).level ?? null;
    if (from === to) continue;
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
  await withProjectIdMigrations((migrations) => withWriteMutex(async () => {
    const file = await loadProjectPermissionsUnlocked(migrations);
    file.permissionAudit.push({ id: randomUUID(), at: new Date().toISOString(), ...entry });
    await saveProjectPermissions(file);
  }));
}

export async function grantProjectToFamiliar(input: {
  familiarId: string;
  projectId: string;
  source: ProjectGrantSource;
  access?: ProjectAccessLevel;
  /** Who is making the change; defaults to the app itself. */
  actor?: GrantChangeActor;
}): Promise<void> {
  await withProjectIdMigrations((migrations) => withWriteMutex(async () => {
    const file = await loadProjectPermissionsUnlocked(migrations);
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
      await saveProjectPermissions(file);
    }
  }));
}

export async function revokeProjectFromFamiliar(input: {
  familiarId: string;
  projectId: string;
  /** Who is making the change; defaults to the app itself. */
  actor?: GrantChangeActor;
}): Promise<boolean> {
  return withProjectIdMigrations((migrations) => withWriteMutex(async () => {
    const file = await loadProjectPermissionsUnlocked(migrations);
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
    await saveProjectPermissions(file);
    return true;
  }));
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
  return withProjectIdMigrations((migrations) => withWriteMutex(async () => {
    const file = await loadProjectPermissionsUnlocked(migrations);

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

    if (grants > 0 || groupGrants > 0 || proposals > 0) await saveProjectPermissions(file);
    return { grants, groupGrants, proposals };
  }));
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
  const [projects, permissions] = await Promise.all([loadProjects(), loadProjectPermissions()]);
  return orphanProjectIntegrity(permissions, new Set(projects.map((project) => project.id)));
}

/**
 * Explicit human-invoked repair for legacy orphan grants. Removing records for
 * projects absent from the registry can only reduce access; an audit record is
 * persisted atomically with the cleanup, making retries after interruption
 * idempotent and reviewable.
 */
export async function repairOrphanProjectPermissions(): Promise<ProjectPermissionIntegrityReport> {
  return withProjectRegistryLock((projects) => {
    const knownProjectIds = new Set(projects.map((project) => project.id));
    return withProjectPermissionsStore(() => withWriteMutex(async () => {
      const file = await loadProjectPermissionsUnlocked(projectIdMigrationMap(projects));
      const report = orphanProjectIntegrity(file, knownProjectIds);
      if (report.directGrants + report.groupGrants + report.proposals === 0) return report;
      file.projectGrants = file.projectGrants.filter((grant) => knownProjectIds.has(grant.projectId));
      for (const group of file.accessGroups) {
        group.projectGrants = group.projectGrants.filter((grant) => knownProjectIds.has(grant.projectId));
      }
      file.grantProposals = file.grantProposals.filter((proposal) => knownProjectIds.has(proposal.projectId));
      file.repairAudit.push({ at: new Date().toISOString(), kind: "orphan-project-repair", ...report });
      await saveProjectPermissions(file);
      return report;
    }));
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

  return withProjectIdMigrations((migrations) => withWriteMutex(async () => {
    const file = await loadProjectPermissionsUnlocked(migrations);
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
  }));
}

export async function resolveGrantProposal(input: {
  proposalId: string;
  decision: "accepted" | "rejected";
}): Promise<GrantProposal> {
  return withProjectIdMigrations((migrations) => withWriteMutex(async () => {
    const file = await loadProjectPermissionsUnlocked(migrations);
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
  }));
}

/**
 * Revert an accepted-but-not-yet-finalized proposal back to `pending`. Only
 * possible during the undo window — once `finalizesAt` passes, loads have
 * already materialized the grant and the proposal reads as `accepted`.
 */
export async function undoGrantProposal(input: { proposalId: string }): Promise<GrantProposal> {
  return withProjectIdMigrations((migrations) => withWriteMutex(async () => {
    const file = await loadProjectPermissionsUnlocked(migrations);
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
  }));
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
  return withProjectIdMigrations((migrations) => withWriteMutex(async () => {
    const file = await loadProjectPermissionsUnlocked(migrations);
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
    recordGroupEffectiveChanges(file, pairs, before, group.id, input.actor ?? "system");
    await saveProjectPermissions(file);
    return group;
  }));
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
  return withProjectIdMigrations((migrations) => withWriteMutex(async () => {
    const file = await loadProjectPermissionsUnlocked(migrations);
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
    recordGroupEffectiveChanges(file, pairs, before, group.id, input.actor ?? "system");
    await saveProjectPermissions(file);
    return group;
  }));
}

export async function deleteAccessGroup(
  groupId: string,
  options: { actor?: GrantChangeActor } = {},
): Promise<boolean> {
  return withProjectIdMigrations((migrations) => withWriteMutex(async () => {
    const file = await loadProjectPermissionsUnlocked(migrations);
    const removed = file.accessGroups.find((group) => group.id === groupId) ?? null;
    const next = file.accessGroups.filter((group) => group.id !== groupId);
    if (next.length === file.accessGroups.length) return false;
    // Deleting a group takes away everything it conferred, from every member
    // at once — the widest single change the model allows.
    const pairs = groupPairs(removed, null);
    const before = effectiveSnapshot(file, pairs);
    file.accessGroups = next;
    recordGroupEffectiveChanges(file, pairs, before, groupId, options.actor ?? "system");
    await saveProjectPermissions(file);
    return true;
  }));
}
