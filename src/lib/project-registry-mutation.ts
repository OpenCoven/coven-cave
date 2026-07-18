import type { CaveProject } from "./cave-projects-types.ts";
import type { ProjectRegistryMutation } from "./project-registry-events.ts";

export function applyProjectRegistryMutation(projects: CaveProject[], mutation: ProjectRegistryMutation): CaveProject[] {
  return mutation.kind === "delete" ? projects.filter((project) => project.id !== mutation.projectId) : projects;
}
