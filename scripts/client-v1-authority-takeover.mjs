#!/usr/bin/env node

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import canonicalize from "canonicalize";

import {
  CLIENT_V1_HPKE_HEADERS,
  CLIENT_V1_HPKE_LIMITS,
  CLIENT_V1_HPKE_MECHANISM,
  CLIENT_V1_HPKE_RESPONSE_MEDIA_TYPE,
} from "../src/lib/server/client-v1/authority-contract.ts";
import { validateClientV1DiscoveryRecord } from "../src/lib/server/client-v1/discovery.ts";
import {
  CLIENT_V1_HPKE_REQUEST_INFO,
  CLIENT_V1_HPKE_RESPONSE_INFO,
  base64UrlDecode,
  base64UrlEncode,
  createClientV1HpkeSuite,
} from "../src/lib/server/client-v1/hpke-bound-v1.ts";
import { createClientV1HpkeTestClient } from "../src/lib/server/client-v1/testing/hpke-client.ts";
import {
  ADMIN_TOKEN_HEADER,
  AUTHORITY_TAKEOVER_ASSERTION_IDS,
  freePort,
  requestOnce,
  seedIsolatedCaveHomes,
  startCave,
  stopCave,
} from "./client-v1-conformance.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const UTF8 = new TextEncoder();

export const AUTHORITY_TAKEOVER_CREDENTIAL_KINDS = Object.freeze([
  "pairing-secret",
  "bearer",
]);

class AuthorityTakeoverFailure extends Error {
  constructor(assertionId, reason) {
    super(reason);
    this.assertionId = assertionId;
    this.reason = reason;
  }
}

function headerValue(headers, name) {
  const value = headers?.[name.toLowerCase()];
  if (Array.isArray(value)) return value.join(",");
  return typeof value === "string" ? value : "";
}

function bodyText(body) {
  if (typeof body === "string") return body;
  if (body instanceof Uint8Array) return Buffer.from(body).toString("utf8");
  return "";
}

function hasHeader(headers, name) {
  return Object.keys(headers ?? {}).some(
    (candidate) => candidate.toLowerCase() === name.toLowerCase(),
  );
}

function capturedValues(capture) {
  const values = [capture.url ?? "", bodyText(capture.body)];
  for (const value of Object.values(capture.headers ?? {})) {
    if (Array.isArray(value)) values.push(...value);
    else if (typeof value === "string") values.push(value);
  }
  return values;
}

function capturesSensitiveValue(capture, value) {
  return (
    typeof value === "string"
    && value.length > 0
    && capturedValues(capture).some((candidate) => candidate.includes(value))
  );
}

export function inspectCapturedPlaintextRequest(
  capture,
  sensitive = {},
) {
  return {
    exposedPairingSecret:
      hasHeader(capture.headers, "x-coven-pairing-secret")
      || capturesSensitiveValue(capture, sensitive.pairingSecret),
    exposedBearer:
      hasHeader(capture.headers, "authorization")
      || capturesSensitiveValue(capture, sensitive.bearer),
    hasBoundCiphertext:
      headerValue(capture.headers, CLIENT_V1_HPKE_HEADERS.mechanism)
        === CLIENT_V1_HPKE_MECHANISM
      && headerValue(
        capture.headers,
        CLIENT_V1_HPKE_HEADERS.ciphertext,
      ).length > 0,
  };
}

export function inspectCapturedBoundRequest(capture, sensitive = {}) {
  return inspectCapturedPlaintextRequest(capture, sensitive);
}

