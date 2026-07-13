import { NextResponse } from "next/server";

import type { ProjectAccessLevel } from "@/lib/project-permissions";

/**
 * Access groups grant project access to every member familiar, so mutations
 * follow the same discipline as direct grants: the human confirms directly in
 * the UI. A request that carries a familiar identity (or claims relayed human
 * approval) is a familiar trying to change its own reach — reject it.
 */
export function rejectRelayedApproval(payload: Record<string, unknown>): Response | null {
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

export async function readPayload(req: Request): Promise<Record<string, unknown> | Response> {
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }
}

/** undefined = field absent; null = present but malformed. */
export function memberIdsInput(value: unknown): string[] | null | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return null;
  const members: string[] = [];
  for (const raw of value) {
    if (typeof raw !== "string") return null;
    members.push(raw);
  }
  return members;
}

/** undefined = field absent; null = present but malformed. */
export function projectGrantsInput(
  value: unknown,
): { projectId: string; access: ProjectAccessLevel }[] | null | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return null;
  const grants: { projectId: string; access: ProjectAccessLevel }[] = [];
  for (const raw of value) {
    const projectId = typeof (raw as { projectId?: unknown })?.projectId === "string"
      ? (raw as { projectId: string }).projectId.trim()
      : "";
    const access = (raw as { access?: unknown })?.access ?? "write";
    if (!projectId || (access !== "read" && access !== "write")) return null;
    grants.push({ projectId, access });
  }
  return grants;
}

export function invalidShapeResponse(): Response {
  return NextResponse.json(
    {
      ok: false,
      error:
        "memberFamiliarIds must be strings and projectGrants need a projectId with access read|write",
    },
    { status: 400 },
  );
}
