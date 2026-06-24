// @ts-nocheck
import assert from "node:assert/strict";
import {
  mergeCatalog,
  deriveRequiresSetup,
  pluginBadgeState,
  filterPlugins,
  categoriesFrom,
} from "./marketplace-catalog.ts";

const marketplacePlugins = [
  { name: "github", displayName: "GitHub", category: "Developer Tools", trust: "reference-local", policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" }, roleAffinity: [{ familiar: "cody", roles: ["implementer"] }] },
  { name: "fetch", displayName: "Fetch", category: "Developer Tools", trust: "reference-local", policy: { installation: "AVAILABLE", authentication: "NONE" } },
  { name: "legacy", displayName: "Legacy", category: "Other", trust: "preview-local", policy: { installation: "UNAVAILABLE", authentication: "NONE" } },
];
const manifests = {
  github: { version: "0.1.0", description: "Repos, issues, PRs.", author: { name: "OpenCoven" }, keywords: ["git", "pull-requests"], capabilities: ["network", "mcp"], homepage: "https://opencoven.ai", userConfig: { github_token: { required: true, sensitive: true } } },
  fetch: { version: "0.2.0", description: "HTTP fetch.", author: "Anthropic", keywords: ["http"], capabilities: ["network"] },
  // legacy: intentionally no manifest -> degraded card
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
assert.equal(pluginBadgeState({ available: true, installed: true, requiresSetup: true }), "added");
assert.equal(pluginBadgeState({ available: true, installed: false, requiresSetup: true }), "needs-setup");
assert.equal(pluginBadgeState({ available: true, installed: false, requiresSetup: false }), "add");

// filterPlugins
assert.deepEqual(filterPlugins(merged, { query: "repos" }).map((p) => p.id), ["github"]);
assert.deepEqual(filterPlugins(merged, { query: "http" }).map((p) => p.id), ["fetch"]); // keyword match
assert.deepEqual(filterPlugins(merged, { category: "Other" }).map((p) => p.id), ["legacy"]);
assert.deepEqual(filterPlugins(merged, { query: "", category: "All" }).map((p) => p.id), ["fetch", "github", "legacy"]);

// categoriesFrom — "All" first, then by count desc then name
assert.deepEqual(categoriesFrom(merged), ["All", "Developer Tools", "Other"]);

console.log("marketplace-catalog.test.ts: ok");
