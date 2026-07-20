import type { IconName } from "@/lib/icon";
import type { SkillBrowserEntry } from "@/components/skill-browser";
import type { SkillEntry as SkillDetailEntry } from "@/components/skill-detail-drawer";
import type { KindFilter, SortKey } from "@/lib/marketplace-catalog";

/** Sections retained by the marketplace router, including legacy deep links. */
export type MarketplaceSection = "browse" | "crafts" | "roles" | "skills" | "build" | "capabilities";

export const MARKETPLACE_SECTIONS: ReadonlyArray<{ id: MarketplaceSection; label: string; icon: IconName }> = [
  { id: "browse", label: "Browse", icon: "ph:storefront-bold" },
  { id: "crafts", label: "Crafts", icon: "ph:package-bold" },
  { id: "skills", label: "Skills", icon: "ph:sparkle" },
  { id: "build", label: "Build", icon: "ph:hammer" },
];

export const MARKETPLACE_SECTION_HINT: Record<MarketplaceSection, string> = {
  browse: "The catalog — add MCP servers, connected APIs, skills, and prompt packs to your Cave.",
  crafts: "Versioned Role loadouts — preview, verify, equip, update, and detach Craft bundles.",
  roles: "Personas your familiars wear — each bundles skills, tools, MCP servers, and workflows.",
  skills: "Skills already in your Cave — reusable SKILL.md procedures familiars load while they work.",
  build: "Author a new skill — write the SKILL.md your familiars load, straight into a local skill root.",
  capabilities: "What each runtime you've installed can do — retired from the hub; deep links land on Browse.",
};

export const MARKETPLACE_SEARCH_LABEL: Record<Exclude<MarketplaceSection, "capabilities" | "build">, string> = {
  browse: "Search the marketplace",
  crafts: "Search Crafts",
  roles: "Search roles",
  skills: "Search skills",
};

export const MARKETPLACE_KIND_TABS: ReadonlyArray<{ id: KindFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "api", label: "APIs" },
  { id: "mcp", label: "MCP servers" },
  { id: "skill", label: "Skills" },
  { id: "prompt", label: "Prompts" },
  { id: "knowledge-pack", label: "Knowledge packs" },
  { id: "craft", label: "Crafts" },
];

export const MARKETPLACE_SORT_OPTIONS: ReadonlyArray<{ id: SortKey; label: string }> = [
  { id: "recommended", label: "Recommended" },
  { id: "name", label: "Name (A–Z)" },
  { id: "installed", label: "Installed first" },
];

/** Maps a scanned local skill to the detail drawer's stable input contract. */
export function toSkillDetail(skill: SkillBrowserEntry): SkillDetailEntry {
  const owner = skill.owner && skill.repo ? `${skill.owner}/${skill.repo}` : skill.owner;
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    version: skill.local?.version,
    category: skill.installed ? "Installed" : "Directory",
    owner,
    tags: [...new Set([...(skill.tags ?? []), ...(skill.topics ?? [])])],
    source: skill.path,
  };
}
