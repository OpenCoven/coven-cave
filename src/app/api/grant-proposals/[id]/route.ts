import { NextResponse } from "next/server";

import {
  ProjectAccessDeniedError,
  resolveGrantProposal,
  undoGrantProposal,
} from "@/lib/project-permissions";

export const dynamic = "force-dynamic";

function rejectRelayedApproval(payload: Record<string, unknown>): Response | null {
  if (
    payload.familiarId != null ||
    payload.proposedBy != null ||
    payload.claimedHumanApproval === true
  ) {
    return NextResponse.json(
      { ok: false, error: "proposal decisions must be confirmed directly by the human" },
      { status: 403 },
    );
  }
  return null;
}

export async function PATCH(
  req: Request,
  { params: rawParams }: { params: Promise<{ id: string }> },
) {
  const params = await rawParams;
  let payload: Record<string, unknown>;
  try {
    payload = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }
  const rejected = rejectRelayedApproval(payload);
  if (rejected) return rejected;
  const decision =
    payload.decision === "accepted" ||
    payload.decision === "rejected" ||
    payload.decision === "undo"
      ? payload.decision
      : null;
  if (!decision) {
    return NextResponse.json(
      { ok: false, error: "decision must be accepted, rejected, or undo" },
      { status: 400 },
    );
  }
  try {
    const proposal = decision === "undo"
      ? await undoGrantProposal({ proposalId: params.id })
      : await resolveGrantProposal({
          proposalId: params.id,
          decision,
        });
    return NextResponse.json({ ok: true, proposal });
  } catch (error) {
    if (error instanceof ProjectAccessDeniedError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    throw error;
  }
}
