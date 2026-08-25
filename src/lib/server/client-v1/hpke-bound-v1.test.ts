import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { CipherSuite } from "@hpke/core";
import canonicalize from "canonicalize";

import {
  CLIENT_V1_HPKE_FRESHNESS,
  CLIENT_V1_HPKE_HEADERS,
  CLIENT_V1_HPKE_LIMITS,
  CLIENT_V1_HPKE_MECHANISM,
  CLIENT_V1_HPKE_RESPONSE_MEDIA_TYPE,
  type ClientV1HpkeAuthority,
  type ClientV1HpkeAuthorization,
  type ClientV1HpkeBinding,
} from "./authority-contract.ts";
import {
  CLIENT_V1_HPKE_REQUEST_INFO,
  CLIENT_V1_HPKE_RESPONSE_INFO,
  ClientV1HpkeBoundRequestError,
  base64UrlDecode,
  base64UrlEncode,
  canonicalClientV1Route,
  clientV1HpkeKeyId,
  clientV1HpkePublicKey,
  concatBytes,
  createClientV1HpkeSuite,
  encodeClientV1HpkeAad,
  frame,
  openClientV1HpkeBoundRequest,
  sealClientV1HpkeBoundResponse,
  uint32be,
  uint64be,
} from "./hpke-bound-v1.ts";
import { createClientV1HpkeBoundV1Vector } from "./hpke-bound-v1-vector.ts";
import { createClientV1HpkeTestClient } from "./testing/hpke-client.ts";
import {
  clientV1HpkeVectorSha256,
  renderClientV1HpkeVector,
} from "../../../../scripts/export-client-v1-hpke-vectors.mjs";

const UTF8 = new TextEncoder();
const UTF8_FATAL = new TextDecoder("utf-8", { fatal: true });
const NOW = 1_787_672_578_109;
const INSTANCE_ID = "00000000-0000-4000-8000-000000000000";
const ROUTE =
  "/api/client/v1/pairing/requests/"
  + "11111111-1111-4111-8111-111111111111/exchange";
const ORIGIN = "http://127.0.0.1:3020";

function range(start: number): Uint8Array {
  return Uint8Array.from({ length: 32 }, (_, index) => start + index);
}

const RECIPIENT_IKM = range(0x00);
const REQUEST_EKM_IKM = range(0x20);
const RESPONSE_RECIPIENT_IKM = range(0x40);
const RESPONSE_EKM_IKM = range(0x60);
const RUNTIME_NONCE = range(0x80);
const REQUEST_NONCE = range(0xa0);
const PAIRING_SECRET = range(0xc0);

function jcs(value: unknown): Uint8Array {
  const rendered = canonicalize(value);
  assert.equal(typeof rendered, "string");
  return UTF8.encode(rendered);
}

function sha256(value: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(value).digest());
}

function flip(value: Uint8Array, index = 0): Uint8Array {
  const changed = value.slice();
  changed[index] ^= 1;
  return changed;
}

function requestHeaders(input: {
  binding: ClientV1HpkeBinding;
  enc: Uint8Array;
  ciphertext: Uint8Array;
}): Headers {
  return new Headers({
    [CLIENT_V1_HPKE_HEADERS.mechanism]: CLIENT_V1_HPKE_MECHANISM,
    [CLIENT_V1_HPKE_HEADERS.keyId]: input.binding.keyId,
    [CLIENT_V1_HPKE_HEADERS.instanceId]: base64UrlEncode(
      UTF8.encode(input.binding.instanceId),
    ),
    [CLIENT_V1_HPKE_HEADERS.runtimeNonce]: input.binding.runtimeNonce,
    [CLIENT_V1_HPKE_HEADERS.requestNonce]: input.binding.requestNonce,
    [CLIENT_V1_HPKE_HEADERS.issuedAt]: String(input.binding.issuedAt),
    [CLIENT_V1_HPKE_HEADERS.enc]: base64UrlEncode(input.enc),
    [CLIENT_V1_HPKE_HEADERS.ciphertext]: base64UrlEncode(input.ciphertext),
  });
}

type RequestFixture = {
  suite: CipherSuite;
  recipient: CryptoKeyPair;
  recipientPublicKeyBytes: Uint8Array;
  responseRecipient: CryptoKeyPair;
  responsePublicKeyBytes: Uint8Array;
  binding: ClientV1HpkeBinding;
  request: Request;
  body: Uint8Array;
  enc: Uint8Array;
  ciphertext: Uint8Array;
  plaintext: Uint8Array;
};

async function createRequestFixture(options: {
  issuedAt?: number;
  method?: string;
  url?: string;
  body?: Uint8Array;
  authorization?: ClientV1HpkeAuthorization;
  plaintext?: Uint8Array;
  requestInfo?: Uint8Array;
  sealAad?: Uint8Array;
  responsePublicKeyBytes?: Uint8Array;
} = {}): Promise<RequestFixture> {
  const suite = createClientV1HpkeSuite();
  const recipient = await suite.kem.deriveKeyPair(RECIPIENT_IKM);
  const recipientPublicKeyBytes = await clientV1HpkePublicKey(
    suite,
    recipient.publicKey,
  );
  const responseRecipient = await suite.kem.deriveKeyPair(
    RESPONSE_RECIPIENT_IKM,
  );
  const responsePublicKeyBytes =
    options.responsePublicKeyBytes
    ?? await clientV1HpkePublicKey(suite, responseRecipient.publicKey);
  const body = options.body?.slice() ?? new Uint8Array();
  const method = (options.method ?? "POST").toUpperCase();
  const url = new URL(options.url ?? `${ORIGIN}${ROUTE}`);
  const keyIdBytes = clientV1HpkeKeyId(recipientPublicKeyBytes);
  const binding: ClientV1HpkeBinding = {
    method,
    route: canonicalClientV1Route(url),
    bodySha256: sha256(body),
    instanceId: INSTANCE_ID,
    runtimeNonce: base64UrlEncode(RUNTIME_NONCE),
    runtimeNonceBytes: RUNTIME_NONCE.slice(),
    keyId: base64UrlEncode(keyIdBytes),
    keyIdBytes,
    requestNonce: base64UrlEncode(REQUEST_NONCE),
    requestNonceBytes: REQUEST_NONCE.slice(),
    issuedAt: options.issuedAt ?? NOW,
  };
  const plaintext = options.plaintext ?? jcs({
    authorization: options.authorization ?? {
      kind: "pairing-secret",
      value: base64UrlEncode(PAIRING_SECRET),
    },
    responsePublicKey: base64UrlEncode(responsePublicKeyBytes),
    version: 1,
  });
  const sender = await suite.createSenderContext({
    recipientPublicKey: recipient.publicKey,
    info: options.requestInfo ?? CLIENT_V1_HPKE_REQUEST_INFO,
    ekm: REQUEST_EKM_IKM,
  });
  const ciphertext = new Uint8Array(
    await sender.seal(
      plaintext,
      options.sealAad ?? encodeClientV1HpkeAad("request", binding),
    ),
  );
  const enc = new Uint8Array(sender.enc);
  return {
    suite,
    recipient,
    recipientPublicKeyBytes,
    responseRecipient,
    responsePublicKeyBytes,
    binding,
    request: new Request(url, {
      method,
      headers: requestHeaders({ binding, enc, ciphertext }),
    }),
    body,
    enc,
    ciphertext,
    plaintext,
  };
}

