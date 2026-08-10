import { NextResponse } from "next/server";
import { runSearch, validateQuery, MAX_PAGE } from "@/lib/search-coordinator";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
 * Registration of real providers is deliberately NOT here: this route wires the
 * coordinator to HTTP and nothing else, so the provider set and the index
 * remain injectable and testable without a server.
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, code: "malformed-query", message: "body must be JSON" },
      { status: 400 },
    );
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json(
      { ok: false, code: "malformed-query", message: "body must be an object" },
      { status: 400 },
    );
  }

  const payload = body as Record<string, unknown>;
  const validated = validateQuery(payload.query);
  if ("code" in validated) {
    // 400 for a malformed or oversized query; an unsupported VERSION is also a
    // client-side fact, and the client already knows to fall back to plain text.
    return NextResponse.json(validated, { status: 400 });
  }

  const limitInput = Number(payload.limit);
  const limit = Number.isFinite(limitInput) ? Math.max(1, Math.min(limitInput, MAX_PAGE)) : MAX_PAGE;

  const outcome = await runSearch(
    {
      query: validated.query,
      context: {
        // Resolved by the caller's session, never trusted from the body. Until
        // the session plumbing lands (unit 6), an unrestricted context is only
        // safe because no provider is registered below.
        allowedProjectIds: null,
        allowedProjectRoots: null,
        familiarId: typeof payload.familiarId === "string" ? payload.familiarId : null,
      },
      limit,
      now: Date.now(),
    },
    {
      // No providers registered yet — units 3/3b built them, unit 6 wires the
      // real registry and the index reader. An empty set returns a truthful
      // filtered-empty rather than pretending to have searched.
      providers: [],
      readIndexed: async () => ({ rows: [], stale: false }),
    },
  );

  return NextResponse.json(outcome, { status: outcome.ok ? 200 : 400 });
}
