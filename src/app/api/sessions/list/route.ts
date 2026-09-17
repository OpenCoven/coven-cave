import { NextResponse } from "next/server";
import { isValidFamiliarId } from "@/lib/server/familiar-id";
import { computeSessionsList } from "@/lib/server/sessions-list";
import { sessionsListCache } from "@/lib/server/sessions-list-cache";

export const dynamic = "force-dynamic";

// The computation moved to @/lib/server/sessions-list (cave-9rwd.1) so the
// Familiar dashboard read can reuse it without self-fetching this route. What
// stays here is what is genuinely route-shaped: query parsing, the familiar id
// guard, and ownership of the shared SWR cache.
//
// Stale-while-revalidate cache (cave-5m1c) + mutation invalidation (cave-53yx)
// live in @/lib/server/sessions-list-cache — a route file may only export
// handlers, and session mutators must be able to bust the cache so
// post-mutation refreshes never serve the pre-mutation list.
//
// The route forwards only the opt-in familiar-workspace metadata toggle.
// Auto-archive sweeps and git enrichment still come from computeSessionsList's
// defaults, preserving the polling behaviour this route has always owned.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const includeArchived = url.searchParams.get("includeArchived") === "1";
  const familiarId = url.searchParams.get("familiarId")?.trim() || null;
  const collapseFamiliarWorkspace =
    url.searchParams.get("collapseFamiliarWorkspace") === "1";
  const classifyFamiliarWorkspace =
    url.searchParams.get("classifyFamiliarWorkspace") === "1";
  if (familiarId && !isValidFamiliarId(familiarId)) {
    return NextResponse.json({ ok: false, error: "invalid familiar id", sessions: [] }, { status: 400 });
  }
  // Cache per (archived, familiar, collapse, classification) — these views
  // differ both by membership and by whether trusted familiar metadata is present.
  const cacheKey = `${includeArchived ? "archived" : "active"}:${familiarId ?? "all"}:${
    collapseFamiliarWorkspace ? "collapse" : "full"
  }:${classifyFamiliarWorkspace ? "classified" : "unclassified"}`;
  const result = await sessionsListCache.get(cacheKey, () =>
    computeSessionsList(includeArchived, familiarId, collapseFamiliarWorkspace, { classifyFamiliarWorkspace }),
  );
  return NextResponse.json(result.payload, result.init);
}
