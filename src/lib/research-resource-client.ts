import type {
  ResourceManifestV1,
  ResourceQueryHitV1,
} from "./research-resource-contracts.ts";

/**
 * Query evidence is immutable for one resource revision. Catalog metadata is
 * useful only when it describes that exact revision; joining by id alone can
 * attach a newly refreshed title/source/action to evidence from an older
 * snapshot.
 */
export function resourceForQueryHit(
  resources: readonly ResourceManifestV1[],
  hit: Pick<ResourceQueryHitV1, "resourceId" | "resourceRevision">,
): ResourceManifestV1 | null {
  return resources.find(
    (resource) => resource.id === hit.resourceId && resource.revision === hit.resourceRevision,
  ) ?? null;
}

export async function mutateResearchResource(
  id: string,
  method: "POST" | "DELETE",
  request: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const response = await request(`/api/research/resources/${encodeURIComponent(id)}`, { method });
    return response.ok;
  } catch {
    return false;
  }
}
