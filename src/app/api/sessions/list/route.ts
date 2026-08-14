import { NextResponse } from "next/server";
import { getCanonicalSessionList } from "@/lib/server/client-v1/read-model";
import { isValidFamiliarId } from "@/lib/server/familiar-id";

export const dynamic = "force-dynamic";

// The canonical merge/grant-scoping/degraded-fallback projection itself lives
// in @/lib/server/client-v1/read-model (`computeCanonicalSessionList`) — this
// route is now a thin query-parsing wrapper around `getCanonicalSessionList`,
// the SAME cached accessor the new `/api/client/v1` read routes (cave-client-v1
// plan, Task 5) use for their list/detail/search reads, so both surfaces
// share the exact same canonical computation AND the exact same cache entry
// rather than a forked reimplementation or a forked cache.
//
// Stale-while-revalidate caching (cave-5m1c) + mutation invalidation
// (cave-53yx) live behind `getCanonicalSessionList` in
// @/lib/server/client-v1/read-model, over the shared singleton in
// @/lib/server/sessions-list-cache — a route file may only export handlers,
// and session mutators must be able to bust the cache so post-mutation
// refreshes never serve the pre-mutation list.

export async function GET(req: Request) {
  const url = new URL(req.url);
  const includeArchived = url.searchParams.get("includeArchived") === "1";
  const familiarId = url.searchParams.get("familiarId")?.trim() || null;
  const collapseFamiliarWorkspace =
    url.searchParams.get("collapseFamiliarWorkspace") === "1";
  if (familiarId && !isValidFamiliarId(familiarId)) {
    return NextResponse.json({ ok: false, error: "invalid familiar id", sessions: [] }, { status: 400 });
  }
  try {
    const result = await getCanonicalSessionList(includeArchived, familiarId, collapseFamiliarWorkspace);
    return NextResponse.json(result.payload, result.init);
  } catch {
    return NextResponse.json(
      { ok: false, error: "sessions are temporarily unavailable", sessions: [] },
      { status: 503 },
    );
  }
}
