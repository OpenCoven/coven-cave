// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./use-runtime-model-options.ts", import.meta.url), "utf8");

assert.match(
  source,
  /runtimeInventory\.key === inventoryKey[\s\S]*?runtimeInventory\.models !== null[\s\S]*?return runtimeInventory\.models/,
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
  /setRuntimeInventory\(\{ key: inventoryKey, models: staticModels \}\)/,
  "a failed dynamic request falls back to the safe static seed",
);
assert.match(
  source,
  /new Set\(\["claude", "copilot", "opencode", "grok"\]\)/,
  "Grok uses the same scoped shared inventory contract as other dynamic runtimes",
);
assert.match(
  source,
  /runtimeInventory\.key === inventoryKey[\s\S]*?return runtimeInventory\.models/,
  "dynamic inventories never render a prior familiar/runtime scope while the current request is pending",
);

console.log("use-runtime-model-options.test.ts: ok");
