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
  /canonicalRuntime !== "grok"[\s\S]*?fetch\("\/api\/harnesses", \{ cache: "no-store" \}\)/,
  "Grok uses the authenticated local harness catalog rather than a static model list",
);
assert.match(
  source,
  /canonicalRuntime === "grok" && harnessInventory\.runtime === canonicalRuntime[\s\S]*?return harnessInventory\.models/,
  "Grok only renders models from the inventory for the current runtime request",
);

console.log("use-runtime-model-options.test.ts: ok");
