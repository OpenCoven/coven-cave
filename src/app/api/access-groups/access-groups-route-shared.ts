import { NextResponse } from "next/server";

import type { ProjectAccessLevel } from "@/lib/project-permissions";

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
