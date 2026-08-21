#!/usr/bin/env node

/**
 * Client v1 release smoke.
 *
 * Proves that a *running, release-mode* Cave serves a Client v1 health
 * contract an external client can actually pair against. The unit tests around
 * `src/lib/server/client-v1/` check the contract module in isolation; this
 * checks the assembled artifact, which is where release-only breakage lives —
 * a route dropped from the build, an env-dependent field that is empty when
 * `next build` runs it, a version that never got stamped.
 *
 * Usage:
 *   node scripts/client-v1-release-smoke.mjs [--origin http://127.0.0.1:3000]
 *
 * Exits 0 on pass, 1 on failure, and prints one line per assertion.
 *
 * SCOPE. The Phase 7 plan also specifies a pair / read / revoke / expect-401
 * leg. That leg is NOT implemented here because the routes it drives do not
 * exist yet: on this commit `src/app/api/client/v1/` contains only `health`,
 * and `src/lib/server/client-v1/contract.ts` still describes itself as
 * foundation-only with no route DTOs. Asserting against routes that 404 would
 * make the smoke fail for a reason unrelated to the release. It is tracked as
 * its own step on bead cave-0wg and lands with the pairing routes.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");

export const DEFAULT_ORIGIN = "http://127.0.0.1:3000";
export const CLIENT_V1_HEALTH_PATH = "/api/client/v1/health";

export function packageVersion(root = repositoryRoot) {
  const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  return manifest.version;
}

export function contractFixturePath(root = repositoryRoot) {
  return path.join(root, "src", "lib", "server", "client-v1", "contract-fixture.json");
}

function requiredFixtureVersion(value, field, fixturePath) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`contract fixture ${fixturePath} declares no usable ${field}`);
  }
  return value;
}

/**
 * The versions a release build must answer with, read from the reviewed
 * fixture rather than repeated as literals here.
 *
 * `minimumClientVersion` is the field that decides whether a client may pair at
 * all, so a release carrying a lower one silently admits clients the contract
 * rejects — exactly the release-only break this script exists to catch, and
 * invisible to a "non-empty string" check. The fixture is the deterministic
 * serialisation of contract.ts and is sha256-gated, so reading it keeps this
 * script honest without importing TypeScript into a plain .mjs probe.
 *
 * Every value is checked before it is returned, and the failure names the
 * fixture. The fixture lives in the checkout this script ships in, not in the
 * build being probed, so a read that fails says nothing about the release — and
 * a bare ENOENT on exit 1 reads exactly like one that does.
 */
export function contractExpectations(root = repositoryRoot) {
  const fixturePath = contractFixturePath(root);
  let fixture;
  try {
    fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
  } catch (error) {
    throw new Error(
      `cannot read the contract fixture at ${fixturePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const contract = typeof fixture === "object" && fixture !== null ? fixture.contract : undefined;
  return {
    apiVersion: requiredFixtureVersion(contract?.apiVersion, "apiVersion", fixturePath),
    minimumClientVersion: requiredFixtureVersion(
      contract?.minimumClientVersion,
      "minimumClientVersion",
      fixturePath,
    ),
  };
}

export function parseOrigin(argv) {
  const index = argv.indexOf("--origin");
  if (index === -1) return DEFAULT_ORIGIN;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error("--origin requires a URL, for example --origin http://127.0.0.1:3000");
  }
  // Reject a malformed origin here rather than letting fetch fail later with a
  // message that reads like the server is down.
  return new URL(value).origin;
}

/**
 * Assert the health envelope a release build must serve.
 *
 * Returns the list of failures rather than throwing on the first one, so a
 * single run reports every broken field instead of forcing one rebuild per
 * fix. Kept pure and exported so it is unit-testable without a live server.
 */
const EXPECTED_VERSION_FIELDS = ["apiVersion", "minimumClientVersion", "releaseVersion"];

export function checkHealthEnvelope(envelope, expected) {
  const failures = [];
  const record = (ok, message) => {
    if (!ok) failures.push(message);
  };

  // An expectation that is not a usable string makes its own comparison
  // vacuous — `undefined === undefined` records a pass — so a release that
  // omitted the field entirely would be reported ok. These equality checks
  // replaced the independent shape checks that used to catch that
  // unconditionally, which leaves this as the only thing between a truncated
  // fixture or an unstamped manifest and a smoke that asserts nothing.
  const unusable = EXPECTED_VERSION_FIELDS.filter(
    (field) => typeof expected?.[field] !== "string" || expected[field].trim().length === 0,
  );
  if (unusable.length > 0) {
    return [`expected ${unusable.join(", ")} unusable; the smoke cannot judge a release against an incomplete expectation`];
  }

  if (typeof envelope !== "object" || envelope === null || Array.isArray(envelope)) {
    return ["health response is not a JSON object"];
  }

  record(envelope.error === undefined, "health response carries an error envelope");
  record(envelope.apiVersion === expected.apiVersion, `apiVersion is ${JSON.stringify(envelope.apiVersion)}, expected ${JSON.stringify(expected.apiVersion)}`);
  record(
    envelope.minimumClientVersion === expected.minimumClientVersion,
    `minimumClientVersion is ${JSON.stringify(envelope.minimumClientVersion)}, expected ${JSON.stringify(expected.minimumClientVersion)}`,
  );
  record(
    Array.isArray(envelope.capabilities) && envelope.capabilities.length > 0,
    "capabilities is missing or empty",
  );

  const data = envelope.data;
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    failures.push("health response has no data record");
    return failures;
  }

  record(
    typeof data.instanceId === "string" && data.instanceId.trim().length > 0,
    "instanceId is missing or empty",
  );
  record(data.pairingRequired === true, `pairingRequired is ${JSON.stringify(data.pairingRequired)}, expected true`);
  record(
    data.releaseVersion === expected.releaseVersion,
    `releaseVersion is ${JSON.stringify(data.releaseVersion)}, expected ${JSON.stringify(expected.releaseVersion)}`,
  );

  return failures;
}

/** The instance id must survive across requests, or cached pairings churn. */
export function checkInstanceStability(first, second) {
  const a = first?.data?.instanceId;
  const b = second?.data?.instanceId;
  if (typeof a !== "string" || typeof b !== "string") return ["instanceId missing on one of two health reads"];
  return a === b ? [] : [`instanceId changed between reads: ${a} then ${b}`];
}

async function readHealth(origin) {
  const response = await fetch(new URL(CLIENT_V1_HEALTH_PATH, origin));
  if (!response.ok) {
    throw new Error(`GET ${CLIENT_V1_HEALTH_PATH} returned HTTP ${response.status}`);
  }
  return response.json();
}

async function main(argv) {
  const origin = parseOrigin(argv);
  const expected = { ...contractExpectations(), releaseVersion: packageVersion() };

  console.log(`client-v1-release-smoke: probing ${origin}${CLIENT_V1_HEALTH_PATH}`);
  const first = await readHealth(origin);
  const second = await readHealth(origin);

  const failures = [
    ...checkHealthEnvelope(first, expected),
    ...checkInstanceStability(first, second),
  ];

  if (failures.length > 0) {
    for (const failure of failures) console.error(`client-v1-release-smoke: FAIL ${failure}`);
    return 1;
  }

  console.log(`client-v1-release-smoke: ok (release ${expected.releaseVersion}, instance ${first.data.instanceId})`);
  return 0;
}

// `import.meta.main` is not available on the Node versions this repo pins, so
// compare the entry path instead — the module must stay importable by its test.
const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(`client-v1-release-smoke: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    },
  );
}
