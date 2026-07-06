export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { loadConfig, saveConfig } from "@/lib/cave-config";
import {
  applyUserProfilePatch,
  normalizeUserProfilePatch,
} from "@/lib/user-profile-shared";
import { readUserAvatarFile } from "@/lib/server/user-avatar-file";

export async function GET() {
  try {
    const [config, avatar] = await Promise.all([loadConfig(), readUserAvatarFile()]);
    return NextResponse.json({
      ok: true,
      profile: config.profile ?? {},
      avatar: avatar ? { present: true, updatedAt: avatar.updatedAt } : { present: false },
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "failed to load profile" },
      { status: 500 },
    );
  }
}

export async function PATCH(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const normalized = normalizeUserProfilePatch(body);
  if (!normalized.ok) {
    return NextResponse.json({ ok: false, error: normalized.error }, { status: 400 });
  }
  try {
    const current = await loadConfig();
    const profile = applyUserProfilePatch(current.profile, normalized.patch);
    const updated = await saveConfig({ profile });
    return NextResponse.json({ ok: true, profile: updated.profile ?? {} });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "failed to save profile" },
      { status: 500 },
    );
  }
}
