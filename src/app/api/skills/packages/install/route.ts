import { NextResponse } from "next/server";
import { readJsonBody, rejectNonLocalRequest } from "@/lib/server/api-security";
import { installSkillPackage, type SkillPackageInstallTarget } from "@/lib/server/skill-package-install";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 16 * 1024;

type InstallBody = {
  packId?: unknown;
  skillId?: unknown;
  targets?: unknown;
};

export async function POST(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;

  const parsed = await readJsonBody<InstallBody>(req, MAX_BODY_BYTES);
  if (!parsed.ok) return parsed.response;

  const packId = typeof parsed.body.packId === "string" ? parsed.body.packId.trim() : "";
  const skillId = typeof parsed.body.skillId === "string" ? parsed.body.skillId.trim() : "";
  const targets = Array.isArray(parsed.body.targets) ? (parsed.body.targets as SkillPackageInstallTarget[]) : undefined;
  try {
    const result = await installSkillPackage({ packId, skillId, ...(targets ? { targets } : {}) });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "install failed";
    const status = message === "missing SKILL.md" ? 404 : 400;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
