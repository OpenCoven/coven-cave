import { NextResponse } from "next/server";
import { listMemoryFileEntries } from "@/lib/server/memory-file-inventory";
import { scopeMemoryFilesToFamiliar } from "@/lib/memory-file-scope";

export const dynamic = "force-dynamic";

export type { MemoryEntry } from "@/lib/server/memory-file-inventory";

export async function GET(req: Request) {
  const entries = await listMemoryFileEntries();

  // When a chat session asks for a specific familiar's memory, scope at the
  // source so another familiar's file metadata never crosses the wire: keep the
  // familiar's own files plus ownerless/global pools, drop every other
  // familiar's. With no `familiarId` (e.g. the cross-familiar management view)
  // the full inventory is returned unchanged.
  const familiarId = new URL(req.url).searchParams.get("familiarId");
  if (familiarId) {
    const scoped = scopeMemoryFilesToFamiliar(entries, familiarId);
    return NextResponse.json({
      ok: true,
      entries: scoped.visible,
      hiddenForeignCount: scoped.hiddenForeignCount,
    });
  }

  return NextResponse.json({ ok: true, entries });
}
