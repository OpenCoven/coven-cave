import { NextResponse } from "next/server.js";

import { caveResearchResources } from "../../../../../lib/feature-flags.ts";
import type { ResourceManifestV1 } from "../../../../../lib/research-resource-contracts.ts";
import { rejectNonLocalRequest } from "../../../../../lib/server/api-security.ts";
import { getResearchResourceManifest } from "../../../../../lib/server/research-resource-catalog.ts";
import { createResearchResourceIngestion } from "../../../../../lib/server/research-resource-ingestion.ts";
import {
  catalogIntegrityResponse,
  projectResearchResourceMetadata,
  resourceNotFoundResponse,
} from "../route.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SAFE_RESOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const WINDOWS_DEVICE_ID = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const NO_STORE_HEADERS = { "cache-control": "no-store" } as const;

type ResourceDetailContext = {
  params: Promise<{ id: string }>;
};

export type ResearchResourceDetailRouteDependencies = {
  enabled?: () => boolean;
  getManifest?: (id: string) => Promise<ResourceManifestV1 | null>;
  retry?: (id: string) => Promise<boolean>;
  deleteResource?: (id: string) => Promise<boolean>;
};

export function isSafeResearchResourceRouteId(value: string): boolean {
  return SAFE_RESOURCE_ID.test(value) && !WINDOWS_DEVICE_ID.test(value);
}

export function createResearchResourceDetailRouteHandlers(
  dependencies: ResearchResourceDetailRouteDependencies = {},
) {
  const enabled = dependencies.enabled ?? caveResearchResources;
  const getManifest = dependencies.getManifest ?? getResearchResourceManifest;
  const withIngestion = async <T>(operation: (ingestion: ReturnType<typeof createResearchResourceIngestion>) => Promise<T>) => {
    const ingestion = createResearchResourceIngestion();
    try { return await operation(ingestion); } finally { await ingestion.close(); }
  };
  const retry = dependencies.retry ?? ((id: string) => withIngestion(async (ingestion) =>
    Boolean(await ingestion.enqueue(id, { refresh: true }))));
  const deleteResource = dependencies.deleteResource ?? ((id: string) => withIngestion((ingestion) =>
    ingestion.deleteResource(id)));

  const resourceId = async (context: ResourceDetailContext) => {
    const { id } = await context.params;
    return isSafeResearchResourceRouteId(id) ? id : null;
  };

  return {
    async GET(req: Request, context: ResourceDetailContext) {
      const forbidden = rejectNonLocalRequest(req);
      if (forbidden) {
        forbidden.headers.set("cache-control", "no-store");
        return forbidden;
      }
      if (!enabled()) return resourceNotFoundResponse();

      const { id } = await context.params;
      if (!isSafeResearchResourceRouteId(id)) {
        return NextResponse.json(
          { ok: false, code: "invalid_resource_id", error: "invalid resource id" },
          { status: 400, headers: NO_STORE_HEADERS },
        );
      }

      try {
        const manifest = await getManifest(id);
        if (!manifest) return resourceNotFoundResponse();
        return NextResponse.json(
          { ok: true, resource: projectResearchResourceMetadata(manifest) },
          { headers: NO_STORE_HEADERS },
        );
      } catch {
        return catalogIntegrityResponse();
      }
    },
    async POST(req: Request, context: ResourceDetailContext) {
      const forbidden = rejectNonLocalRequest(req);
      if (forbidden) {
        forbidden.headers.set("cache-control", "no-store");
        return forbidden;
      }
      if (!enabled()) return resourceNotFoundResponse();
      const id = await resourceId(context);
      if (!id) return NextResponse.json(
        { ok: false, code: "invalid_resource_id", error: "invalid resource id" },
        { status: 400, headers: NO_STORE_HEADERS },
      );
      try {
        const manifest = await getManifest(id);
        if (!manifest) return resourceNotFoundResponse();
        if (manifest.ingest.state !== "failed" || manifest.ingest.retryable === false) {
          return NextResponse.json(
            { ok: false, code: "resource_not_retryable", error: "resource is not retryable" },
            { status: 409, headers: NO_STORE_HEADERS },
          );
        }
        if (!await retry(id)) {
          return NextResponse.json(
            { ok: false, code: "ingestion_unavailable", error: "local ingestion unavailable" },
            { status: 503, headers: NO_STORE_HEADERS },
          );
        }
        return NextResponse.json({ ok: true }, { headers: NO_STORE_HEADERS });
      } catch {
        return catalogIntegrityResponse();
      }
    },
    async DELETE(req: Request, context: ResourceDetailContext) {
      const forbidden = rejectNonLocalRequest(req);
      if (forbidden) {
        forbidden.headers.set("cache-control", "no-store");
        return forbidden;
      }
      if (!enabled()) return resourceNotFoundResponse();
      const id = await resourceId(context);
      if (!id) return NextResponse.json(
        { ok: false, code: "invalid_resource_id", error: "invalid resource id" },
        { status: 400, headers: NO_STORE_HEADERS },
      );
      try {
        if (!await deleteResource(id)) return resourceNotFoundResponse();
        return NextResponse.json({ ok: true }, { headers: NO_STORE_HEADERS });
      } catch {
        return catalogIntegrityResponse();
      }
    },
  };
}

const handlers = createResearchResourceDetailRouteHandlers();
export const GET = handlers.GET;
export const POST = handlers.POST;
export const DELETE = handlers.DELETE;
