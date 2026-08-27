/**
 * Pure wire contract for Client v1 HPKE-bound authority.
 *
 * This module is safe to import from edge-facing contract code: it contains
 * frozen data and erased TypeScript declarations only.
 */

export const CLIENT_V1_HPKE_MECHANISM = "hpke-bound-v1";

export const CLIENT_V1_HPKE_AUTHORITY_MODES = Object.freeze([
  "off",
  "advertise",
  "enforce",
] as const);

export const CLIENT_V1_HPKE_PROTECTED_OPERATIONS = Object.freeze([
  "pairing.poll",
  "pairing.exchange",
  "familiars.list",
  "projects.list",
  "conversations.list",
  "conversations.read",
  "messages.list",
] as const);

export type ClientV1AuthorityMode =
  (typeof CLIENT_V1_HPKE_AUTHORITY_MODES)[number];

export type ClientV1OperationCredential =
  | "none"
  | "pairing-secret"
  | "bearer"
  | "admin";

export type ClientV1OperationBinding = "none" | "hpke-bound-v1";

export type ClientV1HpkeAuthority = {
  mechanism: "hpke-bound-v1";
  mode: "advertise" | "enforce";
  keyId: string;
  publicKey: string;
  suite: {
    kemId: 32;
    kdfId: 1;
    aeadId: 2;
  };
};

export const CLIENT_V1_HPKE_SUITE = Object.freeze({
  kem: "DHKEM(X25519, HKDF-SHA256)",
  kemId: 32,
  kdf: "HKDF-SHA256",
  kdfId: 1,
  aead: "AES-256-GCM",
  aeadId: 2,
} as const);

export const CLIENT_V1_HPKE_HEADERS = Object.freeze({
  mechanism: "x-coven-client-v1-authority",
  keyId: "x-coven-client-v1-authority-key-id",
  instanceId: "x-coven-client-v1-authority-instance",
  runtimeNonce: "x-coven-client-v1-authority-runtime-nonce",
  requestNonce: "x-coven-client-v1-authority-request-nonce",
  issuedAt: "x-coven-client-v1-authority-issued-at",
  enc: "x-coven-client-v1-authority-enc",
  ciphertext: "x-coven-client-v1-authority-ciphertext",
} as const);

export const CLIENT_V1_HPKE_RESPONSE_MEDIA_TYPE =
  "application/vnd.opencoven.client-v1.hpke-bound-v1+json";

export const CLIENT_V1_HPKE_LIMITS = Object.freeze({
  rawKeyBytes: 32,
  encodedKeyCharacters: 43,
  requestPlaintextBytes: 1024,
  requestCiphertextBytes: 2048,
  requestBodyBytes: 65_536,
  responsePlaintextBytes: 8 * 1024 * 1024,
  responseCiphertextBytes: 8_388_624,
  responseEnvelopeBytes: 11_185_056,
  canonicalRouteBytes: 2_048,
  instanceIdBytes: 256,
} as const);

export const CLIENT_V1_HPKE_FRESHNESS = Object.freeze({
  maximumAgeMs: 60_000,
  maximumFutureSkewMs: 10_000,
  replayTtlMs: 120_000,
  replayCapacity: 4_096,
} as const);

export const CLIENT_V1_AUTHORITY_CONTRACT = Object.freeze({
  defaultMode: "off",
  modes: CLIENT_V1_HPKE_AUTHORITY_MODES,
  mechanism: Object.freeze({
    id: CLIENT_V1_HPKE_MECHANISM,
    discoveryVersion: 2,
    suite: CLIENT_V1_HPKE_SUITE,
    requestHeaders: CLIENT_V1_HPKE_HEADERS,
    responseMediaType: CLIENT_V1_HPKE_RESPONSE_MEDIA_TYPE,
    requestHpkeMode: "base",
    responseHpkeMode: "auth",
    requestEncoding: "headers-plus-rfc8785-json",
    aadEncoding: "u32be-length-prefixed-v1",
    canonicalRoute: "rfc3986-sorted-query-v1",
    keyIdDerivation: "sha256-domain-separated-public-key-v1",
    requestInfo: "OpenCoven/client-v1/hpke-bound-v1/request",
    responseInfo: "OpenCoven/client-v1/hpke-bound-v1/response",
    limits: CLIENT_V1_HPKE_LIMITS,
    freshness: CLIENT_V1_HPKE_FRESHNESS,
    protectedOperations: CLIENT_V1_HPKE_PROTECTED_OPERATIONS,
    vectorFixture: Object.freeze({
      fileName: "hpke-bound-v1-vectors.json",
      sha256FileName: "hpke-bound-v1-vectors.sha256",
    } as const),
  } as const),
} as const);

export type ClientV1AuthorityContract =
  typeof CLIENT_V1_AUTHORITY_CONTRACT;

export type ClientV1HpkeBinding = {
  method: string;
  route: string;
  bodySha256: Uint8Array;
  instanceId: string;
  runtimeNonce: string;
  runtimeNonceBytes: Uint8Array;
  keyId: string;
  keyIdBytes: Uint8Array;
  requestNonce: string;
  requestNonceBytes: Uint8Array;
  issuedAt: number;
};

export type ClientV1HpkeAuthorization =
  | { kind: "pairing-secret"; value: string }
  | { kind: "bearer"; value: string };

export interface ClientV1HpkeBoundRequestPlaintext {
  version: 1;
  authorization: ClientV1HpkeAuthorization;
  responsePublicKey: string;
}

export interface ClientV1HpkeBoundResponsePlaintext {
  version: 1;
  requestNonce: string;
  status: number;
  headers: {
    contentType: "application/json";
    retryAfter?: string;
  };
  body: string;
}

export interface ClientV1HpkeBoundResponseEnvelope {
  version: 1;
  mechanism: "hpke-bound-v1";
  keyId: string;
  requestNonce: string;
  enc: string;
  ciphertext: string;
}
