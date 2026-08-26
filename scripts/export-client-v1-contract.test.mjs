import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  CLIENT_V1_CONTRACT_FIXTURE_PATH,
  CLIENT_V1_CONTRACT_FIXTURE_SHA256_PATH,
  REVIEWED_CLIENT_V1_CAPABILITIES,
  REVIEWED_CLIENT_V1_OPERATIONS,
  REVIEWED_CLIENT_V1_PUBLIC_ROUTES,
  clientV1ContractFixtureSha256,
  renderClientV1ContractFixture,
} from "./export-client-v1-contract.mjs";
import * as contractExporter from "./export-client-v1-contract.mjs";
import {
  CLIENT_V1_HPKE_VECTOR_PATH,
  CLIENT_V1_HPKE_VECTOR_SHA256_PATH,
} from "./export-client-v1-hpke-vectors.mjs";

const gitAttributes = readFileSync(new URL("../.gitattributes", import.meta.url), "utf8");

function runExporter(...args) {
  return spawnSync(process.execPath, ["scripts/export-client-v1-contract.mjs", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}

function withTrackedFixtureRestored(run) {
  const fixtureBytes = readFileSync(CLIENT_V1_CONTRACT_FIXTURE_PATH);
  const digestBytes = readFileSync(CLIENT_V1_CONTRACT_FIXTURE_SHA256_PATH);

  try {
    return run();
  } finally {
    writeFileSync(CLIENT_V1_CONTRACT_FIXTURE_PATH, fixtureBytes);
    writeFileSync(CLIENT_V1_CONTRACT_FIXTURE_SHA256_PATH, digestBytes);
  }
}

test("documents the tracked client v1 fixture paths and LF normalization", () => {
  assert.equal(
    CLIENT_V1_CONTRACT_FIXTURE_PATH,
    path.join(process.cwd(), "src", "lib", "server", "client-v1", "contract-fixture.json"),
  );
  assert.equal(
    CLIENT_V1_CONTRACT_FIXTURE_SHA256_PATH,
    path.join(process.cwd(), "src", "lib", "server", "client-v1", "contract-fixture.sha256"),
  );
  for (const rule of [
    "src/lib/server/client-v1/contract-fixture.json text eol=lf",
    "src/lib/server/client-v1/contract-fixture.sha256 text eol=lf",
  ]) {
    assert.ok(gitAttributes.split(/\r?\n/u).includes(rule), `.gitattributes must include: ${rule}`);
  }
});

test("checks generated contract bytes without rewriting committed files before any write path runs", () => {
  const beforeFixture = readFileSync(CLIENT_V1_CONTRACT_FIXTURE_PATH);
  const beforeHash = readFileSync(CLIENT_V1_CONTRACT_FIXTURE_SHA256_PATH);
  const result = runExporter("--check");

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(readFileSync(CLIENT_V1_CONTRACT_FIXTURE_PATH), beforeFixture);
  assert.deepEqual(readFileSync(CLIENT_V1_CONTRACT_FIXTURE_SHA256_PATH), beforeHash);
});

test("fails read-only validation when the committed fixture bytes go stale", () => {
  const fixtureBytes = readFileSync(CLIENT_V1_CONTRACT_FIXTURE_PATH);
  const digestBytes = readFileSync(CLIENT_V1_CONTRACT_FIXTURE_SHA256_PATH);

  try {
    writeFileSync(CLIENT_V1_CONTRACT_FIXTURE_PATH, `${fixtureBytes.toString("utf8").replace(/\n$/, "")} stale\n`, "utf8");
    const staleFixture = runExporter("--check");
    assert.notEqual(staleFixture.status, 0, staleFixture.stdout + staleFixture.stderr);
    assert.match(
      staleFixture.stderr || staleFixture.stdout,
      /Client v1 contract fixture is stale/,
    );
  } finally {
    writeFileSync(CLIENT_V1_CONTRACT_FIXTURE_PATH, fixtureBytes);
    writeFileSync(CLIENT_V1_CONTRACT_FIXTURE_SHA256_PATH, digestBytes);
  }
});

test("fails read-only validation when the committed digest bytes go stale", () => {
  const fixtureBytes = readFileSync(CLIENT_V1_CONTRACT_FIXTURE_PATH);
  const digestBytes = readFileSync(CLIENT_V1_CONTRACT_FIXTURE_SHA256_PATH);

  try {
    writeFileSync(CLIENT_V1_CONTRACT_FIXTURE_SHA256_PATH, `${"0".repeat(64)}\n`, "utf8");
    const staleDigest = runExporter("--check");
    assert.notEqual(staleDigest.status, 0, staleDigest.stdout + staleDigest.stderr);
    assert.match(
      staleDigest.stderr || staleDigest.stdout,
      /Client v1 contract fixture is stale/,
    );
  } finally {
    writeFileSync(CLIENT_V1_CONTRACT_FIXTURE_PATH, fixtureBytes);
    writeFileSync(CLIENT_V1_CONTRACT_FIXTURE_SHA256_PATH, digestBytes);
  }
});

test("restores tracked client v1 bytes when a write-path assertion fails", () => {
  const originalFixture = readFileSync(CLIENT_V1_CONTRACT_FIXTURE_PATH);
  const originalHash = readFileSync(CLIENT_V1_CONTRACT_FIXTURE_SHA256_PATH);
  const dirtyFixture = Buffer.from(
    `${originalFixture.toString("utf8").replace(/\n$/, "")}\n// local-only dirty bytes\n`,
    "utf8",
  );
  const dirtyHash = Buffer.from(`${"f".repeat(64)}\n`, "utf8");

  try {
    writeFileSync(CLIENT_V1_CONTRACT_FIXTURE_PATH, dirtyFixture);
    writeFileSync(CLIENT_V1_CONTRACT_FIXTURE_SHA256_PATH, dirtyHash);
    const foundFixture = readFileSync(CLIENT_V1_CONTRACT_FIXTURE_PATH);
    const foundHash = readFileSync(CLIENT_V1_CONTRACT_FIXTURE_SHA256_PATH);

    assert.throws(
      () =>
        withTrackedFixtureRestored(() => {
          const first = runExporter();
          assert.equal(first.status, 0, first.stderr || first.stdout);
          throw new Error("simulated failure after write");
        }),
      /simulated failure after write/,
    );
    assert.deepEqual(readFileSync(CLIENT_V1_CONTRACT_FIXTURE_PATH), foundFixture);
    assert.deepEqual(readFileSync(CLIENT_V1_CONTRACT_FIXTURE_SHA256_PATH), foundHash);
  } finally {
    writeFileSync(CLIENT_V1_CONTRACT_FIXTURE_PATH, originalFixture);
    writeFileSync(CLIENT_V1_CONTRACT_FIXTURE_SHA256_PATH, originalHash);
  }
});

test("exports deterministic client v1 bytes across consecutive writes", () => {
  withTrackedFixtureRestored(() => {
    const first = runExporter();
    assert.equal(first.status, 0, first.stderr || first.stdout);
    const firstFixture = readFileSync(CLIENT_V1_CONTRACT_FIXTURE_PATH, "utf8");
    const firstHash = readFileSync(CLIENT_V1_CONTRACT_FIXTURE_SHA256_PATH, "utf8");

    const second = runExporter();
    assert.equal(second.status, 0, second.stderr || second.stdout);
    const secondFixture = readFileSync(CLIENT_V1_CONTRACT_FIXTURE_PATH, "utf8");
    const secondHash = readFileSync(CLIENT_V1_CONTRACT_FIXTURE_SHA256_PATH, "utf8");

    assert.equal(firstFixture, renderClientV1ContractFixture());
    assert.equal(firstFixture, secondFixture);
    assert.equal(firstHash, secondHash);
    assert.match(firstHash, /^[0-9a-f]{64}\n$/);
    assert.equal(firstHash, clientV1ContractFixtureSha256(firstFixture));
    assert.equal(firstHash, `${createHash("sha256").update(firstFixture).digest("hex")}\n`);
  });
});

test("ratchets the exported fixture to the reviewed Phase 1 public routes", () => {
  const fixture = JSON.parse(renderClientV1ContractFixture());
  assert.deepEqual(fixture.contract.publicRoutes, REVIEWED_CLIENT_V1_PUBLIC_ROUTES);
  assert.equal(fixture.contract.pairingSecretHeader, "x-coven-pairing-secret");
  assert.deepEqual(fixture.contract.discovery, {
    fileName: "client-v1-discovery.json",
    mode: "0600",
    version: 1,
    hpkeBoundVersion: 2,
  });
  // /api/client/v1/health answers with the release-compatibility record, so
  // the exported health envelope has to carry the same shape rather than a
  // bare status the route never sends.
  assert.deepEqual(fixture.examples.healthEnvelope.data, fixture.examples.health);
  assert.deepEqual(Object.keys(fixture.examples.healthEnvelope.data).sort(), [
    "instanceId",
    "pairingRequired",
    "releaseVersion",
  ]);
  assert.equal(typeof fixture.examples.pairingCreatedEnvelope.data.secret, "string");
  assert.equal(typeof fixture.examples.pairingExchangeEnvelope.data.bearer, "string");
});

test("ratchets the complete authority contract and protected operation inventory", () => {
  const reviewedModes = Reflect.get(
    contractExporter,
    "REVIEWED_CLIENT_V1_AUTHORITY_MODES",
  );
  const reviewedProtectedOperations = Reflect.get(
    contractExporter,
    "REVIEWED_CLIENT_V1_HPKE_BOUND_OPERATIONS",
  );
  assert.deepEqual(reviewedModes, ["off", "advertise", "enforce"]);
  assert.deepEqual(reviewedProtectedOperations, [
    "pairing.poll",
    "pairing.exchange",
    "familiars.list",
    "projects.list",
    "conversations.list",
    "conversations.read",
    "messages.list",
  ]);

  const fixture = JSON.parse(renderClientV1ContractFixture());
  assert.deepEqual(fixture.contract.authority, {
    defaultMode: "off",
    modes: reviewedModes,
    mechanism: {
      id: "hpke-bound-v1",
      discoveryVersion: 2,
      suite: {
        kem: "DHKEM(X25519, HKDF-SHA256)",
        kemId: 32,
        kdf: "HKDF-SHA256",
        kdfId: 1,
        aead: "AES-256-GCM",
        aeadId: 2,
      },
      requestHeaders: {
        mechanism: "x-coven-client-v1-authority",
        keyId: "x-coven-client-v1-authority-key-id",
        instanceId: "x-coven-client-v1-authority-instance",
        runtimeNonce: "x-coven-client-v1-authority-runtime-nonce",
        requestNonce: "x-coven-client-v1-authority-request-nonce",
        issuedAt: "x-coven-client-v1-authority-issued-at",
        enc: "x-coven-client-v1-authority-enc",
        ciphertext: "x-coven-client-v1-authority-ciphertext",
      },
      responseMediaType:
        "application/vnd.opencoven.client-v1.hpke-bound-v1+json",
      requestHpkeMode: "base",
      responseHpkeMode: "auth",
      requestEncoding: "headers-plus-rfc8785-json",
      aadEncoding: "u32be-length-prefixed-v1",
      canonicalRoute: "rfc3986-sorted-query-v1",
      keyIdDerivation: "sha256-domain-separated-public-key-v1",
      requestInfo: "OpenCoven/client-v1/hpke-bound-v1/request",
      responseInfo: "OpenCoven/client-v1/hpke-bound-v1/response",
      limits: {
        rawKeyBytes: 32,
        encodedKeyCharacters: 43,
        requestPlaintextBytes: 1024,
        requestCiphertextBytes: 2048,
        requestBodyBytes: 65_536,
        responsePlaintextBytes: 8 * 1024 * 1024,
        responseCiphertextBytes: (8 * 1024 * 1024) + 16,
        responseEnvelopeBytes: 11_185_056,
        canonicalRouteBytes: 2_048,
        instanceIdBytes: 256,
      },
      freshness: {
        maximumAgeMs: 60_000,
        maximumFutureSkewMs: 10_000,
        replayTtlMs: 120_000,
        replayCapacity: 4_096,
      },
      protectedOperations: reviewedProtectedOperations,
      vectorFixture: {
        fileName: "hpke-bound-v1-vectors.json",
        sha256FileName: "hpke-bound-v1-vectors.sha256",
      },
    },
  });
  assert.deepEqual(
    fixture.contract.operations
      .filter((operation) => operation.binding === "hpke-bound-v1")
      .map((operation) => operation.id),
    reviewedProtectedOperations,
  );
  assert.equal(
    JSON.stringify(fixture).match(
      /privateKey|secretKey|senderKey|recipientPrivateKey/gu,
    ),
    null,
  );
});

test("recursively rejects private-key-shaped fixture fields", () => {
  const reject = Reflect.get(
    contractExporter,
    "assertNoPrivateKeyShapedFields",
  );
  assert.equal(typeof reject, "function");
  for (const field of [
    "privateKey",
    "secretKey",
    "senderKey",
    "recipientPrivateKey",
  ]) {
    assert.throws(
      () => reject({ safe: [{ nested: { [field]: "must-never-publish" } }] }),
      /private-key-shaped field/u,
      field,
    );
  }
});

test("independently recomputes the committed normative vector bytes and digest", () => {
  const vectorModuleUrl = new URL(
    "../src/lib/server/client-v1/hpke-bound-v1-vector.ts",
    import.meta.url,
  ).href;
  const source = [
    `import { createClientV1HpkeBoundV1Vector } from ${JSON.stringify(vectorModuleUrl)};`,
    "process.stdout.write(JSON.stringify(await createClientV1HpkeBoundV1Vector()));",
  ].join("\n");
  const result = spawnSync(
    process.execPath,
    [
      "--no-warnings",
      "--experimental-strip-types",
      "--input-type=module",
      "--eval",
      source,
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const generated = JSON.parse(result.stdout);
  const sortJson = (value) => {
    if (Array.isArray(value)) return value.map(sortJson);
    if (value === null || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.keys(value)
        .sort((left, right) => left < right ? -1 : left > right ? 1 : 0)
        .map((key) => [key, sortJson(value[key])]),
    );
  };
  const rendered = `${JSON.stringify(sortJson(generated), null, 2)}\n`;
  const committedBytes = readFileSync(CLIENT_V1_HPKE_VECTOR_PATH);
  const committedDigest = readFileSync(
    CLIENT_V1_HPKE_VECTOR_SHA256_PATH,
    "utf8",
  );
  assert.equal(committedBytes.toString("utf8"), rendered);
  assert.equal(
    committedDigest,
    `${createHash("sha256").update(rendered).digest("hex")}\n`,
  );
});

test("ratchets the exported fixture to the reviewed live capability inventory", () => {
  // The exporter is the refusal gate, so it holds its own copy of the reviewed
  // declaration rather than reading contract.ts and comparing it to itself. A
  // self-comparison passes for any value at all, which is exactly how
  // `streaming` and `revisions` stayed advertised with no owning route (#4869).
  const fixture = JSON.parse(renderClientV1ContractFixture());
  assert.deepEqual(fixture.contract.capabilities, REVIEWED_CLIENT_V1_CAPABILITIES);
  assert.deepEqual(
    fixture.contract.operations.map((operation) => operation.id),
    REVIEWED_CLIENT_V1_OPERATIONS,
  );
  for (const retired of ["streaming", "revisions"]) {
    assert.equal(fixture.contract.capabilities.includes(retired), false, retired);
    assert.equal(
      REVIEWED_CLIENT_V1_OPERATIONS.some((id) => id.startsWith(`${retired}.`)),
      false,
      retired,
    );
  }

  // Every exported record is complete and internally consistent: an id with no
  // method, path or authority class is an entry a client can read and not act
  // on, which is the "advertised but unusable" failure this replaced.
  const families = new Set();
  for (const operation of fixture.contract.operations) {
    assert.match(operation.method, /^(GET|POST|PATCH|DELETE)$/u, operation.id);
    assert.ok(operation.path.startsWith("/api/client/v1/"), operation.path);
    assert.ok(["public", "admin", "authenticated"].includes(operation.ingress), operation.id);
    assert.equal(operation.id.includes(".admin."), operation.ingress === "admin", operation.id);
    assert.equal(operation.scope === null, operation.ingress !== "authenticated", operation.id);
    assert.ok(operation.families.length > 0, operation.id);
    for (const family of operation.families) {
      assert.ok(REVIEWED_CLIENT_V1_CAPABILITIES.includes(family), `${operation.id}: ${family}`);
      families.add(family);
    }
  }
  // No advertised family without a live operation claiming it.
  assert.deepEqual(
    REVIEWED_CLIENT_V1_CAPABILITIES.filter((family) => !families.has(family)),
    [],
  );

  // The public operations and the reviewed public routes are one set. A public
  // operation the contract does not publish would be a route the proxy answers
  // 403 for; a published route with no public operation would leave a client's
  // only entry point out of the inventory it reads before pairing.
  assert.deepEqual(
    fixture.contract.operations
      .filter((operation) => operation.ingress === "public")
      .map(({ method, path: routePath }) => ({ method, path: routePath })),
    REVIEWED_CLIENT_V1_PUBLIC_ROUTES.map(({ method, path: routePath }) => ({
      method,
      path: routePath,
    })),
  );

  // And the envelope examples carry the id list, so a vendoring consumer sees
  // both halves of the split — ids on the wire, records in the manifest.
  for (const example of [
    fixture.examples.successEnvelope,
    fixture.examples.errorEnvelope,
    fixture.examples.healthEnvelope,
  ]) {
    assert.deepEqual(example.operations, REVIEWED_CLIENT_V1_OPERATIONS);
    assert.deepEqual(example.capabilities, REVIEWED_CLIENT_V1_CAPABILITIES);
  }
});
