import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  CLIENT_V1_HEALTH_PATH,
  DEFAULT_ORIGIN,
  checkHealthEnvelope,
  checkInstanceStability,
  contractExpectations,
  packageVersion,
  parseOrigin,
} from "./client-v1-release-smoke.mjs";

const expected = { apiVersion: "1.0", minimumClientVersion: "0.1.0", releaseVersion: "0.3.6" };

function healthEnvelope(overrides = {}, dataOverrides = {}) {
  return {
    apiVersion: "1.0",
    minimumClientVersion: "0.1.0",
    capabilities: ["pairing"],
    data: {
      instanceId: "6f1d2c94-1f0b-4d3e-8a77-6b6f2a4c9d10",
      pairingRequired: true,
      releaseVersion: "0.3.6",
      ...dataOverrides,
    },
    ...overrides,
  };
}

test("passes a well-formed release health envelope", () => {
  assert.deepEqual(checkHealthEnvelope(healthEnvelope(), expected), []);
});

test("reports every broken field in one run", () => {
  // One rebuild per failure is the cost of stopping at the first, so the
  // checker must accumulate.
  const failures = checkHealthEnvelope(
    healthEnvelope({ apiVersion: "2.0", capabilities: [] }, { releaseVersion: "0.0.0" }),
    expected,
  );
  assert.equal(failures.length, 3);
  assert.equal(failures.some((entry) => entry.includes("apiVersion")), true);
  assert.equal(failures.some((entry) => entry.includes("capabilities")), true);
  assert.equal(failures.some((entry) => entry.includes("releaseVersion")), true);
});

test("catches a release that admits clients the contract rejects", () => {
  // A non-empty check passed this: minimumClientVersion decides whether a
  // client may pair at all, so a build carrying a lower one lets every too-old
  // client through while the smoke reports ok.
  const failures = checkHealthEnvelope(healthEnvelope({ minimumClientVersion: "0.0.1" }), expected);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /minimumClientVersion is "0\.0\.1", expected "0\.1\.0"/);
  assert.equal(checkHealthEnvelope(healthEnvelope({ minimumClientVersion: "" }), expected).length, 1);
});

test("reads the expected versions from the reviewed contract fixture", () => {
  // Literals here would drift the moment contract.ts changed and nothing would
  // say so. The fixture is sha256-gated, so it cannot change unreviewed.
  const fixture = JSON.parse(readFileSync(new URL("../src/lib/server/client-v1/contract-fixture.json", import.meta.url), "utf8"));
  assert.deepEqual(contractExpectations(), {
    apiVersion: fixture.contract.apiVersion,
    minimumClientVersion: fixture.contract.minimumClientVersion,
  });
  assert.deepEqual(checkHealthEnvelope(healthEnvelope(), { ...contractExpectations(), releaseVersion: "0.3.6" }), []);
});

test("catches an unstamped release version", () => {
  // The failure this smoke exists for: a build that shipped without the
  // release stamp still answers 200 and looks healthy.
  const failures = checkHealthEnvelope(healthEnvelope({}, { releaseVersion: "0.0.0" }), expected);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /releaseVersion/);
});

test("refuses a health response that weakens the pairing requirement", () => {
  const failures = checkHealthEnvelope(healthEnvelope({}, { pairingRequired: false }), expected);
  assert.deepEqual(failures.map((entry) => entry.includes("pairingRequired")), [true]);
});

test("refuses an error envelope, a missing data record, and a non-object body", () => {
  assert.equal(
    checkHealthEnvelope({ ...healthEnvelope(), error: { code: "internal_error" } }, expected).some(
      (entry) => entry.includes("error envelope"),
    ),
    true,
  );
  const noData = healthEnvelope();
  delete noData.data;
  assert.deepEqual(checkHealthEnvelope(noData, expected), ["health response has no data record"]);
  assert.deepEqual(checkHealthEnvelope("not json", expected), ["health response is not a JSON object"]);
  assert.deepEqual(checkHealthEnvelope(null, expected), ["health response is not a JSON object"]);
  assert.deepEqual(checkHealthEnvelope([], expected), ["health response is not a JSON object"]);
});

test("requires the instance id to survive between reads", () => {
  assert.deepEqual(checkInstanceStability(healthEnvelope(), healthEnvelope()), []);
  const drifted = checkInstanceStability(
    healthEnvelope(),
    healthEnvelope({}, { instanceId: "11111111-1111-4111-8111-111111111111" }),
  );
  assert.equal(drifted.length, 1);
  assert.match(drifted[0], /instanceId changed between reads/);
  assert.deepEqual(checkInstanceStability(healthEnvelope(), {}), [
    "instanceId missing on one of two health reads",
  ]);
});

test("resolves the probe origin from argv", () => {
  assert.equal(parseOrigin([]), DEFAULT_ORIGIN);
  assert.equal(parseOrigin(["--origin", "http://127.0.0.1:3007"]), "http://127.0.0.1:3007");
  // A path is dropped: the script joins CLIENT_V1_HEALTH_PATH onto the origin.
  assert.equal(parseOrigin(["--origin", "http://127.0.0.1:3007/ignored"]), "http://127.0.0.1:3007");
  assert.throws(() => parseOrigin(["--origin"]), /--origin requires a URL/);
  assert.throws(() => parseOrigin(["--origin", "--other"]), /--origin requires a URL/);
  assert.throws(() => parseOrigin(["--origin", "not a url"]), /Invalid URL/);
});

test("reads the expected release version from the repository manifest", () => {
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(packageVersion(), manifest.version);
});

test("targets the versioned client health route", () => {
  assert.equal(CLIENT_V1_HEALTH_PATH, "/api/client/v1/health");
});

console.log("client-v1-release-smoke contract: ok");
