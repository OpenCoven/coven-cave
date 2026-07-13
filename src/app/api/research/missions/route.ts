import { NextResponse } from "next/server";
import type { CreateResearchMissionInput } from "@/lib/research-missions";
import { validateCreateResearchMissionInput } from "@/lib/research-missions";
import { readJsonBody, rejectNonLocalRequest } from "@/lib/server/api-security";
import {
  listAndReconcileResearchMissions,
  makeProductionResearchMissionRunner,
} from "@/lib/server/research-mission-runner";
import { isValidFamiliarId } from "@/lib/server/familiar-id";
import { MAX_SESSION_JSON_BYTES } from "@/lib/server/session-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;
  const familiarId = new URL(req.url).searchParams.get("familiarId")?.trim() ?? "";
  if (!familiarId) {
    return NextResponse.json({ ok: false, error: "familiarId required" }, { status: 400 });
  }
  if (!isValidFamiliarId(familiarId)) {
    return NextResponse.json({ ok: false, error: "path not allowed" }, { status: 403 });
  }
  const missions = await listAndReconcileResearchMissions(familiarId);
  return NextResponse.json({ ok: true, missions });
}

export async function POST(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;
  const parsed = await readJsonBody<CreateResearchMissionInput>(req, MAX_SESSION_JSON_BYTES);
  if (!parsed.ok) return parsed.response;
  const validated = validateCreateResearchMissionInput(parsed.body);
  if (!validated.ok) {
    return NextResponse.json({ ok: false, error: validated.error }, { status: 400 });
  }
  const mission = await makeProductionResearchMissionRunner().createAndStart(validated.value);
  return NextResponse.json({ ok: true, mission });
}
