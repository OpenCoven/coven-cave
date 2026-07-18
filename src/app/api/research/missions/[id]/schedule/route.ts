import { NextResponse } from "next/server";
import { readJsonBody, rejectNonLocalRequest } from "@/lib/server/api-security";
import {
  makeProductionResearchMissionRunner,
  type ResearchAutomationScheduleInput,
} from "@/lib/server/research-mission-runner";
import { isValidResearchMissionId } from "@/lib/server/research-mission-store";
import { MAX_SESSION_JSON_BYTES } from "@/lib/server/session-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
  const parsed = await readJsonBody<ResearchAutomationScheduleInput>(req, MAX_SESSION_JSON_BYTES);
  if (!parsed.ok) return parsed.response;
  if (!parsed.body || typeof parsed.body.rrule !== "string") {
    return NextResponse.json({ ok: false, error: "automation schedule required" }, { status: 400 });
  }
  try {
    const runner = makeProductionResearchMissionRunner();
    const mission = await runner.schedule(id, parsed.body);
    return NextResponse.json({ ok: true, mission });
  } catch (error) {
    const message = error instanceof Error ? error.message : "research schedule failed";
    const status = message === "research mission not found" ? 404 : 400;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
