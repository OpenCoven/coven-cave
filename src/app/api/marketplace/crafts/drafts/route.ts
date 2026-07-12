import { NextResponse } from "next/server";
import { buildCraftDraftFromRoles } from "@/lib/craft-draft";
import { readCraftDrafts, saveCraftDraft } from "@/lib/server/craft-drafts";
import { loadRoleEntries } from "@/lib/server/role-entries";
import { readJsonBody, rejectNonLocalRequest } from "@/lib/server/api-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 16 * 1024;

type DraftBody = {
  familiar?: unknown;
  roleIds?: unknown;
};

export async function GET(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;
  return NextResponse.json({ ok: true, drafts: await readCraftDrafts() });
}

export async function POST(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;
  const parsed = await readJsonBody<DraftBody>(req, MAX_BODY_BYTES);
  if (!parsed.ok) return parsed.response;

  const familiar = typeof parsed.body.familiar === "string" ? parsed.body.familiar.trim() : "";
  const roleIds = Array.isArray(parsed.body.roleIds)
    ? parsed.body.roleIds.filter((id): id is string => typeof id === "string").map((id) => id.trim()).filter(Boolean)
    : [];
  if (!familiar || roleIds.length === 0) {
    return NextResponse.json(
      { ok: false, error: "familiar and roleIds required" },
      { status: 400 },
    );
  }

  const roleIdSet = new Set(roleIds);
  const roles = (await loadRoleEntries()).filter((role) => (
    role.familiar === familiar && roleIdSet.has(role.id)
  ));
  if (roles.length === 0) {
    return NextResponse.json({ ok: false, error: "no matching roles" }, { status: 404 });
  }

  const draft = buildCraftDraftFromRoles({ familiar, roles });
  await saveCraftDraft(draft);
  return NextResponse.json({ ok: true, draft });
}