export async function evaluateBoundCredentialTakeover(
  attempts,
  predicates,
) {
  const expectedKinds = AUTHORITY_TAKEOVER_CREDENTIAL_KINDS;
  if (
    attempts.length !== expectedKinds.length
    || attempts.some(
      (attempt, index) => attempt.kind !== expectedKinds[index],
    )
  ) {
    throw new Error(
      "authority takeover credential classes are incomplete",
    );
  }

  const ciphertextOnly = [];
  const replacementCannotOpen = [];
  const plaintextResponseRejected = [];
  const forgedAuthResponseRejected = [];
  for (const attempt of attempts) {
    const sensitive = attempt.kind === "pairing-secret"
      ? { pairingSecret: attempt.value }
      : { bearer: attempt.value };
    for (const responseKind of ["plaintext", "forged"]) {
      ciphertextOnly.push(
        await predicates.ciphertextOnly({
          kind: attempt.kind,
          capture: attempt[responseKind].capture,
          sensitive,
        }),
      );
    }
    replacementCannotOpen.push(
      await predicates.replacementCannotOpen({
        kind: attempt.kind,
        capture: attempt.plaintext.capture,
        prepared: attempt.prepared,
        replacementKeyPair: attempt.replacementKeyPair,
      }),
    );
    plaintextResponseRejected.push(
      !await predicates.acceptsResponse({
        kind: attempt.kind,
        responseKind: "plaintext",
        prepared: attempt.prepared,
        response: attempt.plaintext.response,
      }),
    );
    forgedAuthResponseRejected.push(
      !await predicates.acceptsResponse({
        kind: attempt.kind,
        responseKind: "forged",
        prepared: attempt.prepared,
        response: attempt.forged.response,
      }),
    );
  }
  return {
    ciphertextOnly: ciphertextOnly.every(Boolean),
    replacementCannotOpen: replacementCannotOpen.every(Boolean),
    plaintextResponseRejected:
      plaintextResponseRejected.every(Boolean),
    forgedAuthResponseRejected:
      forgedAuthResponseRejected.every(Boolean),
  };
}

export async function acceptsPreparedBoundResponse(prepared, response) {
  try {
    await prepared.open(response);
    return true;
  } catch {
    return false;
  }
}

export async function forgeReplacementResponse(
  prepared,
  replacementKeyPair,
) {
  const suite = createClientV1HpkeSuite();
  const responsePublicKey = await suite.kem.deserializePublicKey(
    prepared.responsePublicKey,
  );
  const sender = await suite.createSenderContext({
    recipientPublicKey: responsePublicKey,
    senderKey: replacementKeyPair.privateKey,
    info: CLIENT_V1_HPKE_RESPONSE_INFO,
  });
  const plaintext = canonicalize({
    body: base64UrlEncode(
      UTF8.encode(JSON.stringify({ error: "forged" })),
    ),
    headers: { contentType: "application/json" },
    requestNonce: prepared.binding.requestNonce,
    status: 401,
    version: 1,
  });
  if (typeof plaintext !== "string") {
    throw new Error("replacement response encoding failed");
  }
  const ciphertext = await sender.seal(
    UTF8.encode(plaintext),
    prepared.responseAad,
  );
  return new Response(
    JSON.stringify({
      version: 1,
      mechanism: CLIENT_V1_HPKE_MECHANISM,
      keyId: prepared.binding.keyId,
      requestNonce: prepared.binding.requestNonce,
      enc: base64UrlEncode(sender.enc),
      ciphertext: base64UrlEncode(ciphertext),
    }),
    {
      status: 200,
      headers: {
        "content-type": CLIENT_V1_HPKE_RESPONSE_MEDIA_TYPE,
      },
    },
  );
}

function plaintextUnauthorizedResponse() {
  return new Response(
    JSON.stringify({ error: "replacement listener" }),
    {
      status: 401,
      headers: { "content-type": "application/json" },
    },
  );
}

async function startCaptureListener(port, responder) {
  const captures = [];
  let responderFailure = null;
  let closed = false;
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", async () => {
      const capture = {
        method: request.method ?? "",
        url: request.url ?? "",
        headers: { ...request.headers },
        body: Buffer.concat(chunks),
      };
      captures.push(capture);
      try {
        const reply = await responder(capture);
        const bytes = Buffer.from(await reply.arrayBuffer());
        response.writeHead(
          reply.status,
          Object.fromEntries(reply.headers.entries()),
        );
        response.end(bytes);
      } catch {
        responderFailure = new Error("capture listener response failed");
        response.writeHead(500, {
          "content-type": "application/json",
          "content-length": "2",
        });
        response.end("{}");
      }
    });
  });
  server.listen(port, "127.0.0.1");
  await once(server, "listening");
  return {
    captures,
    throwIfFailed() {
      if (responderFailure) throw responderFailure;
    },
    async close() {
      if (closed) return;
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      closed = true;
    },
  };
}

