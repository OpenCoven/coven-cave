import { NextResponse } from "next/server";

import { createAccessGroup, listAccessGroups } from "@/lib/project-permissions";
import {
  invalidShapeResponse,
  memberIdsInput,
  projectGrantsInput,
  readPayload,
  rejectRelayedApproval,
} from "./access-groups-route-shared";

export const dynamic = "force-dynamic";

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
