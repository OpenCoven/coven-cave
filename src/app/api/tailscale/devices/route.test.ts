// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
assert.match(route, /export const runtime = "nodejs"/);
assert.match(route, /export const dynamic = "force-dynamic"/);
assert.match(route, /loadTailscaleDevices\(\)/);
assert.match(route, /NextResponse\.json\(result\)/, "fail-soft typed failures should remain HTTP 200");
