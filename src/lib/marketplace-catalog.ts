/**
 * Pure read/merge/filter helpers for the Marketplace tab. No filesystem access —
 * the /api/marketplace route handler parses marketplace.json + plugin.json and
 * passes already-parsed inputs here so this stays unit-testable.
 */

import type { IconName } from "@/lib/icon";

export type RoleAffinity = { familiar: string; roles: string[] };

export type MarketplaceJsonPlugin = {
  name: string;
  displayName?: string;
  category?: string;
  trust?: string;
  policy?: { installation?: string; authentication?: string };
  roleAffinity?: RoleAffinity[];
};

export type PluginUserConfigField = {
  required?: boolean;
  sensitive?: boolean;
  type?: string;
  title?: string;
  description?: string;
  env?: string;
};

export type PluginManifest = {
  version?: string;
  description?: string;
  author?: { name?: string } | string;
  homepage?: string;
  repository?: string;
  keywords?: string[];
  capabilities?: string[];
  userConfig?: Record<string, PluginUserConfigField>;
  mcpServers?: Record<string, { url?: string; type?: string; command?: string }>;
};

export type RequiredConfigField = {
  key: string;
  env: string;
  title: string;
  description?: string;
  sensitive: boolean;
};

/** Required userConfig fields that declare a target env var (collectable). */
export function requiredConfigFromManifest(manifest: PluginManifest): RequiredConfigField[] {
  const uc = manifest.userConfig ?? {};
  return Object.entries(uc)
    .filter(([, f]) => f?.required === true && typeof f?.env === "string" && f.env.length > 0)
    .map(([key, f]) => ({
      key,
      env: f.env as string,
      title: f.title ?? key,
      description: f.description,
      sensitive: f.sensitive === true,
    }));
}

/** The first remote (url-based) MCP server URL declared by the manifest, if any. */
export function remoteUrlFromManifest(manifest: PluginManifest): string | undefined {
  const servers = manifest.mcpServers ?? {};
  for (const s of Object.values(servers)) {
    if (s && typeof s.url === "string" && s.url.length > 0) return s.url;
  }
  return undefined;
}

export type InstalledMap = Record<string, { version: string; source: string; installedAt: string }>;

export type PluginKind = "mcp" | "skill";

export type MarketplacePlugin = {
  id: string;
  displayName: string;
  description: string;
  category: string;
  author: string;
  trust: string;
  policy: { installation: string; authentication: string };
  capabilities: string[];
  keywords: string[];
  homepage?: string;
  repository?: string;
  roleAffinity: RoleAffinity[];
  kind: PluginKind;
  version: string;
  installed: boolean;
  requiresSetup: boolean;
  available: boolean;
  requiredConfig: RequiredConfigField[];
  configured: boolean;
  remoteUrl?: string;
};

/**
 * "mcp" when the manifest declares any MCP server (stdio command or remote
 * url); otherwise "skill" — a first-party capability that runs inside Coven
 * Cave without an external server.
 */
export function deriveKind(manifest: PluginManifest): PluginKind {
  const servers = manifest.mcpServers ?? {};
  return Object.keys(servers).length > 0 ? "mcp" : "skill";
}

export function deriveRequiresSetup(userConfig: PluginManifest["userConfig"]): boolean {
  if (!userConfig) return false;
  return Object.values(userConfig).some((field) => field?.required === true);
}

function authorName(author: PluginManifest["author"]): string {
  if (typeof author === "string" && author.trim()) return author;
  if (author && typeof author === "object" && author.name) return author.name;
  return "OpenCoven";
}

