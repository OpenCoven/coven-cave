import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import canonicalize from "canonicalize";

import {
  CLIENT_V1_HPKE_HEADERS,
  CLIENT_V1_HPKE_LIMITS,
  CLIENT_V1_HPKE_MECHANISM,
  CLIENT_V1_HPKE_RESPONSE_MEDIA_TYPE,
  type ClientV1HpkeAuthority,
  type ClientV1HpkeAuthorization,
  type ClientV1HpkeBinding,
} from "../authority-contract.ts";
import type { ClientV1Operation } from "../contract.ts";
import {
  CLIENT_V1_OPERATION_DEFINITIONS,
} from "../operations.ts";
import {
  CLIENT_V1_HPKE_REQUEST_INFO,
  CLIENT_V1_HPKE_RESPONSE_INFO,
  base64UrlDecode,
  base64UrlEncode,
  canonicalClientV1Route,
  clientV1HpkeKeyId,
  clientV1HpkePublicKey,
  concatBytes,
  createClientV1HpkeSuite,
  encodeClientV1HpkeAad,
} from "../hpke-bound-v1.ts";

const UTF8 = new TextEncoder();
const UTF8_FATAL = new TextDecoder("utf-8", { fatal: true });
const RESPONSE_ERROR =
  "Client v1 test client requires an authenticated HPKE response.";

export type ClientV1HpkeTestClient = {
  request: Request;
  binding: ClientV1HpkeBinding;
  requestAad: Uint8Array;
  responseAad: Uint8Array;
  open(response: Response): Promise<{
    status: number;
    headers: {
      contentType: string;
      retryAfter?: string;
    };
    body: Uint8Array;
  }>;
  responsePublicKey: Uint8Array;
};

function asciiCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
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

function jcs(value: unknown): Uint8Array {
  const rendered = canonicalize(value);
  if (typeof rendered !== "string") {
    throw new Error("Client v1 HPKE test value is not canonical JSON.");
  }
  return UTF8.encode(rendered);
}

async function readBounded(
  response: Response,
  maximumBytes: number,
): Promise<Uint8Array> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const parsed = Number(contentLength);
    if (
      !/^(?:0|[1-9][0-9]*)$/u.test(contentLength)
      || !Number.isSafeInteger(parsed)
      || parsed > maximumBytes
    ) {
      throw new Error(RESPONSE_ERROR);
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
        throw new Error(RESPONSE_ERROR);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return concatBytes(...chunks);
}

function requireOperation(
  operation: ClientV1Operation,
  authorization: ClientV1HpkeAuthorization,
): void {
  const definition = CLIENT_V1_OPERATION_DEFINITIONS.find(
    (candidate) => candidate.id === operation,
  );
  if (
    definition?.binding !== "hpke-bound-v1"
    || definition.credential !== authorization.kind
  ) {
    throw new Error("Client v1 HPKE test operation is not bound.");
  }
}

function requireAuthority(authority: ClientV1HpkeAuthority): void {
  if (
    authority.mechanism !== CLIENT_V1_HPKE_MECHANISM
    || (authority.mode !== "advertise" && authority.mode !== "enforce")
    || authority.suite.kemId !== 32
    || authority.suite.kdfId !== 1
    || authority.suite.aeadId !== 2
  ) {
    throw new Error("Client v1 HPKE test authority is invalid.");
  }
}

