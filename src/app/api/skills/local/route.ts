import { NextResponse } from "next/server";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { covenHome, familiarIds, familiarWorkspace } from "@/lib/coven-paths";

export const dynamic = "force-dynamic";

function parseFrontmatter(text: string): Record<string, string> {
  const fm: Record<string, string> = {};
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return fm;
  for (const line of match[1].split("\n")) {
    const m = line.match(/^(\w[\w-]*):\s+"?([^"]*)"?\s*$/);
    if (m) fm[m[1]] = m[2];
  }
  return fm;
}

function parseListField(text: string, field: string): string[] {
  const match = text.match(new RegExp(`\\n${field}:\\s*\\n((?:\\s*-[^\\n]*\\n?)*)`));
  if (!match) return [];
  return match[1].match(/- (.+)/g)?.map(m => m.slice(2).trim()) ?? [];
}

export type LocalSkillEntry = {
  id: string;
  name: string;
  description?: string;
  version?: string;
  kind?: string;
  tags?: string[];
  path: string;
  familiar: string;   // "global" for shared workspace skills
};

async function scanSkillsDir(dir: string, familiar: string, out: LocalSkillEntry[]) {
  let entries: string[] = [];
  try {
    const dirents = await readdir(dir, { withFileTypes: true });
    entries = dirents.filter(e => e.isDirectory()).map(e => e.name);
  } catch { return; }

  for (const skillName of entries) {
    const skillMdPath = path.join(dir, skillName, "SKILL.md");
    try {
      await stat(skillMdPath);
      const text = await readFile(skillMdPath, "utf8");
      const fm = parseFrontmatter(text);
      const tags = parseListField(text, "tags");
      out.push({
        id: skillName,
        name: fm.name ?? skillName,
        description: fm.description,
        version: fm.version,
        kind: fm.kind,
        tags: tags.length ? tags : (fm.tags ? [fm.tags] : []),
        path: skillMdPath,
        familiar,
      });
    } catch { continue; }
  }
}

export async function GET() {
  const skills: LocalSkillEntry[] = [];

  // 1. Global shared Coven skills.
  await scanSkillsDir(path.join(covenHome(), "skills"), "global", skills);

  // 2. Per-familiar skills resolved the same way the daemon resolves familiar workspaces.
  for (const familiar of await familiarIds()) {
    await scanSkillsDir(path.join(await familiarWorkspace(familiar), "skills"), familiar, skills);
  }

  return NextResponse.json({ ok: true, skills });
}
