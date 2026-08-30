import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";

import {
  CLIENT_V1_HPKE_HEADERS,
  CLIENT_V1_HPKE_MECHANISM,
  CLIENT_V1_HPKE_RESPONSE_MEDIA_TYPE,
} from "../src/lib/server/client-v1/authority-contract.ts";
import {
  base64UrlEncode,
  clientV1HpkeKeyId,
  clientV1HpkePublicKey,
  createClientV1HpkeSuite,
} from "../src/lib/server/client-v1/hpke-bound-v1.ts";
import { createClientV1HpkeTestClient } from "../src/lib/server/client-v1/testing/hpke-client.ts";
import {
  AUTHORITY_TAKEOVER_CREDENTIAL_KINDS,
  acceptsPreparedBoundResponse,
  evaluateBoundCredentialTakeover,
  forgeReplacementResponse,
  inspectCapturedBoundRequest,
  inspectCapturedPlaintextRequest,
} from "./client-v1-authority-takeover.mjs";

const PAIRING_SECRET = base64UrlEncode(new Uint8Array(32).fill(0x31));
const BEARER = "coven_test_bearer";

test("takeover credential kinds include pairing-secret and bearer", () => {
  assert.deepEqual(
    [...AUTHORITY_TAKEOVER_CREDENTIAL_KINDS],
    ["pairing-secret", "bearer"],
  );
});

test("inspectCapturedPlaintextRequest reports exact exposed credential and ciphertext booleans", () => {
  assert.deepEqual(
    inspectCapturedPlaintextRequest({
      headers: {
        "x-coven-pairing-secret": PAIRING_SECRET,
      },
      body: Buffer.alloc(0),
    }),
    {
      exposedPairingSecret: true,
      exposedBearer: false,
      hasBoundCiphertext: false,
    },
  );

  assert.deepEqual(
    inspectCapturedPlaintextRequest({
      headers: {
        authorization: `Bearer ${BEARER}`,
        [CLIENT_V1_HPKE_HEADERS.mechanism]: CLIENT_V1_HPKE_MECHANISM,
        [CLIENT_V1_HPKE_HEADERS.ciphertext]: "ciphertext-value",
      },
      body: Buffer.alloc(0),
    }),
    {
      exposedPairingSecret: false,
      exposedBearer: true,
      hasBoundCiphertext: true,
    },
  );
});

test("inspectCapturedPlaintextRequest scans the URL, every header value, and the body", () => {
  for (const capture of [
    {
      url: `/capture?credential=${PAIRING_SECRET}`,
      headers: {},
      body: Buffer.alloc(0),
    },
    {
      url: "/capture",
      headers: { "x-forwarded-credential": BEARER },
      body: Buffer.alloc(0),
    },
    {
      url: "/capture",
      headers: {},
      body: Buffer.from(`wrapped=${BEARER}`, "utf8"),
    },
  ]) {
    const inspected = inspectCapturedPlaintextRequest(capture, {
      pairingSecret: PAIRING_SECRET,
      bearer: BEARER,
    });
    assert.equal(
      inspected.exposedPairingSecret || inspected.exposedBearer,
      true,
    );
  }

  assert.equal(
    inspectCapturedPlaintextRequest({
      url: "/capture",
      headers: { authorization: "Basic opaque" },
      body: Buffer.alloc(0),
    }).exposedBearer,
    true,
  );
});

test("inspectCapturedBoundRequest reports the exact ciphertext-only result", () => {
  assert.deepEqual(
    inspectCapturedBoundRequest(
      {
        headers: {
          [CLIENT_V1_HPKE_HEADERS.mechanism]: CLIENT_V1_HPKE_MECHANISM,
          [CLIENT_V1_HPKE_HEADERS.ciphertext]: "ciphertext-value",
        },
        body: Buffer.alloc(0),
      },
      { pairingSecret: PAIRING_SECRET, bearer: BEARER },
    ),
    {
      exposedPairingSecret: false,
      exposedBearer: false,
      hasBoundCiphertext: true,
    },
  );
});

function takeoverAttempt(kind) {
  return {
    kind,
    value: kind === "pairing-secret" ? PAIRING_SECRET : BEARER,
    prepared: { label: `${kind}-prepared` },
    replacementKeyPair: { label: "replacement-key-pair" },
    plaintext: {
      capture: { label: `${kind}-plaintext-capture` },
      response: { label: `${kind}-plaintext-response` },
    },
    forged: {
      capture: { label: `${kind}-forged-capture` },
      response: { label: `${kind}-forged-response` },
    },
  };
}

test("evaluateBoundCredentialTakeover requires pairing-secret and bearer before predicates run", async () => {
  let calls = 0;
  await assert.rejects(
    evaluateBoundCredentialTakeover(
      [takeoverAttempt("pairing-secret")],
      {
        ciphertextOnly() {
          calls += 1;
          return true;
        },
        replacementCannotOpen() {
          calls += 1;
          return true;
        },
        acceptsResponse() {
          calls += 1;
          return false;
        },
      },
    ),
    /credential classes are incomplete/u,
  );
  assert.equal(calls, 0);
});

