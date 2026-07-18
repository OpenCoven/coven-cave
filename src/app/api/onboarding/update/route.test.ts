// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const route = await readFile(new URL("./route.ts", import.meta.url), "utf8");
const cache = await readFile(
  new URL("../../../../lib/opencoven-tools-update-cache.ts", import.meta.url),
  "utf8",
);

assert.match(route, /export async function GET\(\)/, "update route exposes cached automatic checks");
assert.match(route, /getOpenCovenToolUpdates\(\)/, "GET uses the SWR cache");
assert.match(route, /export async function POST\(\)/, "update route exposes a manual forced check");
assert.match(route, /forceOpenCovenToolUpdateCheck\(\)/, "POST bypasses a fresh TTL entry");
assert.match(cache, /OPEN_COVEN_UPDATE_TTL_MS = 10 \* 60 \* 1000/, "automatic checks use a ten-minute TTL");
assert.match(cache, /if \(inFlight\) return inFlight/, "concurrent GET and POST checks share one npm lookup");
assert.match(cache, /void refresh\(\);[\s\S]*fromSuccess\("stale", true/, "stale GET data returns while refreshing in the background");
assert.match(cache, /successful \? fromSuccess\("stale"/, "a failed refresh preserves successful data as stale");
assert.match(cache, /freshness: "unavailable"/, "a cold failure is explicit rather than an onboarding failure");

console.log("onboarding-update route.test.ts: ok");
