import { createHash } from "node:crypto";

import canonicalize from "canonicalize";

import type { ClientV1HpkeBinding } from "./authority-contract.ts";
import {
  CLIENT_V1_HPKE_REQUEST_INFO,
  CLIENT_V1_HPKE_RESPONSE_INFO,
  base64UrlEncode,
  clientV1HpkeKeyId,
  clientV1HpkePublicKey,
  createClientV1HpkeSuite,
  encodeClientV1HpkeAad,
} from "./hpke-bound-v1.ts";

const UTF8 = new TextEncoder();

function hexToBytes(value: string): Uint8Array {
  if (!/^(?:[0-9a-f]{2})+$/u.test(value)) {
    throw new Error("HPKE vector hex is malformed.");
  }
  return Uint8Array.from(
    value.match(/[0-9a-f]{2}/gu)!.map((pair) => Number.parseInt(pair, 16)),
  );
}

function bytesToHex(value: Uint8Array): string {
  return [...value]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function jcs(value: unknown): string {
  const rendered = canonicalize(value);
  if (typeof rendered !== "string") {
    throw new Error("HPKE vector value is not canonical JSON.");
  }
  return rendered;
}

export async function createClientV1HpkeBoundV1Vector() {
  const recipientIkm = hexToBytes(
    "000102030405060708090a0b0c0d0e0f"
      + "101112131415161718191a1b1c1d1e1f",
  );
  const requestEkmIkm = hexToBytes(
    "202122232425262728292a2b2c2d2e2f"
      + "303132333435363738393a3b3c3d3e3f",
  );
  const responseRecipientIkm = hexToBytes(
    "404142434445464748494a4b4c4d4e4f"
      + "505152535455565758595a5b5c5d5e5f",
  );
  const responseEkmIkm = hexToBytes(
    "606162636465666768696a6b6c6d6e6f"
      + "707172737475767778797a7b7c7d7e7f",
  );
  const runtimeNonceBytes = hexToBytes(
    "808182838485868788898a8b8c8d8e8f"
      + "909192939495969798999a9b9c9d9e9f",
  );
  const requestNonceBytes = hexToBytes(
    "a0a1a2a3a4a5a6a7a8a9aaabacadaeaf"
      + "b0b1b2b3b4b5b6b7b8b9babbbcbdbebf",
  );
  const pairingSecretBytes = hexToBytes(
    "c0c1c2c3c4c5c6c7c8c9cacbcccdcecf"
      + "d0d1d2d3d4d5d6d7d8d9dadbdcdddedf",
  );

  const suite = createClientV1HpkeSuite();
  const recipient = await suite.kem.deriveKeyPair(recipientIkm);
  const publicKey = await clientV1HpkePublicKey(suite, recipient.publicKey);
  const keyIdBytes = clientV1HpkeKeyId(publicKey);
  const responseRecipient = await suite.kem.deriveKeyPair(
    responseRecipientIkm,
  );
  const responsePublicKey = await clientV1HpkePublicKey(
    suite,
    responseRecipient.publicKey,
  );
  const bodySha256 = new Uint8Array(
    createHash("sha256").update(new Uint8Array()).digest(),
  );
  const binding: ClientV1HpkeBinding = {
    method: "POST",
    route:
      "/api/client/v1/pairing/requests/"
      + "11111111-1111-4111-8111-111111111111/exchange",
    bodySha256,
    instanceId: "00000000-0000-4000-8000-000000000000",
    runtimeNonce: base64UrlEncode(runtimeNonceBytes),
    runtimeNonceBytes,
    keyId: base64UrlEncode(keyIdBytes),
    keyIdBytes,
    requestNonce: base64UrlEncode(requestNonceBytes),
    requestNonceBytes,
    issuedAt: 1_787_672_578_109,
  };
  const requestAad = encodeClientV1HpkeAad("request", binding);
  const responseAad = encodeClientV1HpkeAad("response", binding);
  const authorization = {
    kind: "pairing-secret" as const,
    value: base64UrlEncode(pairingSecretBytes),
  };
  const requestPlaintext = UTF8.encode(jcs({
    authorization,
    responsePublicKey: base64UrlEncode(responsePublicKey),
    version: 1,
  }));
  const requestSender = await suite.createSenderContext({
    recipientPublicKey: recipient.publicKey,
    info: CLIENT_V1_HPKE_REQUEST_INFO,
    ekm: requestEkmIkm,
  });
  const requestCiphertext = new Uint8Array(
    await requestSender.seal(requestPlaintext, requestAad),
  );

  const responseBody = jcs({
    apiVersion: "1.0",
    capabilities: ["pairing"],
    data: { status: "ok" },
    minimumClientVersion: "0.1.0",
    operations: ["pairing.exchange"],
  });
  const responsePlaintext = UTF8.encode(jcs({
    body: base64UrlEncode(UTF8.encode(responseBody)),
    headers: { contentType: "application/json" },
    requestNonce: binding.requestNonce,
    status: 200,
    version: 1,
  }));
  const responseSender = await suite.createSenderContext({
    recipientPublicKey: responseRecipient.publicKey,
    senderKey: recipient.privateKey,
    info: CLIENT_V1_HPKE_RESPONSE_INFO,
    ekm: responseEkmIkm,
  });
  const responseCiphertext = new Uint8Array(
    await responseSender.seal(responsePlaintext, responseAad),
  );

  return {
    suite: { kemId: 32, kdfId: 1, aeadId: 2 },
    inputs: {
      recipientIkm: bytesToHex(recipientIkm),
      requestEkmIkm: bytesToHex(requestEkmIkm),
      responseRecipientIkm: bytesToHex(responseRecipientIkm),
      responseEkmIkm: bytesToHex(responseEkmIkm),
      runtimeNonce: binding.runtimeNonce,
      requestNonce: binding.requestNonce,
      issuedAt: binding.issuedAt,
      method: binding.method,
      route: binding.route,
      bodySha256: base64UrlEncode(bodySha256),
      instanceId: binding.instanceId,
      authorization,
    },
    authority: {
      publicKey: base64UrlEncode(publicKey),
      keyId: binding.keyId,
      responsePublicKey: base64UrlEncode(responsePublicKey),
    },
    request: {
      info: base64UrlEncode(CLIENT_V1_HPKE_REQUEST_INFO),
      aad: base64UrlEncode(requestAad),
      plaintext: base64UrlEncode(requestPlaintext),
      enc: base64UrlEncode(requestSender.enc),
      ciphertext: base64UrlEncode(requestCiphertext),
    },
    response: {
      info: base64UrlEncode(CLIENT_V1_HPKE_RESPONSE_INFO),
      aad: base64UrlEncode(responseAad),
      bodyUtf8: responseBody,
      plaintext: base64UrlEncode(responsePlaintext),
      enc: base64UrlEncode(responseSender.enc),
      ciphertext: base64UrlEncode(responseCiphertext),
    },
  };
}
