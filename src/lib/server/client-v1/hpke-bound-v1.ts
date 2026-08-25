import { createHash, timingSafeEqual } from "node:crypto";

import {
  Aes256Gcm,
  CipherSuite,
  HkdfSha256,
} from "@hpke/core";
import { DhkemX25519HkdfSha256 } from "@hpke/dhkem-x25519";
import canonicalize from "canonicalize";

import {
  CLIENT_V1_HPKE_FRESHNESS,
  CLIENT_V1_HPKE_HEADERS,
  CLIENT_V1_HPKE_LIMITS,
  CLIENT_V1_HPKE_MECHANISM,
  CLIENT_V1_HPKE_RESPONSE_MEDIA_TYPE,
  type ClientV1HpkeAuthorization,
  type ClientV1HpkeBinding,
  type ClientV1HpkeBoundRequestPlaintext,
  type ClientV1HpkeBoundResponseEnvelope,
  type ClientV1HpkeBoundResponsePlaintext,
} from "./authority-contract.ts";

const UTF8 = new TextEncoder();
const UTF8_FATAL = new TextDecoder("utf-8", { fatal: true });
const BASE64URL_RE = /^[A-Za-z0-9_-]*$/u;
const ISSUED_AT_RE = /^[1-9][0-9]{0,15}$/u;
const METHOD_RE = /^[A-Z][A-Z0-9!#$%&'*+.^_`|~-]*$/u;
const REQUEST_AAD_DOMAIN = UTF8.encode(
  "OpenCoven/client-v1/hpke-bound-v1/aad/request\0",
);
const RESPONSE_AAD_DOMAIN = UTF8.encode(
  "OpenCoven/client-v1/hpke-bound-v1/aad/response\0",
);

export const CLIENT_V1_HPKE_REQUEST_INFO = UTF8.encode(
  "OpenCoven/client-v1/hpke-bound-v1/request",
);
export const CLIENT_V1_HPKE_RESPONSE_INFO = UTF8.encode(
  "OpenCoven/client-v1/hpke-bound-v1/response",
);

export type OpenedClientV1HpkeRequest = {
  authorization: ClientV1HpkeAuthorization;
  responsePublicKeyBytes: Uint8Array;
  binding: ClientV1HpkeBinding;
};

export type ClientV1HpkeBoundRequestErrorKind =
  | "stale-key"
  | "stale-instance"
  | "stale-request"
  | "invalid";

export class ClientV1HpkeBoundRequestError extends Error {
  readonly name = "ClientV1HpkeBoundRequestError";
  readonly kind: ClientV1HpkeBoundRequestErrorKind;

  constructor(kind: ClientV1HpkeBoundRequestErrorKind) {
    super("Client v1 HPKE bound request rejected.");
    this.kind = kind;
  }
}

function invalidRequest(): ClientV1HpkeBoundRequestError {
  return new ClientV1HpkeBoundRequestError("invalid");
}

function bytesOf(
  value: ArrayBufferLike | ArrayBufferView,
): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return new Uint8Array(value);
}

export function base64UrlEncode(
  value: ArrayBufferLike | ArrayBufferView,
): string {
  return Buffer.from(bytesOf(value)).toString("base64url");
}

export function base64UrlDecode(
  value: unknown,
  bounds: { minimum: number; maximum: number },
): { bytes: Uint8Array; encoded: string } {
  if (
    !Number.isSafeInteger(bounds.minimum)
    || !Number.isSafeInteger(bounds.maximum)
    || bounds.minimum < 0
    || bounds.maximum < bounds.minimum
  ) {
    throw new Error("Client v1 authority base64url bounds are invalid.");
  }
  if (
    typeof value !== "string"
    || value.includes("=")
    || !BASE64URL_RE.test(value)
    || value.length > Math.ceil((bounds.maximum * 4) / 3)
  ) {
    throw new Error("Client v1 authority value is not canonical base64url.");
  }
  const bytes = Uint8Array.from(Buffer.from(value, "base64url"));
  if (
    bytes.byteLength < bounds.minimum
    || bytes.byteLength > bounds.maximum
    || base64UrlEncode(bytes) !== value
  ) {
    throw new Error(
      "Client v1 authority value has an invalid length or encoding.",
    );
  }
  return { bytes, encoded: value };
}

