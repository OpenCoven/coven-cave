// Browser-side ceremony tests (cave-brksh). No DOM: the WebAuthn container and
// fetch are both injected/stubbed, so what is under test is the REQUEST SHAPE
// and the option flags — which is where this file can silently disagree with
// the server and produce credentials that always fail.

import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import {
  PasskeyError,
  __base64Url,
  deletePasskey,
  listPasskeys,
  passkeySupport,
  provePasskeyPresence,
  registerPasskey,
} from "./passkey-client.ts";

const realFetch = globalThis.fetch;

type Call = { url: string; init: RequestInit | undefined };
let calls: Call[] = [];
let responses: Array<{ status: number; body: unknown }> = [];

beforeEach(() => {
  calls = [];
  responses = [];
  (globalThis as Record<string, unknown>).PublicKeyCredential = function PublicKeyCredential() {};
  (globalThis as Record<string, unknown>).isSecureContext = true;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const next = responses.shift() ?? { status: 200, body: { ok: true } };
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      json: async () => next.body,
    } as Response;
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete (globalThis as Record<string, unknown>).PublicKeyCredential;
  delete (globalThis as Record<string, unknown>).isSecureContext;
});

function bytes(...values: number[]) {
  return new Uint8Array(values).buffer;
}

const CHALLENGE = __base64Url.encode(new Uint8Array(32).fill(7).buffer);
const CREDENTIAL_ID = __base64Url.encode(new Uint8Array(16).fill(3).buffer);

// ─── support detection ─────────────────────────────────────────────────────

test("support detection distinguishes no-WebAuthn from an insecure context", () => {
  assert.equal(passkeySupport({ PublicKeyCredential: class {}, isSecureContext: true }), "supported");
  assert.equal(passkeySupport({ isSecureContext: true }), "no-webauthn");
  assert.equal(
    passkeySupport({ PublicKeyCredential: class {}, isSecureContext: false }),
    "insecure-context",
  );
});

test("a loopback dev server is not reported as unsupported", () => {
  // Loopback is a secure context even over plain http; keying off
  // protocol === "https:" instead would report the desktop dev server as
  // incapable of passkeys.
  assert.equal(
    passkeySupport({ PublicKeyCredential: class {}, isSecureContext: true }),
    "supported",
  );
});

// ─── base64url ─────────────────────────────────────────────────────────────

test("base64url survives a round trip including the +/ characters", () => {
  const original = new Uint8Array([251, 255, 190, 0, 1, 127, 128]);
  const encoded = __base64Url.encode(original.buffer);
  assert.equal(/^[A-Za-z0-9_-]*$/.test(encoded), true, "no padding or +/ in the wire form");
  assert.deepEqual(__base64Url.decode(encoded), original);
});

// ─── registration ──────────────────────────────────────────────────────────

test("registration asks for a platform authenticator with UV required", async () => {
  responses = [
    { status: 200, body: { ok: true, challenge: CHALLENGE, rpId: "cave.example", allowCredentials: [] } },
    { status: 200, body: { ok: true, credential: { credentialId: CREDENTIAL_ID, label: "iPhone" } } },
  ];
  let options: PublicKeyCredentialCreationOptions | undefined;
  const credentials = {
    create: async (request: CredentialCreationOptions) => {
      options = request.publicKey;
      return {
        rawId: bytes(1, 2, 3),
        response: { clientDataJSON: bytes(4), attestationObject: bytes(5) },
      };
    },
  } as unknown as CredentialsContainer;

  const result = await registerPasskey("iPhone", { credentials });
  assert.equal(result.credentialId, CREDENTIAL_ID);

  // The server REJECTS any assertion whose UV flag is clear, so anything weaker
  // here would enroll a credential that can never satisfy the gate.
  assert.equal(options?.authenticatorSelection?.userVerification, "required");
  assert.equal(options?.authenticatorSelection?.authenticatorAttachment, "platform");
  assert.equal(options?.rp.id, "cave.example", "the RP id comes from the server, not the page");
  assert.deepEqual(
    options?.pubKeyCredParams?.map((param) => param.alg),
    [-7, -257],
    "only algorithms the server can verify are offered",
  );
});

test("registration posts the ceremony fields the server expects", async () => {
  responses = [
    { status: 200, body: { ok: true, challenge: CHALLENGE, rpId: "cave.example", allowCredentials: [] } },
    { status: 200, body: { ok: true, credential: { credentialId: CREDENTIAL_ID } } },
  ];
  const credentials = {
    create: async () => ({
      rawId: bytes(1),
      response: { clientDataJSON: bytes(9, 9), attestationObject: bytes(8, 8) },
    }),
  } as unknown as CredentialsContainer;

  await registerPasskey("iPhone", { credentials });
  assert.equal(calls[0].url, "/api/passkey/challenge");
  assert.equal(calls[1].url, "/api/passkey/register");
  const body = JSON.parse(String(calls[1].init?.body));
  assert.deepEqual(Object.keys(body).sort(), [
    "attestationObject",
    "challenge",
    "clientDataJSON",
    "label",
  ]);
  assert.equal(body.challenge, CHALLENGE, "the server's own challenge is echoed back verbatim");
});

