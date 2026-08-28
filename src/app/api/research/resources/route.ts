import { NextResponse } from "next/server.js";

import { caveResearchResources } from "../../../../lib/feature-flags.ts";
import type { ResourceManifestV1 } from "../../../../lib/research-resource-contracts.ts";
import { rejectNonLocalRequest } from "../../../../lib/server/api-security.ts";
import { listResearchResourceManifests } from "../../../../lib/server/research-resource-catalog.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE_HEADERS = { "cache-control": "no-store" } as const;

export type ResearchResourceRouteDependencies = {
  enabled?: () => boolean;
  listManifests?: () => Promise<readonly ResourceManifestV1[]>;
};

/**
 * Keep the API response independent from parser-compatible extension fields.
 * Resource manifests may retain local migration metadata on disk, but a route
 * response contains only this reviewed manifest vocabulary.
 */
export function projectResearchResourceMetadata(
  manifest: ResourceManifestV1,
): ResourceManifestV1 {
  return {
    version: 1,
    id: manifest.id,
    revision: manifest.revision,
    kind: manifest.kind,
    canonicalIdentity: manifest.canonicalIdentity,
    title: manifest.title,
    sourceType: manifest.sourceType,
    subject: {
      ...(manifest.subject.familiarId === undefined
        ? {}
        : { familiarId: manifest.subject.familiarId }),
      ...(manifest.subject.projectId === undefined
        ? {}
        : { projectId: manifest.subject.projectId }),
    },
    sensitivity: manifest.sensitivity,
    ingest: {
      desired: manifest.ingest.desired,
      state: manifest.ingest.state,
      ...(manifest.ingest.lastFailureCode === undefined
        ? {}
        : { lastFailureCode: manifest.ingest.lastFailureCode }),
      ...(manifest.ingest.retryable === undefined
        ? {}
        : { retryable: manifest.ingest.retryable }),
    },
    createdAt: manifest.createdAt,
    updatedAt: manifest.updatedAt,
    ...(manifest.sourceUri === undefined ? {} : { sourceUri: manifest.sourceUri }),
    ...(manifest.category === undefined ? {} : { category: manifest.category }),
    ...(manifest.publishedAt === undefined ? {} : { publishedAt: manifest.publishedAt }),
    ...(manifest.legacySavedLink === undefined
      ? {}
      : {
          legacySavedLink: {
            id: manifest.legacySavedLink.id,
            url: manifest.legacySavedLink.url,
            addedAt: manifest.legacySavedLink.addedAt,
            source: manifest.legacySavedLink.source,
          },
        }),
    ...(manifest.paper === undefined
      ? {}
      : {
          paper: {
            arxivId: manifest.paper.arxivId,
            authors: [...manifest.paper.authors],
            ...(manifest.paper.abstract === undefined
              ? {}
              : { abstract: manifest.paper.abstract }),
            ...(manifest.paper.publishedAt === undefined
              ? {}
              : { publishedAt: manifest.paper.publishedAt }),
          },
        }),
    ...(manifest.currentSnapshotId === undefined
      ? {}
      : { currentSnapshotId: manifest.currentSnapshotId }),
  };
}

export function resourceNotFoundResponse(): NextResponse {
  return NextResponse.json(
    { ok: false, code: "resource_not_found", error: "resource not found" },
    { status: 404, headers: NO_STORE_HEADERS },
  );
}

export function catalogIntegrityResponse(): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      code: "resource_catalog_integrity",
      error: "resource catalog unavailable",
    },
    { status: 500, headers: NO_STORE_HEADERS },
  );
}

export function createResearchResourcesRouteHandlers(
  dependencies: ResearchResourceRouteDependencies = {},
) {
  const enabled = dependencies.enabled ?? caveResearchResources;
  const listManifests = dependencies.listManifests ?? listResearchResourceManifests;

  return {
    async GET(req: Request) {
      const forbidden = rejectNonLocalRequest(req);
      if (forbidden) return forbidden;
      if (!enabled()) return resourceNotFoundResponse();

      try {
        const resources = (await listManifests()).map(projectResearchResourceMetadata);
        return NextResponse.json(
          { ok: true, resources },
          { headers: NO_STORE_HEADERS },
        );
      } catch {
        return catalogIntegrityResponse();
      }
    },
  };
}

const handlers = createResearchResourcesRouteHandlers();
export const GET = handlers.GET;
