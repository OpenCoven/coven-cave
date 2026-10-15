// Explicit Research host contract. Keep exports scoped; never export *.
export {
  ResearchResourceSemanticIndexError,
  openResearchResourceSemanticIndex,
  rebuildResearchResourceSemanticIndex,
  researchResourceSemanticIndexPath,
} from "@/lib/server/research-resource-semantic-index";
export type {
  ResearchResourceSemanticIndex,
  ResearchSemanticAuthority,
  ResearchSemanticProbe,
} from "@/lib/server/research-resource-semantic-index";
