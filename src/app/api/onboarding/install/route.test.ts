// @ts-nocheck
// The install route is intentionally source-pinned: its safety boundary is
// that a browser may name a reviewed target but cannot influence execution.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("./install-service.ts", import.meta.url),
  "utf8",
);
const installOutput = await readFile(new URL("./install-job-output.ts", import.meta.url), "utf8");

assert.match(source, /"managed-node": \{[\s\S]*kind: "managed-node"/);
assert.match(
  source,
  /"coven-cli": \{[\s\S]*packageName: reviewedPackage\("coven-cli"\)/,
  "the Coven CLI update action installs the reviewed maintenance-compatible package",
);
for (const id of ["runtime-codex", "runtime-claude", "runtime-copilot", "runtime-openclaw"]) {
  assert.match(source, new RegExp(`reviewedPackage\\("${id}"\\)`));
}
assert.equal(
  (source.match(/@latest/g) ?? []).length,
  0,
  "installer targets must not bypass the reviewed prerequisite manifest",
);
assert.match(
  source,
  /targetName === "coven-cli"[\s\S]*covenBin\(\)[\s\S]*npmForDetectedCoven\(detected\)/,
  "the Coven CLI update resolves host npm for the detected CLI instead of requiring Cave-managed Node",
);
assert.match(
  source,
  /async function npmForDetectedCoven[\s\S]*npmBesideDetectedCoven\(detected\)[\s\S]*commandPath\("npm", \{ refresh: true, refreshOnMiss: true \}\)/,
  "a user-scoped Coven launcher may use host npm when npm is not colocated with the global bin",
);
assert.match(source, /targetName === "coven-cli"[\s\S]*npmLaunchCommandForPath/);
assert.match(
  source,
  /verificationPath: detected[\s\S]*verifyOpenCovenToolInstall\(targetName, \{[\s\S]*binaryPath: plan\.verificationPath,[\s\S]*env: plan\.env/,
  "post-install verification checks the exact CLI launcher that npm targeted",
);
assert.match(
  source,
  /function isVerifiedReviewedInstallSuccess[\s\S]*verification\.current === reviewed\.version/,
  "the pinned Coven install verifies the reviewed version instead of npm latest",
);
assert.doesNotMatch(
  source,
  /!isVerifiedOpenCovenInstallSuccess\(code, verification\)/,
  "the Coven install path must not require the mutable npm latest tag",
);
assert.match(
  source,
  /resolveStaleOpenCovenLaunchers\([\s\S]*targetName === "coven-cli"[\s\S]*reviewedPackageManifest\("coven-cli"\)\.version/,
  "stale-launcher repair verifies the pinned replacement against the reviewed version",
);
assert.match(
  source,
  /hostNpmSpawnEnv\([\s\S]*NPM_CONFIG_PREFIX/,
  "the Coven CLI update targets the detected CLI's npm prefix",
);
assert.match(
  source,
  /hostNpmSpawnEnv\([\s\S]*\/\^npm_\/i[\s\S]*delete env\[key\]/,
  "pnpm lifecycle config cannot filter npm's latest release",
);
assert.doesNotMatch(source, /curl -fsSL|\birm https?:\/\//i, "one-click installs never use mutable script targets");
assert.doesNotMatch(source, /installHermesShim|targetName === "hermes"/, "Hermes remains manual-only");
assert.match(source, /await probeManagedNodeToolchain\(\)/, "pinned prerequisite installs require the Cave-managed toolchain");
assert.match(source, /managedNpmLaunch\(managed\.paths\)/, "npm runs through owned node and npm-cli.js");
assert.match(source, /args: \[\.\.\.launch\.args, "install", "--global", target\.packageName\]/, "npm argv is fixed and reviewed");
assert.match(source, /shell: false/, "installer spawns never use a shell");
assert.match(source, /commandPath\("npm", \{ refresh: true, refreshOnMiss: true \}\)/, "Coven CLI repair falls back to verified host npm only for its detected prefix");
assert.match(source, /installManagedNodeToolchain\(/, "managed Node installer is routed through the endpoint");
assert.match(source, /controller\.abort\(\)/, "managed Node installation supports cancellation");
assert.match(source, /reserveGlobalNpmInstall\(targetName\)/, "managed toolchain and npm operations serialize");
assert.match(source, /if \(body\.confirmInstall !== true\)/, "installation requires explicit confirmation");
assert.equal(source.match(/rejectNonLocalRequest\(req\)/g)?.length, 3, "all route methods are local-only");
assert.doesNotMatch(source, /spawn\([^)]*body\./, "request values never reach spawn");
assert.match(source, /verifyOpenCovenToolInstall\(targetName, \{/, "Coven uses authoritative post-install verification");
assert.match(source, /prepareDaemonForCliUpdate\(dependencies\)/, "Coven updates preserve daemon lifecycle handling");
assert.match(source, /recoverDaemonAfterCliUpdate\(job\.daemon, daemonLifecycleDependencies\(job\)\)/, "Coven daemon is recovered after install");
assert.match(installOutput, /redactSensitiveInstallOutput/, "installer output is redacted");

console.log("onboarding install route.test.ts: ok");
