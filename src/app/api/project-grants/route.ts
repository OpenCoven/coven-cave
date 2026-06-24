import { NextResponse } from "next/server";

import {
  grantProjectToFamiliar,
  listProjectGrants,
  loadHumanPermissionConfig,
  revokeProjectFromFamiliar,
} from "@/lib/project-permissions";

export const dynamic = "force-dynamic";

function rejectRelayedApproval(payload: Record<string, unknown>): Response | null {
  if (
    payload.familiarId != null ||
    payload.proposedBy != null ||
    payload.claimedHumanApproval === true
  ) {
    return NextResponse.json(
      { ok: false, error: "grant changes must be confirmed directly by the human" },
      { status: 403 },
    );
  }
  return null;
}

async function readPayload(req: Request): Promise<Record<string, unknown> | Response> {
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }
}

function grantInput(payload: Record<string, unknown>) {
  const targetFamiliarId = typeof payload.targetFamiliarId === "string"
    ? payload.targetFamiliarId.trim()
    : "";
  const projectId = typeof payload.projectId === "string" ? payload.projectId.trim() : "";
  if (!targetFamiliarId || !projectId) return null;
  return { familiarId: targetFamiliarId, projectId };
}

export async function GET() {
  const [grants, config] = await Promise.all([
    listProjectGrants(),
    loadHumanPermissionConfig(),
  ]);
  // `supremeFamiliarId` has access to every project regardless of grants — the
  // Permissions UI marks it as all-access and locks its toggles on.
  return NextResponse.json({ ok: true, grants, supremeFamiliarId: config.supremeFamiliarId });
}

export async function POST(req: Request) {
  const payload = await readPayload(req);
  if (payload instanceof Response) return payload;
  const rejected = rejectRelayedApproval(payload);
  if (rejected) return rejected;
  const input = grantInput(payload);
  if (!input) {
    return NextResponse.json(
      { ok: false, error: "targetFamiliarId and projectId are required" },
      { status: 400 },
    );
  }
  await grantProjectToFamiliar({ ...input, source: "human" });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const payload = await readPayload(req);
  if (payload instanceof Response) return payload;
  const rejected = rejectRelayedApproval(payload);
  if (rejected) return rejected;
  const input = grantInput(payload);
  if (!input) {
    return NextResponse.json(
      { ok: false, error: "targetFamiliarId and projectId are required" },
      { status: 400 },
    );
  }
  const revoked = await revokeProjectFromFamiliar(input);
  return NextResponse.json({ ok: true, revoked });
}
