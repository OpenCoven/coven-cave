import {
  categorizeLink,
  type SavedLink,
  type SavedLinkSummary,
} from "./link-organizer.ts";
import type { ResourceManifestV1 } from "./research-resource-contracts.ts";

/**
 * Project one catalog manifest into the legacy Resources list shape.
 *
 * Only manifests that explicitly retain a legacy saved-link identity and
 * category participate. The projection is an allowlist: catalog-only and
 * additive manifest fields never cross into the legacy read model.
 */
export function resourceManifestToSavedLinkSummary(
  manifest: ResourceManifestV1,
): SavedLinkSummary | null {
  if (!manifest.legacySavedLink) return null;

  const paper = legacyPaper(manifest);
  return {
    id: manifest.legacySavedLink.id,
    url: manifest.legacySavedLink.url,
    category: manifest.category ?? categorizeLink(manifest.legacySavedLink.url),
    title: manifest.title,
    addedAt: manifest.legacySavedLink.addedAt,
    source: manifest.legacySavedLink.source,
    ...(paper ? { paper } : {}),
  };
}

/** Newest legacy saves first, with an id tie-breaker for stable output. */
export function resourceManifestsToSavedLinkSummaries(
  manifests: readonly ResourceManifestV1[],
): SavedLinkSummary[] {
  return manifests
    .map(resourceManifestToSavedLinkSummary)
    .filter((summary): summary is SavedLinkSummary => summary !== null)
    .sort((left, right) =>
      right.addedAt.localeCompare(left.addedAt) || left.id.localeCompare(right.id),
    );
}

function legacyPaper(manifest: ResourceManifestV1): SavedLink["paper"] {
  const paper = manifest.paper;
  const publishedAt = paper?.publishedAt ?? manifest.publishedAt;
  if (!paper || paper.abstract === undefined || publishedAt === undefined) return undefined;

  return {
    arxivId: paper.arxivId,
    authors: [...paper.authors],
    abstract: paper.abstract,
    publishedAt,
  };
}
