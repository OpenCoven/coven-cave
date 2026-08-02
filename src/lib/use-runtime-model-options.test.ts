// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./use-runtime-model-options.ts", import.meta.url),
  "utf8",
);

assert.match(
  source,
  /runtimeInventory\.key === inventoryKey &&[\s\S]*?runtimeInventory\.inventory !== null[\s\S]*?\.\.\.runtimeInventory\.inventory,[\s\S]*?loading: false/,
  "dynamic model menus apply only the current runtime and familiar's full inventory",
);
assert.match(
  source,
  /current\.key === inventoryKey[\s\S]{0,80}\? current[\s\S]{0,80}: \{ key: inventoryKey, inventory: null \}/,
  "same-scope polling remains stable while a changed scope fails closed",
);
assert.match(
  source,
  /usePausablePoll\([\s\S]{0,180}INVENTORY_REFRESH_MS[\s\S]{0,100}enabled: dynamicInventory/,
  "dynamic provider inventories refresh on the shared hidden-tab-safe bounded poll",
);
assert.match(
  source,
  /const refreshAfterConfigWrite =[\s\S]*?setRefreshRevision[\s\S]*?addEventListener\("cave:familiars-refresh", refreshAfterConfigWrite\)/,
  "a completed runtime config write immediately retries an optimistic inventory request",
);
assert.match(
  source,
  /value\.runtime === runtime[\s\S]*?Array\.isArray\(value\.models\)[\s\S]*?PROVENANCE\.has[\s\S]*?value\.defaultOwner === "cave"[\s\S]*?typeof value\.allowCustom === "boolean"/,
  "partial, wrong-runtime, or malformed responses cannot cross the client inventory boundary",
);
assert.match(
  source,
  /`\/api\/runtime-models\/\$\{encodeURIComponent\(canonicalRuntime\)\}`/,
  "the hook calls the canonical shared runtime inventory endpoint",
);
assert.equal(
  source.includes('staticModels.length > 0) return "fallback"') &&
    source.includes('defaultOwner === "runtime"') &&
    source.includes('? "runtime-managed"'),
  true,
  "empty runtime-owned and unknown inventories never masquerade as a fallback catalog",
);
assert.match(
  source,
  /"claude",[\s\S]{0,100}"copilot",[\s\S]{0,100}"opencode",[\s\S]{0,100}"grok",[\s\S]{0,100}"hermes"/,
  "Grok and Hermes use the same scoped shared inventory contract as other dynamic runtimes",
);
assert.match(
  source,
  /\.\.\.fallback,[\s\S]{0,180}models: \[\],[\s\S]{0,180}provenance: "unavailable",[\s\S]{0,180}loading: true/,
  "pending scope transitions expose neither stale ids nor stale provenance",
);
assert.doesNotMatch(
  source,
  /\/api\/harnesses/,
  "the client no longer reconstructs inventory capabilities from a second endpoint",
);

console.log("use-runtime-model-options.test.ts: ok");