export function uint32be(value: number): Uint8Array {
  if (
    !Number.isSafeInteger(value)
    || value < 0
    || value > 0xffff_ffff
  ) {
    throw new Error("Client v1 authority uint32 value is invalid.");
  }
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, false);
  return bytes;
}

export function uint64be(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Client v1 authority uint64 value is invalid.");
  }
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(value), false);
  return bytes;
}

export function concatBytes(...values: readonly Uint8Array[]): Uint8Array {
  const length = values.reduce((total, value) => total + value.byteLength, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const value of values) {
    result.set(value, offset);
    offset += value.byteLength;
  }
  return result;
}

export function frame(value: Uint8Array): Uint8Array {
  return concatBytes(uint32be(value.byteLength), value);
}

function rfc3986Component(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/gu, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function asciiCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function canonicalClientV1Route(url: URL): string {
  if (url.pathname.includes("%") || url.pathname.includes("\\")) {
    throw new Error("Client v1 authority path is not canonical.");
  }
  const pairs = [...url.searchParams.entries()]
    .sort(([leftName, leftValue], [rightName, rightValue]) =>
      leftName === rightName
        ? asciiCompare(leftValue, rightValue)
        : asciiCompare(leftName, rightName),
    )
    .map(([name, value]) => [
      rfc3986Component(name),
      rfc3986Component(value),
    ] as const);
  const query = pairs.map(([name, value]) => `${name}=${value}`).join("&");
  const route = query ? `${url.pathname}?${query}` : url.pathname;
  if (
    UTF8.encode(route).byteLength
    > CLIENT_V1_HPKE_LIMITS.canonicalRouteBytes
  ) {
    throw new Error("Client v1 authority route is too long.");
  }
  return route;
}

function requireBinding(binding: ClientV1HpkeBinding): void {
  const instanceIdBytes = UTF8.encode(binding.instanceId);
  const routeBytes = UTF8.encode(binding.route);
  if (
    !METHOD_RE.test(binding.method)
    || !binding.route.startsWith("/")
    || routeBytes.byteLength > CLIENT_V1_HPKE_LIMITS.canonicalRouteBytes
    || binding.bodySha256.byteLength !== 32
    || instanceIdBytes.byteLength < 1
    || instanceIdBytes.byteLength > CLIENT_V1_HPKE_LIMITS.instanceIdBytes
    || binding.runtimeNonceBytes.byteLength !== 32
    || binding.keyIdBytes.byteLength !== 32
    || binding.requestNonceBytes.byteLength !== 32
    || binding.runtimeNonce !== base64UrlEncode(binding.runtimeNonceBytes)
    || binding.keyId !== base64UrlEncode(binding.keyIdBytes)
    || binding.requestNonce !== base64UrlEncode(binding.requestNonceBytes)
    || !Number.isSafeInteger(binding.issuedAt)
    || binding.issuedAt < 1
  ) {
    throw new Error("Client v1 authority binding is invalid.");
  }
}

export function encodeClientV1HpkeAad(
  domain: "request" | "response",
  binding: ClientV1HpkeBinding,
): Uint8Array {
  requireBinding(binding);
  return concatBytes(
    domain === "request" ? REQUEST_AAD_DOMAIN : RESPONSE_AAD_DOMAIN,
    frame(UTF8.encode(binding.method)),
    frame(UTF8.encode(binding.route)),
    frame(binding.bodySha256),
    frame(UTF8.encode(binding.instanceId)),
    frame(binding.runtimeNonceBytes),
    frame(binding.keyIdBytes),
    frame(binding.requestNonceBytes),
    frame(uint64be(binding.issuedAt)),
  );
}

export function createClientV1HpkeSuite(): CipherSuite {
  return new CipherSuite({
    kem: new DhkemX25519HkdfSha256(),
    kdf: new HkdfSha256(),
    aead: new Aes256Gcm(),
  });
}

export async function clientV1HpkePublicKey(
  suite: CipherSuite,
  key: CryptoKey,
): Promise<Uint8Array> {
  return new Uint8Array(await suite.kem.serializePublicKey(key));
}

export function clientV1HpkeKeyId(publicKey: Uint8Array): Uint8Array {
  if (publicKey.byteLength !== CLIENT_V1_HPKE_LIMITS.rawKeyBytes) {
    throw new Error("Client v1 authority public key length is invalid.");
  }
  return new Uint8Array(
    createHash("sha256")
      .update("OpenCoven/client-v1/hpke-bound-v1/key-id\0", "utf8")
      .update(publicKey)
      .digest(),
  );
}

function requiredHeader(
  headers: Headers,
  name: string,
  maximumCharacters: number,
): string {
  const value = headers.get(name);
  if (
    value === null
    || value.length < 1
    || value.length > maximumCharacters
    || value.includes(",")
  ) {
    throw invalidRequest();
  }
  return value;
}

function exactKeys(
  value: unknown,
  expected: readonly string[],
): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const actual = Object.keys(value).sort(asciiCompare);
  const required = [...expected].sort(asciiCompare);
  return (
    actual.length === required.length
    && actual.every((key, index) => key === required[index])
  );
}

