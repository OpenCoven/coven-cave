import { createHash } from "node:crypto";

import { normalizeSearchDocument } from "./search-document.ts";
import {
  permitsByProject,
  type SearchProvider,
  type SearchRequesterContext,
} from "./search-provider.ts";
import type { ResourceManifestV1 } from "./research-resource-contracts.ts";
import { listResearchResourceManifests } from "./server/research-resource-catalog.ts";
import {
  createResearchResourceRetrieval,
  type ResearchResourceRetrieval,
} from "./server/research-resource-retrieval.ts";

export const RESEARCH_RESOURCE_SEARCH_PROVIDER_ID = "research-resources";

function fingerprint(manifests: readonly ResourceManifestV1[]): string {
  const authority = manifests
    .map((manifest) => `${manifest.id}\0${manifest.revision}\0${manifest.currentSnapshotId ?? ""}`)
    .sort()
    .join("\n");
  return createHash("sha256").update(authority).digest("hex");
}

export function createResearchResourceSearchProvider(options: {
  retrieval?: Pick<ResearchResourceRetrieval, "query">;
  listManifests?: () => Promise<readonly ResourceManifestV1[]>;
} = {}): SearchProvider {
  const retrieval = options.retrieval ?? createResearchResourceRetrieval();
  const listManifests = options.listManifests ?? listResearchResourceManifests;
  return {
    id: RESEARCH_RESOURCE_SEARCH_PROVIDER_ID,
    entityTypes: ["resource"],
    supportedFilters: ["project"],
    kind: "live",
    async fingerprint() {
      return fingerprint(await listManifests());
    },
    async query(query, context) {
      try {
        const response = await retrieval.query({
          version: 1,
          text: query.text,
          ranking: "hybrid",
          limit: Math.min(100, Math.max(1, query.limit)),
          filters: {
            ...(query.projectIds.length > 0 ? { projectIds: query.projectIds } : {}),
            ...(query.familiarIds.length > 0 ? { familiarIds: query.familiarIds } : {}),
          },
        });
        const manifests = new Map((await listManifests()).map((manifest) => [manifest.id, manifest]));
        const documents = response.hits.flatMap((hit) => {
          const manifest = manifests.get(hit.resourceId);
          if (!manifest || manifest.revision !== hit.resourceRevision) return [];
          const permissions = [
            ...(manifest.subject.projectId ? [{ kind: "project", id: manifest.subject.projectId }] : []),
            ...(manifest.subject.familiarId ? [{ kind: "familiar", id: manifest.subject.familiarId }] : []),
          ];
          const document = normalizeSearchDocument({
            id: `${hit.resourceId}:${hit.snapshotId}`,
            providerId: RESEARCH_RESOURCE_SEARCH_PROVIDER_ID,
            entityType: "resource",
            title: manifest.title,
            body: hit.excerpt,
            excerpt: hit.excerpt,
            projectId: manifest.subject.projectId ?? null,
            projectRoot: null,
            familiarId: manifest.subject.familiarId ?? null,
            roomId: null,
            sessionId: null,
            runtime: null,
            status: manifest.ingest.state,
            tags: [manifest.kind, manifest.sensitivity],
            createdAt: manifest.createdAt,
            updatedAt: manifest.updatedAt,
            sourceType: manifest.sourceType,
            permissions,
            sourceVersion: `${hit.resourceRevision}:${hit.normalizedBlobDigest}:${hit.excerptDigest}`,
            action: { id: "open-research-resource", label: `Open ${manifest.title}` },
            secondaryActions: [],
          });
          return document && permitsByProject(document, context) ? [document] : [];
        });
        return { documents, diagnostics: [] };
      } catch {
        return {
          documents: [],
          diagnostics: [{
            providerId: RESEARCH_RESOURCE_SEARCH_PROVIDER_ID,
            code: "unavailable",
            message: "local research retrieval is unavailable",
          }],
        };
      }
    },
    permits(document, context: SearchRequesterContext) {
      return permitsByProject(document, context);
    },
  };
}