async function startForgingCaptureListener(port, prepared) {
  const suite = createClientV1HpkeSuite();
  const replacementKeyPair = await suite.kem.generateKeyPair();
  const sequence = AUTHORITY_TAKEOVER_CREDENTIAL_KINDS.flatMap(
    (kind) => [
      { kind, responseKind: "plaintext" },
      { kind, responseKind: "forged" },
    ],
  );
  let requestCount = 0;
  const listener = await startCaptureListener(port, async () => {
    const step = sequence[requestCount];
    requestCount += 1;
    if (!step) throw new Error("unexpected request count");
    if (step.responseKind === "plaintext") {
      return plaintextUnauthorizedResponse();
    }
    return forgeReplacementResponse(
      prepared[step.kind],
      replacementKeyPair,
    );
  });
  return { ...listener, replacementKeyPair };
}

function caveOrigin(port) {
  return `http://127.0.0.1:${port}`;
}

async function createPairing(origin) {
  const body = JSON.stringify({
    appName: "Authority takeover harness",
    installationId: "authority-takeover-harness",
    scopes: ["chat:read"],
  });
  const response = await requestOnce(origin, {
    method: "POST",
    path: "/api/client/v1/pairing/requests",
    headers: {
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(body)),
    },
    body,
  });
  assert.equal(response.status, 201);
  assert.equal(typeof response.json?.data?.requestId, "string");
  assert.equal(typeof response.json?.data?.secret, "string");
  return response.json.data;
}

async function approvePairing(origin, adminToken, pairing) {
  const body = JSON.stringify({ decision: "approved" });
  const response = await requestOnce(origin, {
    method: "POST",
    path:
      `/api/client/v1/admin/pairing-requests/${pairing.requestId}/decision`,
    headers: {
      [ADMIN_TOKEN_HEADER]: adminToken,
      "content-type": "application/json",
      origin,
      referer: `${origin}/settings`,
    },
    body,
  });
  assert.equal(response.status, 200);
  assert.equal(
    response.json?.data?.pairingRequest?.status,
    "approved",
  );
}

async function readAuthorityDiscovery(caveHomeDir) {
  const raw = JSON.parse(
    await readFile(
      path.join(caveHomeDir, "client-v1-discovery.json"),
      "utf8",
    ),
  );
  return validateClientV1DiscoveryRecord(raw);
}

async function readHealthEnvelope(origin) {
  const response = await requestOnce(origin, {
    method: "GET",
    path: "/api/client/v1/health",
  });
  assert.equal(response.status, 200);
  assert.equal(typeof response.json?.data?.instanceId, "string");
  assert.ok(response.json.data.instanceId.length > 0);
  return response.json;
}

async function sendLegacyExchange(origin, pairing) {
  return requestOnce(origin, {
    method: "POST",
    path:
      `/api/client/v1/pairing/requests/${pairing.requestId}/exchange`,
    headers: {
      "content-length": "0",
      "x-coven-pairing-secret": pairing.secret,
    },
    body: "",
  });
}

async function prepareBoundRequest({
  origin,
  discovery,
  instanceId,
  operation,
  requestPath,
  method,
  authorization,
}) {
  assert.equal(discovery.version, 2);
  return createClientV1HpkeTestClient({
    authority: discovery.authority,
    instanceId,
    runtimeNonce: discovery.nonce,
    operation,
    url: new URL(requestPath, origin).href,
    method,
    body: new Uint8Array(),
    issuedAt: Date.now(),
    authorization,
  });
}