function parseAuthorization(value: unknown): ClientV1HpkeAuthorization {
  if (!exactKeys(value, ["kind", "value"]) || typeof value.value !== "string") {
    throw invalidRequest();
  }
  if (value.kind === "pairing-secret") {
    base64UrlDecode(value.value, { minimum: 32, maximum: 32 });
    return { kind: "pairing-secret", value: value.value };
  }
  if (
    value.kind === "bearer"
    && value.value.length >= 1
    && value.value.length <= 512
    && /^\S+$/u.test(value.value)
  ) {
    return { kind: "bearer", value: value.value };
  }
  throw invalidRequest();
}

function validateOpenedClientV1HpkePlaintext(input: {
  plaintext: Uint8Array;
  binding: ClientV1HpkeBinding;
}): OpenedClientV1HpkeRequest {
  if (
    input.plaintext.byteLength
    > CLIENT_V1_HPKE_LIMITS.requestPlaintextBytes
  ) {
    throw invalidRequest();
  }
  const decoded = UTF8_FATAL.decode(input.plaintext);
  const parsed: unknown = JSON.parse(decoded);
  if (
    !exactKeys(parsed, ["authorization", "responsePublicKey", "version"])
    || parsed.version !== 1
    || typeof parsed.responsePublicKey !== "string"
  ) {
    throw invalidRequest();
  }
  const canonical = canonicalize(parsed);
  if (
    typeof canonical !== "string"
    || !timingSafeEqual(
      Buffer.from(input.plaintext),
      Buffer.from(UTF8.encode(canonical)),
    )
  ) {
    throw invalidRequest();
  }
  const authorization = parseAuthorization(parsed.authorization);
  const responsePublicKeyBytes = base64UrlDecode(parsed.responsePublicKey, {
    minimum: CLIENT_V1_HPKE_LIMITS.rawKeyBytes,
    maximum: CLIENT_V1_HPKE_LIMITS.rawKeyBytes,
  }).bytes;
  return {
    authorization,
    responsePublicKeyBytes,
    binding: input.binding,
  };
}

