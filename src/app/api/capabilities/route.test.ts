// @ts-nocheck
// The Capabilities page must keep working against daemons whose aggregate
// /api/v1/capabilities returns control-plane descriptors instead of harness
// manifests, and must not hide claude's locally-installed user skills when
// the daemon's own scanner misses them.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

assert.match(
  source,
  /Array\.isArray\(aggregate\.data\?\.harness_capabilities\)/,
  "Legacy aggregate manifest shape is detected before trusting the daemon aggregate",
);

assert.match(
  source,
  /COMPATIBILITY_ADAPTERS\.map\(\(adapter\) => adapter\.id\)/,
  "Fallback assembles the aggregate by fanning out to per-harness manifest endpoints",
);

assert.match(
  source,
  /ensureAdapterCoverage\(reported, refresh\)/,
  "Daemon aggregate manifests are backfilled so every supported harness stays covered",
);

assert.match(
  source,
  /openClawCapabilityManifest\(new Date\(\)\.toISOString\(\)\)/,
  "OpenClaw should expose a synthetic bridge capability manifest when the daemon has no harness manifest",
);

assert.match(
  source,
  /if \(harness === "openclaw"\)[\s\S]*harness_capabilities: \[manifest\]/,
  "The per-harness capabilities route should return OpenClaw bridge capabilities directly",
);

assert.match(
  source,
  /bridge_capabilities: openClawBridgeCapabilities\(\)/,
  "The synthetic OpenClaw manifest should include structured bridge capability flags",
);

assert.match(
  source,
  /const missing = COMPATIBILITY_ADAPTERS\.map\(\(adapter\) => adapter\.id\)\.filter\(\(id\) => !present\.has\(id\)\)/,
  "Coverage backfill only fetches harnesses the daemon aggregate omitted",
);

assert.match(
  source,
  /supplementClaudeSkills/,
  "Claude manifests are supplemented with the local ~/.claude/skills scan",
);

assert.match(
  source,
  /source: "local-scan"/,
  "Supplemented skills are labeled local-scan so daemon-reported entries stay distinguishable",
);

assert.match(
  source,
  /\.filter\(\(s\) => !seen\.has\(s\.id\)\)/,
  "Daemon-reported skills win over the local scan on id collisions",
);

console.log("capabilities route.test.ts: ok");
