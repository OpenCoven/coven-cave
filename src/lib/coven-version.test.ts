// @ts-nocheck
import assert from "node:assert/strict";

const { displayCovenVersion, exactSemver, firstSemver } = await import("./coven-version.ts");

assert.equal(firstSemver("coven 0.0.39\n"), "0.0.39");
assert.equal(firstSemver("v1.2.3-beta.1"), "1.2.3-beta.1");
assert.equal(firstSemver("no version here"), null);

assert.equal(exactSemver("v1.2.3-beta.1+build.7"), "1.2.3-beta.1+build.7");
assert.equal(exactSemver(" 0.0.54 "), "0.0.54");
for (const unsafeVersion of [
  "/Users/val/.coven/token",
  "ghp_deadbeef",
  "daemon 1.2.3",
  "1.2.3/../../secret",
  "01.2.3",
  "1.2.3-01",
]) {
  assert.equal(
    exactSemver(unsafeVersion),
    null,
    `rejects a non-semver daemon version: ${unsafeVersion}`,
  );
}

assert.equal(
  displayCovenVersion({ daemonVersion: "0.0.40", installedVersion: "0.0.39" }),
  "0.0.40",
  "non-placeholder daemon health versions should win",
);

assert.equal(
  displayCovenVersion({ daemonVersion: "0.0.0", installedVersion: "0.0.39" }),
  "0.0.39",
  "daemon health placeholder should fall back to the installed Coven CLI version",
);

assert.equal(
  displayCovenVersion({ daemonVersion: undefined, installedVersion: "0.0.39" }),
  "0.0.39",
  "missing daemon health version should fall back to the installed Coven CLI version",
);

assert.equal(
  displayCovenVersion({ daemonVersion: "0.0.0", installedVersion: null }),
  undefined,
  "placeholder daemon health version should not be displayed when no fallback exists",
);

assert.equal(
  displayCovenVersion({
    daemonVersion: "/Users/val/.coven/secret-token",
    installedVersion: "0.0.39",
  }),
  "0.0.39",
  "an unsafe remote daemon version must not be forwarded by the status route",
);

assert.equal(
  displayCovenVersion({ daemonVersion: "daemon 1.2.3", installedVersion: null }),
  undefined,
  "embedded semver text is not an exact daemon version",
);

console.log("coven-version.test.ts: ok");
