import { loadProjects } from "@/lib/cave-projects";
import { resolveFirstUseContext, type FirstUseDefaults } from "@/lib/first-use";
import { effectiveProjectAccess, loadHumanPermissionConfig, loadProjectPermissions } from "@/lib/project-permissions";
import { loadVisibleFamiliarRoster } from "@/lib/server/familiar-roster";
import { validateCaveProjectRootAsync } from "@/lib/server/project-paths";

/** Re-read registry, roster and effective grants; a saved preference is never authority. */
export async function inspectFirstUseContext(defaults: FirstUseDefaults | null) {
  if (!defaults) return {
    resolution: resolveFirstUseContext({ defaults, projectIds: [], familiarIds: [], eligibleFamiliarIds: [], runtimeAvailable: true }),
    access: [], project: null,
  };
  const [projects, roster, permissions, humanConfig] = await Promise.all([
    loadProjects(), loadVisibleFamiliarRoster(), loadProjectPermissions(), loadHumanPermissionConfig(),
  ]);
  if (!roster.ok) throw new Error(roster.error);
  const project = projects.find((entry) => entry.id === defaults.projectId) ?? null;
  const projectValid = project !== null && (await validateCaveProjectRootAsync(project.root)).ok;
  const access = defaults.familiarIds.map((familiarId) => {
    const effective = effectiveProjectAccess(permissions, familiarId, defaults.projectId);
    const supreme = humanConfig.supremeFamiliarId === familiarId;
    return { familiarId, ...effective, level: supreme ? "write" as const : effective.level, supreme };
  });
  const resolution = resolveFirstUseContext({
    defaults,
    projectIds: projectValid ? [defaults.projectId] : [],
    familiarIds: roster.roster.map((entry) => entry.id),
    eligibleFamiliarIds: access.filter((entry) => entry.level !== null).map((entry) => entry.familiarId),
    // Runtime readiness is checked separately by the live runtime/model-state
    // report and launch route. A valid selection never promises a runnable CLI.
    runtimeAvailable: true,
  });
  return { resolution, access, project };
}
