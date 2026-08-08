import { NextResponse } from "next/server";
import { isValidFamiliarId } from "@/lib/server/familiar-id";
import { computeSessionsList } from "@/lib/server/sessions-list";
import {
  sessionsListCache,
} from "@/lib/server/sessions-list-cache";

export const dynamic = "force-dynamic";

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
