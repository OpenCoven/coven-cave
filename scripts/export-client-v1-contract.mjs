#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const fixtureModuleUrl = pathToFileURL(
  path.join(repositoryRoot, "src", "lib", "server", "client-v1", "contract.ts"),
).href;

export const REVIEWED_CLIENT_V1_PUBLIC_ROUTES = Object.freeze([
  Object.freeze({ method: "GET", path: "/api/client/v1/health" }),
  Object.freeze({ method: "POST", path: "/api/client/v1/pairing/requests" }),
  Object.freeze({ method: "GET", path: "/api/client/v1/pairing/requests/:id" }),
  Object.freeze({
    method: "POST",
    path: "/api/client/v1/pairing/requests/:id/exchange",
  }),
]);

/**
 * The reviewed live declaration, restated here on purpose.
 *
 * This file is the refusal gate: it re-derives the fixture from contract.ts and
 * compares bytes, so a contract change that does not regenerate the artifact
 * fails CI. That only works if the gate holds an expectation of its OWN — a
 * check that read the declaration out of contract.ts and compared it to
 * contract.ts would pass for any value whatsoever, which is precisely how
 * `streaming` and `revisions` stayed advertised with no route (#4869).
 *
 * So changing either list is a two-file edit, and the second file is the one a
 * reviewer reads as "the maintainers decided this". Adding a live operation is
 * additive and cheap; REMOVING or RENAMING one is a compatibility decision, and
 * this is where that decision is recorded.
 */
export const REVIEWED_CLIENT_V1_CAPABILITIES = Object.freeze([
  "health",
  "pairing",
  "credentials",
  "familiars",
  "projects",
  "conversations",
  "conversation-messages",
  "cursors",
]);

export const REVIEWED_CLIENT_V1_OPERATIONS = Object.freeze([
  "health.read",
  "pairing.create",
  "pairing.poll",
  "pairing.exchange",
  "pairing.admin.list",
  "pairing.admin.decide",
  "credentials.admin.list",
  "credentials.admin.revoke",
  "familiars.list",
  "projects.list",
  "conversations.list",
  "conversations.read",
  "messages.list",
]);

export const REVIEWED_CLIENT_V1_HPKE_BOUND_OPERATIONS = Object.freeze([
  "pairing.poll",
  "pairing.exchange",
  "familiars.list",
  "projects.list",
  "conversations.list",
  "conversations.read",
  "messages.list",
]);

export const REVIEWED_CLIENT_V1_AUTHORITY_MODES = Object.freeze([
  "off",
  "advertise",
  "enforce",
]);

export const CLIENT_V1_CONTRACT_FIXTURE_PATH = path.join(
  repositoryRoot,
  "src",
  "lib",
  "server",
  "client-v1",
  "contract-fixture.json",
);
export const CLIENT_V1_CONTRACT_FIXTURE_SHA256_PATH = path.join(
  repositoryRoot,
  "src",
  "lib",
  "server",
  "client-v1",
  "contract-fixture.sha256",
);

const PRIVATE_KEY_SHAPED_FIELDS = new Set([
  "privatekey",
  "secretkey",
  "senderkey",
  "recipientprivatekey",
]);

export function assertNoPrivateKeyShapedFields(value, location = "$") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertNoPrivateKeyShapedFields(entry, `${location}[${index}]`),
    );
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    const normalized = key.replace(/[^a-z0-9]/giu, "").toLowerCase();
    if (PRIVATE_KEY_SHAPED_FIELDS.has(normalized)) {
      throw new Error(
        `Client v1 contract contains private-key-shaped field ${location}.${key}.`,
      );
    }
    assertNoPrivateKeyShapedFields(entry, `${location}.${key}`);
  }
}

