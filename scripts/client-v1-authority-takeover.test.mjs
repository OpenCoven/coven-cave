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
  acceptsPreparedBoundResponse,
  forgeReplacementResponse,
  inspectCapturedBoundRequest,
  inspectCapturedPlaintextRequest,
} from "./client-v1-authority-takeover.mjs";

const PAIRING_SECRET = base64UrlEncode(new Uint8Array(32).fill(0x31));
const BEARER = "coven_test_bearer";

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
