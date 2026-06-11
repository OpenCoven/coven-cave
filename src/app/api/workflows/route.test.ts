// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const listRoute = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
const validateRoute = readFileSync(new URL("./validate/route.ts", import.meta.url), "utf8");
const dryRunRoute = readFileSync(new URL("./dry-run/route.ts", import.meta.url), "utf8");

assert.match(listRoute, /path:\s*"\/api\/v1\/workflows"/, "GET /api/workflows proxies daemon workflow discovery");
assert.match(validateRoute, /path:\s*"\/api\/v1\/workflows\/validate"/, "validate proxies the daemon validator");
assert.match(dryRunRoute, /path:\s*"\/api\/v1\/workflows\/dry-run"/, "dry-run proxies the daemon planner");

for (const source of [validateRoute, dryRunRoute]) {
  assert.match(source, /let body:\s*unknown\s*=\s*\{\}/, "workflow POST routes should tolerate an empty body");
  assert.match(source, /try\s*\{[\s\S]{0,100}req\.json\(\)[\s\S]{0,100}\}\s*catch\s*\{/, "workflow POST routes should guard malformed JSON");
  assert.match(source, /extractDaemonError/, "workflow routes should surface normalized daemon errors");
}

console.log("workflows route.test.ts: ok");
