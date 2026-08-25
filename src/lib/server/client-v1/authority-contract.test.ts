import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  CLIENT_V1_HPKE_AUTHORITY_MODES,
  CLIENT_V1_HPKE_FRESHNESS,
  CLIENT_V1_HPKE_HEADERS,
  CLIENT_V1_HPKE_LIMITS,
  CLIENT_V1_HPKE_MECHANISM,
  CLIENT_V1_HPKE_RESPONSE_MEDIA_TYPE,
  CLIENT_V1_HPKE_SUITE,
  type ClientV1AuthorityMode,
  type ClientV1OperationBinding,
  type ClientV1OperationCredential,
} from "./authority-contract.ts";

const authorityContractSource = readFileSync(
  new URL("./authority-contract.ts", import.meta.url),
  "utf8",
);

type Equal<Actual, Expected> =
  (<Value>() => Value extends Actual ? 1 : 2) extends
  (<Value>() => Value extends Expected ? 1 : 2)
    ? (<Value>() => Value extends Expected ? 1 : 2) extends
      (<Value>() => Value extends Actual ? 1 : 2)
      ? true
      : false
    : false;
type Assert<Condition extends true> = Condition;

export type ClientV1AuthorityModeIsExact = Assert<
  Equal<ClientV1AuthorityMode, "off" | "advertise" | "enforce">
>;
export type ClientV1OperationCredentialIsExact = Assert<
  Equal<ClientV1OperationCredential, "none" | "pairing-secret" | "bearer" | "admin">
>;
export type ClientV1OperationBindingIsExact = Assert<
  Equal<ClientV1OperationBinding, "none" | "hpke-bound-v1">
>;

test("pins the Client v1 HPKE authority mechanism and modes", () => {
  assert.equal(CLIENT_V1_HPKE_MECHANISM, "hpke-bound-v1");
  assert.deepEqual(CLIENT_V1_HPKE_AUTHORITY_MODES, [
    "off",
    "advertise",
    "enforce",
  ]);
  assert.equal(Object.isFrozen(CLIENT_V1_HPKE_AUTHORITY_MODES), true);
});

test("pins the RFC 9180 suite identifiers", () => {
  assert.deepEqual(CLIENT_V1_HPKE_SUITE, {
    kem: "DHKEM(X25519, HKDF-SHA256)",
    kemId: 32,
    kdf: "HKDF-SHA256",
    kdfId: 1,
    aead: "AES-256-GCM",
    aeadId: 2,
  });
  assert.equal(Object.isFrozen(CLIENT_V1_HPKE_SUITE), true);
});

test("pins the exact bound-authority request headers and response media type", () => {
  assert.deepEqual(CLIENT_V1_HPKE_HEADERS, {
    mechanism: "x-coven-client-v1-authority",
    keyId: "x-coven-client-v1-authority-key-id",
    instanceId: "x-coven-client-v1-authority-instance",
    runtimeNonce: "x-coven-client-v1-authority-runtime-nonce",
    requestNonce: "x-coven-client-v1-authority-request-nonce",
    issuedAt: "x-coven-client-v1-authority-issued-at",
    enc: "x-coven-client-v1-authority-enc",
    ciphertext: "x-coven-client-v1-authority-ciphertext",
  });
  assert.equal(Object.isFrozen(CLIENT_V1_HPKE_HEADERS), true);
  assert.equal(
    CLIENT_V1_HPKE_RESPONSE_MEDIA_TYPE,
    "application/vnd.opencoven.client-v1.hpke-bound-v1+json",
  );
});

test("pins the authority wire limits and replay freshness bounds", () => {
  assert.deepEqual(CLIENT_V1_HPKE_LIMITS, {
    rawKeyBytes: 32,
    encodedKeyCharacters: 43,
    requestPlaintextBytes: 1024,
    requestCiphertextBytes: 2048,
    requestBodyBytes: 65536,
    responsePlaintextBytes: 8 * 1024 * 1024,
    canonicalRouteBytes: 2048,
    instanceIdBytes: 256,
  });
  assert.deepEqual(CLIENT_V1_HPKE_FRESHNESS, {
    maximumAgeMs: 60_000,
    maximumFutureSkewMs: 10_000,
    replayTtlMs: 120_000,
    replayCapacity: 4_096,
  });
  assert.equal(Object.isFrozen(CLIENT_V1_HPKE_LIMITS), true);
  assert.equal(Object.isFrozen(CLIENT_V1_HPKE_FRESHNESS), true);
});

test("keeps the authority contract pure, edge-safe, and public-key-only", () => {
  assert.doesNotMatch(authorityContractSource, /@hpke/u);
  assert.doesNotMatch(authorityContractSource, /node:/u);
  assert.doesNotMatch(authorityContractSource, /\bBuffer\b/u);
  assert.doesNotMatch(authorityContractSource, /\bCryptoKey(?:Pair)?\b/u);
  assert.doesNotMatch(
    authorityContractSource,
    /\b(?:privateKey|private_key|secretKey|secret_key|senderKey|sender_key)\b/u,
  );
  assert.doesNotMatch(
    authorityContractSource,
    /\b(?:process|globalThis|console|fetch|setTimeout|setInterval|Date|performance)\b/u,
  );

  const sourceWithoutApprovedFreezeCalls = authorityContractSource
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/\/\/.*$/gmu, "")
    .replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/gu, "\"\"")
    .replaceAll("Object.freeze", "");
  assert.doesNotMatch(
    sourceWithoutApprovedFreezeCalls,
    /\b(?:new\s+)?[A-Za-z_$][\w$]*\s*\(/u,
    "pure authority contract must not execute runtime calls",
  );
});
