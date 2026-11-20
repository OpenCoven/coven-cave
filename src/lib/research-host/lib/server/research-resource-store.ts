// Explicit Research host contract. Keep exports scoped; never export *.
export {
  ResearchResourceStoreError,
  createResearchResourceStore,
} from "@/lib/server/research-resource-store";
export type {
  ResearchResourceStore,
  ResourceEmbeddingTaskRecordV1,
  ResourceIngestFailureV1,
  ResourceOperationalTransaction,
  VerifiedResourceSnapshot,
} from "@/lib/server/research-resource-store";
