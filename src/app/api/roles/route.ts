import { NextResponse } from "next/server";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import { loadConfig, upsertRoleConfig } from "@/lib/cave-config";

export const dynamic = "force-dynamic";

// Known familiar workspace dirs
const FAMILIAR_DIRS = ["sage", "echo", "charm", "astra", "cody", "kitty", "nova"];

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

export type RoleEntry = {
  id: string;
  name: string;
  description?: string;
  version?: string;
  emoji?: string;
  familiar: string;
  skills: string[];
  tools: string[];
  plugins: string[];
  workflows: string[];
  path: string;
  /** Persisted in cave-config.json — whether this role is currently active */
  active: boolean;
  activatedAt?: string;
};

export async function GET() {
  const workspaceRoot = path.join(homedir(), ".openclaw", "workspace");
  const roles: RoleEntry[] = [];

  // Load config for active state overlay
  const cfg = await loadConfig();
  const roleConfigMap = new Map(cfg.roles.map(r => [`${r.familiar}:${r.id}`, r]));

  for (const familiar of FAMILIAR_DIRS) {
    const rolesDir = path.join(workspaceRoot, familiar, "roles");
    let roleDirs: string[] = [];
    try {
      const entries = await readdir(rolesDir, { withFileTypes: true });
      roleDirs = entries.filter(e => e.isDirectory()).map(e => e.name);
    } catch { continue; }

    for (const roleName of roleDirs) {
      const roleMdPath = path.join(rolesDir, roleName, "ROLE.md");
      try {
        await stat(roleMdPath);
        const text = await readFile(roleMdPath, "utf8");
        const fm = parseFrontmatter(text);
        const configEntry = roleConfigMap.get(`${familiar}:${roleName}`);
        roles.push({
          id: roleName,
          name: fm.name ?? roleName,
          description: fm.description,
          version: fm.version,
          emoji: fm.emoji,
          familiar: fm.familiar ?? familiar,
          skills: parseListField(text, "skills"),
          tools: parseListField(text, "tools"),
          plugins: parseListField(text, "plugins"),
          workflows: parseListField(text, "workflows"),
          path: roleMdPath,
          active: configEntry?.active ?? false,
          activatedAt: configEntry?.activatedAt,
        });
      } catch { continue; }
    }
  }

  return NextResponse.json({ ok: true, roles });
}

/** Toggle a role's active state in cave-config.json */
export async function POST(req: Request) {
  try {
    const { id, familiar, active } = await req.json() as {
      id: string;
      familiar: string;
      active: boolean;
    };
    if (!id || !familiar || typeof active !== "boolean") {
      return NextResponse.json({ ok: false, error: "missing id, familiar, or active" }, { status: 400 });
    }
    await upsertRoleConfig(id, familiar, active);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "unknown error" },
      { status: 500 },
    );
  }
}
