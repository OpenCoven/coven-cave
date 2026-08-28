import { NextResponse } from "next/server.js";

import { caveResearchResources } from "../../../../../lib/feature-flags.ts";
import { rejectNonLocalRequest, readJsonBody } from "../../../../../lib/server/api-security.ts";
import {
  createResearchResourceRetrieval,
  ResearchResourceRetrievalError,
  type ResearchResourceRetrieval,
} from "../../../../../lib/server/research-resource-retrieval.ts";
import { resourceNotFoundResponse } from "../route.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE_HEADERS = { "cache-control": "no-store" } as const;
const MAX_QUERY_BYTES = 32 * 1024;

function malformedSearchRequest(response: Response): NextResponse {
  const status = response.status === 413 ? 413 : response.status === 415 ? 415 : 400;
  const code = status === 413
    ? "request-body-too-large"
    : status === 415
      ? "unsupported-content-type"
      : "invalid-json-body";
  const error = status === 413
    ? "request body too large"
    : status === 415
      ? "application/json required"
      : "invalid json body";
  return NextResponse.json({ ok: false, code, error }, { status, headers: NO_STORE_HEADERS });
}

export function createResearchResourceSearchRouteHandlers(dependencies: {
  enabled?: () => boolean;
  retrieval?: Pick<ResearchResourceRetrieval, "query">;
} = {}) {
  const enabled = dependencies.enabled ?? caveResearchResources;
  const retrieval = dependencies.retrieval ?? createResearchResourceRetrieval();
  return {
    async POST(req: Request) {
      const forbidden = rejectNonLocalRequest(req);
      if (forbidden) {
        forbidden.headers.set("cache-control", "no-store");
        return forbidden;
      }
      if (!enabled()) return resourceNotFoundResponse();
      const body = await readJsonBody<unknown>(req, MAX_QUERY_BYTES);
      if (!body.ok) return malformedSearchRequest(body.response);
      try {
        const response = await retrieval.query(body.body);
        return NextResponse.json({ ok: true, result: response }, { headers: NO_STORE_HEADERS });
      } catch (error) {
        const code = error instanceof ResearchResourceRetrievalError ? error.code : "unavailable";
        const status = code === "invalid-query" ? 400 : code === "unsupported-filter" ? 422 : 503;
        return NextResponse.json(
          { ok: false, code, error: code === "unavailable" ? "resource search unavailable" : error instanceof Error ? error.message : "invalid query" },
          { status, headers: NO_STORE_HEADERS },
        );
      }
    },
  };
}

const handlers = createResearchResourceSearchRouteHandlers();
export const POST = handlers.POST;
