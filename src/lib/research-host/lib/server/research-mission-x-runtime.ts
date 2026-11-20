// Explicit Research host contract. Keep exports scoped; never export *.
export {
  ResearchMissionXHydrationError,
  dropMissionXRuntime,
  hydrateMissionXSources,
  mergeXSourceRefs,
  researchMissionHoldsXRuntime,
} from "@/lib/server/research-mission-x-runtime";
export type {
  ResearchMissionXHydration,
} from "@/lib/server/research-mission-x-runtime";
