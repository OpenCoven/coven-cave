import type { IconName } from "@/lib/icon";
import type { SkillBrowserEntry } from "@/components/skill-browser";
import type { SkillEntry as SkillDetailEntry } from "@/components/skill-detail-drawer";
import type { KindFilter, SortKey } from "@/lib/marketplace-catalog";

/** Sections retained by the marketplace router, including legacy deep links.
 *  "skills" is no longer a visible tab — the Skills directory merged into
 *  Explore (the renamed Browse section) as its "Skills" type. The id survives
 *  in the type so `mode === "skills"` deep links keep type-checking; they land
 *  on Explore pre-filtered to Skills. */
export type MarketplaceSection = "browse" | "crafts" | "roles" | "skills" | "build" | "capabilities";

export const MARKETPLACE_SECTIONS: ReadonlyArray<{ id: MarketplaceSection; label: string; icon: IconName }> = [
  { id: "browse", label: "Explore", icon: "ph:compass" },
  { id: "crafts", label: "Crafts", icon: "ph:package-bold" },
  { id: "build", label: "Build", icon: "ph:flow-arrow" },
];

export const MARKETPLACE_SECTION_HINT: Record<MarketplaceSection, string> = {
  browse: "Everything your familiars can equip — MCP servers, connected APIs, and skills in one place.",
  crafts: "Versioned Role loadouts — preview, verify, equip, update, and detach Craft bundles.",
  roles: "Personas your familiars wear — each bundles skills, tools, MCP servers, and workflows.",
  skills: "SKILL.md procedures familiars load while they work — browsed here alongside tools.",
  build: "Author a new skill — write the SKILL.md your familiars load, straight into a local skill root.",
  capabilities: "What each runtime you've installed can do — retired from the hub; deep links land on Explore.",
};

export const MARKETPLACE_SEARCH_LABEL: Record<Exclude<MarketplaceSection, "capabilities" | "build">, string> = {
  browse: "Search tools and skills",
  crafts: "Search Crafts",
  roles: "Search roles",
  skills: "Search tools and skills",
};

/** Explore's left-rail "Type" segment — the item kinds a familiar can equip.
 *  A subset of KindFilter (prompt/craft/knowledge-pack live under Categories,
 *  not the primary rail) paired with rail icons. */
export const MARKETPLACE_TYPE_RAIL: ReadonlyArray<{ id: KindFilter; label: string; icon: IconName }> = [
  { id: "all", label: "All items", icon: "ph:squares-four" },
  { id: "mcp", label: "MCP servers", icon: "ph:plugs" },
  { id: "api", label: "APIs", icon: "ph:cloud-bold" },
  { id: "skill", label: "Skills", icon: "ph:sparkle" },
];

/** Explore's left-rail "Status" segment — install/setup lifecycle filter. */
export type MarketplaceStatusFilter = "all" | "installed" | "needs-setup";

export const MARKETPLACE_STATUS_FILTERS: ReadonlyArray<{ id: MarketplaceStatusFilter; label: string; icon: IconName }> = [
  { id: "all", label: "All", icon: "ph:list" },
  { id: "installed", label: "Installed", icon: "ph:check-circle" },
  { id: "needs-setup", label: "Needs setup", icon: "ph:warning" },
];

/** Explore's card layout toggle — a grid of cards vs. a single-column list. */
export type MarketplaceViewMode = "grid" | "rows";

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
