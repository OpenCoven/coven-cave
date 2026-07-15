import assert from "node:assert/strict";
import {
  evaluateOpenCovenToolVerification,
  isVerifiedOpenCovenInstallSuccess,
  type OpenCovenToolProbe,
} from "./opencoven-tool-verification.ts";

const covenCode = {
  id: "coven-code",
  binary: "coven-code",
  packageName: "@opencoven/coven-code",
  minimumVersion: "0.6.0",
} as const;

const verifiedProbe: OpenCovenToolProbe = {
  path: "C:\\Users\\witch\\AppData\\Roaming\\npm\\coven-code.cmd",
  executablePath:
    "C:\\Users\\witch\\AppData\\Roaming\\npm\\node_modules\\@opencoven\\coven-code\\bin\\coven-code.js",
  executableVerified: true,
  version: "0.7.2",
  packageName: "@opencoven/coven-code",
  packagePath: "C:\\Users\\witch\\AppData\\Roaming\\npm\\node_modules\\@opencoven\\coven-code",
};

const success = evaluateOpenCovenToolVerification(covenCode, verifiedProbe, "0.7.2");
assert.equal(success.ok, true, "a matching npm shim, package entry point, and latest version succeeds");
assert.equal(success.compatible, true);
assert.equal(success.packageVerified, true);
assert.equal(isVerifiedOpenCovenInstallSuccess(0, success), true, "a zero npm exit plus verified tool reports success");
assert.equal(isVerifiedOpenCovenInstallSuccess(1, success), false, "a nonzero npm exit never reports success even if an older valid executable remains on PATH");

const staleShadow = evaluateOpenCovenToolVerification(
  covenCode,
  {
    ...verifiedProbe,
    path: "C:\\stale-bin\\coven-code.cmd",
    executablePath: "C:\\stale-bin\\node_modules\\@opencoven\\coven-code\\bin\\coven-code.js",
    version: "0.6.0",
  },
  "0.7.2",
);
assert.equal(staleShadow.ok, false, "a stale PATH shadow must not report success after npm exits zero");
assert.match(staleShadow.error ?? "", /C:\\stale-bin\\coven-code\.cmd/);
assert.match(staleShadow.error ?? "", /npm latest is 0\.7\.2/);

const wrongPackage = evaluateOpenCovenToolVerification(
  covenCode,
  {
    ...verifiedProbe,
    path: "C:\\legacy\\coven-code.cmd",
    packageName: "coven-code",
    packagePath: "C:\\legacy\\node_modules\\coven-code",
    executablePath: "C:\\legacy\\node_modules\\coven-code\\bin\\coven-code.js",
  },
  "0.7.2",
);
assert.equal(wrongPackage.ok, false, "a launcher from the deprecated bare package is rejected");
assert.match(wrongPackage.error ?? "", /coven-code, not @opencoven\/coven-code/);

const wrongLauncher = evaluateOpenCovenToolVerification(
  covenCode,
  { ...verifiedProbe, executableVerified: false },
  "0.7.2",
);
assert.equal(wrongLauncher.ok, false, "a launcher targeting the wrong file inside a package is rejected");
assert.match(wrongLauncher.error ?? "", /does not point to the coven-code entry point/);

const unreadableVersion = evaluateOpenCovenToolVerification(
  covenCode,
  { ...verifiedProbe, version: null, error: "version-probe-failed" },
  "0.7.2",
);
assert.equal(unreadableVersion.ok, false, "an unreadable version probe is a recovery state, not success");
assert.match(unreadableVersion.error ?? "", /version probe/);

const belowFloor = evaluateOpenCovenToolVerification(
  covenCode,
  { ...verifiedProbe, version: "0.5.9" },
  "0.7.2",
);
assert.equal(belowFloor.ok, false, "a successful install that remains below Cave's floor is rejected");
assert.match(belowFloor.error ?? "", /below the required 0\.6\.0/);
assert.equal(isVerifiedOpenCovenInstallSuccess(0, belowFloor), false, "a zero npm exit cannot override a below-floor post-install result");

const latestUnavailable = evaluateOpenCovenToolVerification(covenCode, verifiedProbe, null);
assert.equal(latestUnavailable.ok, false, "latest-tag verification must complete before the UI can report success");
assert.match(latestUnavailable.error ?? "", /could not read npm's latest version/);

const covenCli = {
  id: "coven-cli",
  binary: "coven",
  packageName: "@opencoven/cli",
  minimumVersion: "0.1.1",
} as const;
const cliProbe = {
  path: "/tmp/prefix/bin/coven",
  executablePath: "/tmp/prefix/lib/node_modules/@opencoven/cli/bin/coven.js",
  executableVerified: true,
  version: "0.0.54",
  packageName: "@opencoven/cli",
  packagePath: "/tmp/prefix/lib/node_modules/@opencoven/cli",
} satisfies OpenCovenToolProbe;
const beforeCliUpdate = evaluateOpenCovenToolVerification(covenCli, cliProbe, "0.1.1");
assert.equal(beforeCliUpdate.ok, false, "the screenshot's 0.0.54 CLI requires an update");
const afterCliUpdate = evaluateOpenCovenToolVerification(
  covenCli,
  { ...cliProbe, version: "0.1.1" },
  "0.1.1",
);
assert.equal(afterCliUpdate.ok, true, "the updated compatible CLI verifies against npm latest");
assert.equal(
  isVerifiedOpenCovenInstallSuccess(0, afterCliUpdate),
  true,
  "a zero npm exit plus the refreshed 0.1.1 probe completes the update",
);

console.log("opencoven-tool-verification.test.ts: ok");
