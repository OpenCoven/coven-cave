import { NextResponse } from "next/server";
import path from "node:path";
import { rm } from "node:fs/promises";
import { covenHome } from "@/lib/coven-paths";
import {
  dedupeByRealPath,
  scanAgentSharedSkills,
  scanClaudeUserSkills,
  scanCodexUserSkills,
  scanSkillsDir,
  type LocalSkillEntry,
} from "@/lib/server/skill-scan";
import { isRemovableSkillDir } from "@/lib/server/skill-file-paths";
import { isLocalOrigin } from "@/lib/server/local-origin";

export const dynamic = "force-dynamic";

// Re-exported so existing call sites (inspector pane) keep importing from here.
export type { LocalSkillEntry };

export async function GET() {
  const skills: LocalSkillEntry[] = [];

  // 1. Global shared Coven skills.
  await scanSkillsDir(path.join(covenHome(), "skills"), "global", skills);

  // 2. Agent-level skills managed by the Skills CLI. These are visible to the
  // corresponding coding agents and should share the same browser/install state
  // as registry rows.
  skills.push(...await scanClaudeUserSkills());
  skills.push(...await scanCodexUserSkills());
  skills.push(...await scanAgentSharedSkills());

  // The same physical skill often appears under several roots (~/.claude/skills
  // symlinks into ~/.agents/skills); collapse those so id-keyed consumers don't
  // render duplicate rows.
  return NextResponse.json({ ok: true, skills: await dedupeByRealPath(skills) });
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
