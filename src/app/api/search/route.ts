import { NextResponse } from "next/server";
import { readJsonBody } from "@/lib/server/api-security";
import { runSearch, validateQuery, MAX_PAGE } from "@/lib/search-coordinator";
import { createServerSearchSetup } from "@/lib/server/search-runtime";
import { loadVisibleFamiliarRoster } from "@/lib/server/familiar-roster";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Bounded request body — a query AST is small; anything larger is not one. */
const MAX_BODY_BYTES = 64 * 1024;

/**
 * POST /api/search — the search coordinator's HTTP surface (cave-ychtl.4).
 *
 * POST rather than GET because a query AST carries nested filters and scopes;
 * URL-encoding them would invent a second serialization alongside the canonical
 * one the client already owns for shareable links.
 *
 * The response distinguishes the empty states the spec requires to be told
 * apart — no matches, a filter nothing can honor, an index still warming,
 * stale results, a provider that could not be searched, permission denied —
 * because collapsing them into one empty array is what makes a search surface
 * feel broken rather than honest.
 *
 * Provider registration lives in @/lib/server/search-runtime (cave-ychtl.6):
 * this route wires the coordinator to HTTP and to that registry, keeping the
 * provider set and the index injectable and testable without a server.
 */
export async function POST(req: Request) {
  // The shared helper, not a hand-rolled req.json(): it enforces
  // application/json, caps the body size, and returns the repo's standard
  // invalid-JSON response. Rolling our own skipped all three — notably the
  // size cap the spec requires of every search request.
  const body = await readJsonBody<Record<string, unknown>>(req, MAX_BODY_BYTES);
  if (!body.ok) return body.response;

  const payload = body.body;
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return NextResponse.json(
      { ok: false, code: "malformed-query", message: "body must be an object" },
      { status: 400 },
    );
  }
  const validated = validateQuery(payload.query);
  if (!validated.ok) {
    // 400 for a malformed or oversized query; an unsupported VERSION is also a
    // client-side fact, and the client already knows to fall back to plain text.
    return NextResponse.json(validated, { status: 400 });
  }

  const limitInput = Number(payload.limit);
  const limit = Number.isFinite(limitInput) ? Math.max(1, Math.min(limitInput, MAX_PAGE)) : MAX_PAGE;

  // Unit 6 wires the real registry and the index reader: providers built from
  // the saved project/board/conversation/familiar stores plus the live file
  // provider, and a lazy per-process FTS5 index that refreshes only when a
  // provider fingerprint moves. Allowed project ids are resolved server-side
  // from the saved project store — never trusted from the body — and the
  // coordinator re-applies them before ranking.
  //
  // Familiar access is roster-wide (the local user owns their whole roster):
  // resolved from the visible roster rather than trusted from the body, so a
  // familiar-scoped row is never readable because a client CLAIMED a familiar.
  // The optional body familiar id only selects the single-familiar pin for
  // scoped surfaces; roster access keeps global broadening inclusive.
  const roster = await loadVisibleFamiliarRoster();
  const familiarIds = roster.ok ? roster.roster.map((familiar) => familiar.id) : [];
  const setup = await createServerSearchSetup(validated.query, { familiarIds });
  const outcome = await runSearch(
    {
      query: validated.query,
      context: setup.requesterContext,
      limit,
      now: Date.now(),
    },
    {
      providers: setup.providers,
      readIndexed: setup.readIndexed,
    },
  );

  return NextResponse.json(outcome, { status: outcome.ok ? 200 : 400 });
}
