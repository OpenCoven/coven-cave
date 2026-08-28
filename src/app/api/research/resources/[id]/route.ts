import { NextResponse } from "next/server.js";

import { caveResearchResources } from "../../../../../lib/feature-flags.ts";
import type { ResourceManifestV1 } from "../../../../../lib/research-resource-contracts.ts";
import { rejectNonLocalRequest } from "../../../../../lib/server/api-security.ts";
import { getResearchResourceManifest } from "../../../../../lib/server/research-resource-catalog.ts";
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
};

export function isSafeResearchResourceRouteId(value: string): boolean {
  return SAFE_RESOURCE_ID.test(value) && !WINDOWS_DEVICE_ID.test(value);
}

export function createResearchResourceDetailRouteHandlers(
  dependencies: ResearchResourceDetailRouteDependencies = {},
) {
  const enabled = dependencies.enabled ?? caveResearchResources;
  const getManifest = dependencies.getManifest ?? getResearchResourceManifest;

  return {
    async GET(req: Request, context: ResourceDetailContext) {
      const forbidden = rejectNonLocalRequest(req);
      if (forbidden) return forbidden;
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
  };
}

const handlers = createResearchResourceDetailRouteHandlers();
export const GET = handlers.GET;
