import { NextResponse } from "next/server";

import {
  AccessGroupNotFoundError,
  deleteAccessGroup,
  updateAccessGroup,
} from "@/lib/project-permissions";
import {
  invalidShapeResponse,
  memberIdsInput,
  projectGrantsInput,
  requireLocalHumanGrantMutation,
} from "../access-groups-route-shared";

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

export async function PATCH(
  req: Request,
  { params: rawParams }: { params: Promise<{ id: string }> },
) {
  const blocked = requireLocalHumanGrantMutation(req);
  if (blocked) return blocked;
  const params = await rawParams;
  const payload = await readPayload(req);
  if (payload instanceof Response) return payload;
  const rejected = rejectRelayedApproval(payload);
  if (rejected) return rejected;

  const name = payload.name === undefined
    ? undefined
    : typeof payload.name === "string"
      ? payload.name.trim()
      : "";
  if (name === "") {
    return NextResponse.json({ ok: false, error: "name must be a non-empty string" }, { status: 400 });
  }
  const description = payload.description === undefined
    ? undefined
    : payload.description === null
      ? null
      : typeof payload.description === "string"
        ? payload.description
        : undefined;
  const memberFamiliarIds = memberIdsInput(payload.memberFamiliarIds);
  const projectGrants = projectGrantsInput(payload.projectGrants);
  if (memberFamiliarIds === null || projectGrants === null) {
    return invalidShapeResponse();
  }

  try {
    const group = await updateAccessGroup({
      groupId: params.id,
      ...(name !== undefined ? { name } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(memberFamiliarIds !== undefined ? { memberFamiliarIds } : {}),
      ...(projectGrants !== undefined ? { projectGrants } : {}),
    });
    return NextResponse.json({ ok: true, group });
  } catch (error) {
    if (error instanceof AccessGroupNotFoundError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    throw error;
  }
}

export async function DELETE(
  req: Request,
  { params: rawParams }: { params: Promise<{ id: string }> },
) {
  const blocked = requireLocalHumanGrantMutation(req);
  if (blocked) return blocked;
  const params = await rawParams;
  let payload: Record<string, unknown> = {};
  try {
    payload = (await req.json()) as Record<string, unknown>;
  } catch {
    // DELETE may ship no body; that's still a valid human-confirmed request.
  }
  const rejected = rejectRelayedApproval(payload);
  if (rejected) return rejected;

  const deleted = await deleteAccessGroup(params.id);
  if (!deleted) {
    return NextResponse.json({ ok: false, error: "access group not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
