import type { PluginKind } from "./marketplace-catalog.ts";

export type RoleDirectComposition = {
  skills: string[];
  tools: string[];
  mcpServers: string[];
  plugins: string[];
  workflows: string[];
};

export type EquippedCraftComposition = {
  id: string;
  displayName: string;
  components: Record<string, { kind: PluginKind }>;
  craft: {
    components: { required: string[]; optional: string[] };
    bundled: { skills: string[]; prompts: string[]; workflows: string[] };
    requiredCapabilities: string[];
  };
};

export type RoleCapabilityOrigin = "direct" | "craft";

export type RoleEffectiveEntry = {
  id: string;
  origin: RoleCapabilityOrigin;
  originLabel: string;
  craftId?: string;
};

export type RoleEffectiveComposition = {
  skills: RoleEffectiveEntry[];
  tools: RoleEffectiveEntry[];
  mcpServers: RoleEffectiveEntry[];
  plugins: RoleEffectiveEntry[];
  workflows: RoleEffectiveEntry[];
  prompts: RoleEffectiveEntry[];
  capabilities: RoleEffectiveEntry[];
};

function addUnique(
  entries: RoleEffectiveEntry[],
  seen: Set<string>,
  ids: readonly string[],
  origin: Omit<RoleEffectiveEntry, "id">,
): void {
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    entries.push({ id, ...origin });
  }
}

export function composeRoleEffective(
  direct: RoleDirectComposition,
  crafts: readonly EquippedCraftComposition[],
): RoleEffectiveComposition {
  const effective: RoleEffectiveComposition = {
    skills: [],
    tools: [],
    mcpServers: [],
    plugins: [],
    workflows: [],
    prompts: [],
    capabilities: [],
  };
  const seen = Object.fromEntries(
    Object.keys(effective).map((field) => [field, new Set<string>()]),
  ) as Record<keyof RoleEffectiveComposition, Set<string>>;
  const directOrigin = { origin: "direct", originLabel: "Direct" } as const;

  addUnique(effective.skills, seen.skills, direct.skills, directOrigin);
  addUnique(effective.tools, seen.tools, direct.tools, directOrigin);
  addUnique(effective.mcpServers, seen.mcpServers, direct.mcpServers, directOrigin);
  addUnique(effective.plugins, seen.plugins, direct.plugins, directOrigin);
  addUnique(effective.workflows, seen.workflows, direct.workflows, directOrigin);

  for (const craft of crafts) {
    const craftOrigin = {
      origin: "craft",
      originLabel: `via ${craft.displayName}`,
      craftId: craft.id,
    } as const;
    const requiredComponents = craft.craft.components.required;
    addUnique(effective.plugins, seen.plugins, [craft.id, ...requiredComponents], craftOrigin);
    addUnique(
      effective.mcpServers,
      seen.mcpServers,
      requiredComponents.filter((id) => craft.components[id]?.kind === "mcp"),
      craftOrigin,
    );
    addUnique(effective.skills, seen.skills, craft.craft.bundled.skills, craftOrigin);
    addUnique(effective.prompts, seen.prompts, craft.craft.bundled.prompts, craftOrigin);
    addUnique(effective.workflows, seen.workflows, craft.craft.bundled.workflows, craftOrigin);
    addUnique(effective.capabilities, seen.capabilities, craft.craft.requiredCapabilities, craftOrigin);
  }

  return effective;
}
