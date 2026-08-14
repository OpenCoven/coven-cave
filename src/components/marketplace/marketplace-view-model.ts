import type { IconName } from "@/lib/icon";
import type { KindFilter, SortKey } from "@/lib/marketplace-catalog";
import { caveCrafts } from "@/lib/feature-flags";

/** Sections retained by the Marketplace router, including legacy deep links. */
export type MarketplaceSection = "browse" | "crafts" | "roles" | "skills" | "build" | "capabilities";

export const MARKETPLACE_SECTIONS: ReadonlyArray<{ id: MarketplaceSection; label: string; icon: IconName }> = [
  { id: "browse", label: "Yours", icon: "ph:squares-four" },
  ...(caveCrafts()
    ? [{ id: "crafts", label: "Crafts", icon: "ph:package-bold" } satisfies {
        id: MarketplaceSection;
        label: string;
        icon: IconName;
      }]
    : []),
  { id: "skills", label: "Skills", icon: "ph:sparkle" },
  { id: "build", label: "Build", icon: "ph:flow-arrow" },
];

export const MARKETPLACE_SECTION_HINT: Record<MarketplaceSection, string> = {
  browse: "Things you already installed or authored, kept together in one local inventory.",
  crafts: "Versioned Role loadouts — preview, verify, equip, update, and detach Craft bundles.",
  roles: "Personas your familiars wear — each bundles skills, tools, MCP servers, and workflows.",
  skills: "A smaller, reviewed OpenCoven Skills marketplace is being curated.",
  build: "Author a new skill directly in a local skill root.",
  capabilities: "What each runtime you've installed can do — retired from the hub; deep links land on Yours.",
};

export const MARKETPLACE_SEARCH_LABEL: Record<Exclude<MarketplaceSection, "capabilities" | "build" | "skills">, string> = {
  browse: "Search your items",
  crafts: "Search your Crafts",
  roles: "Search your items",
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

/** Yours' left-rail setup filter. "installed" remains parseable for migration. */
export type MarketplaceStatusFilter = "all" | "installed" | "needs-setup";

export const MARKETPLACE_STATUS_FILTERS: ReadonlyArray<{ id: MarketplaceStatusFilter; label: string; icon: IconName }> = [
  { id: "all", label: "All", icon: "ph:list" },
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
  ...(caveCrafts() ? [{ id: "craft", label: "Crafts" } satisfies { id: KindFilter; label: string }] : []),
];

export const MARKETPLACE_SORT_OPTIONS: ReadonlyArray<{ id: SortKey; label: string }> = [
  { id: "recommended", label: "Recommended" },
  { id: "name", label: "Name (A–Z)" },
  { id: "installed", label: "Installed first" },
];

