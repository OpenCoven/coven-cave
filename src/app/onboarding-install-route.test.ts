// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync(
  new URL("./api/onboarding/install/install-service.ts", import.meta.url),
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
  /async function finishInstallJob\([\s\S]*?recoverDaemonAfterCliInstall\(targetName, job\)[\s\S]*?finally \{[\s\S]*?releaseNpmLease\(job, npmLease\);/,
  "the shared npm lease should be released and traced only after daemon recovery finishes",
);

assert.doesNotMatch(
  route,
  /command:\s*["']sudo["']|passwordlessSudoAvailable|(?:spawn|execFileAsync)\(\s*["']sudo["']|\[\s*["']-n["']/,
  "install route must not auto-elevate npm installs with sudo",
);

assert.match(
  route,
  /Coven CLI repair:[\s\S]*?npm beside[\s\S]*?the detected CLI/,
  "the reviewed CLI repair must use the npm installation that owns the detected CLI",
);

assert.match(
  route,
  /"coven-cli": \{[\s\S]*?packageName: reviewedPackage\("coven-cli"\)/,
  "the Coven CLI button installs the reviewed maintenance-compatible package",
);
assert.doesNotMatch(
  route,
  /"coven-code":\s*\{/,
  "coven-code is no longer a separate install target after unification",
);

assert.match(
  route,
  /reserveGlobalNpmInstall\(targetName\)[\s\S]*?return npmBusyResult\(owner\)/,
  "all npm installers reserve the shared global npm lane before starting",
);

assert.match(
  route,
  /function npmBusyResult\([\s\S]*?status: 409/,
  "a competing npm installer receives a reusable actionable busy result",
);

assert.match(
  npmLane,
  /function reserveGlobalNpmInstall\(target: string\)[\s\S]*?if \(current\.target\) return \{ ok: false, owner: current\.target \};[\s\S]*?current\.target = target/,
  "the global npm lane atomically rejects a competing owner before recording a new one",
);

assert.match(
  route,
  /managedNodeMissing: true,[\s\S]*?hint: managedNodeInstallHint\(\)/,
  "a missing managed toolchain returns an actionable Node installation hint",
);

assert.match(
  route,
  /const launch = managedNpmLaunch\(managed\.paths\);[\s\S]*?args: \[\.\.\.launch\.args, "install", "--global", target\.packageName\]/,
  "pinned prerequisite installs use the managed Node.js/npm launch plan",
);

assert.doesNotMatch(
  route,
  /sudoRequired: true|global npm directory from this API route|npm couldn't write to the global directory/,
  "managed installs do not surface stale host-global npm recovery guidance",
);

console.log("onboarding-install-route.test.ts OK");