export function mergeCatalog(
  marketplacePlugins: MarketplaceJsonPlugin[],
  manifests: Record<string, PluginManifest>,
  installed: InstalledMap,
): MarketplacePlugin[] {
  return marketplacePlugins
    .map((p) => {
      const manifest = manifests[p.name] ?? {};
      const installation = p.policy?.installation ?? "AVAILABLE";
      const requiredConfig = requiredConfigFromManifest(manifest);
      return {
        id: p.name,
        displayName: p.displayName ?? p.name,
        description: manifest.description ?? "",
        category: p.category ?? "Other",
        author: authorName(manifest.author),
        trust: p.trust ?? "reference-local",
        policy: {
          installation,
          authentication: p.policy?.authentication ?? "NONE",
        },
        capabilities: manifest.capabilities ?? [],
        keywords: manifest.keywords ?? [],
        homepage: manifest.homepage,
        repository: manifest.repository,
        roleAffinity: p.roleAffinity ?? [],
        kind: deriveKind(manifest),
        version: manifest.version ?? "0.0.0",
        installed: Boolean(installed[p.name]),
        requiresSetup: requiredConfig.length > 0,
        available: installation === "AVAILABLE",
        requiredConfig,
        configured: false,
        remoteUrl: remoteUrlFromManifest(manifest),
      };
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export type PluginBadgeState = "add" | "added" | "needs-setup" | "unavailable";

export function pluginBadgeState(
  p: Pick<MarketplacePlugin, "available" | "installed" | "requiresSetup" | "configured">,
): PluginBadgeState {
  if (!p.available) return "unavailable";
  if (p.requiresSetup && !p.configured) return "needs-setup";
  if (p.installed) return "added";
  return "add";
}

export type KindFilter = "all" | PluginKind;

export function filterPlugins(
  plugins: MarketplacePlugin[],
  opts: { query?: string; category?: string; kind?: KindFilter; ids?: readonly string[] },
): MarketplacePlugin[] {
  const q = (opts.query ?? "").trim().toLowerCase();
  const category = opts.category ?? "All";
  const kind = opts.kind ?? "all";
  const idSet = opts.ids ? new Set(opts.ids) : null;
  return plugins.filter((p) => {
    if (idSet && !idSet.has(p.id)) return false;
    if (category !== "All" && p.category !== category) return false;
    if (kind !== "all" && p.kind !== kind) return false;
    if (!q) return true;
    const haystack = [p.displayName, p.description, p.author, p.category, ...p.keywords]
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  });
}

export type SortKey = "recommended" | "name" | "installed";

const TRUST_RANK: Record<string, number> = {
  "official-remote": 0,
  "official-local": 1,
  "reference-local": 2,
  "preview-local": 3,
  "local-tool": 4,
};

function trustRank(trust: string): number {
  return TRUST_RANK[trust] ?? 9;
}

/** Returns a new, sorted array — never mutates the input. */
export function sortPlugins(plugins: MarketplacePlugin[], sort: SortKey): MarketplacePlugin[] {
  const byName = (a: MarketplacePlugin, b: MarketplacePlugin) =>
    a.displayName.localeCompare(b.displayName);
  const copy = [...plugins];
  if (sort === "name") return copy.sort(byName);
  if (sort === "installed") {
    return copy.sort(
      (a, b) => Number(b.installed) - Number(a.installed) || byName(a, b),
    );
  }
  // recommended: official trust first, then needs-setup demoted, then name
  return copy.sort(
    (a, b) =>
      trustRank(a.trust) - trustRank(b.trust) ||
      Number(a.requiresSetup && !a.configured) - Number(b.requiresSetup && !b.configured) ||
      byName(a, b),
  );
}

export function countByKind(plugins: MarketplacePlugin[]): { mcp: number; skill: number } {
  let mcp = 0;
  let skill = 0;
  for (const p of plugins) {
    if (p.kind === "mcp") mcp += 1;
    else skill += 1;
  }
  return { mcp, skill };
}

export type Collection = {
  id: string;
  title: string;
  description: string;
  icon: IconName;
  /** Explicit member ids; resolved against the live catalog (missing ids skipped). */
  ids?: readonly string[];
  /** When set, members are every plugin in this category (ids ignored). */
  category?: string;
};

/**
 * Curated bundles surfaced as a "Featured collections" strip. Order matters —
 * it is the on-screen order. Coven-native uses a category match so it always
 * reflects every first-party plugin; the rest are hand-picked id lists.
 */
export const COLLECTIONS: readonly Collection[] = [
  {
    id: "coven-native",
    title: "Coven native",
    description: "First-party capabilities that run inside Coven Cave.",
    icon: "ph:sparkle-bold",
    category: "Coven",
  },
  {
    id: "essentials",
    title: "Essentials",
    description: "The core toolkit every familiar should start with.",
    icon: "ph:cube-bold",
    ids: ["filesystem", "git", "github", "fetch", "memory", "time", "sequential-thinking"],
  },
  {
    id: "research",
    title: "Research stack",
    description: "Search, retrieve, and ground answers in real sources.",
    icon: "ph:magnifying-glass-bold",
    ids: ["exa", "tavily", "firecrawl", "context7", "huggingface", "fetch"],
  },
  {
    id: "web-automation",
    title: "Web & browser",
    description: "Drive browsers and crawl the live web.",
    icon: "ph:globe-bold",
    ids: ["playwright", "browserbase", "chrome-devtools", "firecrawl", "searxng"],
  },
  {
    id: "data",
    title: "Data & databases",
    description: "Query and inspect your data sources.",
    icon: "ph:database-bold",
    ids: ["postgres", "sqlite", "supabase", "mongodb", "dbhub"],
  },
  {
    id: "devops",
    title: "Ship & operate",
    description: "Deploy, observe, and manage infrastructure.",
    icon: "ph:rocket-launch-bold",
    ids: ["vercel", "azure", "terraform", "cloudflare-docs", "sentry"],
  },
];

/** Member plugins of a collection, in collection order, present in the catalog. */
export function resolveCollection(
  plugins: MarketplacePlugin[],
  collection: Collection,
): MarketplacePlugin[] {
  if (collection.category) {
    return plugins.filter((p) => p.category === collection.category);
  }
  const byId = new Map(plugins.map((p) => [p.id, p]));
  const out: MarketplacePlugin[] = [];
  for (const id of collection.ids ?? []) {
    const p = byId.get(id);
    if (p) out.push(p);
  }
  return out;
}

export function categoriesFrom(plugins: MarketplacePlugin[]): string[] {
  const counts = new Map<string, number>();
  for (const p of plugins) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
  const cats = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([category]) => category);
  return ["All", ...cats];
}
