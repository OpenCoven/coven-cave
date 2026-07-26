import { NextResponse } from "next/server";
import { scanGrimoireGraph } from "@/lib/server/grimoire-graph-scan";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Grimoire graph — the full-corpus doc graph (cave-hand).
 *
 *   GET /api/grimoire/graph → { ok, nodes, edges, meta }
 *
 * Nodes cover every knowledge entry, scanned memory file, and journal day
 * (orphans included); edges carry their generator (`link` / `mention` / `tag`).
 * `meta` reports the scan bounds so the client can say what was left out
 * rather than truncating silently. Takes no input, so there is no
 * user-controlled path to guard.
 */
export async function GET() {
  const { graph, meta } = await scanGrimoireGraph();
  return NextResponse.json({ ok: true, nodes: graph.nodes, edges: graph.edges, meta });
}
