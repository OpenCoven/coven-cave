// @ts-nocheck
import assert from "node:assert/strict";

const { displayCovenVersion, firstSemver } = await import("./coven-version.ts");

assert.equal(firstSemver("coven 0.0.39\n"), "0.0.39");
assert.equal(firstSemver("v1.2.3-beta.1"), "1.2.3-beta.1");
assert.equal(firstSemver("no version here"), null);

assert.equal(
  displayCovenVersion({ daemonVersion: "0.0.40", installedVersion: "0.0.39" }),
  "0.0.40",
  "non-placeholder daemon health versions should win",
);

assert.equal(
  displayCovenVersion({ daemonVersion: "0.0.0", installedVersion: "0.0.39" }),
  "0.0.39",
  "daemon health placeholder should fall back to the installed coven CLI version",
);

assert.equal(
  displayCovenVersion({ daemonVersion: undefined, installedVersion: "0.0.39" }),
  "0.0.39",
  "missing daemon health version should fall back to the installed coven CLI version",
);

assert.equal(
  displayCovenVersion({ daemonVersion: "0.0.0", installedVersion: null }),
  undefined,
  "placeholder daemon health version should not be displayed when no fallback exists",
);

console.log("coven-version.test.ts: ok");
