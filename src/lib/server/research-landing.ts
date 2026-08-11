import { mkdir } from "node:fs/promises";
import type { CaveProject } from "../cave-projects.ts";
import { createProject, deleteProject, loadProjects, projectForRoot } from "../cave-projects.ts";
import {
  effectiveProjectAccess,
  grantProjectToFamiliar,
  loadProjectPermissions,
  revokeAllGrantsForProject,
} from "../project-permissions.ts";
import { researchMissionWorkspacePath, researchMissionsRoot } from "./research-mission-store.ts";

/**
 * Register and grant only one mission workspace. The parent research root is
 * deliberately never granted: it contains workspaces owned by other familiars.
 */
export async function ensureResearchLandingAccess(
  familiarId: string,
  missionId: string,
): Promise<{ project: CaveProject; granted: boolean }> {
  const root = researchMissionWorkspacePath(missionId);
  await mkdir(/* turbopackIgnore: true */ root, { recursive: true });
  const existing = projectForRoot(root, await loadProjects());
  const project = existing ?? (await createProject({ name: missionId, root }));
  const permissions = await loadProjectPermissions();
  const effective = effectiveProjectAccess(permissions, familiarId, project.id);
  if (!effective.level) {
    await grantProjectToFamiliar({
      familiarId,
      projectId: project.id,
      source: "bootstrap",
      access: "write",
      actor: "system",
    });
  }

  // Remove the insecure project created by older releases. Keeping even one
  // grant on this shared parent makes every mission workspace accessible.
  const shared = projectForRoot(researchMissionsRoot(), await loadProjects());
  if (shared) {
    await revokeAllGrantsForProject(shared.id);
    await deleteProject(shared.id);
  }
  return { project, granted: !effective.level };
}
