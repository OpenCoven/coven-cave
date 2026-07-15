import { NextResponse } from "next/server";
import type { CreateResearchMissionInput } from "@/lib/research-missions";
import { validateCreateResearchMissionInput } from "@/lib/research-missions";
import { readJsonBody, rejectNonLocalRequest } from "@/lib/server/api-security";
import {
  listAndReconcileResearchMissions,
  makeProductionResearchMissionRunner,
} from "@/lib/server/research-mission-runner";
import { isValidFamiliarId } from "@/lib/server/familiar-id";
import { MAX_SESSION_JSON_BYTES, normalizeProjectRoot } from "@/lib/server/session-security";

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
  // Resolve an explicit project root before the mission exists, so a mission is
  // never created pointing at a root its sessions can't run in.
  if (validated.value.projectRoot) {
    const resolved = normalizeProjectRoot(validated.value.projectRoot);
    if (!resolved) {
      return NextResponse.json({
        ok: false,
        error: `Project root "${validated.value.projectRoot}" is not an allowed project path. Add it as a Cave project first, or leave it empty to use the mission workspace.`,
      }, { status: 400 });
    }
    validated.value.projectRoot = resolved;
  }
  const mission = await makeProductionResearchMissionRunner().createAndStart(validated.value);
  return NextResponse.json({ ok: true, mission });
}
