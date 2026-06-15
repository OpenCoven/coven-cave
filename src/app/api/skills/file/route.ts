import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { isAllowedSkillFilePath } from "@/lib/server/skill-file-paths";

export const dynamic = "force-dynamic";

/**
 * Read a skill / harness-instructions markdown file for the Capabilities
 * inspector preview. The `path` param is constrained to the well-known harness
 * roots under $HOME by isAllowedSkillFilePath — out-of-tree paths get 403.
 *
 * The daemon reports a skill's `path` as its directory (e.g.
 * `~/.claude/skills/brainstorming`), not the SKILL.md inside it, so a
 * non-markdown path is treated as a skill folder and resolved to its SKILL.md
 * before the allow-list check.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const target = url.searchParams.get("path");
  if (!target) {
    return NextResponse.json({ ok: false, error: "path required" }, { status: 400 });
  }
  const candidate = target.toLowerCase().endsWith(".md")
    ? target
    : path.join(target, "SKILL.md");
  if (!isAllowedSkillFilePath(candidate)) {
    return NextResponse.json({ ok: false, error: "path not allowed" }, { status: 403 });
  }
  let text: string;
  try {
    text = await readFile(candidate, "utf8");
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "read failed" },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true, path: candidate, text });
}
