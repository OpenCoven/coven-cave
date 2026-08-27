import { NextResponse } from "next/server";
import { listMemoryFileEntries } from "@/lib/server/memory-file-inventory";
import { scopeMemoryFilesToFamiliar } from "@/lib/memory-file-scope";
import { listHermesMemory } from "@/lib/server/hermes-memory";
import { resolveHermesMemorySource } from "@/lib/server/hermes-memory-source";

export const dynamic = "force-dynamic";

export type { MemoryEntry } from "@/lib/server/memory-file-inventory";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const familiarId = url.searchParams.get("familiarId");
  const query = url.searchParams.get("query")?.trim() ?? "";
  if (url.searchParams.get("hermesOnly") === "1") {
    if (!familiarId) {
      return NextResponse.json(
        { ok: false, entries: [], error: "familiarId required" },
        { status: 400 },
      );
    }
    const source = await resolveHermesMemorySource(familiarId);
    if (!source.ok) {
      return NextResponse.json({
        ok: true,
        entries: [],
        hermes: { available: false, error: source.error },
      });
    }
    const hermes = await listHermesMemory({
      hermesHome: source.hermesHome,
      familiarId: source.familiarId,
      query,
    });
    return NextResponse.json({
      ok: true,
      entries: hermes.entries,
      hermes: hermes.status,
    });
  }

  const entries = await listMemoryFileEntries();

  // When a chat session asks for a specific familiar's memory, scope at the
  // source so nothing beyond that familiar's own files crosses the wire: other
  // familiars' files AND ownerless/global pools are dropped. With no
  // `familiarId` (e.g. the cross-familiar management view) the full inventory
  // is returned unchanged.
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
