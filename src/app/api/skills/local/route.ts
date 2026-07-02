import { NextResponse } from "next/server";
import path from "node:path";
import { rm } from "node:fs/promises";
import { covenHome } from "@/lib/coven-paths";
import { scanSkillsDir, scanClaudeUserSkills, type LocalSkillEntry } from "@/lib/server/skill-scan";
import { isRemovableSkillDir } from "@/lib/server/skill-file-paths";
import { isLocalOrigin } from "@/lib/server/local-origin";

export const dynamic = "force-dynamic";

// Re-exported so existing call sites (inspector pane) keep importing from here.
export type { LocalSkillEntry };

export async function GET() {
  const skills: LocalSkillEntry[] = [];

  // 1. Global shared Coven skills.
  await scanSkillsDir(path.join(covenHome(), "skills"), "global", skills);

  // 2. The user's own Claude Code skills (~/.claude/skills) — these are
  // available to every claude-harness familiar, so the Skills tab should
  // list them alongside the Coven-managed ones.
  skills.push(...await scanClaudeUserSkills());

  return NextResponse.json({ ok: true, skills });
}

// Remove a scanned skill's directory. Destructive → local-origin gated and
// hard-constrained to a direct child of a scan root (see isRemovableSkillDir).
// The client passes the skill's SKILL.md `path`; we delete its parent folder.
export async function DELETE(req: Request) {
  if (!isLocalOrigin(req)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  const filePath = new URL(req.url).searchParams.get("path");
  if (!filePath) {
    return NextResponse.json({ ok: false, error: "path required" }, { status: 400 });
  }
  const dir = path.dirname(filePath);
  if (!(await isRemovableSkillDir(dir))) {
    return NextResponse.json({ ok: false, error: "path not allowed" }, { status: 403 });
  }
  try {
    await rm(dir, { recursive: true, force: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "delete failed" },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true, deleted: true, path: dir });
}
