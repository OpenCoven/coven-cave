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
// No options are passed to computeSessionsList: this route keeps the default
// behaviour it has always had, auto-archive sweeps and git enrichment included.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const includeArchived = url.searchParams.get("includeArchived") === "1";
  const familiarId = url.searchParams.get("familiarId")?.trim() || null;
  const collapseFamiliarWorkspace =
    url.searchParams.get("collapseFamiliarWorkspace") === "1";
  if (familiarId && !isValidFamiliarId(familiarId)) {
    return NextResponse.json({ ok: false, error: "invalid familiar id", sessions: [] }, { status: 400 });
  }
  // Cache per (archived, familiar, collapse) — each view differs by its result set.
  const cacheKey = `${includeArchived ? "archived" : "active"}:${familiarId ?? "all"}:${
    collapseFamiliarWorkspace ? "collapse" : "full"
  }`;
  const result = await sessionsListCache.get(cacheKey, () =>
    computeSessionsList(includeArchived, familiarId, collapseFamiliarWorkspace),
  );
  return NextResponse.json(result.payload, result.init);
}
