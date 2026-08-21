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

/**
 * The release version this build should be answering with.
 *
 * Validated for the same reason the fixture is: it is read from the checkout
 * this script ships in, not from the build being probed, so an unusable value
 * says nothing about the release. Unvalidated it returned `undefined` for a
 * manifest carrying no `version`, which reached checkHealthEnvelope and was
 * announced on the FAIL channel — a broken harness reported as a broken
 * release, the exact confusion contractExpectations is wrapped to prevent.
 */
export function packageVersion(root = repositoryRoot) {
  const manifestPath = path.join(root, "package.json");
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(`cannot read the release manifest at ${manifestPath}: ${describe(error)}`, { cause: error });
  }
  const version = typeof manifest === "object" && manifest !== null ? manifest.version : undefined;
  return requiredVersion(version, "version", `release manifest ${manifestPath}`);
}

export function contractFixturePath(root = repositoryRoot) {
  return path.join(root, "src", "lib", "server", "client-v1", "contract-fixture.json");
}

function describe(error) {
  return error instanceof Error ? error.message : String(error);
}

function requiredVersion(value, field, source) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${source} declares no usable ${field}`);
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
    throw new Error(`cannot read the contract fixture at ${fixturePath}: ${describe(error)}`, { cause: error });
  }
  const contract = typeof fixture === "object" && fixture !== null ? fixture.contract : undefined;
  const source = `contract fixture ${fixturePath}`;
  return {
    apiVersion: requiredVersion(contract?.apiVersion, "apiVersion", source),
    minimumClientVersion: requiredVersion(contract?.minimumClientVersion, "minimumClientVersion", source),
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

/** The three fields judged by comparison against the expectation, not by shape. */
const EXPECTED_VERSION_FIELDS = ["apiVersion", "minimumClientVersion", "releaseVersion"];

/**
 * Assert the health envelope a release build must serve.
 *
 * Returns the list of failures rather than throwing on the first one, so a
 * single run reports every broken field instead of forcing one rebuild per
 * fix. Kept pure and exported so it is unit-testable without a live server.
 */
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
  //
  // It disables only the three comparisons it actually undermines. Refusing the
  // whole envelope here also discarded the five checks that never consult the
  // expectation — the error envelope, capabilities, the data record, instanceId,
  // pairingRequired — so a broken body scored 1 failure where it scores 7 under
  // a complete expectation, and the accumulate-every-field contract above held
  // only while the harness was intact.
  const unusable = new Set(
    EXPECTED_VERSION_FIELDS.filter(
      (field) => typeof expected?.[field] !== "string" || expected[field].trim().length === 0,
    ),
  );
  if (unusable.size > 0) {
    failures.push(
      `expected ${[...unusable].join(", ")} unusable; the smoke cannot judge a release against an incomplete expectation`,
    );
  }

  if (typeof envelope !== "object" || envelope === null || Array.isArray(envelope)) {
    failures.push("health response is not a JSON object");
    return failures;
  }

  record(envelope.error === undefined, "health response carries an error envelope");
  record(
    unusable.has("apiVersion") || envelope.apiVersion === expected.apiVersion,
    `apiVersion is ${JSON.stringify(envelope?.apiVersion)}, expected ${JSON.stringify(expected?.apiVersion)}`,
  );
  record(
    unusable.has("minimumClientVersion") || envelope.minimumClientVersion === expected.minimumClientVersion,
    `minimumClientVersion is ${JSON.stringify(envelope?.minimumClientVersion)}, expected ${JSON.stringify(expected?.minimumClientVersion)}`,
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
    unusable.has("releaseVersion") || data.releaseVersion === expected.releaseVersion,
    `releaseVersion is ${JSON.stringify(data.releaseVersion)}, expected ${JSON.stringify(expected?.releaseVersion)}`,
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

/**
 * How long one health read may take before the probe gives up.
 *
 * Without it a release that accepts the connection and never answers — a Next
 * server still compiling, a handler wedged on a synchronous read of a home that
 * has not mounted — hangs this script forever. That is the one outcome its
 * contract does not allow: it promises exit 0 or exit 1, and an unbounded wait
 * turns a diagnosable failure into a CI job timeout with no output. Health does
 * no work beyond a memoised id, so seconds is already far past generous.
 */
export const HEALTH_READ_TIMEOUT_MS = 10_000;

export async function readHealth(origin, fetchImpl = fetch) {
  const url = new URL(CLIENT_V1_HEALTH_PATH, origin);
  let response;
  try {
    response = await fetchImpl(url, { signal: AbortSignal.timeout(HEALTH_READ_TIMEOUT_MS) });
  } catch (error) {
    // Neither rejection names what was probed: a timeout raises "The operation
    // was aborted due to timeout" and a refused connection "fetch failed". That
    // one line is the whole of what an operator gets on exit 1, so it has to
    // carry the origin, and for a timeout the bound that produced it — a bare
    // abort message reads like a bug in this script rather than a wedged build.
    const reason =
      error?.name === "TimeoutError"
        ? `did not answer within ${HEALTH_READ_TIMEOUT_MS} ms`
        : `is unreachable: ${describe(error)}`;
    throw new Error(`GET ${url} ${reason}`, { cause: error });
  }
  if (!response.ok) {
    throw new Error(`GET ${url} returned HTTP ${response.status}`);
  }
  try {
    return await response.json();
  } catch (error) {
    // A 200 carrying something that is not JSON is a release failure this smoke
    // exists to catch, and the raw parser message names neither the route nor
    // the fact that the status was fine.
    throw new Error(`GET ${url} returned HTTP ${response.status} with a body that is not JSON: ${describe(error)}`, {
      cause: error,
    });
  }
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