function buildFixture() {
  const source = [
    `import { renderClientV1ContractFixture } from ${JSON.stringify(fixtureModuleUrl)};`,
    "process.stdout.write(renderClientV1ContractFixture());",
  ].join("\n");
  const fixture = execFileSync(process.execPath, [
    "--no-warnings",
    "--experimental-strip-types",
    "--input-type=module",
    "--eval",
    source,
  ], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  const parsed = JSON.parse(fixture);
  assertNoPrivateKeyShapedFields(parsed);
  if (
    !isDeepStrictEqual(parsed.contract?.discovery, {
      fileName: "client-v1-discovery.json",
      mode: "0600",
      version: 1,
      hpkeBoundVersion: 2,
    })
  ) {
    throw new Error("Client v1 contract omitted the reviewed discovery contract.");
  }
  if (
    JSON.stringify(parsed.contract?.publicRoutes)
      !== JSON.stringify(REVIEWED_CLIENT_V1_PUBLIC_ROUTES)
  ) {
    throw new Error("Client v1 contract omitted the reviewed public routes.");
  }
  if (
    JSON.stringify(parsed.contract?.capabilities)
      !== JSON.stringify(REVIEWED_CLIENT_V1_CAPABILITIES)
  ) {
    throw new Error(
      "Client v1 contract capabilities differ from the reviewed live set. "
      + "Adding one is additive; removing or renaming one is a compatibility "
      + "decision — update REVIEWED_CLIENT_V1_CAPABILITIES deliberately.",
    );
  }
  const reviewedAuthority = {
    defaultMode: "off",
    modes: REVIEWED_CLIENT_V1_AUTHORITY_MODES,
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
      protectedOperations: REVIEWED_CLIENT_V1_HPKE_BOUND_OPERATIONS,
      vectorFixture: {
        fileName: "hpke-bound-v1-vectors.json",
        sha256FileName: "hpke-bound-v1-vectors.sha256",
      },
    },
  };
  if (
    !isDeepStrictEqual(parsed.contract?.authority, reviewedAuthority)
  ) {
    throw new Error(
      "Client v1 authority contract differs from the reviewed HPKE wire contract.",
    );
  }
  const exportedOperationIds = Array.isArray(parsed.contract?.operations)
    ? parsed.contract.operations.map((operation) => operation?.id)
    : undefined;
  if (
    JSON.stringify(exportedOperationIds) !== JSON.stringify(REVIEWED_CLIENT_V1_OPERATIONS)
  ) {
    throw new Error(
      "Client v1 contract operations differ from the reviewed live inventory. "
      + "Adding one is additive; removing or renaming one is a compatibility "
      + "decision — update REVIEWED_CLIENT_V1_OPERATIONS deliberately.",
    );
  }
  // Each exported record has to be complete. An id with no method, path or
  // authority class is an entry a client can read and not act on, which is the
  // "advertised but unusable" failure this whole change exists to remove.
  for (const operation of parsed.contract.operations) {
    const complete = operation
      && typeof operation.method === "string" && operation.method
      && typeof operation.path === "string" && operation.path.startsWith("/api/client/v1/")
      && ["public", "admin", "authenticated"].includes(operation.ingress)
      && (operation.scope === null || typeof operation.scope === "string")
      && ["none", "pairing-secret", "bearer", "admin"].includes(operation.credential)
      && ["none", "hpke-bound-v1"].includes(operation.binding)
      && Array.isArray(operation.families) && operation.families.length > 0
      && operation.families.every((family) =>
        REVIEWED_CLIENT_V1_CAPABILITIES.includes(family),
      );
    if (!complete) {
      throw new Error(
        `Client v1 contract operation ${JSON.stringify(operation?.id)} is incomplete or `
        + "claims a capability family the reviewed live set does not contain.",
      );
    }
    const protectedOperation =
      REVIEWED_CLIENT_V1_HPKE_BOUND_OPERATIONS.includes(operation.id);
    if (
      operation.binding
        !== (protectedOperation ? "hpke-bound-v1" : "none")
    ) {
      throw new Error(
        `Client v1 contract operation ${JSON.stringify(operation.id)} has an unreviewed authority binding.`,
      );
    }
    const expectedCredential = operation.ingress === "admin"
      ? "admin"
      : operation.ingress === "authenticated"
        ? "bearer"
        : protectedOperation
          ? "pairing-secret"
          : "none";
    if (operation.credential !== expectedCredential) {
      throw new Error(
        `Client v1 contract operation ${JSON.stringify(operation.id)} has an unreviewed credential.`,
      );
    }
  }
  return fixture;
}

export function renderClientV1ContractFixture() {
  return buildFixture();
}

export function clientV1ContractFixtureSha256(fixture) {
  return `${createHash("sha256").update(fixture).digest("hex")}\n`;
}

function parseArgs(args) {
  if (args.length === 0) return { check: false };
  if (args.length === 1 && args[0] === "--check") return { check: true };
  throw new Error("usage: export-client-v1-contract.mjs [--check]");
}

function matchesCommittedFile(filePath, expected) {
  try {
    return readFileSync(filePath).equals(Buffer.from(expected));
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return false;
    throw error;
  }
}

function main() {
  const { check } = parseArgs(process.argv.slice(2));
  const fixture = renderClientV1ContractFixture();
  const fixtureHash = clientV1ContractFixtureSha256(fixture);

  if (check) {
    if (
      !matchesCommittedFile(CLIENT_V1_CONTRACT_FIXTURE_PATH, fixture)
      || !matchesCommittedFile(CLIENT_V1_CONTRACT_FIXTURE_SHA256_PATH, fixtureHash)
    ) {
      throw new Error(
        "Client v1 contract fixture is stale. Run node scripts/export-client-v1-contract.mjs.",
      );
    }
    return;
  }

  writeFileSync(CLIENT_V1_CONTRACT_FIXTURE_PATH, fixture);
  writeFileSync(CLIENT_V1_CONTRACT_FIXTURE_SHA256_PATH, fixtureHash);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
