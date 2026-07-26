import { NextResponse } from "next/server";

import type { ProjectAccessLevel } from "@/lib/project-permissions";
import { isLocalOrigin } from "@/lib/server/local-origin";

/**
 * Access-group mutations are the same class as direct project grants (a group
 * grant is a real grant to every member), so they get the same PR #3306 gate:
 * only a local desktop request may mutate — mobile/tailnet requests are
 * rejected even if their Host is spoofed to loopback.
 */
export function requireLocalHumanGrantMutation(req: Request): Response | null {
  if (isLocalOrigin(req)) return null;
  return NextResponse.json(
    { ok: false, error: "access group changes must be confirmed from the local desktop" },
    { status: 403 },
  );
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