test("evaluateBoundCredentialTakeover checks both credential classes with exact predicate inputs", async () => {
  const attempts = [
    takeoverAttempt("pairing-secret"),
    takeoverAttempt("bearer"),
  ];
  const ciphertextCalls = [];
  const replacementCalls = [];
  const responseCalls = [];

  const result = await evaluateBoundCredentialTakeover(attempts, {
    ciphertextOnly(input) {
      ciphertextCalls.push({
        kind: input.kind,
        capture: input.capture.label,
        sensitiveKeys: Object.keys(input.sensitive),
      });
      return true;
    },
    replacementCannotOpen(input) {
      replacementCalls.push({
        kind: input.kind,
        capture: input.capture.label,
        prepared: input.prepared.label,
        replacementKeyPair: input.replacementKeyPair.label,
      });
      return true;
    },
    acceptsResponse(input) {
      responseCalls.push({
        kind: input.kind,
        responseKind: input.responseKind,
        prepared: input.prepared.label,
        response: input.response.label,
      });
      return false;
    },
  });

  assert.deepEqual(result, {
    ciphertextOnly: true,
    replacementCannotOpen: true,
    plaintextResponseRejected: true,
    forgedAuthResponseRejected: true,
  });
  assert.equal(ciphertextCalls.length, 4);
  assert.equal(replacementCalls.length, 2);
  assert.equal(responseCalls.length, 4);
  assert.deepEqual(ciphertextCalls, [
    {
      kind: "pairing-secret",
      capture: "pairing-secret-plaintext-capture",
      sensitiveKeys: ["pairingSecret"],
    },
    {
      kind: "pairing-secret",
      capture: "pairing-secret-forged-capture",
      sensitiveKeys: ["pairingSecret"],
    },
    {
      kind: "bearer",
      capture: "bearer-plaintext-capture",
      sensitiveKeys: ["bearer"],
    },
    {
      kind: "bearer",
      capture: "bearer-forged-capture",
      sensitiveKeys: ["bearer"],
    },
  ]);
  assert.deepEqual(replacementCalls, [
    {
      kind: "pairing-secret",
      capture: "pairing-secret-plaintext-capture",
      prepared: "pairing-secret-prepared",
      replacementKeyPair: "replacement-key-pair",
    },
    {
      kind: "bearer",
      capture: "bearer-plaintext-capture",
      prepared: "bearer-prepared",
      replacementKeyPair: "replacement-key-pair",
    },
  ]);
  assert.deepEqual(responseCalls, [
    {
      kind: "pairing-secret",
      responseKind: "plaintext",
      prepared: "pairing-secret-prepared",
      response: "pairing-secret-plaintext-response",
    },
    {
      kind: "pairing-secret",
      responseKind: "forged",
      prepared: "pairing-secret-prepared",
      response: "pairing-secret-forged-response",
    },
    {
      kind: "bearer",
      responseKind: "plaintext",
      prepared: "bearer-prepared",
      response: "bearer-plaintext-response",
    },
    {
      kind: "bearer",
      responseKind: "forged",
      prepared: "bearer-prepared",
      response: "bearer-forged-response",
    },
  ]);
});

async function preparedFixture() {
  const suite = createClientV1HpkeSuite();
  const authorityKeyPair = await suite.kem.deriveKeyPair(
    new Uint8Array(32).fill(0x41),
  );
  const authorityPublicKey = await clientV1HpkePublicKey(
    suite,
    authorityKeyPair.publicKey,
  );
  const prepared = await createClientV1HpkeTestClient({
    authority: {
      mechanism: CLIENT_V1_HPKE_MECHANISM,
      mode: "enforce",
      keyId: base64UrlEncode(clientV1HpkeKeyId(authorityPublicKey)),
      publicKey: base64UrlEncode(authorityPublicKey),
      suite: { kemId: 32, kdfId: 1, aeadId: 2 },
    },
    instanceId: "authority-takeover-test",
    runtimeNonce: base64UrlEncode(new Uint8Array(32).fill(0x42)),
    operation: "pairing.exchange",
    url: "http://127.0.0.1:4242/api/client/v1/pairing/requests/test/exchange",
    method: "POST",
    issuedAt: 1_777_777_777_777,
    requestNonce: new Uint8Array(32).fill(0x43),
    requestEkm: new Uint8Array(32).fill(0x44),
    responseRecipientIkm: new Uint8Array(32).fill(0x45),
    authorization: {
      kind: "pairing-secret",
      value: PAIRING_SECRET,
    },
  });
  return { prepared, suite };
}

test("bound response acceptance rejects plaintext, malformed, random, and replacement-auth responses", async () => {
  const { prepared, suite } = await preparedFixture();

  assert.equal(
    await acceptsPreparedBoundResponse(
      prepared,
      Response.json(
        { error: "replacement listener" },
        { status: 401 },
      ),
    ),
    false,
  );

  assert.equal(
    await acceptsPreparedBoundResponse(
      prepared,
      new Response("{", {
        status: 200,
        headers: { "content-type": CLIENT_V1_HPKE_RESPONSE_MEDIA_TYPE },
      }),
    ),
    false,
  );

  assert.equal(
    await acceptsPreparedBoundResponse(
      prepared,
      Response.json(
        {
          version: 1,
          mechanism: CLIENT_V1_HPKE_MECHANISM,
          keyId: prepared.binding.keyId,
          requestNonce: prepared.binding.requestNonce,
          enc: base64UrlEncode(randomBytes(32)),
          ciphertext: base64UrlEncode(randomBytes(32)),
        },
        {
          headers: {
            "content-type": CLIENT_V1_HPKE_RESPONSE_MEDIA_TYPE,
          },
        },
      ),
    ),
    false,
  );

  const replacementKeyPair = await suite.kem.deriveKeyPair(
    new Uint8Array(32).fill(0x53),
  );
  assert.equal(
    await acceptsPreparedBoundResponse(
      prepared,
      await forgeReplacementResponse(prepared, replacementKeyPair),
    ),
    false,
  );
});
