import type { ResourceManifestV1 } from "../research-resource-contracts.ts";
import {
  createResearchResourceStore,
  ResearchResourceStoreError,
  type ResearchResourceStore,
} from "./research-resource-store.ts";

export { ResearchResourceStoreError as ResearchResourceCatalogError };

export type ResearchResourceCatalog = Pick<
  ResearchResourceStore,
  "createManifest" | "listManifests" | "updateManifest"
> & {
  getManifest(id: string): Promise<ResourceManifestV1 | null>;
};

export function createResearchResourceCatalog(
  options: { root?: string } = {},
): ResearchResourceCatalog {
  const store = createResearchResourceStore(options);
  return {
    createManifest: store.createManifest,
    getManifest: store.readManifest,
    listManifests: store.listManifests,
    updateManifest: store.updateManifest,
  };
}

export async function listResearchResourceManifests(): Promise<ResourceManifestV1[]> {
  return createResearchResourceCatalog().listManifests();
}

export async function getResearchResourceManifest(
  id: string,
): Promise<ResourceManifestV1 | null> {
  return createResearchResourceCatalog().getManifest(id);
}
