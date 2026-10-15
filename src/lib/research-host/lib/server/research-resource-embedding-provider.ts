// Explicit Research host contract. Keep exports scoped; never export *.
export {
  MAX_RESEARCH_EMBEDDING_INPUTS,
  ResearchEmbeddingProviderError,
  configuredResearchEmbeddingProvider,
  embedResearchResourceInputs,
  validateResearchEmbeddingProviderConfig,
} from "@/lib/server/research-resource-embedding-provider";
export type {
  ResearchEmbeddingAvailability,
  ValidatedResearchEmbeddingProviderConfig,
} from "@/lib/server/research-resource-embedding-provider";
