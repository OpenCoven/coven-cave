// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const route = await readFile(new URL("./route.ts", import.meta.url), "utf8");

// Method contract (order matters for api-contracts).
assert.match(route, /export async function GET/, "GET handler");
assert.match(route, /export async function POST/, "POST handler");
assert.match(route, /NextResponse\.json/, "returns JSON responses");

// Deterministic pipeline, registry-grounded, no model call.
assert.match(route, /matchPath\(/, "POST runs the deterministic matcher");
assert.match(route, /buildCard\(/, "POST builds a card from the registry");
assert.match(route, /sanitizeCard\(/, "POST sanitizes before returning");
assert.match(route, /REGISTRY_VERSION/, "GET exposes the registry version");
assert.doesNotMatch(route, /spawn\(|fetch\(|anthropic|llms-full/i, "v0 pathfinder makes no model/network call");

// Invalid JSON is guarded (api-contracts requires this string for invalidJson:"guarded").
assert.match(route, /invalid json/i, "guards invalid JSON body");
assert.match(route, /status:\s*400/, "invalid JSON returns 400");

console.log("salem/pathfinder route test: ok");
