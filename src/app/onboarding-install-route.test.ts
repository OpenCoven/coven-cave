// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync(
  new URL("./api/onboarding/install/route.ts", import.meta.url),
  "utf8",
);
const npmLane = readFileSync(
  new URL("../lib/server/global-npm-install-lane.ts", import.meta.url),
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

assert.match(
  route,
  /"coven-cli": \{[\s\S]*?packageName: "@opencoven\/cli@latest"[\s\S]*?"coven-code": \{[\s\S]*?packageName: "@opencoven\/coven-code@latest"/,
  "Coven recovery only accepts the fixed allowlisted CLI and scoped Code packages",
);

assert.match(
  route,
  /reserveGlobalNpmInstall\(targetName\)[\s\S]*?return npmBusyResponse\(owner\)/,
  "all npm installers reserve the shared global npm lane before starting",
);

assert.match(
  route,
  /function npmBusyResponse\([\s\S]*?status: 409/,
  "a competing npm installer receives an actionable busy response",
);

assert.match(
  npmLane,
  /function reserveGlobalNpmInstall\(target: string\)[\s\S]*?if \(current\.target\) return \{ ok: false, owner: current\.target \};[\s\S]*?current\.target = target/,
  "the global npm lane atomically rejects a competing owner before recording a new one",
);

assert.match(
  route,
  /npmMissing: true,[\s\S]*?hint: nodeInstallHint\(\)/,
  "missing npm returns an actionable Node installation hint",
);

assert.match(
  route,
  /sudoRequired: true,[\s\S]*?global npm directory from this API route[\s\S]*?plan\.packageName/,
  "global-prefix permission failures return a copyable manual recovery command",
);

assert.match(
  route,
  /\(EACCES\|EPERM\|EROFS\|permission denied\)[\s\S]*?npm couldn't write to the global directory/,
  "late npm permission failures remain actionable after an install attempt",
);

console.log("onboarding-install-route.test.ts OK");
