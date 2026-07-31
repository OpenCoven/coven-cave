// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./use-runtime-model-options.ts", import.meta.url), "utf8");

assert.match(
  source,
  /runtimeInventory\.key === inventoryKey[\s\S]*?runtimeInventory\.models !== null[\s\S]*?return \{ models: runtimeInventory\.models, provenance: runtimeInventory\.provenance, loading: false, key: inventoryKey \}/,
  "dynamic model menus never expose a previous runtime or familiar's scoped inventory",
);
assert.match(
  source,
  /DYNAMIC_INVENTORY_RUNTIMES\.has\(canonicalRuntime\)/,
  "Claude, Copilot, and OpenCode all use capability-driven inventories",
);
assert.match(
  source,
  /`\/api\/runtime-models\/\$\{encodeURIComponent\(canonicalRuntime\)\}`/,
  "the hook calls the canonical shared runtime inventory endpoint",
);
assert.match(
  source,
  /inventoryFailureProvenance\(canonicalRuntime, staticModels\)/,
  "a failed dynamic request derives truthful fallback, runtime-managed, or unavailable provenance",
);
assert.equal(
  source.includes('staticModels.length > 0) return "fallback"') && source.includes('defaultOwner === "runtime" ? "runtime-managed" : "unavailable"'),
  true,
  "empty runtime-owned and unknown inventories never masquerade as a fallback catalog",
);
assert.match(
  source,
  /new Set\(\["claude", "copilot", "opencode", "grok"\]\)/,
  "Grok uses the same scoped shared inventory contract as other dynamic runtimes",
);
assert.match(
  source,
  /DYNAMIC_INVENTORY_RUNTIMES\.has\(canonicalRuntime\) \? \[\] : staticModels[\s\S]*?loading: DYNAMIC_INVENTORY_RUNTIMES\.has\(canonicalRuntime\)/,
  "dynamic inventories never render a prior familiar/runtime scope while the current request is pending",
);

console.log("use-runtime-model-options.test.ts: ok");
