import { NextResponse } from "next/server.js";

import { caveResearchContextPacks } from "../../../../../lib/feature-flags.ts";
import { parseContextPackV1 } from "../../../../../lib/research-protocol/context-pack.ts";
import { rejectNonLocalRequest } from "../../../../../lib/server/api-security.ts";
import {
  ContextPackStoreError,
  createContextPackStore,
  type ContextPackStore,
} from "../../../../../lib/server/research-context-pack-store.ts";
import { contextPackNotFoundResponse } from "../route.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE_HEADERS = { "cache-control": "no-store" } as const;

type Params = { params: Promise<{ id: string }> };

export type ContextPackItemRouteDependencies = {
  enabled?: () => boolean;
  store?: ContextPackStore;
};

function corruptionResponse(): NextResponse {
  return NextResponse.json(
    { ok: false, code: "context_pack_corrupt", error: "context pack store unavailable" },
    { status: 500, headers: NO_STORE_HEADERS },
  );
}

export function createContextPackItemRouteHandlers(
  dependencies: ContextPackItemRouteDependencies = {},
) {
  const enabled = dependencies.enabled ?? caveResearchContextPacks;
  const store = dependencies.store ?? createContextPackStore();

  return {
    async GET(req: Request, { params }: Params) {
      const forbidden = rejectNonLocalRequest(req);
      if (forbidden) {
        forbidden.headers.set("cache-control", "no-store");
        return forbidden;
      }
      if (!enabled()) return contextPackNotFoundResponse();
      const { id } = await params;
      try {
        const validated = await store.validatePack(id);
        if (!validated.valid) return contextPackNotFoundResponse();
        const read = await store.readPack(id);
        const checked = parseContextPackV1(read.pack);
        if (!checked.ok) return corruptionResponse();
        // Manifests only — no blob bytes are ever served.
        return NextResponse.json({ ok: true, pack: checked.value }, { headers: NO_STORE_HEADERS });
      } catch (error) {
        if (error instanceof ContextPackStoreError && error.code === "missing") {
          return contextPackNotFoundResponse();
        }
        if (error instanceof ContextPackStoreError && error.code === "invalid-id") {
          return NextResponse.json(
            { ok: false, code: "invalid_context_pack_id", error: error.message },
            { status: 400, headers: NO_STORE_HEADERS },
          );
        }
        return corruptionResponse();
      }
    },

    async DELETE(req: Request, { params }: Params) {
      const forbidden = rejectNonLocalRequest(req);
      if (forbidden) {
        forbidden.headers.set("cache-control", "no-store");
        return forbidden;
      }
      if (!enabled()) return contextPackNotFoundResponse();
      const { id } = await params;
      try {
        const result = await store.deletePack(id);
        if (!result.deleted) return contextPackNotFoundResponse();
        return NextResponse.json({ ok: true }, { headers: NO_STORE_HEADERS });
      } catch (error) {
        if (error instanceof ContextPackStoreError && error.code === "missing") {
          return contextPackNotFoundResponse();
        }
        if (error instanceof ContextPackStoreError && error.code === "invalid-id") {
          return NextResponse.json(
            { ok: false, code: "invalid_context_pack_id", error: error.message },
            { status: 400, headers: NO_STORE_HEADERS },
          );
        }
        return corruptionResponse();
      }
    },
  };
}

const handlers = createContextPackItemRouteHandlers();
export const GET = handlers.GET;
export const DELETE = handlers.DELETE;
