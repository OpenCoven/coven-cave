import { NextResponse } from "next/server";
import path from "node:path";
import { covenHome } from "@/lib/coven-paths";
import { scanSkillsDir, scanClaudeUserSkills, type LocalSkillEntry } from "@/lib/server/skill-scan";

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
