// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./opencoven/executions/route.ts", import.meta.url),
  "utf8",
);

assert.match(source, /export async function POST/);
assert.match(source, /invalid json body/i, "execution route should guard malformed JSON");
assert.match(source, /harnessId/, "execution requests should select a harness");
assert.match(source, /runtimeId/, "execution requests may pin a runtime");
assert.match(source, /buildExecutionPlan/, "execution route should build an OpenCoven execution-service plan");
assert.match(source, /loadOpenCovenSubmissions/, "execution route should resolve against the OpenCoven catalog");
assert.match(source, /opencoven\.execution\.v1/, "execution route should expose the OpenCoven execution-service contract");
assert.doesNotMatch(source, /clawhub|openclaw/i, "OpenCoven executions must not route through external publishing paths");

console.log("opencoven-executions-route.test.ts: ok");
