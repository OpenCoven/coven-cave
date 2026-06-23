import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { loadProjects, projectForRoot } from "./cave-projects.ts";
import type { CaveProject } from "./cave-projects-types.ts";

export type ProjectGrantSource = "bootstrap" | "human";
export type ProjectAccessDecision = "allow" | "deny";
export type ProjectPermissionSurface =
  | "chat"
  | "session-launch"
  | "shell"
  | "file-browse"
  | "file-read"
  | "file-write"
  | "project-api"
  | "mobile"
  | "project-picker";

export type ProjectGrant = {
  familiarId: string;
  projectId: string;
  source: ProjectGrantSource;
  grantedAt: string;
};

export type GrantProposal = {
  id: string;
  proposedBy: string;
  targetFamiliarId: string;
  projectId: string;
  status: "pending" | "accepted" | "rejected";
  createdAt: string;
};

export type PermissionAuditEntry = {
  id: string;
  at: string;
  familiarId: string;
  projectId: string;
  surface: ProjectPermissionSurface;
  decision: ProjectAccessDecision;
  reason: "grant" | "supreme" | "missing-grant";
};

type ProjectPermissionsFile = {
  version: 1;
  projectGrants: ProjectGrant[];
  grantProposals: GrantProposal[];
  permissionAudit: PermissionAuditEntry[];
  legacyConfiguredGrantsBootstrappedAt?: string;
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
    path.join(homedir(), ".coven", "cave-project-permissions.json")
  );
}

function humanPermissionConfigPath(): string {
  return (
    process.env.CAVE_PERMISSION_CONFIG_PATH_OVERRIDE ??
    path.join(homedir(), ".coven", "cave-permission-config.json")
  );
}

function emptyFile(): ProjectPermissionsFile {
  return { version: 1, projectGrants: [], grantProposals: [], permissionAudit: [] };
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

export async function loadProjectPermissions(): Promise<ProjectPermissionsFile> {
  const parsed = await readJsonFile<Partial<ProjectPermissionsFile>>(permissionsFilePath());
  if (!parsed) return emptyFile();
  return {
    version: 1,
    projectGrants: Array.isArray(parsed.projectGrants) ? parsed.projectGrants : [],
    grantProposals: Array.isArray(parsed.grantProposals) ? parsed.grantProposals : [],
    permissionAudit: Array.isArray(parsed.permissionAudit) ? parsed.permissionAudit : [],
    legacyConfiguredGrantsBootstrappedAt:
      typeof parsed.legacyConfiguredGrantsBootstrappedAt === "string"
        ? parsed.legacyConfiguredGrantsBootstrappedAt
        : undefined,
  };
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
  },
): boolean {
  const exists = file.projectGrants.some(
    (grant) => grant.familiarId === input.familiarId && grant.projectId === input.projectId,
  );
  if (exists) return false;
  file.projectGrants.push({
    familiarId: input.familiarId,
    projectId: input.projectId,
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

export function canAccessProject(
  file: Pick<ProjectPermissionsFile, "projectGrants">,
  ctx: ProjectAccessContext,
  projectId: string,
  supremeFamiliarId: string,
): boolean {
  const familiarId = ctx.familiarId?.trim();
  if (!familiarId) return false;
  if (familiarId === supremeFamiliarId) return true;
  return file.projectGrants.some(
    (grant) => grant.familiarId === familiarId && grant.projectId === projectId,
  );
}

export async function filterProjectsForFamiliar(
  projects: CaveProject[],
  familiarId: string,
): Promise<CaveProject[]> {
  const [permissions, config] = await Promise.all([
    loadProjectPermissions(),
    loadHumanPermissionConfig(),
  ]);
  if (familiarId === config.supremeFamiliarId) return projects;
  const granted = new Set(
    permissions.projectGrants
      .filter((grant) => grant.familiarId === familiarId)
      .map((grant) => grant.projectId),
  );
  return projects.filter((project) => granted.has(project.id));
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
  const allowed = canAccessProject(permissions, ctx, projectId, config.supremeFamiliarId);
  const reason = allowed
    ? familiarId === config.supremeFamiliarId
      ? "supreme"
      : "grant"
    : "missing-grant";

  await appendAudit({
    familiarId: familiarId || "unknown",
    projectId,
    surface,
    decision: allowed ? "allow" : "deny",
    reason,
  });

  if (!allowed) throw new ProjectAccessDeniedError();
}

export async function assertProjectRootAccess(
  ctx: ProjectAccessContext,
  projectRoot: string | null | undefined,
  surface: ProjectPermissionSurface,
): Promise<CaveProject | null> {
  if (!projectRoot?.trim()) return null;
  const project = projectForRoot(projectRoot, await loadProjects());
  if (!project) {
    throw new ProjectAccessDeniedError("project is not registered for permission checks");
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

function configuredFamiliarIds(values: readonly string[]): string[] {
  const unique = new Set<string>();
  for (const value of values) {
    const familiarId = value.trim();
    if (/^[a-z0-9_-]+$/i.test(familiarId)) unique.add(familiarId);
  }
  return [...unique];
}

export async function bootstrapConfiguredFamiliarProjectGrants(
  projects: CaveProject[],
  familiarIds: readonly string[],
): Promise<boolean> {
  const targetFamiliarIds = configuredFamiliarIds(familiarIds);
  if (projects.length === 0 || targetFamiliarIds.length === 0) return false;

  return withWriteMutex(async () => {
    const file = await loadProjectPermissions();
    if (
      file.legacyConfiguredGrantsBootstrappedAt ||
      file.projectGrants.length > 0 ||
      file.grantProposals.length > 0
    ) {
      return false;
    }

    for (const familiarId of targetFamiliarIds) {
      for (const project of projects) {
        ensureProjectGrant(file, {
          familiarId,
          projectId: project.id,
          source: "bootstrap",
        });
      }
    }
    file.legacyConfiguredGrantsBootstrappedAt = new Date().toISOString();
    await saveProjectPermissions(file);
    return true;
  });
}

export async function createGrantProposal(input: {
  proposedBy: string;
  targetFamiliarId: string;
  projectId: string;
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
    grantProposal.status = input.decision === "accepted" ? "accepted" : "rejected";
    if (input.decision === "accepted") {
      ensureProjectGrant(file, {
        familiarId: grantProposal.targetFamiliarId,
        projectId: grantProposal.projectId,
        source: "human",
      });
    }
    await saveProjectPermissions(file);
    return grantProposal;
  });
}
