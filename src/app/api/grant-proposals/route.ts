import { NextResponse } from "next/server";

import { isLocalOrigin } from "@/lib/server/local-origin";

import {
  ProjectAccessDeniedError,
  createGrantProposal,
  listGrantProposals,
} from "@/lib/project-permissions";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ ok: true, proposals: await listGrantProposals() });
}

export async function POST(req: Request) {
  if (!isLocalOrigin(req)) {
    return NextResponse.json(
      { ok: false, error: "grant proposals must be created from the local desktop" },
      { status: 403 },
    );
  }
  let payload: Record<string, unknown>;
  try {
    payload = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }
  const proposedBy = typeof payload.proposedBy === "string" ? payload.proposedBy.trim() : "";
  const targetFamiliarId = typeof payload.targetFamiliarId === "string"
    ? payload.targetFamiliarId.trim()
    : "";
  const projectId = typeof payload.projectId === "string" ? payload.projectId.trim() : "";
  if (!proposedBy || !targetFamiliarId || !projectId) {
    return NextResponse.json(
      { ok: false, error: "proposedBy, targetFamiliarId, and projectId are required" },
      { status: 400 },
    );
  }
  try {
    const proposal = await createGrantProposal({
      proposedBy: proposedBy,
      targetFamiliarId: targetFamiliarId,
      projectId: projectId,
      claimedHumanApproval: payload.claimedHumanApproval === true,
    });
    return NextResponse.json({ ok: true, proposal }, { status: 201 });
  } catch (error) {
    if (error instanceof ProjectAccessDeniedError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    throw error;
  }
}
