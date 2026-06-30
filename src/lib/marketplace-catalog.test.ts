// @ts-nocheck
import assert from "node:assert/strict";
import {
  mergeCatalog,
  deriveRequiresSetup,
  deriveKind,
  pluginBadgeState,
  filterPlugins,
  sortPlugins,
  countByKind,
  categoriesFrom,
  requiredConfigFromManifest,
  remoteUrlFromManifest,
  resolveCollection,
  COLLECTIONS,
} from "./marketplace-catalog.ts";

const marketplacePlugins = [
  { name: "github", displayName: "GitHub", category: "Developer Tools", trust: "reference-local", policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" }, roleAffinity: [{ familiar: "cody", roles: ["implementer"] }] },
  { name: "fetch", displayName: "Fetch", category: "Developer Tools", trust: "reference-local", policy: { installation: "AVAILABLE", authentication: "NONE" } },
  { name: "legacy", displayName: "Legacy", category: "Other", trust: "preview-local", policy: { installation: "UNAVAILABLE", authentication: "NONE" } },
];
const manifests = {
  github: { version: "0.1.0", description: "Repos, issues, PRs.", author: { name: "OpenCoven" }, keywords: ["git", "pull-requests"], capabilities: ["network", "mcp"], homepage: "https://opencoven.ai", mcpServers: { github: { command: "npx", type: "stdio" } }, userConfig: { github_token: { required: true, sensitive: true, env: "GITHUB_PERSONAL_ACCESS_TOKEN" } } },
  fetch: { version: "0.2.0", description: "HTTP fetch.", author: "Anthropic", keywords: ["http"], capabilities: ["network"], mcpServers: { fetch: { command: "npx", type: "stdio" } } },
  // legacy: intentionally no manifest -> degraded card, no mcpServers -> kind "skill"
};
const installed = { fetch: { version: "0.2.0", source: "catalog", installedAt: "2026-06-24T00:00:00.000Z" } };

const merged = mergeCatalog(marketplacePlugins, manifests, installed);

// Sorted by displayName: Fetch, GitHub, Legacy
assert.deepEqual(merged.map((p) => p.id), ["fetch", "github", "legacy"]);

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
assert.deepEqual(filterPlugins(merged, { query: "", category: "All" }).map((p) => p.id), ["fetch", "github", "legacy"]);

// categoriesFrom — "All" first, then by count desc then name
assert.deepEqual(categoriesFrom(merged), ["All", "Developer Tools", "Other"]);

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

// --- deriveKind ---
assert.equal(deriveKind({ mcpServers: { x: { command: "npx" } } }), "mcp");
assert.equal(deriveKind({ mcpServers: { x: { url: "https://e.x/mcp" } } }), "mcp");
assert.equal(deriveKind({ mcpServers: {} }), "skill");
assert.equal(deriveKind({}), "skill");
assert.equal(merged.find((p) => p.id === "legacy").kind, "skill"); // no manifest -> skill

// --- filterPlugins: kind + ids ---
assert.deepEqual(filterPlugins(merged, { kind: "mcp" }).map((p) => p.id), ["fetch", "github"]);
assert.deepEqual(filterPlugins(merged, { kind: "skill" }).map((p) => p.id), ["legacy"]);
assert.deepEqual(filterPlugins(merged, { ids: ["github", "legacy"] }).map((p) => p.id), ["github", "legacy"]);
assert.deepEqual(filterPlugins(merged, { ids: ["github"], kind: "skill" }).map((p) => p.id), []);

// --- countByKind ---
assert.deepEqual(countByKind(merged), { mcp: 2, skill: 1 });

// --- sortPlugins (returns a new array, never mutates) ---
const before = merged.map((p) => p.id);
const byName = sortPlugins(merged, "name");
assert.deepEqual(byName.map((p) => p.id), ["fetch", "github", "legacy"]);
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

console.log("marketplace-catalog.test.ts: ok");
