import {
  sortProjectsAlphabetically,
  type CaveProject,
} from "./cave-projects-types.ts";
import type { ProjectAccessLevel } from "./project-access-levels.ts";

export type AccessibleCaveProject = Omit<CaveProject, "access"> & {
  access: ProjectAccessLevel;
};

/**
 * Project choices safe for a Coven group: every participant must have a
 * server-verified grant. The displayed level is the least privilege shared by
 * the group, so a single Read member keeps the whole choice visibly Read.
 */
export function intersectAccessibleProjects(
  projectLists: readonly (readonly CaveProject[])[],
): AccessibleCaveProject[] {
  const [first, ...rest] = projectLists;
  if (!first) return [];

  const verifiedLists = projectLists.map(
    (projects) =>
      new Map(
        projects
          .filter((project): project is AccessibleCaveProject => project.access !== undefined)
          .map((project) => [project.id, project]),
      ),
  );
  const firstVerified = verifiedLists[0];
  if (!firstVerified) return [];

  const shared: AccessibleCaveProject[] = [];
  for (const project of firstVerified.values()) {
    const matches = rest.map((_, index) => verifiedLists[index + 1]?.get(project.id));
    if (matches.some((match) => !match)) continue;
    const access: ProjectAccessLevel =
      project.access === "read" || matches.some((match) => match?.access === "read")
        ? "read"
        : "write";
    shared.push({ ...project, access });
  }
  return sortProjectsAlphabetically(shared) as AccessibleCaveProject[];
}
