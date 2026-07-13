// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync(
  new URL("./api/onboarding/install/route.ts", import.meta.url),
  "utf8",
);

assert.match(
  route,
  /async function finishInstallJob\([\s\S]*?launchError[\s\S]*?installStartErrorMessage\(launchError\)[\s\S]*?recoverDaemonAfterCliInstall\(targetName, job\)/,
  "install route should finalize start failures through the daemon-recovery path",
);

assert.match(
  route,
  /function installStartErrorMessage\([\s\S]*?resource temporarily unavailable[\s\S]*?Cave could not start the installer because the system is temporarily out of process slots/,
  "install route should turn process exhaustion into a user-facing retryable job error",
);

assert.doesNotMatch(
  route,
  /â€”/,
  "installer recovery copy must not expose a mojibake em dash",
);

assert.match(
  route,
  /void runInstallJob\(targetName, target, plan, job, npmLease\);/,
  "POST should hand the background installer to the shared lifecycle runner",
);

assert.match(
  route,
  /async function runInstallJob\([\s\S]*?child = spawn\(plan\.command, plan\.args,[\s\S]*?\} catch \(err\) \{\s*await finish\(null, null, err\);/,
  "the background lifecycle runner should recover a daemon after synchronous spawn failures",
);

assert.match(
  route,
  /async function finishInstallJob\([\s\S]*?recoverDaemonAfterCliInstall\(targetName, job\)[\s\S]*?finally \{[\s\S]*?npmLease\?\.release\(\);/,
  "the shared npm lease should be released only after daemon recovery finishes",
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
