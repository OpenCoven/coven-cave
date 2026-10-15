// Explicit Research host contract. Keep exports scoped; never export *.
export {
  createProject,
  deleteProject,
  loadProjects,
  projectForRoot,
} from "@/lib/cave-projects";
export type {
  CaveProject,
} from "@/lib/cave-projects";
