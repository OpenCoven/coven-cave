#!/usr/bin/env node

import assert from "node:assert/strict";
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

export function inspectCapturedPlaintextRequest(
  capture,
  sensitive = {},
) {
  const body = bodyText(capture.body);
  const pairingSecret = headerValue(
    capture.headers,
    "x-coven-pairing-secret",
  );
  const authorization = headerValue(capture.headers, "authorization");
  return {
    exposedPairingSecret:
      pairingSecret.length > 0
      || (
        typeof sensitive.pairingSecret === "string"
        && sensitive.pairingSecret.length > 0
        && body.includes(sensitive.pairingSecret)
      ),
    exposedBearer:
      /^Bearer \S+$/iu.test(authorization)
      || (
        typeof sensitive.bearer === "string"
        && sensitive.bearer.length > 0
        && body.includes(sensitive.bearer)
      ),
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
  let requestCount = 0;
  const listener = await startCaptureListener(port, async () => {
    requestCount += 1;
    if (requestCount === 1) return plaintextUnauthorizedResponse();
    if (requestCount === 2) {
      return forgeReplacementResponse(prepared, replacementKeyPair);
    }
    throw new Error("unexpected request count");
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
  pairing,
  operation,
  requestPath,
  method,
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
    authorization: {
      kind: "pairing-secret",
      value: pairing.secret,
    },
  });
}

async function proveBoundPollSucceeds(input) {
  const prepared = await prepareBoundRequest({
    ...input,
    operation: "pairing.poll",
    requestPath:
      `/api/client/v1/pairing/requests/${input.pairing.requestId}`,
    method: "GET",
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
  });
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

function assertCiphertextOnly(capture, pairingSecret) {
  assert.deepEqual(
    inspectCapturedBoundRequest(capture, { pairingSecret }),
    {
      exposedPairingSecret: false,
      exposedBearer: false,
      hasBoundCiphertext: true,
    },
  );
  for (const name of Object.values(CLIENT_V1_HPKE_HEADERS)) {
    assert.ok(headerValue(capture.headers, name).length > 0);
  }
  assert.equal(capture.body.byteLength, 0);
}

async function replacementCannotOpen(
  capture,
  prepared,
  replacementKeyPair,
) {
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
  await assert.rejects(
    recipient.open(ciphertext, prepared.requestAad),
  );
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
      adminToken: null,
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
    const prepared = await prepareBoundExchange({
      origin: cave.origin,
      discovery,
      instanceId: health.data.instanceId,
      pairing: boundPairing,
    });
    await stopCave(cave, port);
    cave = null;

    replacement = await startForgingCaptureListener(port, prepared);
    const plaintext = await fetch(prepared.request.clone());
    replacement.throwIfFailed();
    await fixedAssertion(
      AUTHORITY_TAKEOVER_ASSERTION_IDS[3],
      "plaintext replacement response was accepted",
      async () => {
        assert.equal(
          await acceptsPreparedBoundResponse(prepared, plaintext),
          false,
        );
      },
    );

    await fixedAssertion(
      AUTHORITY_TAKEOVER_ASSERTION_IDS[1],
      "bound request exposed credential material",
      async () => {
        assert.equal(replacement.captures.length, 1);
        assertCiphertextOnly(
          replacement.captures[0],
          boundPairing.secret,
        );
      },
    );
    await fixedAssertion(
      AUTHORITY_TAKEOVER_ASSERTION_IDS[2],
      "replacement listener opened the bound request",
      async () => {
        await replacementCannotOpen(
          replacement.captures[0],
          prepared,
          replacement.replacementKeyPair,
        );
      },
    );

    const forged = await fetch(prepared.request.clone());
    replacement.throwIfFailed();
    await fixedAssertion(
      AUTHORITY_TAKEOVER_ASSERTION_IDS[1],
      "bound request exposed credential material",
      async () => {
        assert.equal(replacement.captures.length, 2);
        assertCiphertextOnly(
          replacement.captures[1],
          boundPairing.secret,
        );
      },
    );
    await fixedAssertion(
      AUTHORITY_TAKEOVER_ASSERTION_IDS[4],
      "replacement Auth response was accepted",
      async () => {
        assert.equal(
          await acceptsPreparedBoundResponse(prepared, forged),
          false,
        );
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
