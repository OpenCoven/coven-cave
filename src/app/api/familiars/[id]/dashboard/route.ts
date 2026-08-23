import { NextResponse } from "next/server";
import {
  FAMILIAR_DASHBOARD_LIMITS,
  FAMILIAR_DASHBOARD_VERSION,
  serializedDashboardBytes,
  type FamiliarDashboardFailure,
} from "@/lib/familiar-dashboard";
import { isValidFamiliarId } from "@/lib/server/familiar-id";
import {
  loadFamiliarDashboard,
  type FamiliarDashboardDependencies,
} from "@/lib/server/familiar-dashboard-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/familiars/[id]/dashboard?v=1
 *
 * One coherent read snapshot for a Familiar hub: identity plus an Overview,
 * Profile and Analytics section, each carrying its own honest state. The shape
 * and every rule about that state live in `@/lib/familiar-dashboard`; the
 * assembly lives in `@/lib/server/familiar-dashboard-data`. This file is only
 * the HTTP mapping.
 *
 * It does NOT call Cave's own HTTP endpoints. See the loader's module note for
 * why a self-fetch would be wrong here specifically (the sessions route mutates
 * cave state as a side effect of being polled).
 *
 * ## Statuses, and why 403 rather than 404 for a bad id
 *
 *   403 — the id is not a valid familiar slug.
 *   404 — the id is well-formed but names no familiar in this Cave's roster.
 *   400 — an explicit `v` that this build does not serve.
 *   503 — the roster itself could not be read, so existence is unknown.
 *   200 — a real familiar, fully or partially loaded.
 *
 * The 403 is not a probing defence — a well-formed unknown id already answers
 * 404, so the surface is enumerable either way and pretending otherwise would
 * be security theatre. It is a REFUSAL: `id` is interpolated into a filesystem
 * path by the contract-file and self-report loaders downstream, so an id that
 * fails the slug guard is a request this route will not attempt at all. 404
 * would mean "I looked and found nothing", and nothing was looked at.
 *
 * That distinction and the exact `path not allowed` wording match every sibling
 * under `/api/familiars/[id]/` — avatar, contract, notes, self-reports — which
 * is what a client already switching on `error` expects. A machine-readable
 * `code` rides alongside for a client that would rather not match on prose.
 */

function refuse(
  code: FamiliarDashboardFailure["code"],
  error: string,
  status: number,
): NextResponse {
  return NextResponse.json({ ok: false, error, code } satisfies FamiliarDashboardFailure, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export function createFamiliarDashboardGetHandler(
  dependencies?: FamiliarDashboardDependencies,
) {
  return async function familiarDashboardGet(
    req: Request,
    ctx: { params: Promise<{ id: string }> },
  ): Promise<NextResponse> {
    const { id } = await ctx.params;
    if (!id || !isValidFamiliarId(id)) {
      // Written out rather than routed through `refuse` so the guard, its
      // wording and its status sit together at the top of the handler, exactly
      // as they do in every sibling under /api/familiars/[id]/. This is the one
      // refusal that must be readable without following a helper: everything
      // below it interpolates `id` into a filesystem path.
      return NextResponse.json(
        {
          ok: false,
          error: "path not allowed",
          code: "invalid_familiar_id",
        } satisfies FamiliarDashboardFailure,
        { status: 403, headers: { "Cache-Control": "no-store" } },
      );
    }

    // An absent `v` means "whatever this build serves" — the response states its
    // own version, so an unversioned client is never lied to. An explicit `v`
    // this build cannot serve is refused rather than silently answered with a
    // different shape, which is the failure mode versioning exists to prevent.
    const requested = new URL(req.url).searchParams.get("v");
    if (requested !== null && requested !== String(FAMILIAR_DASHBOARD_VERSION)) {
      return refuse("unsupported_version", "unsupported dashboard version", 400);
    }

    const result = await loadFamiliarDashboard({ familiarId: id, dependencies });
    if (result.outcome === "not_found") {
      return refuse("familiar_not_found", `No familiar "${id}".`, 404);
    }
    if (result.outcome === "unavailable") {
      return refuse("dashboard_unavailable", "The Familiar dashboard is unavailable.", 503);
    }

    // The loader already enforced the budget. Re-checked here because this is
    // the boundary the promise is actually made at: a future caller that builds
    // a response some other way must not be able to exceed it unnoticed.
    const bytes = serializedDashboardBytes(result.response);
    if (bytes > FAMILIAR_DASHBOARD_LIMITS.responseBytes) {
      return refuse("dashboard_unavailable", "The Familiar dashboard is unavailable.", 503);
    }

    return NextResponse.json(result.response, {
      headers: { "Cache-Control": "no-store" },
    });
  };
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  return createFamiliarDashboardGetHandler()(req, ctx);
}