async function openFixture(
  fixture: RequestFixture,
  overrides: Partial<Parameters<typeof openClientV1HpkeBoundRequest>[0]> = {},
) {
  return openClientV1HpkeBoundRequest({
    suite: fixture.suite,
    recipientKey: fixture.recipient.privateKey,
    request: fixture.request,
    body: fixture.body,
    expectedKeyId: fixture.binding.keyIdBytes,
    expectedRuntimeNonce: fixture.binding.runtimeNonceBytes,
    expectedInstanceId: fixture.binding.instanceId,
    now: fixture.binding.issuedAt,
    ...overrides,
  });
}

async function assertRequestError(
  promise: Promise<unknown>,
  kind: ClientV1HpkeBoundRequestError["kind"],
  absent?: string,
): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof ClientV1HpkeBoundRequestError);
    assert.equal(error.kind, kind);
    assert.equal(error.message, "Client v1 HPKE bound request rejected.");
    if (absent) assert.equal(error.message.includes(absent), false);
    return true;
  });
}

test("uses strict canonical unpadded base64url with exact bounds", () => {
  assert.equal(base64UrlEncode(Uint8Array.from([0xfb, 0xff])), "-_8");
  assert.deepEqual(
    base64UrlDecode("-_8", { minimum: 2, maximum: 2 }),
    { bytes: Uint8Array.from([0xfb, 0xff]), encoded: "-_8" },
  );
  for (const invalid of ["-_8=", "+/8", "-_9", "A", "AA=", "AA\n"]) {
    assert.throws(
      () => base64UrlDecode(invalid, { minimum: 1, maximum: 2 }),
      /canonical base64url|invalid length or encoding/u,
      invalid,
    );
  }
  assert.throws(
    () => base64UrlDecode("AA", { minimum: 2, maximum: 2 }),
    /invalid length or encoding/u,
  );
});

test("encodes deterministic big-endian integers and length-prefixed frames", () => {
  assert.deepEqual(uint32be(0x0102_0304), Uint8Array.of(1, 2, 3, 4));
  assert.deepEqual(
    uint64be(0x0102_0304_0506),
    Uint8Array.of(0, 0, 1, 2, 3, 4, 5, 6),
  );
  assert.deepEqual(
    frame(Uint8Array.of(0xaa, 0xbb)),
    Uint8Array.of(0, 0, 0, 2, 0xaa, 0xbb),
  );
  assert.deepEqual(
    concatBytes(Uint8Array.of(1), Uint8Array.of(2, 3)),
    Uint8Array.of(1, 2, 3),
  );
  assert.throws(() => uint32be(-1));
  assert.throws(() => uint64be(Number.MAX_SAFE_INTEGER + 1));
});

test("canonicalizes query pairs by deterministic encoded wire order", () => {
  assert.equal(
    canonicalClientV1Route(
      new URL(
        "http://127.0.0.1:3020/api/client/v1/projects?limit=2&cursor=a%20b",
      ),
    ),
    "/api/client/v1/projects?cursor=a%20b&limit=2",
  );
  assert.equal(
    canonicalClientV1Route(
      new URL(
        "http://127.0.0.1:3020/api/client/v1/projects?z=%21&a=hello+world",
      ),
    ),
    "/api/client/v1/projects?a=hello%20world&z=%21",
  );
  assert.equal(
    canonicalClientV1Route(new URL("http://127.0.0.1:3020/projects?b=1&A=2&a=1")),
    "/projects?A=2&a=1&b=1",
  );
  assert.equal(
    canonicalClientV1Route(
      new URL("http://127.0.0.1:3020/projects?%C3%A9=1&z=1"),
    ),
    "/projects?%C3%A9=1&z=1",
  );
  assert.equal(
    canonicalClientV1Route(
      new URL(
        "http://127.0.0.1:3020/projects"
        + "?z=plain"
        + "&%C3%A9=unicode"
        + "&%5B=bracket"
        + "&dup=z"
        + "&dup=%C3%A9"
        + "&dup=space+value"
        + "&dup=%21"
        + "&dup=~"
        + "&space+name=a+b"
        + "&punct%21=%28%29",
      ),
    ),
    "/projects"
      + "?%5B=bracket"
      + "&%C3%A9=unicode"
      + "&dup=%21"
      + "&dup=%C3%A9"
      + "&dup=space%20value"
      + "&dup=z"
      + "&dup=~"
      + "&punct%21=%28%29"
      + "&space%20name=a%20b"
      + "&z=plain",
  );
  assert.throws(
    () => canonicalClientV1Route(new URL("http://127.0.0.1:3020/api/%25")),
    /path is not canonical/u,
  );
  assert.throws(
    () =>
      canonicalClientV1Route(
        new URL(`http://127.0.0.1:3020/${"a".repeat(2050)}`),
      ),
    /route is too long/u,
  );
});

test("uses distinct fixed request and response info and binary AAD domains", async () => {
  const fixture = await createRequestFixture();
  const requestAad = encodeClientV1HpkeAad("request", fixture.binding);
  const responseAad = encodeClientV1HpkeAad("response", fixture.binding);

  assert.equal(
    UTF8_FATAL.decode(CLIENT_V1_HPKE_REQUEST_INFO),
    "OpenCoven/client-v1/hpke-bound-v1/request",
  );
  assert.equal(
    UTF8_FATAL.decode(CLIENT_V1_HPKE_RESPONSE_INFO),
    "OpenCoven/client-v1/hpke-bound-v1/response",
  );
  assert.notDeepEqual(CLIENT_V1_HPKE_REQUEST_INFO, CLIENT_V1_HPKE_RESPONSE_INFO);
  assert.notDeepEqual(requestAad, responseAad);
  const requestDomain = UTF8.encode(
    "OpenCoven/client-v1/hpke-bound-v1/aad/request\0",
  );
  const responseDomain = UTF8.encode(
    "OpenCoven/client-v1/hpke-bound-v1/aad/response\0",
  );
  assert.deepEqual(requestAad.subarray(0, requestDomain.byteLength), requestDomain);
  assert.deepEqual(
    responseAad.subarray(0, responseDomain.byteLength),
    responseDomain,
  );
});

