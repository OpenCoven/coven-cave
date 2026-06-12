import { NextResponse } from "next/server";
import { readFile, writeFile } from "node:fs/promises";
import { parseRoleListField, setRoleListField } from "@/lib/role-manifest";
import { discoverRoleFiles } from "@/lib/role-source";

export const dynamic = "force-dynamic";

function safeSegment(value: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{0,80}$/i.test(value);
}

async function resolveRoleMd(roleId: string, familiar: string): Promise<string | null> {
  const role = (await discoverRoleFiles()).find((entry) => entry.id === roleId && entry.familiar === familiar);
  return role?.path ?? null;
}

/**
 * Attach or detach a workflow on a role by rewriting the `workflows:` list
 * block in its ROLE.md — the canonical home of role composition.
 */
export async function POST(req: Request) {
  let body: { roleId?: string; familiar?: string; workflowId?: string; attach?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }
  const { roleId, familiar, workflowId, attach } = body;
  if (!roleId || !familiar || !workflowId || typeof attach !== "boolean") {
    return NextResponse.json(
      { ok: false, error: "roleId, familiar, workflowId, and attach required" },
      { status: 400 },
    );
  }
  if (!safeSegment(roleId) || !safeSegment(familiar) || !safeSegment(workflowId)) {
    return NextResponse.json({ ok: false, error: "unsafe roleId, familiar, or workflowId" }, { status: 400 });
  }

  const roleMdPath = await resolveRoleMd(roleId, familiar);
  if (!roleMdPath) {
    return NextResponse.json({ ok: false, error: `role ${familiar}:${roleId} not found` }, { status: 404 });
  }

  try {
    const text = await readFile(roleMdPath, "utf8");
    const current = parseRoleListField(text, "workflows");
    const next = attach
      ? current.includes(workflowId)
        ? current
        : [...current, workflowId]
      : current.filter((id) => id !== workflowId);
    const updated = setRoleListField(text, "workflows", next);
    if (updated !== text) {
      await writeFile(roleMdPath, updated, "utf8");
    }
    return NextResponse.json({ ok: true, workflows: next });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "role update failed" },
      { status: 500 },
    );
  }
}
