import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { loadConfig, upsertRoleConfig } from "@/lib/cave-config";
import { parseRoleListField, parseRoleMcpServers } from "@/lib/role-manifest";
import { discoverRoleFiles, parseRoleFrontmatter } from "@/lib/role-source";
import type { RoleEffectiveComposition } from "@/lib/role-craft-composition";
import { roleCraftService, type RoleCraftState } from "@/lib/server/role-crafts";

export const dynamic = "force-dynamic";

export type RoleEntry = {
  id: string;
  name: string;
  description?: string;
  version?: string;
  emoji?: string;
  familiar: string;
  skills: string[];
  tools: string[];
  mcpServers: string[];
  plugins: string[];
  workflows: string[];
  crafts: string[];
  craftStates: RoleCraftState[];
  effective: RoleEffectiveComposition;
  path: string;
  /** Persisted in cave-config.json — whether this role is currently active */
  active: boolean;
  activatedAt?: string;
};

export async function GET() {
  const roles: RoleEntry[] = [];

  // Load config for active state overlay
  const cfg = await loadConfig();
  const roleConfigMap = new Map(cfg.roles.map(r => [`${r.familiar}:${r.id}`, r]));

  for (const roleFile of await discoverRoleFiles()) {
    try {
      const text = await readFile(roleFile.path, "utf8");
      const fm = parseRoleFrontmatter(text);
      const familiar = fm.familiar ?? roleFile.familiar;
      const id = fm.id ?? roleFile.id;
      const configEntry = roleConfigMap.get(`${familiar}:${id}`);
      const direct = {
        skills: parseRoleListField(text, "skills"),
        tools: parseRoleListField(text, "tools"),
        mcpServers: parseRoleMcpServers(text),
        plugins: parseRoleListField(text, "plugins"),
        workflows: parseRoleListField(text, "workflows"),
      };
      const crafts = parseRoleListField(text, "crafts");
      const resolved = await roleCraftService.resolve(direct, crafts, cfg.marketplace.installed);
      roles.push({
        id,
        name: fm.name ?? id,
        description: fm.description,
        version: fm.version,
        emoji: fm.emoji,
        familiar,
        skills: direct.skills,
        tools: direct.tools,
        mcpServers: direct.mcpServers,
        plugins: direct.plugins,
        workflows: direct.workflows,
        crafts,
        craftStates: resolved.craftStates,
        effective: resolved.effective,
        path: roleFile.path,
        active: configEntry?.active ?? false,
        activatedAt: configEntry?.activatedAt,
      });
    } catch { continue; }
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
