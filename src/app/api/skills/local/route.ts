import { NextResponse } from "next/server";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";

export const dynamic = "force-dynamic";

// Parse minimal YAML frontmatter (key: value pairs only, no nesting needed for top-level scalar fields)
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

// Parse array fields from frontmatter block (e.g. skills:\n  - foo)
function parseListField(text: string, field: string): string[] {
  const match = text.match(new RegExp(`\\n${field}:\\s*\\n((?:\\s*-[^\\n]*\\n?)*)`));
  if (!match) return [];
  return match[1].match(/- (.+)/g)?.map(m => m.slice(2).trim()) ?? [];
}

export type LocalSkillEntry = {
  id: string;           // folder name
  name: string;
  description?: string;
  version?: string;
  kind?: string;        // agent | harness | hybrid
  tags?: string[];
  path: string;         // absolute path to SKILL.md
  familiar: string;     // which familiar owns it
};

export async function GET() {
  const workspaceRoot = path.join(homedir(), ".openclaw", "workspace");
  const skills: LocalSkillEntry[] = [];

  // Scan all familiar workspaces
  let familiars: string[] = [];
  try {
    const entries = await readdir(workspaceRoot, { withFileTypes: true });
    familiars = entries.filter(e => e.isDirectory()).map(e => e.name);
  } catch {
    return NextResponse.json({ ok: true, skills: [] });
  }

  for (const familiar of familiars) {
    const skillsDir = path.join(workspaceRoot, familiar, "skills");
    let skillDirs: string[] = [];
    try {
      const entries = await readdir(skillsDir, { withFileTypes: true });
      skillDirs = entries.filter(e => e.isDirectory()).map(e => e.name);
    } catch { continue; }

    for (const skillName of skillDirs) {
      const skillMdPath = path.join(skillsDir, skillName, "SKILL.md");
      try {
        await stat(skillMdPath); // confirm exists
        const text = await readFile(skillMdPath, "utf8");
        const fm = parseFrontmatter(text);
        const tags = parseListField(text, "tags");
        skills.push({
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

  return NextResponse.json({ ok: true, skills });
}
