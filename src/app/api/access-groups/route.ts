import { NextResponse } from "next/server";

import { createAccessGroup, listAccessGroups } from "@/lib/project-permissions";
import {
  invalidShapeResponse,
  memberIdsInput,
  projectGrantsInput,
} from "./access-groups-route-shared";

export const dynamic = "force-dynamic";

/**
 * Access groups grant project access to every member familiar, so mutations
 * follow the same discipline as direct grants: the human confirms directly in
 * the UI. A request that carries a familiar identity (or claims relayed human
 * approval) is a familiar trying to change its own reach — reject it.
 */
function rejectRelayedApproval(payload: Record<string, unknown>): Response | null {
  if (
    payload.familiarId != null ||
    payload.proposedBy != null ||
    payload.claimedHumanApproval === true
  ) {
    return NextResponse.json(
      { ok: false, error: "access group changes must be confirmed directly by the human" },
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

export async function GET() {
  return NextResponse.json({ ok: true, accessGroups: await listAccessGroups() });
}

export async function POST(req: Request) {
  const payload = await readPayload(req);
  if (payload instanceof Response) return payload;
  const rejected = rejectRelayedApproval(payload);
  if (rejected) return rejected;

  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  if (!name) {
    return NextResponse.json({ ok: false, error: "name is required" }, { status: 400 });
  }
  const memberFamiliarIds = memberIdsInput(payload.memberFamiliarIds);
  const projectGrants = projectGrantsInput(payload.projectGrants);
  if (memberFamiliarIds === null || projectGrants === null) {
    return invalidShapeResponse();
  }

  const group = await createAccessGroup({
    name,
    ...(typeof payload.description === "string" ? { description: payload.description } : {}),
    ...(memberFamiliarIds !== undefined ? { memberFamiliarIds } : {}),
    ...(projectGrants !== undefined ? { projectGrants } : {}),
  });
  return NextResponse.json({ ok: true, group });
}