export async function createClientV1HpkeTestClient(input: {
  authority: ClientV1HpkeAuthority;
  instanceId: string;
  runtimeNonce: string;
  operation: ClientV1Operation;
  url: string;
  method: string;
  body?: Uint8Array;
  issuedAt: number;
  requestNonce?: Uint8Array;
  authorization: ClientV1HpkeAuthorization;
  requestEkm?: Uint8Array;
  responseRecipientIkm?: Uint8Array;
}): Promise<ClientV1HpkeTestClient> {
  requireAuthority(input.authority);
  requireOperation(input.operation, input.authorization);
  const suite = createClientV1HpkeSuite();
  const authorityPublicKeyBytes = base64UrlDecode(input.authority.publicKey, {
    minimum: CLIENT_V1_HPKE_LIMITS.rawKeyBytes,
    maximum: CLIENT_V1_HPKE_LIMITS.rawKeyBytes,
  }).bytes;
  const authorityKeyIdBytes = base64UrlDecode(input.authority.keyId, {
    minimum: CLIENT_V1_HPKE_LIMITS.rawKeyBytes,
    maximum: CLIENT_V1_HPKE_LIMITS.rawKeyBytes,
  }).bytes;
  if (
    !timingSafeEqual(
      authorityKeyIdBytes,
      clientV1HpkeKeyId(authorityPublicKeyBytes),
    )
  ) {
    throw new Error("Client v1 HPKE test authority is invalid.");
  }
  const runtimeNonceBytes = base64UrlDecode(input.runtimeNonce, {
    minimum: CLIENT_V1_HPKE_LIMITS.rawKeyBytes,
    maximum: CLIENT_V1_HPKE_LIMITS.rawKeyBytes,
  }).bytes;
  const requestNonceBytes =
    input.requestNonce?.slice()
    ?? new Uint8Array(randomBytes(CLIENT_V1_HPKE_LIMITS.rawKeyBytes));
  if (requestNonceBytes.byteLength !== CLIENT_V1_HPKE_LIMITS.rawKeyBytes) {
    throw new Error("Client v1 HPKE test request nonce is invalid.");
  }
  const body = input.body?.slice() ?? new Uint8Array();
  if (body.byteLength > CLIENT_V1_HPKE_LIMITS.requestBodyBytes) {
    throw new Error("Client v1 HPKE test request body is too large.");
  }
  const responseRecipient = input.responseRecipientIkm === undefined
    ? await suite.kem.generateKeyPair()
    : await suite.kem.deriveKeyPair(input.responseRecipientIkm);
  const responsePublicKey = await clientV1HpkePublicKey(
    suite,
    responseRecipient.publicKey,
  );
  const method = input.method.toUpperCase();
  const url = new URL(input.url);
  const binding: ClientV1HpkeBinding = {
    method,
    route: canonicalClientV1Route(url),
    bodySha256: new Uint8Array(createHash("sha256").update(body).digest()),
    instanceId: input.instanceId,
    runtimeNonce: input.runtimeNonce,
    runtimeNonceBytes,
    keyId: input.authority.keyId,
    keyIdBytes: authorityKeyIdBytes,
    requestNonce: base64UrlEncode(requestNonceBytes),
    requestNonceBytes,
    issuedAt: input.issuedAt,
  };
  const requestAad = encodeClientV1HpkeAad("request", binding);
  const responseAad = encodeClientV1HpkeAad("response", binding);
  const authorityPublicKey = await suite.kem.deserializePublicKey(
    authorityPublicKeyBytes,
  );
  const requestSender = await suite.createSenderContext({
    recipientPublicKey: authorityPublicKey,
    info: CLIENT_V1_HPKE_REQUEST_INFO,
    ...(input.requestEkm !== undefined ? { ekm: input.requestEkm } : {}),
  });
  const ciphertext = await requestSender.seal(
    jcs({
      authorization: input.authorization,
      responsePublicKey: base64UrlEncode(responsePublicKey),
      version: 1,
    }),
    requestAad,
  );
  const headers = new Headers({
    [CLIENT_V1_HPKE_HEADERS.mechanism]: CLIENT_V1_HPKE_MECHANISM,
    [CLIENT_V1_HPKE_HEADERS.keyId]: binding.keyId,
    [CLIENT_V1_HPKE_HEADERS.instanceId]: base64UrlEncode(
      UTF8.encode(binding.instanceId),
    ),
    [CLIENT_V1_HPKE_HEADERS.runtimeNonce]: binding.runtimeNonce,
    [CLIENT_V1_HPKE_HEADERS.requestNonce]: binding.requestNonce,
    [CLIENT_V1_HPKE_HEADERS.issuedAt]: String(binding.issuedAt),
    [CLIENT_V1_HPKE_HEADERS.enc]: base64UrlEncode(requestSender.enc),
    [CLIENT_V1_HPKE_HEADERS.ciphertext]: base64UrlEncode(ciphertext),
  });
  const request = new Request(url, {
    method,
    headers,
    ...(
      body.byteLength > 0 && method !== "GET" && method !== "HEAD"
        ? { body }
        : {}
    ),
  });

  return {
    request,
    binding,
    requestAad,
    responseAad,
    responsePublicKey,
    async open(response) {
      try {
        if (
          response.status !== 200
          || response.headers.get("content-type")
            !== CLIENT_V1_HPKE_RESPONSE_MEDIA_TYPE
        ) {
          throw new Error(RESPONSE_ERROR);
        }
        const envelopeBytes = await readBounded(
          response,
          CLIENT_V1_HPKE_LIMITS.responseEnvelopeBytes,
        );
        const envelope: unknown = JSON.parse(UTF8_FATAL.decode(envelopeBytes));
        if (
          !exactKeys(
            envelope,
            [
              "version",
              "mechanism",
              "keyId",
              "requestNonce",
              "enc",
              "ciphertext",
            ],
          )
          || envelope.version !== 1
          || envelope.mechanism !== CLIENT_V1_HPKE_MECHANISM
          || envelope.keyId !== binding.keyId
          || envelope.requestNonce !== binding.requestNonce
          || typeof envelope.enc !== "string"
          || typeof envelope.ciphertext !== "string"
        ) {
          throw new Error(RESPONSE_ERROR);
        }
        const enc = base64UrlDecode(envelope.enc, {
          minimum: CLIENT_V1_HPKE_LIMITS.rawKeyBytes,
          maximum: CLIENT_V1_HPKE_LIMITS.rawKeyBytes,
        }).bytes;
        const responseCiphertext = base64UrlDecode(envelope.ciphertext, {
          minimum: 16,
          maximum: CLIENT_V1_HPKE_LIMITS.responseCiphertextBytes,
        }).bytes;
        const recipient = await suite.createRecipientContext({
          recipientKey: responseRecipient.privateKey,
          senderPublicKey: authorityPublicKey,
          enc,
          info: CLIENT_V1_HPKE_RESPONSE_INFO,
        });
        const plaintext = new Uint8Array(
          await recipient.open(responseCiphertext, responseAad),
        );
        if (
          plaintext.byteLength
          > CLIENT_V1_HPKE_LIMITS.responsePlaintextBytes
        ) {
          throw new Error(RESPONSE_ERROR);
        }
        const decoded = UTF8_FATAL.decode(plaintext);
        const parsed: unknown = JSON.parse(decoded);
        if (
          !exactKeys(
            parsed,
            ["version", "requestNonce", "status", "headers", "body"],
          )
          || parsed.version !== 1
          || parsed.requestNonce !== binding.requestNonce
          || !Number.isInteger(parsed.status)
          || (parsed.status as number) < 100
          || (parsed.status as number) > 599
          || typeof parsed.body !== "string"
          || !exactKeys(parsed.headers, ["contentType", "retryAfter"].filter(
            (key) =>
              key !== "retryAfter"
              || Object.hasOwn(parsed.headers as object, "retryAfter"),
          ))
          || parsed.headers.contentType !== "application/json"
          || (
            Object.hasOwn(parsed.headers, "retryAfter")
            && (
              typeof parsed.headers.retryAfter !== "string"
              || parsed.headers.retryAfter.length > 256
            )
          )
        ) {
          throw new Error(RESPONSE_ERROR);
        }
        const canonical = canonicalize(parsed);
        if (
          typeof canonical !== "string"
          || !timingSafeEqual(
            Buffer.from(plaintext),
            Buffer.from(UTF8.encode(canonical)),
          )
        ) {
          throw new Error(RESPONSE_ERROR);
        }
        const responseBody = base64UrlDecode(parsed.body, {
          minimum: 0,
          maximum: CLIENT_V1_HPKE_LIMITS.responsePlaintextBytes,
        }).bytes;
        return {
          status: parsed.status as number,
          headers: {
            contentType: parsed.headers.contentType,
            ...(Object.hasOwn(parsed.headers, "retryAfter")
              ? { retryAfter: parsed.headers.retryAfter as string }
              : {}),
          },
          body: responseBody,
        };
      } catch {
        throw new Error(RESPONSE_ERROR);
      }
    },
  };
}