test("a cancelled picker surfaces as cancelled, not as a server error", async () => {
  responses = [
    { status: 200, body: { ok: true, challenge: CHALLENGE, rpId: "cave.example", allowCredentials: [] } },
  ];
  const credentials = {
    create: async () => {
      throw new Error("The operation either timed out or was not allowed.");
    },
  } as unknown as CredentialsContainer;

  await assert.rejects(
    () => registerPasskey("iPhone", { credentials }),
    (err: unknown) => err instanceof PasskeyError && err.kind === "cancelled",
  );
});

test("a server refusal carries the server's reason through", async () => {
  responses = [
    { status: 200, body: { ok: true, challenge: CHALLENGE, rpId: "cave.example", allowCredentials: [] } },
    { status: 403, body: { ok: false, error: "existing passkey required to enroll another" } },
  ];
  const credentials = {
    create: async () => ({
      rawId: bytes(1),
      response: { clientDataJSON: bytes(1), attestationObject: bytes(1) },
    }),
  } as unknown as CredentialsContainer;

  await assert.rejects(
    () => registerPasskey("iPhone", { credentials }),
    (err: unknown) =>
      err instanceof PasskeyError &&
      err.kind === "server" &&
      /existing passkey required/.test(err.message),
  );
});

// ─── assertion ─────────────────────────────────────────────────────────────

test("proving presence sends every field the verifier needs", async () => {
  responses = [
    {
      status: 200,
      body: { ok: true, challenge: CHALLENGE, rpId: "cave.example", allowCredentials: [CREDENTIAL_ID] },
    },
    { status: 200, body: { ok: true, expiresAt: 1234 } },
  ];
  let options: PublicKeyCredentialRequestOptions | undefined;
  const credentials = {
    get: async (request: CredentialRequestOptions) => {
      options = request.publicKey;
      return {
        rawId: bytes(3, 3, 3),
        response: {
          clientDataJSON: bytes(1),
          authenticatorData: bytes(2),
          signature: bytes(3),
        },
      };
    },
  } as unknown as CredentialsContainer;

  const result = await provePasskeyPresence({ credentials });
  assert.equal(result.expiresAt, 1234);
  assert.equal(options?.userVerification, "required");
  assert.equal(options?.allowCredentials?.length, 1, "only this device's own credential is offered");

  const body = JSON.parse(String(calls[1].init?.body));
  assert.deepEqual(Object.keys(body).sort(), [
    "authenticatorData",
    "challenge",
    "clientDataJSON",
    "credentialId",
    "signature",
  ]);
});

test("presence fails fast when this device has nothing enrolled", async () => {
  // Calling into the picker with an empty allowCredentials would prompt for a
  // credential that cannot exist, then fail with a generic browser message.
  responses = [
    { status: 200, body: { ok: true, challenge: CHALLENGE, rpId: "cave.example", allowCredentials: [] } },
  ];
  let picked = false;
  const credentials = {
    get: async () => {
      picked = true;
      return null;
    },
  } as unknown as CredentialsContainer;

  await assert.rejects(
    () => provePasskeyPresence({ credentials }),
    (err: unknown) => err instanceof PasskeyError && err.kind === "device",
  );
  assert.equal(picked, false, "the picker is never opened");
});

// ─── listing and deletion ──────────────────────────────────────────────────

test("listing tolerates an error response instead of throwing into the UI", async () => {
  responses = [{ status: 403, body: { ok: false, error: "unrecognized device" } }];
  assert.deepEqual(await listPasskeys(), []);
});

test("deletion reports success by status", async () => {
  responses = [{ status: 200, body: { ok: true } }];
  assert.equal(await deletePasskey("abc"), true);
  responses = [{ status: 403, body: { ok: false } }];
  assert.equal(await deletePasskey("abc"), false);
  assert.match(calls[1].url, /credentialId=abc/);
  assert.equal(calls[1].init?.method, "DELETE");
});

test("a credential id is URL-encoded on the way into the query string", async () => {
  responses = [{ status: 200, body: { ok: true } }];
  await deletePasskey("a+b/c=d");
  assert.match(calls[0].url, /credentialId=a%2Bb%2Fc%3Dd/);
});
