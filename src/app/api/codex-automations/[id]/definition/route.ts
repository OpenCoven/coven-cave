import { NextResponse } from "next/server";
import { toCodexAutomationPayload } from "@/lib/coven-automations-facade";
import { readRoutineDefinition } from "@/lib/server/coven-automations-client";
import { CovenAutomationsUnavailableError } from "@/lib/coven-automations-types";

export const dynamic = "force-dynamic";

/**
 * The definition Coven holds now and its revision, from one snapshot. A save
 * refused as a revision conflict reads this to show what changed before the
 * person decides whether to re-apply their edits at the newer revision.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const definition = await readRoutineDefinition(id);
    if (!definition) return NextResponse.json({ ok: false, error: "not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
    return NextResponse.json(
      { ok: true, automation: toCodexAutomationPayload(definition.routine), revision: definition.revision },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    const degraded = err instanceof CovenAutomationsUnavailableError && err.degraded;
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "unknown", ...(degraded ? { degraded: true } : {}) },
      { status: degraded ? 503 : 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
