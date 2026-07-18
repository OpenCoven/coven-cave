import { NextResponse } from "next/server";
import type { ResearchMissionActionInput } from "@/lib/research-missions";
import { readJsonBody, rejectNonLocalRequest } from "@/lib/server/api-security";
import { makeProductionResearchMissionRunner } from "@/lib/server/research-mission-runner";
import { isValidResearchMissionId } from "@/lib/server/research-mission-store";
import { MAX_SESSION_JSON_BYTES } from "@/lib/server/session-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ACTIONS = new Set([
  "retry", "continue", "refine", "finish", "pause", "resume", "cancel", "archive",
  "attach-source", "update-source", "reject-artifact",
]);

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;
  const { id } = await context.params;
  if (!isValidResearchMissionId(id)) {
    return NextResponse.json({ ok: false, error: "path not allowed" }, { status: 403 });
  }
  const parsed = await readJsonBody<ResearchMissionActionInput>(req, MAX_SESSION_JSON_BYTES);
  if (!parsed.ok) return parsed.response;
  if (!parsed.body || typeof parsed.body.action !== "string" || !ACTIONS.has(parsed.body.action)) {
    return NextResponse.json({ ok: false, error: "invalid research action" }, { status: 400 });
  }
  try {
    const runner = makeProductionResearchMissionRunner();
    const mission = await runner.act(id, parsed.body);
    return NextResponse.json({ ok: true, mission });
  } catch (error) {
    const message = error instanceof Error ? error.message : "research action failed";
    const status = message === "research mission not found" ? 404 : 400;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