export async function openClientV1HpkeBoundRequest(input: {
  suite: CipherSuite;
  recipientKey: CryptoKey;
  request: Request;
  body: Uint8Array;
  expectedKeyId: Uint8Array;
  expectedRuntimeNonce: Uint8Array;
  expectedInstanceId: string;
  now: number;
}): Promise<OpenedClientV1HpkeRequest> {
  try {
    if (
      !(input.body instanceof Uint8Array)
      || input.body.byteLength > CLIENT_V1_HPKE_LIMITS.requestBodyBytes
      || input.expectedKeyId.byteLength !== CLIENT_V1_HPKE_LIMITS.rawKeyBytes
      || input.expectedRuntimeNonce.byteLength
        !== CLIENT_V1_HPKE_LIMITS.rawKeyBytes
      || !Number.isSafeInteger(input.now)
    ) {
      throw invalidRequest();
    }

    const mechanism = requiredHeader(
      input.request.headers,
      CLIENT_V1_HPKE_HEADERS.mechanism,
      CLIENT_V1_HPKE_MECHANISM.length,
    );
    const keyId = requiredHeader(
      input.request.headers,
      CLIENT_V1_HPKE_HEADERS.keyId,
      CLIENT_V1_HPKE_LIMITS.encodedKeyCharacters,
    );
    const instanceIdEncoded = requiredHeader(
      input.request.headers,
      CLIENT_V1_HPKE_HEADERS.instanceId,
      Math.ceil((CLIENT_V1_HPKE_LIMITS.instanceIdBytes * 4) / 3),
    );
    const runtimeNonce = requiredHeader(
      input.request.headers,
      CLIENT_V1_HPKE_HEADERS.runtimeNonce,
      CLIENT_V1_HPKE_LIMITS.encodedKeyCharacters,
    );
    const requestNonce = requiredHeader(
      input.request.headers,
      CLIENT_V1_HPKE_HEADERS.requestNonce,
      CLIENT_V1_HPKE_LIMITS.encodedKeyCharacters,
    );
    const issuedAtEncoded = requiredHeader(
      input.request.headers,
      CLIENT_V1_HPKE_HEADERS.issuedAt,
      16,
    );
    const encEncoded = requiredHeader(
      input.request.headers,
      CLIENT_V1_HPKE_HEADERS.enc,
      CLIENT_V1_HPKE_LIMITS.encodedKeyCharacters,
    );
    const ciphertextEncoded = requiredHeader(
      input.request.headers,
      CLIENT_V1_HPKE_HEADERS.ciphertext,
      Math.ceil((CLIENT_V1_HPKE_LIMITS.requestCiphertextBytes * 4) / 3),
    );
    if (mechanism !== CLIENT_V1_HPKE_MECHANISM) throw invalidRequest();

    const keyIdBytes = base64UrlDecode(keyId, {
      minimum: CLIENT_V1_HPKE_LIMITS.rawKeyBytes,
      maximum: CLIENT_V1_HPKE_LIMITS.rawKeyBytes,
    }).bytes;
    if (!timingSafeEqual(keyIdBytes, input.expectedKeyId)) {
      throw new ClientV1HpkeBoundRequestError("stale-key");
    }

    const runtimeNonceBytes = base64UrlDecode(runtimeNonce, {
      minimum: CLIENT_V1_HPKE_LIMITS.rawKeyBytes,
      maximum: CLIENT_V1_HPKE_LIMITS.rawKeyBytes,
    }).bytes;
    if (!timingSafeEqual(runtimeNonceBytes, input.expectedRuntimeNonce)) {
      throw new ClientV1HpkeBoundRequestError("stale-key");
    }

    const instanceIdBytes = base64UrlDecode(instanceIdEncoded, {
      minimum: 1,
      maximum: CLIENT_V1_HPKE_LIMITS.instanceIdBytes,
    }).bytes;
    const instanceId = UTF8_FATAL.decode(instanceIdBytes);
    if (
      !instanceId
      || !timingSafeEqual(
        Buffer.from(instanceIdBytes),
        Buffer.from(UTF8.encode(instanceId)),
      )
    ) {
      throw invalidRequest();
    }
    if (instanceId !== input.expectedInstanceId) {
      throw new ClientV1HpkeBoundRequestError("stale-instance");
    }

    if (!ISSUED_AT_RE.test(issuedAtEncoded)) throw invalidRequest();
    const issuedAt = Number(issuedAtEncoded);
    if (!Number.isSafeInteger(issuedAt) || issuedAt < 1) throw invalidRequest();
    if (
      issuedAt < input.now - CLIENT_V1_HPKE_FRESHNESS.maximumAgeMs
      || issuedAt > input.now + CLIENT_V1_HPKE_FRESHNESS.maximumFutureSkewMs
    ) {
      throw new ClientV1HpkeBoundRequestError("stale-request");
    }

    const requestNonceBytes = base64UrlDecode(requestNonce, {
      minimum: CLIENT_V1_HPKE_LIMITS.rawKeyBytes,
      maximum: CLIENT_V1_HPKE_LIMITS.rawKeyBytes,
    }).bytes;
    const enc = base64UrlDecode(encEncoded, {
      minimum: CLIENT_V1_HPKE_LIMITS.rawKeyBytes,
      maximum: CLIENT_V1_HPKE_LIMITS.rawKeyBytes,
    }).bytes;
    const ciphertext = base64UrlDecode(ciphertextEncoded, {
      minimum: 16,
      maximum: CLIENT_V1_HPKE_LIMITS.requestCiphertextBytes,
    }).bytes;
    const method = input.request.method.toUpperCase();
    if (!METHOD_RE.test(method)) throw invalidRequest();
    const route = canonicalClientV1Route(new URL(input.request.url));
    const binding: ClientV1HpkeBinding = {
      method,
      route,
      bodySha256: new Uint8Array(
        createHash("sha256").update(input.body).digest(),
      ),
      instanceId,
      runtimeNonce,
      runtimeNonceBytes,
      keyId,
      keyIdBytes,
      requestNonce,
      requestNonceBytes,
      issuedAt,
    };
    const recipient = await input.suite.createRecipientContext({
      recipientKey: input.recipientKey,
      enc,
      info: CLIENT_V1_HPKE_REQUEST_INFO,
    });
    const plaintext = await recipient.open(
      ciphertext,
      encodeClientV1HpkeAad("request", binding),
    );
    return validateOpenedClientV1HpkePlaintext({
      plaintext: new Uint8Array(plaintext),
      binding,
    });
  } catch (error) {
    if (error instanceof ClientV1HpkeBoundRequestError) throw error;
    throw invalidRequest();
  }
}