test("constructs only the pinned RFC 9180 suite and derives the reviewed key ID", async () => {
  const suite = createClientV1HpkeSuite();
  const pair = await suite.kem.deriveKeyPair(RECIPIENT_IKM);
  const publicKey = await clientV1HpkePublicKey(suite, pair.publicKey);
  assert.equal(publicKey.byteLength, 32);
  assert.deepEqual(
    clientV1HpkeKeyId(publicKey),
    new Uint8Array(
      createHash("sha256")
        .update("OpenCoven/client-v1/hpke-bound-v1/key-id\0", "utf8")
        .update(publicKey)
        .digest(),
    ),
  );
});

test("source forbids locale sorting, custom primitives, and direct AEAD nonce work", () => {
  const productionSource = readFileSync(
    new URL("./hpke-bound-v1.ts", import.meta.url),
    "utf8",
  );
  const clientSource = readFileSync(
    new URL("./testing/hpke-client.ts", import.meta.url),
    "utf8",
  );
  const vectorSource = readFileSync(
    new URL("./hpke-bound-v1-vector.ts", import.meta.url),
    "utf8",
  );
  const combined = `${productionSource}\n${clientSource}\n${vectorSource}`;

  assert.doesNotMatch(combined, /localeCompare/u);
  assert.doesNotMatch(
    combined,
    /\b(?:createCipheriv|createDecipheriv|diffieHellman|hkdfSync|scryptSync|pbkdf2Sync)\b/u,
  );
  assert.doesNotMatch(
    combined,
    /\bsubtle\.(?:encrypt|decrypt|deriveBits|deriveKey)\b/u,
  );
  assert.doesNotMatch(combined, /\.createEncryptionContext\s*\(/u);
  assert.doesNotMatch(combined, /\b(?:iv|baseNonce)\s*:/u);
  assert.match(productionSource, /new DhkemX25519HkdfSha256\(\)/u);
  assert.match(productionSource, /new HkdfSha256\(\)/u);
  assert.match(productionSource, /new Aes256Gcm\(\)/u);
  const requestSenderBlock = /const requestSender = await suite\.createSenderContext\(\{[\s\S]*?\n  \}\);/u
    .exec(vectorSource)?.[0];
  const responseSenderBlock = /const responseSender = await suite\.createSenderContext\(\{[\s\S]*?\n  \}\);/u
    .exec(vectorSource)?.[0];
  assert.ok(requestSenderBlock);
  assert.ok(responseSenderBlock);
  assert.doesNotMatch(requestSenderBlock, /senderKey/u);
  assert.match(responseSenderBlock, /senderKey: recipient\.privateKey/u);
  assert.match(
    productionSource,
    /createRecipientContext\(\{\s*recipientKey: input\.recipientKey,\s*enc,\s*info: CLIENT_V1_HPKE_REQUEST_INFO/u,
  );
  assert.match(
    clientSource,
    /createRecipientContext\(\{\s*recipientKey: responseRecipient\.privateKey,\s*senderPublicKey: authorityPublicKey/u,
  );
});

test("recomputes the normative vector bytes, digest, fields, and both RFC 9180 opens", async () => {
  const vectorUrl = new URL("./hpke-bound-v1-vectors.json", import.meta.url);
  const digestUrl = new URL("./hpke-bound-v1-vectors.sha256", import.meta.url);
  const committedBytes = readFileSync(vectorUrl);
  const committedDigest = readFileSync(digestUrl, "utf8");
  const generated = await createClientV1HpkeBoundV1Vector();
  const rendered = renderClientV1HpkeVector(generated);

  assert.equal(committedBytes.toString("utf8"), rendered);
  assert.equal(rendered.endsWith("\n"), true);
  assert.equal(rendered.includes("\r"), false);
  assert.equal(committedDigest, clientV1HpkeVectorSha256(rendered));
  assert.equal(
    committedDigest,
    `${createHash("sha256").update(committedBytes).digest("hex")}\n`,
  );

  const vector = JSON.parse(committedBytes.toString("utf8"));
  assert.deepEqual(Object.keys(vector).sort(), [
    "authority",
    "inputs",
    "request",
    "response",
    "suite",
  ]);
  assert.deepEqual(vector.suite, { aeadId: 2, kdfId: 1, kemId: 32 });
  assert.equal(vector.inputs.recipientIkm, Buffer.from(RECIPIENT_IKM).toString("hex"));
  assert.equal(vector.inputs.requestEkmIkm, Buffer.from(REQUEST_EKM_IKM).toString("hex"));
  assert.equal(
    vector.inputs.responseRecipientIkm,
    Buffer.from(RESPONSE_RECIPIENT_IKM).toString("hex"),
  );
  assert.equal(
    vector.inputs.responseEkmIkm,
    Buffer.from(RESPONSE_EKM_IKM).toString("hex"),
  );
  assert.equal(vector.inputs.route, ROUTE);
  assert.equal(vector.inputs.issuedAt, NOW);

  const suite = createClientV1HpkeSuite();
  const recipient = await suite.kem.deriveKeyPair(RECIPIENT_IKM);
  const requestRecipient = await suite.createRecipientContext({
    recipientKey: recipient.privateKey,
    enc: base64UrlDecode(vector.request.enc, { minimum: 32, maximum: 32 }).bytes,
    info: base64UrlDecode(vector.request.info, { minimum: 1, maximum: 128 }).bytes,
  });
  const requestPlaintext = await requestRecipient.open(
    base64UrlDecode(vector.request.ciphertext, {
      minimum: 16,
      maximum: CLIENT_V1_HPKE_LIMITS.requestCiphertextBytes,
    }).bytes,
    base64UrlDecode(vector.request.aad, { minimum: 1, maximum: 4096 }).bytes,
  );
  assert.equal(base64UrlEncode(requestPlaintext), vector.request.plaintext);

  const responseRecipient = await suite.kem.deriveKeyPair(RESPONSE_RECIPIENT_IKM);
  const senderPublicKey = await suite.kem.deserializePublicKey(
    base64UrlDecode(vector.authority.publicKey, { minimum: 32, maximum: 32 }).bytes,
  );
  const responseContext = await suite.createRecipientContext({
    recipientKey: responseRecipient.privateKey,
    senderPublicKey,
    enc: base64UrlDecode(vector.response.enc, { minimum: 32, maximum: 32 }).bytes,
    info: base64UrlDecode(vector.response.info, { minimum: 1, maximum: 128 }).bytes,
  });
  const responsePlaintext = await responseContext.open(
    base64UrlDecode(vector.response.ciphertext, {
      minimum: 16,
      maximum: CLIENT_V1_HPKE_LIMITS.responseCiphertextBytes,
    }).bytes,
    base64UrlDecode(vector.response.aad, { minimum: 1, maximum: 4096 }).bytes,
  );
  assert.equal(base64UrlEncode(responsePlaintext), vector.response.plaintext);
});

test("opens the normative Base request and the test client opens the normative Auth response", async () => {
  const vector = JSON.parse(
    readFileSync(new URL("./hpke-bound-v1-vectors.json", import.meta.url), "utf8"),
  );
  const suite = createClientV1HpkeSuite();
  const recipient = await suite.kem.deriveKeyPair(RECIPIENT_IKM);
  const request = new Request(`${ORIGIN}${vector.inputs.route}`, {
    method: vector.inputs.method,
    headers: {
      [CLIENT_V1_HPKE_HEADERS.mechanism]: CLIENT_V1_HPKE_MECHANISM,
      [CLIENT_V1_HPKE_HEADERS.keyId]: vector.authority.keyId,
      [CLIENT_V1_HPKE_HEADERS.instanceId]: base64UrlEncode(
        UTF8.encode(vector.inputs.instanceId),
      ),
      [CLIENT_V1_HPKE_HEADERS.runtimeNonce]: vector.inputs.runtimeNonce,
      [CLIENT_V1_HPKE_HEADERS.requestNonce]: vector.inputs.requestNonce,
      [CLIENT_V1_HPKE_HEADERS.issuedAt]: String(vector.inputs.issuedAt),
      [CLIENT_V1_HPKE_HEADERS.enc]: vector.request.enc,
      [CLIENT_V1_HPKE_HEADERS.ciphertext]: vector.request.ciphertext,
    },
  });
  const opened = await openClientV1HpkeBoundRequest({
    suite,
    recipientKey: recipient.privateKey,
    request,
    body: new Uint8Array(),
    expectedKeyId: base64UrlDecode(vector.authority.keyId, {
      minimum: 32,
      maximum: 32,
    }).bytes,
    expectedRuntimeNonce: RUNTIME_NONCE,
    expectedInstanceId: INSTANCE_ID,
    now: NOW,
  });
  assert.deepEqual(opened.authorization, vector.inputs.authorization);
  assert.equal(
    base64UrlEncode(opened.responsePublicKeyBytes),
    vector.authority.responsePublicKey,
  );
  assert.equal(base64UrlEncode(encodeClientV1HpkeAad("request", opened.binding)), vector.request.aad);

  const client = await createClientV1HpkeTestClient({
    authority: {
      mechanism: CLIENT_V1_HPKE_MECHANISM,
      mode: "enforce",
      keyId: vector.authority.keyId,
      publicKey: vector.authority.publicKey,
      suite: vector.suite,
    },
    instanceId: INSTANCE_ID,
    runtimeNonce: vector.inputs.runtimeNonce,
    operation: "pairing.exchange",
    url: `${ORIGIN}${ROUTE}`,
    method: "POST",
    issuedAt: NOW,
    requestNonce: REQUEST_NONCE,
    authorization: vector.inputs.authorization,
    requestEkm: REQUEST_EKM_IKM,
    responseRecipientIkm: RESPONSE_RECIPIENT_IKM,
  });
  assert.equal(client.request.headers.get(CLIENT_V1_HPKE_HEADERS.enc), vector.request.enc);
  assert.equal(
    client.request.headers.get(CLIENT_V1_HPKE_HEADERS.ciphertext),
    vector.request.ciphertext,
  );
  assert.equal(base64UrlEncode(client.responsePublicKey), vector.authority.responsePublicKey);

  const response = await client.open(
    Response.json(
      {
        version: 1,
        mechanism: CLIENT_V1_HPKE_MECHANISM,
        keyId: vector.authority.keyId,
        requestNonce: vector.inputs.requestNonce,
        enc: vector.response.enc,
        ciphertext: vector.response.ciphertext,
      },
      {
        status: 200,
        headers: { "content-type": CLIENT_V1_HPKE_RESPONSE_MEDIA_TYPE },
      },
    ),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.contentType, "application/json");
  assert.equal(UTF8_FATAL.decode(response.body), vector.response.bodyUtf8);
});

test("returns only typed fixed request-open errors and accepts inclusive freshness bounds", async () => {
  for (const issuedAt of [
    NOW - CLIENT_V1_HPKE_FRESHNESS.maximumAgeMs,
    NOW + CLIENT_V1_HPKE_FRESHNESS.maximumFutureSkewMs,
  ]) {
    const fixture = await createRequestFixture({ issuedAt });
    const opened = await openFixture(fixture, { now: NOW });
    assert.equal(opened.binding.issuedAt, issuedAt);
  }

  for (const issuedAt of [
    NOW - CLIENT_V1_HPKE_FRESHNESS.maximumAgeMs - 1,
    NOW + CLIENT_V1_HPKE_FRESHNESS.maximumFutureSkewMs + 1,
  ]) {
    const fixture = await createRequestFixture({ issuedAt });
    await assertRequestError(openFixture(fixture, { now: NOW }), "stale-request");
  }

  const fixture = await createRequestFixture();
  await assertRequestError(
    openFixture(fixture, { expectedKeyId: flip(fixture.binding.keyIdBytes) }),
    "stale-key",
  );
  await assertRequestError(
    openFixture(fixture, {
      expectedRuntimeNonce: flip(fixture.binding.runtimeNonceBytes),
    }),
    "stale-key",
  );
  await assertRequestError(
    openFixture(fixture, { expectedInstanceId: "different-instance" }),
    "stale-instance",
  );
});

test("rejects malformed, duplicate, and oversized request fields as fixed invalid errors", async () => {
  const fixture = await createRequestFixture();
  const cases: Array<[string, string | null]> = [
    [CLIENT_V1_HPKE_HEADERS.mechanism, null],
    [CLIENT_V1_HPKE_HEADERS.mechanism, "other"],
    [CLIENT_V1_HPKE_HEADERS.keyId, "-_8="],
    [CLIENT_V1_HPKE_HEADERS.runtimeNonce, "A"],
    [CLIENT_V1_HPKE_HEADERS.instanceId, ""],
    [CLIENT_V1_HPKE_HEADERS.issuedAt, "01"],
    [CLIENT_V1_HPKE_HEADERS.issuedAt, "0"],
    [CLIENT_V1_HPKE_HEADERS.issuedAt, "9007199254740992"],
    [CLIENT_V1_HPKE_HEADERS.requestNonce, base64UrlEncode(new Uint8Array(31))],
    [CLIENT_V1_HPKE_HEADERS.enc, base64UrlEncode(new Uint8Array(31))],
    [CLIENT_V1_HPKE_HEADERS.ciphertext, base64UrlEncode(new Uint8Array(15))],
  ];

  for (const [name, value] of cases) {
    const headers = new Headers(fixture.request.headers);
    if (value === null) headers.delete(name);
    else headers.set(name, value);
    const request = new Request(fixture.request.url, {
      method: fixture.request.method,
      headers,
    });
    await assertRequestError(
      openFixture(fixture, { request }),
      "invalid",
      value ?? name,
    );
  }

  const duplicateHeaders = new Headers(fixture.request.headers);
  duplicateHeaders.append(
    CLIENT_V1_HPKE_HEADERS.keyId,
    fixture.binding.keyId,
  );
  await assertRequestError(
    openFixture(fixture, {
      request: new Request(fixture.request.url, {
        method: fixture.request.method,
        headers: duplicateHeaders,
      }),
    }),
    "invalid",
  );

  const oversized = "x".repeat(10_000);
  const oversizedHeaders = new Headers(fixture.request.headers);
  oversizedHeaders.set(CLIENT_V1_HPKE_HEADERS.ciphertext, oversized);
  await assertRequestError(
    openFixture(fixture, {
      request: new Request(fixture.request.url, {
        method: fixture.request.method,
        headers: oversizedHeaders,
      }),
    }),
    "invalid",
    oversized,
  );
});

test("rejects a 2049-byte ciphertext before invoking HPKE", async () => {
  const fixture = await createRequestFixture();
  let hpkeCalls = 0;
  const suite = {
    createRecipientContext() {
      hpkeCalls += 1;
      throw new Error("HPKE must not run");
    },
  } as unknown as CipherSuite;
  const headers = requestHeaders({
    binding: fixture.binding,
    enc: fixture.enc,
    ciphertext: new Uint8Array(
      CLIENT_V1_HPKE_LIMITS.requestCiphertextBytes + 1,
    ),
  });
  await assertRequestError(
    openFixture(fixture, {
      suite,
      request: new Request(fixture.request.url, {
        method: fixture.request.method,
        headers,
      }),
    }),
    "invalid",
  );
  assert.equal(hpkeCalls, 0);
});

test("rejects noncanonical JCS, duplicate keys, invalid UTF-8, and invalid response keys", async () => {
  const valid = {
    authorization: {
      kind: "pairing-secret",
      value: base64UrlEncode(PAIRING_SECRET),
    },
    responsePublicKey: base64UrlEncode(range(0x40)),
    version: 1,
  };
  const plaintexts = [
    UTF8.encode(JSON.stringify(valid, null, 2)),
    UTF8.encode(
      `{"authorization":{"kind":"pairing-secret","value":"${base64UrlEncode(PAIRING_SECRET)}"},`
      + `"responsePublicKey":"${base64UrlEncode(range(0x40))}","version":1,"version":1}`,
    ),
    Uint8Array.of(0xff),
    jcs({ ...valid, extra: true }),
    jcs({ ...valid, responsePublicKey: base64UrlEncode(new Uint8Array(31)) }),
    jcs({ ...valid, authorization: { kind: "pairing-secret" } }),
    jcs({ ...valid, authorization: { kind: "bearer", value: "x".repeat(513) } }),
  ];
  for (const plaintext of plaintexts) {
    const fixture = await createRequestFixture({ plaintext });
    await assertRequestError(openFixture(fixture), "invalid");
  }
});

test("binds key, method, route, query, body, instance, nonces, time, AAD, info, enc, and ciphertext", async () => {
  const fixture = await createRequestFixture({
    url: `${ORIGIN}${ROUTE}?z=%21&a=hello+world`,
  });
  const requestMutation = (
    url: string,
    method = fixture.request.method,
    headers = fixture.request.headers,
  ) => new Request(url, { method, headers });
  const changedHeaders = (
    name: string,
    value: string,
  ): Headers => {
    const headers = new Headers(fixture.request.headers);
    headers.set(name, value);
    return headers;
  };

  await assertRequestError(
    openFixture(fixture, {
      request: requestMutation(fixture.request.url, "PUT"),
    }),
    "invalid",
  );
  await assertRequestError(
    openFixture(fixture, {
      request: requestMutation(`${ORIGIN}${ROUTE}x?z=%21&a=hello+world`),
    }),
    "invalid",
  );
  await assertRequestError(
    openFixture(fixture, {
      request: requestMutation(`${ORIGIN}${ROUTE}?z=%21&a=changed`),
    }),
    "invalid",
  );
  await assertRequestError(
    openFixture(fixture, { body: Uint8Array.of(1) }),
    "invalid",
  );
  await assertRequestError(
    openFixture(fixture, {
      request: requestMutation(
        fixture.request.url,
        fixture.request.method,
        changedHeaders(
          CLIENT_V1_HPKE_HEADERS.keyId,
          base64UrlEncode(flip(fixture.binding.keyIdBytes)),
        ),
      ),
    }),
    "stale-key",
  );
  await assertRequestError(
    openFixture(fixture, {
      request: requestMutation(
        fixture.request.url,
        fixture.request.method,
        changedHeaders(
          CLIENT_V1_HPKE_HEADERS.runtimeNonce,
          base64UrlEncode(flip(fixture.binding.runtimeNonceBytes)),
        ),
      ),
    }),
    "stale-key",
  );
  await assertRequestError(
    openFixture(fixture, {
      request: requestMutation(
        fixture.request.url,
        fixture.request.method,
        changedHeaders(
          CLIENT_V1_HPKE_HEADERS.instanceId,
          base64UrlEncode(UTF8.encode("another-instance")),
        ),
      ),
    }),
    "stale-instance",
  );
  await assertRequestError(
    openFixture(fixture, {
      request: requestMutation(
        fixture.request.url,
        fixture.request.method,
        changedHeaders(
          CLIENT_V1_HPKE_HEADERS.requestNonce,
          base64UrlEncode(flip(fixture.binding.requestNonceBytes)),
        ),
      ),
    }),
    "invalid",
  );
  await assertRequestError(
    openFixture(fixture, {
      request: requestMutation(
        fixture.request.url,
        fixture.request.method,
        changedHeaders(
          CLIENT_V1_HPKE_HEADERS.issuedAt,
          String(fixture.binding.issuedAt + 1),
        ),
      ),
    }),
    "invalid",
  );
  await assertRequestError(
    openFixture(fixture, {
      request: requestMutation(
        fixture.request.url,
        fixture.request.method,
        changedHeaders(
          CLIENT_V1_HPKE_HEADERS.enc,
          base64UrlEncode(flip(fixture.enc)),
        ),
      ),
    }),
    "invalid",
  );
  await assertRequestError(
    openFixture(fixture, {
      request: requestMutation(
        fixture.request.url,
        fixture.request.method,
        changedHeaders(
          CLIENT_V1_HPKE_HEADERS.ciphertext,
          base64UrlEncode(flip(fixture.ciphertext)),
        ),
      ),
    }),
    "invalid",
  );

  const wrongAad = await createRequestFixture({
    sealAad: encodeClientV1HpkeAad("response", fixture.binding),
  });
  await assertRequestError(openFixture(wrongAad), "invalid");
  const wrongInfo = await createRequestFixture({
    requestInfo: CLIENT_V1_HPKE_RESPONSE_INFO,
  });
  await assertRequestError(openFixture(wrongInfo), "invalid");
});

test("a replacement recipient cannot open a Base request", async () => {
  const fixture = await createRequestFixture();
  const replacement = await fixture.suite.kem.deriveKeyPair(range(0xe0));
  await assertRequestError(
    openFixture(fixture, { recipientKey: replacement.privateKey }),
    "invalid",
  );
});

test("seals each response with a fresh Auth context and preserves only reviewed headers", async () => {
  const fixture = await createRequestFixture();
  const opened = await openFixture(fixture);
  const innerBody = jcs({
    apiVersion: "1.0",
    capabilities: ["pairing"],
    data: { status: "ok" },
    minimumClientVersion: "0.1.0",
    operations: ["pairing.exchange"],
  });
  const inner = new Response(innerBody.slice().buffer as ArrayBuffer, {
    status: 429,
    headers: {
      "content-type": "application/json",
      "retry-after": "5",
      "set-cookie": "must-not-cross=1",
      "x-internal": "must-not-cross",
    },
  });
  const responsePublicKey = await fixture.suite.kem.deserializePublicKey(
    opened.responsePublicKeyBytes,
  );
  const outer = await sealClientV1HpkeBoundResponse({
    suite: fixture.suite,
    senderKey: fixture.recipient.privateKey,
    responsePublicKey,
    binding: opened.binding,
    response: inner,
  });
  assert.equal(outer.status, 200);
  assert.equal(outer.headers.get("cache-control"), "no-store");
  assert.equal(outer.headers.get("content-type"), CLIENT_V1_HPKE_RESPONSE_MEDIA_TYPE);
  const envelope = await outer.json();
  assert.deepEqual(Object.keys(envelope).sort(), [
    "ciphertext",
    "enc",
    "keyId",
    "mechanism",
    "requestNonce",
    "version",
  ]);
  assert.equal(envelope.keyId, fixture.binding.keyId);
  assert.equal(envelope.requestNonce, fixture.binding.requestNonce);

  const recipient = await fixture.suite.createRecipientContext({
    recipientKey: fixture.responseRecipient.privateKey,
    senderPublicKey: fixture.recipient.publicKey,
    enc: base64UrlDecode(envelope.enc, { minimum: 32, maximum: 32 }).bytes,
    info: CLIENT_V1_HPKE_RESPONSE_INFO,
  });
  const plaintext = new Uint8Array(
    await recipient.open(
      base64UrlDecode(envelope.ciphertext, {
        minimum: 16,
        maximum: CLIENT_V1_HPKE_LIMITS.responseCiphertextBytes,
      }).bytes,
      encodeClientV1HpkeAad("response", opened.binding),
    ),
  );
  const parsed = JSON.parse(UTF8_FATAL.decode(plaintext));
  assert.equal(UTF8_FATAL.decode(plaintext), canonicalize(parsed));
  assert.deepEqual(parsed.headers, {
    contentType: "application/json",
    retryAfter: "5",
  });
  assert.equal(parsed.status, 429);
  assert.deepEqual(
    base64UrlDecode(parsed.body, { minimum: 0, maximum: innerBody.byteLength }).bytes,
    innerBody,
  );
  assert.equal(JSON.stringify(parsed).includes("set-cookie"), false);
  assert.equal(JSON.stringify(parsed).includes("x-internal"), false);

  await assert.rejects(
    sealClientV1HpkeBoundResponse({
      suite: fixture.suite,
      senderKey: fixture.recipient.privateKey,
      responsePublicKey,
      binding: opened.binding,
      response: new Response(
        new Uint8Array(CLIENT_V1_HPKE_LIMITS.responsePlaintextBytes + 1),
        { headers: { "content-type": "application/json" } },
      ),
    }),
  );
});

test("bounds the final canonical response plaintext and the test client at exact wire limits", async () => {
  const fixture = await createRequestFixture();
  const client = await createClientV1HpkeTestClient({
    authority: {
      mechanism: CLIENT_V1_HPKE_MECHANISM,
      mode: "enforce",
      keyId: fixture.binding.keyId,
      publicKey: base64UrlEncode(fixture.recipientPublicKeyBytes),
      suite: { kemId: 32, kdfId: 1, aeadId: 2 },
    },
    instanceId: INSTANCE_ID,
    runtimeNonce: fixture.binding.runtimeNonce,
    operation: "pairing.exchange",
    url: `${ORIGIN}${ROUTE}`,
    method: "POST",
    issuedAt: NOW,
    requestNonce: REQUEST_NONCE,
    authorization: {
      kind: "pairing-secret",
      value: base64UrlEncode(PAIRING_SECRET),
    },
    requestEkm: REQUEST_EKM_IKM,
    responseRecipientIkm: RESPONSE_RECIPIENT_IKM,
  });
  const opened = await openClientV1HpkeBoundRequest({
    suite: fixture.suite,
    recipientKey: fixture.recipient.privateKey,
    request: client.request,
    body: new Uint8Array(),
    expectedKeyId: fixture.binding.keyIdBytes,
    expectedRuntimeNonce: RUNTIME_NONCE,
    expectedInstanceId: INSTANCE_ID,
    now: NOW,
  });
  const responsePublicKey = await fixture.suite.kem.deserializePublicKey(
    opened.responsePublicKeyBytes,
  );
  const boundaryBody = new Uint8Array(6_291_349);
  const boundaryResponse = await sealClientV1HpkeBoundResponse({
    suite: fixture.suite,
    senderKey: fixture.recipient.privateKey,
    responsePublicKey,
    binding: opened.binding,
    response: new Response(boundaryBody, {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  });
  const boundaryEnvelopeBytes = new Uint8Array(
    await boundaryResponse.clone().arrayBuffer(),
  );
  assert.equal(
    boundaryEnvelopeBytes.byteLength,
    CLIENT_V1_HPKE_LIMITS.responseEnvelopeBytes,
  );
  const boundaryEnvelope = JSON.parse(UTF8_FATAL.decode(boundaryEnvelopeBytes));
  const boundaryCiphertext = base64UrlDecode(boundaryEnvelope.ciphertext, {
    minimum: 16,
    maximum: CLIENT_V1_HPKE_LIMITS.responseCiphertextBytes,
  }).bytes;
  assert.equal(
    boundaryCiphertext.byteLength,
    CLIENT_V1_HPKE_LIMITS.responseCiphertextBytes,
  );
  const recipient = await fixture.suite.createRecipientContext({
    recipientKey: fixture.responseRecipient.privateKey,
    senderPublicKey: fixture.recipient.publicKey,
    enc: base64UrlDecode(boundaryEnvelope.enc, {
      minimum: 32,
      maximum: 32,
    }).bytes,
    info: CLIENT_V1_HPKE_RESPONSE_INFO,
  });
  const boundaryPlaintext = new Uint8Array(
    await recipient.open(
      boundaryCiphertext,
      encodeClientV1HpkeAad("response", opened.binding),
    ),
  );
  assert.equal(
    boundaryPlaintext.byteLength,
    CLIENT_V1_HPKE_LIMITS.responsePlaintextBytes,
  );

  const result = await client.open(boundaryResponse);
  assert.equal(result.body.byteLength, boundaryBody.byteLength);

  await assert.rejects(
    sealClientV1HpkeBoundResponse({
      suite: fixture.suite,
      senderKey: fixture.recipient.privateKey,
      responsePublicKey,
      binding: opened.binding,
      response: new Response(new Uint8Array(boundaryBody.byteLength + 1), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    }),
    /response plaintext exceeds its limit/u,
  );

  await assert.rejects(
    client.open(
      new Response(
        new Uint8Array(CLIENT_V1_HPKE_LIMITS.responseEnvelopeBytes + 1),
        {
          status: 200,
          headers: { "content-type": CLIENT_V1_HPKE_RESPONSE_MEDIA_TYPE },
        },
      ),
    ),
    /authenticated HPKE response/u,
  );

  const oversizedCiphertext = base64UrlEncode(
    new Uint8Array(CLIENT_V1_HPKE_LIMITS.responseCiphertextBytes + 1),
  );
  const oversizedEnvelope = Response.json(
    {
      version: 1,
      mechanism: CLIENT_V1_HPKE_MECHANISM,
      keyId: client.binding.keyId,
      requestNonce: client.binding.requestNonce,
      enc: base64UrlEncode(new Uint8Array(32)),
      ciphertext: oversizedCiphertext,
    },
    {
      status: 200,
      headers: { "content-type": CLIENT_V1_HPKE_RESPONSE_MEDIA_TYPE },
    },
  );
  assert.equal(
    (await oversizedEnvelope.clone().arrayBuffer()).byteLength,
    CLIENT_V1_HPKE_LIMITS.responseEnvelopeBytes + 2,
  );
  await assert.rejects(
    client.open(oversizedEnvelope),
    /authenticated HPKE response/u,
  );
});

test("the test client round-trips Base requests and Auth responses and refuses plaintext", async () => {
  const fixture = await createRequestFixture();
  const authority = {
    mechanism: CLIENT_V1_HPKE_MECHANISM,
    mode: "enforce" as const,
    keyId: fixture.binding.keyId,
    publicKey: base64UrlEncode(fixture.recipientPublicKeyBytes),
    suite: { kemId: 32 as const, kdfId: 1 as const, aeadId: 2 as const },
  } satisfies ClientV1HpkeAuthority;
  const client = await createClientV1HpkeTestClient({
    authority,
    instanceId: INSTANCE_ID,
    runtimeNonce: fixture.binding.runtimeNonce,
    operation: "pairing.exchange",
    url: `${ORIGIN}${ROUTE}`,
    method: "POST",
    issuedAt: NOW,
    requestNonce: REQUEST_NONCE,
    authorization: {
      kind: "pairing-secret",
      value: base64UrlEncode(PAIRING_SECRET),
    },
    requestEkm: REQUEST_EKM_IKM,
    responseRecipientIkm: RESPONSE_RECIPIENT_IKM,
  });
  const opened = await openClientV1HpkeBoundRequest({
    suite: fixture.suite,
    recipientKey: fixture.recipient.privateKey,
    request: client.request,
    body: new Uint8Array(),
    expectedKeyId: fixture.binding.keyIdBytes,
    expectedRuntimeNonce: RUNTIME_NONCE,
    expectedInstanceId: INSTANCE_ID,
    now: NOW,
  });
  assert.deepEqual(opened.authorization, {
    kind: "pairing-secret",
    value: base64UrlEncode(PAIRING_SECRET),
  });
  assert.deepEqual(opened.responsePublicKeyBytes, client.responsePublicKey);

  const responsePublicKey = await fixture.suite.kem.deserializePublicKey(
    opened.responsePublicKeyBytes,
  );
  const outer = await sealClientV1HpkeBoundResponse({
    suite: fixture.suite,
    senderKey: fixture.recipient.privateKey,
    responsePublicKey,
    binding: opened.binding,
    response: Response.json({ status: "ok" }, {
      status: 201,
      headers: { "retry-after": "3" },
    }),
  });
  const result = await client.open(outer);
  assert.equal(result.status, 201);
  assert.deepEqual(result.headers, {
    contentType: "application/json",
    retryAfter: "3",
  });
  assert.equal(UTF8_FATAL.decode(result.body), '{"status":"ok"}');

  await assert.rejects(
    client.open(Response.json({ status: "plaintext" })),
    /authenticated HPKE response/u,
  );
});

test("replacement Auth senders and response mutations fail against the discovered Cave key", async () => {
  const fixture = await createRequestFixture();
  const client = await createClientV1HpkeTestClient({
    authority: {
      mechanism: CLIENT_V1_HPKE_MECHANISM,
      mode: "enforce",
      keyId: fixture.binding.keyId,
      publicKey: base64UrlEncode(fixture.recipientPublicKeyBytes),
      suite: { kemId: 32, kdfId: 1, aeadId: 2 },
    },
    instanceId: INSTANCE_ID,
    runtimeNonce: fixture.binding.runtimeNonce,
    operation: "pairing.exchange",
    url: `${ORIGIN}${ROUTE}`,
    method: "POST",
    issuedAt: NOW,
    requestNonce: REQUEST_NONCE,
    authorization: {
      kind: "pairing-secret",
      value: base64UrlEncode(PAIRING_SECRET),
    },
    requestEkm: REQUEST_EKM_IKM,
    responseRecipientIkm: RESPONSE_RECIPIENT_IKM,
  });
  const replacement = await fixture.suite.kem.deriveKeyPair(range(0xe0));
  const responsePublicKey = await fixture.suite.kem.deserializePublicKey(
    client.responsePublicKey,
  );
  const sender = await fixture.suite.createSenderContext({
    recipientPublicKey: responsePublicKey,
    senderKey: replacement.privateKey,
    info: CLIENT_V1_HPKE_RESPONSE_INFO,
    ekm: RESPONSE_EKM_IKM,
  });
  const plaintext = jcs({
    body: base64UrlEncode(UTF8.encode('{"status":"forged"}')),
    headers: { contentType: "application/json" },
    requestNonce: client.binding.requestNonce,
    status: 200,
    version: 1,
  });
  const ciphertext = new Uint8Array(
    await sender.seal(plaintext, client.responseAad),
  );
  const forged = () =>
    Response.json(
      {
        version: 1,
        mechanism: CLIENT_V1_HPKE_MECHANISM,
        keyId: client.binding.keyId,
        requestNonce: client.binding.requestNonce,
        enc: base64UrlEncode(sender.enc),
        ciphertext: base64UrlEncode(ciphertext),
      },
      {
        status: 200,
        headers: { "content-type": CLIENT_V1_HPKE_RESPONSE_MEDIA_TYPE },
      },
    );
  await assert.rejects(client.open(forged()));

  const mutations = [
    { enc: base64UrlEncode(flip(new Uint8Array(sender.enc))) },
    { ciphertext: base64UrlEncode(flip(ciphertext)) },
    { keyId: base64UrlEncode(flip(client.binding.keyIdBytes)) },
    { requestNonce: base64UrlEncode(flip(client.binding.requestNonceBytes)) },
    { mechanism: "other" },
  ];
  for (const mutation of mutations) {
    const envelope = await forged().json();
    await assert.rejects(
      client.open(
        Response.json(
          { ...envelope, ...mutation },
          {
            status: 200,
            headers: { "content-type": CLIENT_V1_HPKE_RESPONSE_MEDIA_TYPE },
          },
        ),
      ),
    );
  }

  const authenticatedEnvelope = async (options: {
    plaintext?: Uint8Array;
    info?: Uint8Array;
    aad?: Uint8Array;
  } = {}) => {
    const authenticatedSender = await fixture.suite.createSenderContext({
      recipientPublicKey: responsePublicKey,
      senderKey: fixture.recipient.privateKey,
      info: options.info ?? CLIENT_V1_HPKE_RESPONSE_INFO,
      ekm: RESPONSE_EKM_IKM,
    });
    const authenticatedCiphertext = await authenticatedSender.seal(
      options.plaintext ?? jcs({
        body: base64UrlEncode(UTF8.encode('{"status":"ok"}')),
        headers: { contentType: "application/json" },
        requestNonce: client.binding.requestNonce,
        status: 200,
        version: 1,
      }),
      options.aad ?? client.responseAad,
    );
    return Response.json(
      {
        version: 1,
        mechanism: CLIENT_V1_HPKE_MECHANISM,
        keyId: client.binding.keyId,
        requestNonce: client.binding.requestNonce,
        enc: base64UrlEncode(authenticatedSender.enc),
        ciphertext: base64UrlEncode(authenticatedCiphertext),
      },
      {
        status: 200,
        headers: { "content-type": CLIENT_V1_HPKE_RESPONSE_MEDIA_TYPE },
      },
    );
  };
  for (const invalidPlaintext of [
    jcs({
      body: base64UrlEncode(UTF8.encode('{"status":"ok"}')),
      headers: { contentType: "application/json" },
      requestNonce: client.binding.requestNonce,
      status: 99,
      version: 1,
    }),
    jcs({
      body: "A",
      headers: { contentType: "application/json" },
      requestNonce: client.binding.requestNonce,
      status: 200,
      version: 1,
    }),
    jcs({
      body: base64UrlEncode(UTF8.encode('{"status":"ok"}')),
      headers: { contentType: "application/json" },
      requestNonce: base64UrlEncode(flip(client.binding.requestNonceBytes)),
      status: 200,
      version: 1,
    }),
  ]) {
    await assert.rejects(
      client.open(await authenticatedEnvelope({ plaintext: invalidPlaintext })),
    );
  }
  await assert.rejects(
    client.open(
      await authenticatedEnvelope({ info: CLIENT_V1_HPKE_REQUEST_INFO }),
    ),
  );
  await assert.rejects(
    client.open(
      await authenticatedEnvelope({ aad: client.requestAad }),
    ),
  );
});

test("Base request and Auth response use separate fresh contexts with one reviewed static key", async () => {
  const fixture = await createRequestFixture();
  const first = await openFixture(fixture);
  const secondFixture = await createRequestFixture();
  const second = await openFixture(secondFixture);
  assert.deepEqual(first.authorization, second.authorization);

  const responsePublicKey = await fixture.suite.kem.deserializePublicKey(
    first.responsePublicKeyBytes,
  );
  const firstOuter = await sealClientV1HpkeBoundResponse({
    suite: fixture.suite,
    senderKey: fixture.recipient.privateKey,
    responsePublicKey,
    binding: first.binding,
    response: Response.json({ status: "ok" }),
  });
  const secondOuter = await sealClientV1HpkeBoundResponse({
    suite: fixture.suite,
    senderKey: fixture.recipient.privateKey,
    responsePublicKey,
    binding: first.binding,
    response: Response.json({ status: "ok" }),
  });
  const firstEnvelope = await firstOuter.json();
  const secondEnvelope = await secondOuter.json();
  assert.notEqual(firstEnvelope.enc, secondEnvelope.enc);
  assert.notEqual(firstEnvelope.ciphertext, secondEnvelope.ciphertext);
});
