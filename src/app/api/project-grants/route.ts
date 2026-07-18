import { NextResponse } from "next/server";

import { isLocalOrigin } from "@/lib/server/local-origin";

import {
  grantProjectToFamiliar,
  listAccessGroups,
  listProjectGrants,
  listRecentPermissionAudit,
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

function requireLocalHumanGrantMutation(req: Request): Response | null {
  if (isLocalOrigin(req)) return null;
  return NextResponse.json(
    { ok: false, error: "grant changes must be confirmed from the local desktop" },
    { status: 403 },
  );
}

function grantInput(payload: Record<string, unknown>) {
  const targetFamiliarId = typeof payload.targetFamiliarId === "string"
    ? payload.targetFamiliarId.trim()
    : "";
  const projectId = typeof payload.projectId === "string" ? payload.projectId.trim() : "";
  if (!targetFamiliarId || !projectId) return null;
  return { familiarId: targetFamiliarId, projectId };
}

function accessInput(payload: Record<string, unknown>): "read" | "write" | null {
  if (payload.access === undefined) return "write";
  if (payload.access === "read" || payload.access === "write") return payload.access;
  return null;
}

export async function GET() {
  const [grants, config, audit, accessGroups] = await Promise.all([
    listProjectGrants(),
    loadHumanPermissionConfig(),
    listRecentPermissionAudit(),
    listAccessGroups(),
  ]);
  // `supremeFamiliarId` has access to every project regardless of grants — the
  // Permissions UI marks it as all-access and locks its toggles on. `audit` is a
  // bounded recent window of access decisions for the console's audit log.
  // `accessGroups` ride along so one fetch can render effective (direct + group)
  // access.
  return NextResponse.json({
    ok: true,
    grants,
    accessGroups,
    supremeFamiliarId: config.supremeFamiliarId,
    audit,
  });
}

export async function POST(req: Request) {
  const blocked = requireLocalHumanGrantMutation(req);
  if (blocked) return blocked;
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
  const access = accessInput(payload);
  if (!access) {
    return NextResponse.json(
      { ok: false, error: "access must be \"read\" or \"write\"" },
      { status: 400 },
    );
  }
  await grantProjectToFamiliar({ ...input, source: "human", access });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const blocked = requireLocalHumanGrantMutation(req);
  if (blocked) return blocked;
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