async function proveBoundPollSucceeds(input) {
  const prepared = await prepareBoundRequest({
    ...input,
    operation: "pairing.poll",
    requestPath:
      `/api/client/v1/pairing/requests/${input.pairing.requestId}`,
    method: "GET",
    authorization: {
      kind: "pairing-secret",
      value: input.pairing.secret,
    },
  });
  const outer = await fetch(prepared.request.clone());
  assert.equal(outer.status, 200);
  assert.equal(
    outer.headers.get("content-type"),
    CLIENT_V1_HPKE_RESPONSE_MEDIA_TYPE,
  );
  const inner = await prepared.open(outer);
  assert.equal(inner.status, 200);
  const envelope = JSON.parse(new TextDecoder().decode(inner.body));
  assert.equal(envelope.data?.status, "pending");
}

async function prepareBoundExchange(input) {
  return prepareBoundRequest({
    ...input,
    operation: "pairing.exchange",
    requestPath:
      `/api/client/v1/pairing/requests/${input.pairing.requestId}/exchange`,
    method: "POST",
    authorization: {
      kind: "pairing-secret",
      value: input.pairing.secret,
    },
  });
}

async function prepareBoundProjects(input) {
  return prepareBoundRequest({
    ...input,
    operation: "projects.list",
    requestPath: "/api/client/v1/projects",
    method: "GET",
    authorization: {
      kind: "bearer",
      value: input.bearer,
    },
  });
}

async function openLiveBoundJson(prepared) {
  const outer = await fetch(prepared.request.clone());
  assert.equal(outer.status, 200);
  assert.equal(
    outer.headers.get("content-type"),
    CLIENT_V1_HPKE_RESPONSE_MEDIA_TYPE,
  );
  const inner = await prepared.open(outer);
  assert.equal(inner.status, 200);
  assert.equal(inner.headers.contentType, "application/json");
  return JSON.parse(new TextDecoder().decode(inner.body));
}

function assertLegacySecretExposure(capture, secret) {
  assert.equal(
    headerValue(capture.headers, "x-coven-pairing-secret"),
    secret,
  );
  assert.deepEqual(
    inspectCapturedPlaintextRequest(capture, {
      pairingSecret: secret,
    }),
    {
      exposedPairingSecret: true,
      exposedBearer: false,
      hasBoundCiphertext: false,
    },
  );
}

function isCiphertextOnly(capture, sensitive) {
  const inspected = inspectCapturedBoundRequest(capture, sensitive);
  if (
    inspected.exposedPairingSecret
    || inspected.exposedBearer
    || !inspected.hasBoundCiphertext
  ) {
    return false;
  }
  for (const name of Object.values(CLIENT_V1_HPKE_HEADERS)) {
    if (headerValue(capture.headers, name).length === 0) return false;
  }
  return capture.body.byteLength === 0;
}

async function replacementCannotOpen(
  capture,
  prepared,
  replacementKeyPair,
) {
  try {
    const suite = createClientV1HpkeSuite();
    const recipient = await suite.createRecipientContext({
      recipientKey: replacementKeyPair.privateKey,
      enc: base64UrlDecode(
        headerValue(capture.headers, CLIENT_V1_HPKE_HEADERS.enc),
        {
          minimum: CLIENT_V1_HPKE_LIMITS.rawKeyBytes,
          maximum: CLIENT_V1_HPKE_LIMITS.rawKeyBytes,
        },
      ).bytes,
      info: CLIENT_V1_HPKE_REQUEST_INFO,
    });
    const ciphertext = base64UrlDecode(
      headerValue(capture.headers, CLIENT_V1_HPKE_HEADERS.ciphertext),
      {
        minimum: 16,
        maximum: CLIENT_V1_HPKE_LIMITS.requestCiphertextBytes,
      },
    ).bytes;
    try {
      await recipient.open(ciphertext, prepared.requestAad);
      return false;
    } catch {
      return true;
    }
  } catch {
    return false;
  }
}

async function fixedAssertion(assertionId, reason, action) {
  try {
    await action();
  } catch {
    throw new AuthorityTakeoverFailure(assertionId, reason);
  }
}

