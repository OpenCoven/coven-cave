import assert from "node:assert/strict";
import { loadCraftDefinition } from "./craft-catalog.ts";

const craft = await loadCraftDefinition("seekers-lens");
assert.ok(craft, "the hidden reference Craft is available to the transaction service");
assert.equal(craft.id, "seekers-lens");
assert.equal(craft.version, "0.1.0");
assert.deepEqual(craft.craft.components.required, [
  "fetch",
  "filesystem",
  "memory",
  "sequential-thinking",
]);
assert.deepEqual(Object.keys(craft.components), [
  "fetch",
  "filesystem",
  "memory",
  "sequential-thinking",
  "exa",
  "tavily",
  "firecrawl",
  "searxng",
  "research-ingestion",
]);
assert.deepEqual(craft.components.exa.requiredConfig, ["EXA_API_KEY"]);
assert.equal(await loadCraftDefinition("not-a-craft"), null);
assert.equal(await loadCraftDefinition("../seekers-lens"), null, "request ids never become paths");

console.log("craft-catalog.test.ts: ok");
