// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync(
  new URL("./api/onboarding/install/route.ts", import.meta.url),
  "utf8",
);

assert.match(
  route,
  /function finishInstallJobError\([\s\S]*?job\.status = "done";[\s\S]*?job\.ok = false;[\s\S]*?job\.error = installStartErrorMessage\(err\);/,
  "install route should have a shared finalizer for start failures",
);

assert.match(
  route,
  /function installStartErrorMessage\([\s\S]*?resource temporarily unavailable[\s\S]*?Cave could not start the installer because the system is temporarily out of process slots/,
  "install route should turn process exhaustion into a user-facing retryable job error",
);

assert.match(
  route,
  /void \(async \(\) => \{\s*try \{[\s\S]*?const child = spawn\(plan\.command, plan\.args,[\s\S]*?\} catch \(err\) \{\s*finishInstallJobError\(job, err\);/,
  "fire-and-forget installer task should catch synchronous spawn failures",
);

assert.doesNotMatch(
  route,
  /command:\s*["']sudo["']|passwordlessSudoAvailable|(?:spawn|execFileAsync)\(\s*["']sudo["']|\[\s*["']-n["']/,
  "install route must not auto-elevate npm installs with sudo",
);

assert.match(
  route,
  /Do not elevate from this API route:[\s\S]*?Require the[\s\S]*?operator to run the sudo command manually instead/,
  "install route should require manual sudo when global npm dirs are not writable",
);

console.log("onboarding-install-route.test.ts OK");