export async function runAuthorityTakeoverProof() {
  if (
    !existsSync(path.join(repositoryRoot, "server.mjs"))
    || !existsSync(path.join(repositoryRoot, ".next", "BUILD_ID"))
  ) {
    throw new AuthorityTakeoverFailure(
      AUTHORITY_TAKEOVER_ASSERTION_IDS[0],
      "release build is unavailable",
    );
  }

  const scratchRoot = await mkdtemp(
    path.join(
      repositoryRoot,
      ".scratch-client-v1-authority-takeover-",
    ),
  );
  let cave = null;
  let replacement = null;
  let cleanupFailed = false;
  try {
    const port = await freePort();
    const homes = await seedIsolatedCaveHomes(scratchRoot);
    const adminToken = `authority-takeover-${randomUUID()}`;

    cave = await startCave({
      port,
      ...homes,
      adminToken: null,
      authorityMode: "off",
    });
    const legacyDiscovery = await readAuthorityDiscovery(
      homes.caveHomeDir,
    );
    assert.equal(legacyDiscovery.version, 1);
    const legacyPairing = await createPairing(cave.origin);
    await stopCave(cave, port);
    cave = null;

    replacement = await startCaptureListener(
      port,
      async () => plaintextUnauthorizedResponse(),
    );
    await sendLegacyExchange(caveOrigin(port), legacyPairing);
    replacement.throwIfFailed();
    await fixedAssertion(
      AUTHORITY_TAKEOVER_ASSERTION_IDS[0],
      "legacy request did not expose the exact pairing secret",
      async () => {
        assert.equal(replacement.captures.length, 1);
        assertLegacySecretExposure(
          replacement.captures[0],
          legacyPairing.secret,
        );
      },
    );
    await replacement.close();
    replacement = null;

    cave = await startCave({
      port,
      ...homes,
      adminToken,
      authorityMode: "enforce",
    });
    const discovery = await readAuthorityDiscovery(homes.caveHomeDir);
    assert.equal(discovery.version, 2);
    assert.equal(discovery.endpoint, cave.origin);
    assert.equal(discovery.authority.mode, "enforce");
    assert.equal(
      discovery.authority.mechanism,
      CLIENT_V1_HPKE_MECHANISM,
    );
    const health = await readHealthEnvelope(cave.origin);
    const boundPairing = await createPairing(cave.origin);
    await proveBoundPollSucceeds({
      origin: cave.origin,
      discovery,
      instanceId: health.data.instanceId,
      pairing: boundPairing,
    });
    await approvePairing(cave.origin, adminToken, boundPairing);
    const liveExchange = await prepareBoundExchange({
      origin: cave.origin,
      discovery,
      instanceId: health.data.instanceId,
      pairing: boundPairing,
    });
    const takeoverExchange = await prepareBoundExchange({
      origin: cave.origin,
      discovery,
      instanceId: health.data.instanceId,
      pairing: boundPairing,
    });
    const exchanged = await openLiveBoundJson(liveExchange);
    const bearer = exchanged?.data?.bearer;
    assert.equal(typeof bearer, "string");
    assert.equal(/^[A-Za-z0-9_-]{43}$/u.test(bearer), true);
    const liveProjects = await prepareBoundProjects({
      origin: cave.origin,
      discovery,
      instanceId: health.data.instanceId,
      bearer,
    });
    const projects = await openLiveBoundJson(liveProjects);
    assert.equal(Array.isArray(projects?.data?.projects), true);
    const takeoverProjects = await prepareBoundProjects({
      origin: cave.origin,
      discovery,
      instanceId: health.data.instanceId,
      bearer,
    });
    await stopCave(cave, port);
    cave = null;

    replacement = await startForgingCaptureListener(port, {
      "pairing-secret": takeoverExchange,
      bearer: takeoverProjects,
    });
    const pairingPlaintext = await fetch(
      takeoverExchange.request.clone(),
    );
    const pairingForged = await fetch(takeoverExchange.request.clone());
    const bearerPlaintext = await fetch(
      takeoverProjects.request.clone(),
    );
    const bearerForged = await fetch(takeoverProjects.request.clone());
    replacement.throwIfFailed();
    let boundResults = null;
    await fixedAssertion(
      AUTHORITY_TAKEOVER_ASSERTION_IDS[1],
      "bound request exposed credential material",
      async () => {
        assert.equal(replacement.captures.length, 4);
        boundResults = await evaluateBoundCredentialTakeover(
          [
            {
              kind: "pairing-secret",
              value: boundPairing.secret,
              prepared: takeoverExchange,
              replacementKeyPair: replacement.replacementKeyPair,
              plaintext: {
                capture: replacement.captures[0],
                response: pairingPlaintext,
              },
              forged: {
                capture: replacement.captures[1],
                response: pairingForged,
              },
            },
            {
              kind: "bearer",
              value: bearer,
              prepared: takeoverProjects,
              replacementKeyPair: replacement.replacementKeyPair,
              plaintext: {
                capture: replacement.captures[2],
                response: bearerPlaintext,
              },
              forged: {
                capture: replacement.captures[3],
                response: bearerForged,
              },
            },
          ],
          {
            ciphertextOnly: ({ capture, sensitive }) =>
              isCiphertextOnly(capture, sensitive),
            replacementCannotOpen: ({
              capture,
              prepared,
              replacementKeyPair,
            }) => replacementCannotOpen(
              capture,
              prepared,
              replacementKeyPair,
            ),
            acceptsResponse: ({ prepared, response }) =>
              acceptsPreparedBoundResponse(prepared, response),
          },
        );
        assert.equal(boundResults.ciphertextOnly, true);
      },
    );
    await fixedAssertion(
      AUTHORITY_TAKEOVER_ASSERTION_IDS[2],
      "replacement listener opened the bound request",
      async () => {
        assert.equal(boundResults?.replacementCannotOpen, true);
      },
    );
    await fixedAssertion(
      AUTHORITY_TAKEOVER_ASSERTION_IDS[3],
      "plaintext replacement response was accepted",
      async () => {
        assert.equal(boundResults?.plaintextResponseRejected, true);
      },
    );
    await fixedAssertion(
      AUTHORITY_TAKEOVER_ASSERTION_IDS[4],
      "replacement Auth response was accepted",
      async () => {
        assert.equal(boundResults?.forgedAuthResponseRejected, true);
      },
    );

    return {
      assertions: [...AUTHORITY_TAKEOVER_ASSERTION_IDS],
      context: {
        authorityMode: discovery.authority.mode,
        discoveryVersion: discovery.version,
        mechanism: discovery.authority.mechanism,
      },
    };
  } finally {
    if (replacement) {
      try {
        await replacement.close();
      } catch {
        cleanupFailed = true;
      }
    }
    if (cave) {
      try {
        await stopCave(cave, cave.port);
      } catch {
        cleanupFailed = true;
      }
    }
    try {
      await rm(scratchRoot, { recursive: true, force: true });
    } catch {
      cleanupFailed = true;
    }
    if (cleanupFailed) {
      throw new AuthorityTakeoverFailure(
        AUTHORITY_TAKEOVER_ASSERTION_IDS[4],
        "fixture cleanup failed",
      );
    }
  }
}

async function main() {
  try {
    const result = await runAuthorityTakeoverProof();
    for (const assertionId of result.assertions) {
      console.log(`ok ${assertionId}`);
    }
    return 0;
  } catch (error) {
    const assertionId =
      error instanceof AuthorityTakeoverFailure
        ? error.assertionId
        : AUTHORITY_TAKEOVER_ASSERTION_IDS[0];
    const reason =
      error instanceof AuthorityTakeoverFailure
        ? error.reason
        : "authority takeover proof did not complete";
    console.error(`FAIL ${assertionId} — ${reason}`);
    return 1;
  }
}

const invokedDirectly =
  process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  process.exit(await main());
}
