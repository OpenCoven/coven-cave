// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  mergeCatalog,
  deriveRequiresSetup,
  deriveKind,
  pluginBadgeState,
  filterPlugins,
  sortPlugins,
  countByKind,
  groupPluginsByCategory,
  categoriesFrom,
  requiredConfigFromManifest,
  remoteUrlFromManifest,
  resolveCollection,
  COLLECTIONS,
  sanitizeMarketplaceCatalogCards,
  sanitizeMarketplacePlugins,
} from "./marketplace-catalog.ts";

const marketplacePlugins = [
  { name: "github", displayName: "GitHub", category: "Developer Tools", trust: "reference-local", policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" }, roleAffinity: [{ familiar: "cody", roles: ["implementer"] }] },
  { name: "fetch", displayName: "Fetch", category: "Developer Tools", trust: "reference-local", policy: { installation: "AVAILABLE", authentication: "NONE" } },
  { name: "tinyfish-search", displayName: "TinyFish Search", category: "Web", trust: "reference-local", policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" } },
  { name: "legacy", displayName: "Legacy", category: "Other", trust: "preview-local", policy: { installation: "UNAVAILABLE", authentication: "NONE" } },
];
const manifests = {
  github: { version: "0.1.0", description: "Repos, issues, PRs.", author: { name: "OpenCoven" }, keywords: ["git", "pull-requests"], capabilities: ["network", "mcp"], homepage: "https://opencoven.ai", mcpServers: { github: { command: "npx", type: "stdio" } }, userConfig: { github_token: { required: true, sensitive: true, env: "GITHUB_PERSONAL_ACCESS_TOKEN" } } },
  fetch: { version: "0.2.0", description: "HTTP fetch.", author: "Anthropic", keywords: ["http"], capabilities: ["network"], mcpServers: { fetch: { command: "npx", type: "stdio" } } },
  "tinyfish-search": { version: "1.0.0", description: "Search the web with an API.", author: "TinyFish", keywords: ["search", "api"], capabilities: ["network", "api"], userConfig: { token: { required: true, sensitive: true, env: "TINYFISH_API_KEY" } } },
  // legacy: intentionally no manifest -> degraded card, no mcpServers -> kind "skill"
};
const installed = {
  fetch: { version: "0.2.0", source: "catalog", installedAt: "2026-06-24T00:00:00.000Z" },
  "tinyfish-search": { version: "1.0.0", source: "catalog", installedAt: "2026-06-25T00:00:00.000Z" },
};

const merged = mergeCatalog(marketplacePlugins, manifests, installed);
const safeMerged = mergeCatalog(sanitizeMarketplacePlugins(marketplacePlugins), manifests, installed);

// Sorted by displayName: Fetch, GitHub, Legacy, TinyFish Search
assert.deepEqual(merged.map((p) => p.id), ["fetch", "github", "legacy", "tinyfish-search"]);

const github = merged.find((p) => p.id === "github");
assert.equal(github.displayName, "GitHub");
assert.equal(github.description, "Repos, issues, PRs.");
assert.equal(github.author, "OpenCoven");
assert.equal(github.category, "Developer Tools");
assert.equal(github.trust, "reference-local");
assert.deepEqual(github.capabilities, ["network", "mcp"]);
assert.deepEqual(github.keywords, ["git", "pull-requests"]);
assert.equal(github.kind, "mcp");
assert.equal(github.version, "0.1.0");
assert.equal(github.installed, false);
assert.equal(github.requiresSetup, true);
assert.equal(github.available, true);
assert.deepEqual(github.roleAffinity, [{ familiar: "cody", roles: ["implementer"] }]);

const fetchP = merged.find((p) => p.id === "fetch");
assert.equal(fetchP.author, "Anthropic"); // string author form
assert.equal(fetchP.installed, true);
assert.equal(fetchP.requiresSetup, false);

const tinyfish = merged.find((p) => p.id === "tinyfish-search");
assert.equal(tinyfish.kind, "api", "non-MCP configured API plugins should be first-class API entries");
assert.equal(tinyfish.installed, true, "installed API entries should reflect Cave setup state");
assert.equal(tinyfish.requiresSetup, true);

assert.deepEqual(
  sanitizeMarketplaceCatalogCards([
    ...safeMerged,
    { ...tinyfish, id: "xurl", displayName: "X URL", description: "Charm social voice lane" },
  ]).map((p) => p.id),
  ["fetch", "github", "legacy", "tinyfish-search"],
  "rendered marketplace cards should drop manifest copy with hardcoded familiar names",
);

const legacy = merged.find((p) => p.id === "legacy");
assert.equal(legacy.description, "");        // no manifest -> empty
assert.equal(legacy.author, "OpenCoven");    // default author
assert.equal(legacy.available, false);       // installation !== AVAILABLE

// deriveRequiresSetup
assert.equal(deriveRequiresSetup(undefined), false);
assert.equal(deriveRequiresSetup({ a: { required: false }, b: { sensitive: true } }), false);
assert.equal(deriveRequiresSetup({ a: { required: true } }), true);

// pluginBadgeState
assert.equal(pluginBadgeState({ available: false, installed: false, requiresSetup: false }), "unavailable");
assert.equal(pluginBadgeState({ available: true, installed: true, requiresSetup: true, configured: true }), "added");
assert.equal(pluginBadgeState({ available: true, installed: false, requiresSetup: true }), "needs-setup");
assert.equal(pluginBadgeState({ available: true, installed: false, requiresSetup: false }), "add");

// filterPlugins
assert.deepEqual(filterPlugins(merged, { query: "repos" }).map((p) => p.id), ["github"]);
assert.deepEqual(filterPlugins(merged, { query: "http" }).map((p) => p.id), ["fetch"]); // keyword match
assert.deepEqual(filterPlugins(merged, { category: "Other" }).map((p) => p.id), ["legacy"]);
assert.deepEqual(filterPlugins(merged, { query: "", category: "All" }).map((p) => p.id), ["fetch", "github", "legacy", "tinyfish-search"]);

// categoriesFrom — "All" first, then by count desc then name
assert.deepEqual(categoriesFrom(merged), ["All", "Developer Tools", "Other", "Web"]);

// --- requiredConfig + configured + badge state (credential collection) ---
const rcManifests = {
  github: { userConfig: { github_token: { required: true, sensitive: true, title: "GitHub Token", description: "PAT", env: "GITHUB_PERSONAL_ACCESS_TOKEN" } } },
  fs: { userConfig: { filesystem_root: { required: true, sensitive: false, type: "directory", title: "Root", env: "COVEN_MCP_FILESYSTEM_ROOT" } } },
  none: { userConfig: { opt: { required: false, env: "X" }, noenv: { required: true } } }, // neither qualifies
};

assert.deepEqual(requiredConfigFromManifest(rcManifests.github), [
  { key: "github_token", env: "GITHUB_PERSONAL_ACCESS_TOKEN", title: "GitHub Token", description: "PAT", sensitive: true },
]);
assert.deepEqual(requiredConfigFromManifest(rcManifests.fs), [
  { key: "filesystem_root", env: "COVEN_MCP_FILESYSTEM_ROOT", title: "Root", description: undefined, sensitive: false },
]);
assert.deepEqual(requiredConfigFromManifest(rcManifests.none), []); // opt not required; noenv has no env
assert.deepEqual(requiredConfigFromManifest({}), []);

// default pre-fill: carried through for non-sensitive fields, stripped for sensitive ones
assert.deepEqual(
  requiredConfigFromManifest({
    userConfig: { db: { required: true, sensitive: false, title: "Database Path", env: "SQLITE_DB_PATH", default: "~/.coven/data.db" } },
  }),
  [{ key: "db", env: "SQLITE_DB_PATH", title: "Database Path", description: undefined, sensitive: false, default: "~/.coven/data.db" }],
);
// a secret field never gets a pre-filled default, even if the manifest declares one
assert.deepEqual(
  requiredConfigFromManifest({
    userConfig: { tok: { required: true, sensitive: true, title: "Token", env: "TOKEN", default: "should-be-ignored" } },
  }),
  [{ key: "tok", env: "TOKEN", title: "Token", description: undefined, sensitive: true }],
);

const rcMerged = mergeCatalog(
  [{ name: "github", displayName: "GitHub", category: "Developer Tools", trust: "reference-local", policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" } }],
  { github: rcManifests.github },
  {},
);
const gh = rcMerged[0];
assert.equal(gh.requiresSetup, true);
assert.equal(gh.configured, false);
assert.deepEqual(gh.requiredConfig.map((f) => f.env), ["GITHUB_PERSONAL_ACCESS_TOKEN"]);

assert.equal(pluginBadgeState({ available: true, installed: false, requiresSetup: true, configured: false }), "needs-setup");
assert.equal(pluginBadgeState({ available: true, installed: true, requiresSetup: true, configured: false }), "needs-setup");
assert.equal(pluginBadgeState({ available: true, installed: true, requiresSetup: true, configured: true }), "added");
assert.equal(pluginBadgeState({ available: true, installed: false, requiresSetup: true, configured: true }), "add");
assert.equal(pluginBadgeState({ available: true, installed: false, requiresSetup: false, configured: false }), "add");
assert.equal(pluginBadgeState({ available: false, installed: false, requiresSetup: true, configured: false }), "unavailable");

// --- remoteUrl (remote MCP endpoint) ---
assert.equal(
  remoteUrlFromManifest({ mcpServers: { linear: { url: "https://mcp.linear.app/mcp", type: "http" } } }),
  "https://mcp.linear.app/mcp",
);
assert.equal(
  remoteUrlFromManifest({ mcpServers: { github: { command: "npx" } } }),
  undefined,
); // command-only (no url) -> undefined
assert.equal(remoteUrlFromManifest({}), undefined);

const remoteMerged = mergeCatalog(
  [{ name: "linear", displayName: "Linear", category: "Project Management", trust: "official-remote", policy: { installation: "AVAILABLE", authentication: "NONE" } }],
  { linear: { mcpServers: { linear: { url: "https://mcp.linear.app/mcp", type: "http" } } } },
  {},
);
assert.equal(remoteMerged[0].remoteUrl, "https://mcp.linear.app/mcp");

const ghRow = merged.find((p) => p.id === "github");
assert.equal(ghRow.remoteUrl, undefined); // command-only mcpServer (no url) -> undefined

// --- prompt packs: manifest prompts thread through to the card model ---
const packMerged = mergeCatalog(
  [{ name: "prompt-pack-essentials", displayName: "Prompt Pack: Essentials", category: "Productivity", trust: "official-local", policy: { installation: "AVAILABLE", authentication: "NONE" } }],
  { "prompt-pack-essentials": { prompts: ["debug-this", "write-tests"] } },
  {},
);
assert.equal(packMerged[0].kind, "prompt");
assert.deepEqual(packMerged[0].prompts, ["debug-this", "write-tests"]);
assert.equal(ghRow.prompts, undefined); // non-pack cards carry no prompts field

// --- deriveKind ---
assert.equal(deriveKind({ mcpServers: { x: { command: "npx" } } }), "mcp");
assert.equal(deriveKind({ mcpServers: { x: { url: "https://e.x/mcp" } } }), "mcp");
assert.equal(deriveKind({ capabilities: ["network", "api"] }), "api");
assert.equal(deriveKind({ keywords: ["api", "search"] }), "api");
assert.equal(deriveKind({ mcpServers: {} }), "skill");
assert.equal(deriveKind({}), "skill");
assert.equal(deriveKind({ prompts: ["debug-this"] }), "prompt");
assert.equal(deriveKind({ prompts: [] }), "skill"); // empty pack -> not a prompt kind
// An MCP server wins over shipped prompts — the server defines the runtime shape.
assert.equal(deriveKind({ prompts: ["a"], mcpServers: { x: { command: "npx" } } }), "mcp");
assert.equal(
  deriveKind({ kind: "craft", mcpServers: { x: { command: "npx" } } }),
  "craft",
  "an explicit Craft kind wins over its bundled runtime components",
);
assert.equal(merged.find((p) => p.id === "legacy").kind, "skill"); // no manifest -> skill

const craftSpec = {
  schemaVersion: "opencoven.craft.v1",
  components: { required: ["fetch"], optional: ["exa"] },
  bundled: {
    skills: [{
      id: "brainstorming-research-ideas",
      sourcePath: "craft-sources/seekers-lens/brainstorming-research-ideas/SKILL.md",
      upstreamPath: "21-research-ideation/brainstorming-research-ideas/SKILL.md",
      contentHash: "sha256:8422a1a6dc0a88d05f02b9fbe0f8c2ae06a77024856d18125efa13d19d855d46",
      modifications: ["Normalized frontmatter for Codex."],
    }],
    prompts: [],
    workflows: [],
  },
  requiredCapabilities: ["network.http"],
  recommendedRoles: ["researcher"],
  provenance: {
    source: "https://github.com/orchestra-research/AI-Research-SKILLs",
    commit: "773a52944ba4747a18bd4ae9ade53fff041adcbc",
    license: "MIT",
    licensePath: "craft-sources/orchestra-research/LICENSE",
  },
};
const craftMerged = mergeCatalog(
  [{ name: "seekers-lens", displayName: "Seeker's Lens", kind: "craft", category: "Research Crafts", policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" } }],
  { "seekers-lens": { kind: "craft", version: "0.1.0", craft: craftSpec, mcpServers: { local: { command: "research-search", args: ["--stdio"] } } } },
  {},
);
assert.equal(craftMerged[0].kind, "craft");
assert.deepEqual(craftMerged[0].craft, craftSpec, "Craft metadata is exposed through the marketplace model");

// --- filterPlugins: kind + ids ---
assert.deepEqual(filterPlugins(merged, { kind: "mcp" }).map((p) => p.id), ["fetch", "github"]);
assert.deepEqual(filterPlugins(merged, { kind: "skill" }).map((p) => p.id), ["legacy"]);
assert.deepEqual(filterPlugins(merged, { kind: "api" }).map((p) => p.id), ["tinyfish-search"]);
assert.deepEqual(filterPlugins(merged, { ids: ["github", "legacy"] }).map((p) => p.id), ["github", "legacy"]);
assert.deepEqual(filterPlugins(merged, { ids: ["github"], kind: "skill" }).map((p) => p.id), []);

// --- countByKind ---
assert.deepEqual(countByKind(merged), { api: 1, mcp: 2, skill: 1, prompt: 0, craft: 0 });
assert.deepEqual(countByKind(craftMerged), { api: 0, mcp: 0, skill: 0, prompt: 0, craft: 1 });

// --- groupPluginsByCategory ---
const groups = groupPluginsByCategory(merged);
assert.deepEqual(groups.map((g) => g.category), ["Developer Tools", "Other", "Web"]);
assert.deepEqual(groups[0].plugins.map((p) => p.id), ["fetch", "github"]);
assert.deepEqual(groups[0].counts, { api: 0, mcp: 2, skill: 0, prompt: 0, craft: 0 });
assert.deepEqual(groups.find((g) => g.category === "Web")?.counts, { api: 1, mcp: 0, skill: 0, prompt: 0, craft: 0 });

// --- sortPlugins (returns a new array, never mutates) ---
const before = merged.map((p) => p.id);
const byName = sortPlugins(merged, "name");
assert.deepEqual(byName.map((p) => p.id), ["fetch", "github", "legacy", "tinyfish-search"]);
assert.deepEqual(merged.map((p) => p.id), before); // input untouched
// installed: fetch is installed -> first
assert.equal(sortPlugins(merged, "installed")[0].id, "fetch");
// recommended: trust rank reference-local(2) < preview-local(3) -> legacy last
assert.equal(sortPlugins(merged, "recommended").at(-1).id, "legacy");

// --- collections ---
const essentials = COLLECTIONS.find((c) => c.id === "essentials");
assert.ok(essentials);
// resolve keeps collection id order and skips ids absent from the catalog
assert.deepEqual(
  resolveCollection(merged, { id: "t", title: "t", description: "", icon: "", ids: ["legacy", "missing", "github"] }).map((p) => p.id),
  ["legacy", "github"],
);
// category-based collection returns every plugin in the category
assert.deepEqual(
  resolveCollection(merged, { id: "t", title: "t", description: "", icon: "", category: "Other" }).map((p) => p.id),
  ["legacy"],
);
// coven-native collection is category-driven so it always tracks first-party plugins
assert.equal(COLLECTIONS.find((c) => c.id === "coven-native").category, "Coven");

// --- production marketplace: OpenClaw skills are individual cards (not one bundle) ---
const productionMarketplace = JSON.parse(
  readFileSync(new URL("../../marketplace/marketplace.json", import.meta.url), "utf8"),
);
const marketplaceRoute = readFileSync(new URL("../app/api/marketplace/route.ts", import.meta.url), "utf8");
const marketplaceInstallRoute = readFileSync(new URL("../app/api/marketplace/install/route.ts", import.meta.url), "utf8");
const marketplaceUninstallRoute = readFileSync(new URL("../app/api/marketplace/uninstall/route.ts", import.meta.url), "utf8");
const marketplaceCatalogConfig = readFileSync(new URL("../app/api/marketplace/config/catalog-config.ts", import.meta.url), "utf8");
const sanitizedProductionPlugins = sanitizeMarketplacePlugins(productionMarketplace.plugins);
const productionManifests = Object.fromEntries(
  productionMarketplace.plugins.map((p) => {
    try {
      return [p.name, JSON.parse(readFileSync(new URL(`../../marketplace/plugins/${p.name}/plugin.json`, import.meta.url), "utf8"))];
    } catch {
      return [p.name, {}];
    }
  }),
);
const sanitizedProductionCards = sanitizeMarketplaceCatalogCards(
  mergeCatalog(sanitizedProductionPlugins, productionManifests, {}),
);
const prodNames = new Set(sanitizedProductionPlugins.map((p) => p.name));
const prodCardNames = new Set(sanitizedProductionCards.map((p) => p.id));
// the old bundled umbrella entry is gone — each OpenClaw skill is its own card now
assert.ok(!prodNames.has("openclaw-skills"), "bundled OpenClaw Skills umbrella should be removed");
// representative individual skills are present as their own cards
for (const name of ["ocr", "higgsfield-generate", "prompt-vault"]) {
  assert.ok(prodNames.has(name), `individual OpenClaw skill "${name}" should be a Cave marketplace card`);
}
for (const familiarSkill of ["coven-nova", "coven-kitty", "coven-cody", "coven-charm", "coven-sage", "coven-astra", "coven-echo"]) {
  assert.ok(!prodNames.has(familiarSkill), `${familiarSkill} should not be exposed as a hardcoded familiar skill`);
}
	assert.ok(!prodNames.has("rollcall"), "rollcall should not be exposed as a hardcoded familiar skill");
	assert.ok(prodCardNames.has("xurl"), "xurl should render after hardcoded familiar copy is removed");
for (const plugin of sanitizedProductionPlugins) {
  assert.deepEqual(plugin.roleAffinity ?? [], [], `${plugin.name} should not expose hardcoded familiar role affinity`);
}
for (const plugin of sanitizedProductionCards) {
  assert.doesNotMatch(JSON.stringify(plugin).toLowerCase(), /\b(nova|kitty|cody|charm|sage|astra|echo)\b/, `${plugin.id} should not mention named familiars`);
}
for (const [label, source] of [
  ["/api/marketplace", marketplaceRoute],
  ["/api/marketplace/uninstall", marketplaceUninstallRoute],
  ["marketplace catalog-config", marketplaceCatalogConfig],
]) {
  assert.match(source, /sanitizeMarketplacePlugins/, `${label} should resolve ids through the familiar-safe marketplace catalog`);
}
// The install route delegates id-resolution to the shared, path-injection-safe
// resolveCatalogName helper (which itself sanitizes the catalog), so it no
// longer names sanitizeMarketplacePlugins directly (cave-1f9h).
assert.match(
  marketplaceInstallRoute,
  /resolveCatalogName/,
  "/api/marketplace/install should resolve ids through the shared catalog resolver",
);

// --- production prompt pack: card derives kind "prompt", template files exist ---
const packCard = sanitizedProductionCards.find((p) => p.id === "prompt-pack-essentials");
assert.ok(packCard, "prompt-pack-essentials should be a marketplace card");
assert.equal(packCard.kind, "prompt");
assert.ok((packCard.prompts?.length ?? 0) >= 5, "pack card lists its template ids");
for (const pid of packCard.prompts ?? []) {
  // Each declared template must exist where /api/prompts scans installed packs.
  const md = readFileSync(new URL(`../../marketplace/plugins/prompt-pack-essentials/prompts/${pid}.md`, import.meta.url), "utf8");
  assert.match(md, /^---\nname: /, `${pid}.md carries scanner-readable frontmatter`);
  assert.ok(md.split("---")[2]?.trim().length > 0, `${pid}.md has a body to insert`);
}

console.log("marketplace-catalog.test.ts: ok");
