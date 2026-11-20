// Explicit Research host contract. Keep exports scoped; never export *.
export {
  accessLevelSatisfies,
  maxAccessLevel,
  normalizeAccessLevel,
} from "@/lib/project-access-levels";
export type {
  ProjectAccessLevel,
} from "@/lib/project-access-levels";