async function readBoundedResponseBody(
  response: Response,
  maximumBytes: number,
): Promise<Uint8Array> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^(?:0|[1-9][0-9]*)$/u.test(contentLength)) {
      throw new Error("Client v1 response content length is invalid.");
    }
    const parsed = Number(contentLength);
    if (!Number.isSafeInteger(parsed) || parsed > maximumBytes) {
      throw new Error("Client v1 response body exceeds its limit.");
    }
  }
  if (response.body === null) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximumBytes) {
        await reader.cancel();
        throw new Error("Client v1 response body exceeds its limit.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return concatBytes(...chunks);
}

export async function sealClientV1HpkeBoundResponse(input: {
  suite: CipherSuite;
  senderKey: CryptoKey;
  responsePublicKey: CryptoKey;
  binding: ClientV1HpkeBinding;
  response: Response;
}): Promise<Response> {
  requireBinding(input.binding);
  const body = await readBoundedResponseBody(
    input.response,
    CLIENT_V1_HPKE_LIMITS.responsePlaintextBytes,
  );
  const contentType = input.response.headers.get("content-type");
  if (contentType !== "application/json") {
    throw new Error("Client v1 HPKE response content type is invalid.");
  }
  const retryAfter = input.response.headers.get("retry-after");
  if (retryAfter !== null && retryAfter.length > 256) {
    throw new Error("Client v1 HPKE response retry-after is invalid.");
  }
  const plaintextValue: ClientV1HpkeBoundResponsePlaintext = {
    body: base64UrlEncode(body),
    headers: {
      contentType,
      ...(retryAfter !== null ? { retryAfter } : {}),
    },
    requestNonce: input.binding.requestNonce,
    status: input.response.status,
    version: 1,
  };
  const canonical = canonicalize(plaintextValue);
  if (typeof canonical !== "string") {
    throw new Error("Client v1 HPKE response is not canonical JSON.");
  }
  const sender = await input.suite.createSenderContext({
    recipientPublicKey: input.responsePublicKey,
    senderKey: input.senderKey,
    info: CLIENT_V1_HPKE_RESPONSE_INFO,
  });
  const ciphertext = await sender.seal(
    UTF8.encode(canonical),
    encodeClientV1HpkeAad("response", input.binding),
  );
  const envelope: ClientV1HpkeBoundResponseEnvelope = {
    version: 1,
    mechanism: CLIENT_V1_HPKE_MECHANISM,
    keyId: input.binding.keyId,
    requestNonce: input.binding.requestNonce,
    enc: base64UrlEncode(sender.enc),
    ciphertext: base64UrlEncode(ciphertext),
  };
  return Response.json(envelope, {
    status: 200,
    headers: {
      "cache-control": "no-store",
      "content-type": CLIENT_V1_HPKE_RESPONSE_MEDIA_TYPE,
    },
  });
}

export type {
  ClientV1HpkeAuthorization,
  ClientV1HpkeBinding,
  ClientV1HpkeBoundRequestPlaintext,
  ClientV1HpkeBoundResponseEnvelope,
  ClientV1HpkeBoundResponsePlaintext,
};
