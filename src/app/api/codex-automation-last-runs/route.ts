import { NextResponse } from "next/server";
import { listRoutineRuns } from "@/lib/server/coven-automations-client";
import { parseLastRunIds, readLastRuns } from "@/lib/server/automation-last-runs";

export const dynamic = "force-dynamic";

/**
 * GET /api/codex-automation-last-runs?id=a&id=b → { ok, runs: { a: run|null, b: … } }
 *
 * The newest run of each automation in one request (#5687). This lives outside
 * /api/codex-automations/ so a static segment can never shadow an automation
 * whose id matches it under the [id] routes.
 */
export async function GET(req: Request) {
  const parsed = parseLastRunIds(new URL(req.url).searchParams);
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  }
  const result = await readLastRuns(parsed.ids, (id, limit) => listRoutineRuns(id, limit));
  return NextResponse.json(result, { status: result.ok ? 200 : 503 });
}
