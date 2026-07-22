import { NextResponse } from "next/server";
import {
  allowedResearchActions,
  type ResearchMissionActionInput,
  type ResearchMissionStatus,
} from "@/lib/research-missions";
import { readJsonBody, rejectNonLocalRequest } from "@/lib/server/api-security";
import { makeProductionResearchMissionRunner } from "@/lib/server/research-mission-runner";
import { isValidResearchMissionId } from "@/lib/server/research-mission-store";
import { MAX_SESSION_JSON_BYTES } from "@/lib/server/session-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Lifecycle actions are derived from the domain's allowedResearchActions so
// this route can never drift from what the runner will actually perform (a
// hand-copied list previously accepted a pause action no mission status ever
// allows — a silent no-op 200). The status list mirrors ResearchMissionStatus;
// a typo or removed status fails typecheck.
const MISSION_STATUSES: ResearchMissionStatus[] = [
  "queued", "planning", "running", "checkpoint", "paused",
  "completed", "failed", "cancelled", "archived",
];
const ACTIONS = new Set<string>([
  ...MISSION_STATUSES.flatMap((status) => allowedResearchActions({ status })),
  "attach-source", "update-source", "reject-artifact",
]);

// Messages the runner throws when the CLIENT sent a bad request (invalid
// payload fields, unknown source/artifact ids). Anything else that throws is
// an internal failure — fs errors, bugs — and must surface as a 500 instead
// of masquerading as a client error.
const VALIDATION_ERRORS = new Set([
  "Source id and title are required",
  "Source requires a safe URL or absolute local path",
  "Source confidence must be between 0 and 1",
  "artifact rejection reason required",
  "research artifact not found",
  "research source not found",
  "refined direction required",
  "invalid project root override",
]);

function actionErrorStatus(message: string): number {
  if (message === "research mission not found") return 404;
  // Manual runs are refused while the linked automation is ACTIVE — a state
  // conflict the user resolves by pausing the schedule, not a bad request.
  if (message === "pause the linked automation before running manually") return 409;
  if (
    VALIDATION_ERRORS.has(message) ||
    // Retry project-root rejections carry the offending path; source-patch
    // rejections carry the offending field ("invalid source status",
    // "invalid source patch field: url", …).
    message.startsWith('Project root "') ||
    message.startsWith("invalid source")
  ) {
    return 400;
  }
  return 500;
}

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
    return NextResponse.json(
      { ok: false, error: message },
      { status: actionErrorStatus(message) },
    );
  }
}
