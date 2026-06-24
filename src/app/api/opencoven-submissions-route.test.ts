// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./opencoven/submissions/route.ts", import.meta.url),
  "utf8",
);

assert.match(source, /export async function GET/);
assert.match(source, /export async function POST/);
assert.match(source, /invalid json body/i, "submission route should guard malformed JSON");
assert.match(source, /validateSubmissionPackage/, "POST should validate the uploaded OpenCoven package");
assert.match(source, /catalogEntriesFromSubmissions/, "route should publish through OpenCoven catalog projection");
assert.match(source, /resolveExecutionRoute/, "route should expose execution routing from harness to runtime");
assert.match(source, /packagePayload/, "POST should accept one package payload, not separate bespoke integration fields");
assert.match(source, /type:\s*"runtime"[\s\S]*type:\s*"harness"/, "route should keep Runtime and Harness as the only submission choices");
assert.doesNotMatch(source, /clawhub|openclaw/i, "OpenCoven submissions must not route through ClawHub or OpenClaw");

console.log("opencoven-submissions-route.test.ts: ok");
