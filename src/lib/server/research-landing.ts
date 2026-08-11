import { mkdir } from "node:fs/promises";
import type { CaveProject } from "../cave-projects.ts";
import { createProject, deleteProject, loadProjects, projectForRoot } from "../cave-projects.ts";
import {
  accessLevelSatisfies,
  maxAccessLevel,
  normalizeAccessLevel,
  type ProjectAccessLevel,
} from "../project-access-levels.ts";
import {
  effectiveProjectAccess,
  grantProjectToFamiliar,
  loadProjectPermissions,
  revokeAllGrantsForProject,
} from "../project-permissions.ts";
import { researchMissionsRoot } from "./research-mission-store.ts";

/**
 * research-landing.ts
 *
 * The standard place research lands: every mission workspace lives under
 * researchMissionsRoot() (~/.coven/cave/research-missions). This module makes
 * that landing root a first-class Cave project so the normal grant machinery
 * covers it — a familiar granted the landing project sees ALL of its research
 * output in later chat sessions (the chat boundary is built from registered
 * projects via filterProjectsForFamiliar), instead of relying on ad-hoc
 * per-mission grants that nobody remembers to add.
 */

export const RESEARCH_LANDING_PROJECT_NAME = "Research Missions";

/**
 * Idempotently register the research landing root as a Cave project. The
 * directory is created first: project-paths' savedCaveProjectRoots() drops
 * roots that fail statSync, so a registered-but-missing directory would be
 * silently unusable.
 */
export async function ensureResearchLandingProject(): Promise<CaveProject> {
  const root = researchMissionsRoot();
  await mkdir(/* turbopackIgnore: true */ root, { recursive: true });
  const existing = projectForRoot(root, await loadProjects());
  if (existing) return existing;
  // createProject is idempotent per root — a concurrent registration returns
  // the already-persisted record.
  return createProject({ name: RESEARCH_LANDING_PROJECT_NAME, root });
}

export type ResearchLandingAccess = {
  project: CaveProject;
  /** True when this call added the grant (vs. already effective). */
  granted: boolean;
};

/**
 * Ensure the familiar can reach the research landing root: register the
 * landing project if needed, fold any legacy ad-hoc per-mission grants into
 * it, and add a write grant when the familiar has no effective access. An
 * existing grant (direct or via group) is left untouched — this never
 * upgrades or downgrades a level a human chose.
 */
export async function ensureResearchLandingAccess(
  familiarId: string,
): Promise<ResearchLandingAccess> {
  const project = await ensureResearchLandingProject();
  await migrateAdHocMissionGrants(project);
  const permissions = await loadProjectPermissions();
  const effective = effectiveProjectAccess(permissions, familiarId, project.id);
  if (effective.level) return { project, granted: false };
  await grantProjectToFamiliar({
    familiarId,
    projectId: project.id,
    source: "bootstrap",
    access: "write",
    actor: "system",
  });
  return { project, granted: true };
}

export type AdHocMissionGrantMigration = {
  /** Ad-hoc per-mission projects removed from the registry. */
  removedProjects: number;
  /** Familiars whose ad-hoc access was folded into the landing project. */
  migratedFamiliarIds: string[];
};

/** Registered project roots use forward slashes with no trailing separator. */
function normalizeRegisteredRoot(root: string): string {
  const normalized = root.replace(/\\/g, "/");
  let end = normalized.length;
  while (end > 0 && normalized[end - 1] === "/") end--;
  return normalized.slice(0, end) || "/";
}

/**
 * Fold legacy ad-hoc grants into the standard landing project. Before the
 * landing project existed, reaching a mission's output from chat required
 * registering the individual mission directory as its own project and
 * granting THAT — leaving one narrow, easily-forgotten grant per mission.
 * Every registered project strictly inside the landing root is such a relic:
 * each familiar with access (direct or via group) gets at least the same
 * level on the landing project, then the per-mission project and all of its
 * grants are removed. Idempotent and cheap when no ad-hoc project exists.
 */
export async function migrateAdHocMissionGrants(
  landing: CaveProject,
): Promise<AdHocMissionGrantMigration> {
  const landingRoot = normalizeRegisteredRoot(landing.root);
  const adHoc = (await loadProjects()).filter((project) =>
    project.id !== landing.id &&
    normalizeRegisteredRoot(project.root).startsWith(landingRoot + "/"),
  );
  if (adHoc.length === 0) return { removedProjects: 0, migratedFamiliarIds: [] };

  // Highest access each familiar held on any ad-hoc mission project, from
  // direct grants and group grants alike — the landing grant must not be
  // weaker than what the migration removes.
  const permissions = await loadProjectPermissions();
  const adHocIds = new Set(adHoc.map((project) => project.id));
  const levels = new Map<string, ProjectAccessLevel>();
  const record = (familiarId: string, access: unknown) => {
    const level = normalizeAccessLevel(access);
    levels.set(familiarId, maxAccessLevel(levels.get(familiarId) ?? null, level) ?? level);
  };
  for (const grant of permissions.projectGrants) {
    if (adHocIds.has(grant.projectId)) record(grant.familiarId, grant.access);
  }
  for (const group of permissions.accessGroups ?? []) {
    for (const grant of group.projectGrants) {
      if (!adHocIds.has(grant.projectId)) continue;
      for (const familiarId of group.memberFamiliarIds) record(familiarId, grant.access);
    }
  }

  const migratedFamiliarIds: string[] = [];
  for (const [familiarId, level] of levels) {
    const effective = effectiveProjectAccess(permissions, familiarId, landing.id);
    if (accessLevelSatisfies(effective.level, level)) continue;
    await grantProjectToFamiliar({
      familiarId,
      projectId: landing.id,
      source: "bootstrap",
      access: level,
      actor: "system",
    });
    migratedFamiliarIds.push(familiarId);
  }

  for (const project of adHoc) {
    // Grants first: a crash between the two operations must leave the grants
    // pointing at a still-registered project, never orphaned records.
    await revokeAllGrantsForProject(project.id);
    await deleteProject(project.id);
  }
  return { removedProjects: adHoc.length, migratedFamiliarIds };
}
