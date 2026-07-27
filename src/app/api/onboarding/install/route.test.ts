// @ts-nocheck
// The install route is intentionally source-pinned: its safety boundary is
// that a browser may name a reviewed target but cannot influence execution.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");
const installOutput = await readFile(new URL("./install-job-output.ts", import.meta.url), "utf8");

assert.match(source, /"managed-node": \{[\s\S]*kind: "managed-node"/);
assert.match(
  source,
  /"coven-cli": \{[\s\S]*packageName: "@opencoven\/cli@latest"/,
  "the Coven CLI update action installs the latest published package",
);
for (const id of ["runtime-codex", "runtime-claude", "runtime-copilot", "runtime-openclaw"]) {
  assert.match(source, new RegExp(`reviewedPackage\\("${id}"\\)`));
}
assert.equal(
  source.match(/@latest/g)?.length,
  1,
  "only the Coven CLI self-update action may use a mutable package target",
);
assert.doesNotMatch(source, /curl -fsSL|\birm https?:\/\//i, "one-click installs never use mutable script targets");
assert.doesNotMatch(source, /installHermesShim|targetName === "hermes"/, "Hermes remains manual-only");
assert.match(source, /await probeManagedNodeToolchain\(\)/, "npm plans require the Cave-managed toolchain");
assert.match(source, /managedNpmLaunch\(managed\.paths\)/, "npm runs through owned node and npm-cli.js");
assert.match(source, /args: \[\.\.\.launch\.args, "install", "--global", target\.packageName\]/, "npm argv is fixed and reviewed");
assert.match(source, /shell: false/, "installer spawns never use a shell");
assert.doesNotMatch(source, /commandPath\("npm"/, "host npm/PATH is not a prerequisite");
assert.match(source, /installManagedNodeToolchain\(/, "managed Node installer is routed through the endpoint");
assert.match(source, /controller\.abort\(\)/, "managed Node installation supports cancellation");
assert.match(source, /reserveGlobalNpmInstall\(targetName\)/, "managed toolchain and npm operations serialize");
assert.match(source, /if \(body\.confirmInstall !== true\)/, "installation requires explicit confirmation");
assert.equal(source.match(/rejectNonLocalRequest\(req\)/g)?.length, 3, "all route methods are local-only");
assert.doesNotMatch(source, /spawn\([^)]*body\./, "request values never reach spawn");
assert.match(source, /verifyOpenCovenToolInstall\(targetName\)/, "Coven uses authoritative post-install verification");
assert.match(source, /prepareDaemonForCliUpdate\(dependencies\)/, "Coven updates preserve daemon lifecycle handling");
assert.match(source, /recoverDaemonAfterCliUpdate\(job\.daemon, daemonLifecycleDependencies\(job\)\)/, "Coven daemon is recovered after install");
assert.match(installOutput, /redactSensitiveInstallOutput/, "installer output is redacted");

console.log("onboarding install route.test.ts: ok");
