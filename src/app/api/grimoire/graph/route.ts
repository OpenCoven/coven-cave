import { NextResponse } from "next/server";
import { scanGrimoireGraph } from "@/lib/server/grimoire-graph-scan";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Same shape rule the research routes apply to a familiar id. */
const FAMILIAR_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
/**
 * A scope is a familiar multiselect, so a handful of ids. The bound keeps a
 * hostile query string from making the server build a large Set and re-scan
 * against it; it is not a correctness limit.
 */
const MAX_SCOPE_IDS = 64;

/**
 * Grimoire graph — the doc graph (cave-hand), optionally scoped to familiars.
 *
 *   GET /api/grimoire/graph                         → coven-wide
 *   GET /api/grimoire/graph?familiarId=a&familiarId=b → scoped to {a, b}
 *
 * Nodes cover every knowledge entry, scanned memory file, and journal day
 * (orphans included); edges carry their generator (`link` / `mention` / `tag`).
 * `meta` reports the scan bounds so the client can say what was left out rather
 * than truncating silently.
 *
 * The scope is applied BEFORE the scan cap (cave-z6xvd), so a scoped request
 * returns that familiar's most-recent N rather than their slice of the coven's
 * most-recent N.
 *
 * On the input guard: this route previously took none, so its comment said
 * there was "no user-controlled path to guard". That is still true of the
 * filesystem — a scope id is only ever compared for equality against the
 * `familiarId` already recorded on inventory entries, and never joined into a
 * path, so an unknown id matches nothing by construction rather than by
 * validation. The shape and count checks below therefore exist to bound the
 * input and reject obvious garbage early, not to prevent traversal.
 */
export async function GET(req: Request) {
  const requested = new URL(req.url).searchParams
    .getAll("familiarId")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  if (requested.length > MAX_SCOPE_IDS) {
    return NextResponse.json(
      { ok: false, error: `at most ${MAX_SCOPE_IDS} familiarId values` },
      { status: 400 },
    );
  }
  if (requested.some((value) => !FAMILIAR_ID_RE.test(value))) {
    return NextResponse.json({ ok: false, error: "invalid familiarId" }, { status: 400 });
  }

  const { graph, meta } = await scanGrimoireGraph(new Set(requested));
  return NextResponse.json({ ok: true, nodes: graph.nodes, edges: graph.edges, meta });
}
