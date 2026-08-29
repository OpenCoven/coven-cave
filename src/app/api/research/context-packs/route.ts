import { NextResponse } from "next/server.js";

import { caveResearchContextPacks } from "../../../../lib/feature-flags.ts";
import { readJsonBody, rejectNonLocalRequest } from "../../../../lib/server/api-security.ts";
import {
  createContextPackBuilder,
  type ContextPackBuilder,
} from "../../../../lib/server/research-context-pack-builder.ts";
import {
  ContextPackBuilderError,
} from "../../../../lib/server/research-context-pack-builder.ts";
import {
  createContextPackStore,
  type ContextPackStore,
} from "../../../../lib/server/research-context-pack-store.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE_HEADERS = { "cache-control": "no-store" } as const;

export type ContextPacksRouteDependencies = {
  enabled?: () => boolean;
  store?: Pick<ContextPackStore, "listPacks">;
  builder?: ContextPackBuilder;
};

export function contextPackNotFoundResponse(): NextResponse {
  return NextResponse.json(
    { ok: false, code: "context_pack_not_found", error: "context pack not found" },
    { status: 404, headers: NO_STORE_HEADERS },
  );
}

function corruptionResponse(): NextResponse {
  return NextResponse.json(
    { ok: false, code: "context_pack_corrupt", error: "context pack store unavailable" },
    { status: 500, headers: NO_STORE_HEADERS },
  );
}

function selectionConflictResponse(message: string): NextResponse {
  return NextResponse.json(
    { ok: false, code: "selection_conflict", error: message },
    { status: 409, headers: NO_STORE_HEADERS },
  );
}

export function createContextPacksRouteHandlers(
  dependencies: ContextPacksRouteDependencies = {},
) {
  const enabled = dependencies.enabled ?? caveResearchContextPacks;
  const store = dependencies.store ?? createContextPackStore();
  const builder =
    dependencies.builder ?? createContextPackBuilder();

  return {
    async GET(req: Request) {
      const forbidden = rejectNonLocalRequest(req);
      if (forbidden) {
        forbidden.headers.set("cache-control", "no-store");
        return forbidden;
      }
      if (!enabled()) return contextPackNotFoundResponse();

      try {
        // The store's listPacks already returns digest-verified manifests;
        // the route only projects them (manifests only, no blob bytes).
        const packs = await store.listPacks();
        return NextResponse.json({ ok: true, packs }, { headers: NO_STORE_HEADERS });
      } catch {
        return corruptionResponse();
      }
    },

    async POST(req: Request) {
      const forbidden = rejectNonLocalRequest(req);
      if (forbidden) {
        forbidden.headers.set("cache-control", "no-store");
        return forbidden;
      }
      if (!enabled()) return contextPackNotFoundResponse();

      const body = await readJsonBody<{ selection?: unknown; redactions?: unknown }>(req, 32 * 1024);
      if (!body.ok) {
        body.response.headers.set("cache-control", "no-store");
        return body.response;
      }
      if (!body.body.selection) {
        return NextResponse.json(
          { ok: false, code: "invalid_selection", error: "selection is required" },
          { status: 400, headers: NO_STORE_HEADERS },
        );
      }

      try {
        const pack = await builder.seal(body.body.selection, body.body.redactions);
        return NextResponse.json({ ok: true, pack }, { status: 201, headers: NO_STORE_HEADERS });
      } catch (error) {
        if (error instanceof ContextPackBuilderError) {
          if (error.code === "invalid-selection" || error.code === "invalid-redactions") {
            return NextResponse.json(
              { ok: false, code: "invalid_selection", error: error.message },
              { status: 400, headers: NO_STORE_HEADERS },
            );
          }
          if (error.code === "selection-conflict") {
            return selectionConflictResponse(error.message);
          }
          if (error.code === "confirmation-required") {
            return NextResponse.json(
              { ok: false, code: "confirmation_required", error: error.message },
              { status: 409, headers: NO_STORE_HEADERS },
            );
          }
          if (error.code === "publish-failed" && error.message.includes("immutable-conflict")) {
            return NextResponse.json(
              { ok: false, code: "immutable_conflict", error: error.message },
              { status: 409, headers: NO_STORE_HEADERS },
            );
          }
        }
        return corruptionResponse();
      }
    },
  };
}

const handlers = createContextPacksRouteHandlers();
export const GET = handlers.GET;
export const POST = handlers.POST;
