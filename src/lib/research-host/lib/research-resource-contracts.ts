// Explicit Research host contract. Keep exports scoped; never export *.
export {
  parseResourceManifestV1,
  parseResourceQueryResponseV1,
  parseResourceQueryV1,
} from "@/lib/research-resource-contracts";
export type {
  ResourceIngestJobStageV1,
  ResourceIngestJobV1,
  ResourceManifestV1,
  ResourceNormalizationReceiptV1,
  ResourcePageBoundaryV1,
  ResourceQueryHitV1,
  ResourceQueryResponseV1,
  ResourceQueryV1,
  ResourceSnapshotV1,
} from "@/lib/research-resource-contracts";
