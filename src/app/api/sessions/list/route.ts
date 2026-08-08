import { NextResponse } from "next/server";
import { isValidFamiliarId } from "@/lib/server/familiar-id";
import {
  loadCachedSessionsList,
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
  const result = await loadCachedSessionsList(
    includeArchived,
    familiarId,
    collapseFamiliarWorkspace,
  );
  return NextResponse.json(result.payload, result.init);
}
