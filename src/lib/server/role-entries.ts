import { readFile } from "node:fs/promises";
import { loadConfig } from "@/lib/cave-config";
import { parseRoleListField, parseRoleMcpServers } from "@/lib/role-manifest";
import { discoverRoleFiles, parseRoleFrontmatter } from "@/lib/role-source";
import type { RoleEffectiveComposition } from "@/lib/role-craft-composition";
import { roleCraftService, type RoleCraftState } from "@/lib/server/role-crafts";

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

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export async function loadRoleEntries(): Promise<RoleEntry[]> {
  const roles: RoleEntry[] = [];
  const cfg = await loadConfig();
  const roleConfigMap = new Map(cfg.roles.map((r) => [`${r.familiar}:${r.id}`, r]));
  const roleFiles = (await discoverRoleFiles()).sort((a, b) => (
    compareStrings(a.familiar, b.familiar)
    || compareStrings(a.id, b.id)
    || compareStrings(a.path, b.path)
  ));

  for (const roleFile of roleFiles) {
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
    } catch {
      continue;
    }
  }

  return roles;
}
