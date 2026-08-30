import type { ResourceManifestV1 } from "../research-resource-contracts.ts";
import {
  createResearchResourceStore,
  ResearchResourceStoreError,
  type ResearchResourceStore,
} from "./research-resource-store.ts";
import { recoverInterruptedResearchResourceRestore } from "./research-resource-recovery.ts";

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
  const ready = () => recoverInterruptedResearchResourceRestore({ root: options.root });
  return {
    createManifest: async (manifest) => {
      await ready();
      return store.createManifest(manifest);
    },
    getManifest: async (id) => {
      await ready();
      return store.readManifest(id);
    },
    listManifests: async () => {
      await ready();
      return store.listManifests();
    },
    updateManifest: async (input) => {
      await ready();
      return store.updateManifest(input);
    },
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
