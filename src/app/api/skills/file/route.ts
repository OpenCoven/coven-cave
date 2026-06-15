import { NextResponse } from "next/server";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";
import { isAllowedSkillFilePath, MAX_SKILL_FILE_PREVIEW_BYTES } from "@/lib/server/skill-file-paths";

export const dynamic = "force-dynamic";

/**
 * Read a skill / harness-instructions markdown file for the Capabilities
 * inspector preview. The `path` param is constrained to the well-known harness
 * roots under $HOME by isAllowedSkillFilePath — out-of-tree paths get 403.
 *
 * The daemon can report a capability's `path` as its directory (e.g.
 * `~/.claude/skills/brainstorming` or `~/.codex/automations/foo`), not the
 * actual descriptor file inside it, so directory-looking paths are resolved to
 * their concrete capability file before the allow-list check.
 */
function resolveCapabilityFilePath(target: string): string {
  const lowerTarget = target.toLowerCase();
  if (lowerTarget.endsWith(".md") || lowerTarget.endsWith(".toml")) return target;
  if (target.includes(`${path.sep}.codex${path.sep}automations${path.sep}`) || target.includes("/.codex/automations/")) {
    return path.join(target, "automation.toml");
  }
  return path.join(target, "SKILL.md");
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const target = url.searchParams.get("path");
  if (!target) {
    return NextResponse.json({ ok: false, error: "path required" }, { status: 400 });
  }
  const candidate = resolveCapabilityFilePath(target);
  if (!(await isAllowedSkillFilePath(candidate))) {
    return NextResponse.json({ ok: false, error: "path not allowed" }, { status: 403 });
  }
  let text: string;
  try {
    const file = await open(candidate, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const targetStat = await file.stat();
      if (targetStat.size > MAX_SKILL_FILE_PREVIEW_BYTES) {
        return NextResponse.json({ ok: false, error: "file too large" }, { status: 413 });
      }
      text = await file.readFile("utf8");
    } finally {
      await file.close();
    }
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "read failed" },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true, path: candidate, text });
}
