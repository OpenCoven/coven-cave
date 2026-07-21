// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

assert.match(
  source,
  /collapseFamiliarWorkspace\s*=\s*\n?\s*url\.searchParams\.get\("collapseFamiliarWorkspace"\)\s*===\s*"1"/,
  "the list route parses the opt-in collapseFamiliarWorkspace query param",
);

assert.match(
  source,
  /cacheKey\s*=[\s\S]{0,160}collapseFamiliarWorkspace\s*\?\s*"collapse"\s*:\s*"full"/,
  "the cache key varies by collapse mode so full and collapsed views never alias",
);

assert.match(
  source,
  /computeSessionsList\(includeArchived,\s*familiarId,\s*collapseFamiliarWorkspace\)/,
  "the collapse flag is threaded into computeSessionsList",
);

assert.match(
  source,
  /collapseFamiliarWorkspace\s*\n?\s*\?\s*collapseFamiliarWorkspaceSessions\(/,
  "collapse is applied only when the flag is set (default view stays unfiltered)",
);

console.log("sessions list route.test.ts: ok");
