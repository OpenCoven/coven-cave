/**
 * Pure read/merge/filter helpers for the Marketplace tab. No filesystem access —
 * the /api/marketplace route handler parses marketplace.json + plugin.json and
 * passes already-parsed inputs here so this stays unit-testable.
 */

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
};

export type InstalledMap = Record<string, { version: string; source: string; installedAt: string }>;

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
  kind: "mcp";
  version: string;
  installed: boolean;
  requiresSetup: boolean;
  available: boolean;
};

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
        kind: "mcp" as const,
        version: manifest.version ?? "0.0.0",
        installed: Boolean(installed[p.name]),
        requiresSetup: deriveRequiresSetup(manifest.userConfig),
        available: installation === "AVAILABLE",
      };
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export type PluginBadgeState = "add" | "added" | "needs-setup" | "unavailable";

export function pluginBadgeState(
  p: Pick<MarketplacePlugin, "available" | "installed" | "requiresSetup">,
): PluginBadgeState {
  if (!p.available) return "unavailable";
  if (p.installed) return "added";
  if (p.requiresSetup) return "needs-setup";
  return "add";
}

export function filterPlugins(
  plugins: MarketplacePlugin[],
  opts: { query?: string; category?: string },
): MarketplacePlugin[] {
  const q = (opts.query ?? "").trim().toLowerCase();
  const category = opts.category ?? "All";
  return plugins.filter((p) => {
    if (category !== "All" && p.category !== category) return false;
    if (!q) return true;
    const haystack = [p.displayName, p.description, p.author, p.category, ...p.keywords]
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  });
}

export function categoriesFrom(plugins: MarketplacePlugin[]): string[] {
  const counts = new Map<string, number>();
  for (const p of plugins) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
  const cats = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([category]) => category);
  return ["All", ...cats];
}
