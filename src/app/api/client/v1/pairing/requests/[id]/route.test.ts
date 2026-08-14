import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { CLIENT_V1_LOCAL_HEADER } from "@/proxy-helpers";
import {
  consumeApprovedPairing,
  createPairingRequest,
  decidePairingRequest,
  MAX_PAIRING_REQUESTS,
  PAIRING_TTL_MS,
  resetPairingRequestsForTest,
} from "@/lib/server/client-v1/pairing-store.ts";

const LOCAL_PEER_SECRET = "test-per-boot-secret-do-not-reuse";
process.env.COVEN_CAVE_LOCAL_PEER_SECRET = LOCAL_PEER_SECRET;

const { GET } = await import("./route.ts");

afterEach(() => {
  resetPairingRequestsForTest();
});

const PAIRING_SECRET_HEADER = "x-coven-pairing-secret";

function input(overrides: Record<string, unknown> = {}) {
  return {
    appName: "OpenCoven Chat",
    installationId: "9f4145de-9b43-4abc-876d-81ef63de60e0",
    scopes: ["chat:read" as const],
    ...overrides,
  };
}

function requestFor(
  id: string,
  secret: string | null,
  options: { marker?: string | null } = {},
) {
  const headers = new Headers();
  if (secret !== null) headers.set(PAIRING_SECRET_HEADER, secret);
  const marker = options.marker === undefined ? LOCAL_PEER_SECRET : options.marker;
  if (marker !== null) headers.set(CLIENT_V1_LOCAL_HEADER, marker);
  return new Request(`http://127.0.0.1/api/client/v1/pairing/requests/${id}`, { headers });
}

async function ctxFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

test("an absent or forged internal marker returns 403 unauthorized and cannot observe a valid pairing, before params/secrets are even parsed", async () => {
  const { request, secret } = createPairingRequest(input());
  for (const marker of [null, "guessed-value"]) {
    const response = await GET(requestFor(request.id, secret, { marker }), await ctxFor(request.id));
    assert.equal(response.status, 403);
    const body = await response.json();
    assert.equal(body.ok, false);
    assert.equal(body.error.code, "unauthorized");
  }

  // The pairing request must remain untouched and still pollable by a caller
  // that DOES carry the trusted marker — the rejected attempts above must
  // never have consumed or altered it.
  const legitimate = await GET(requestFor(request.id, secret), await ctxFor(request.id));
  assert.equal(legitimate.status, 200);
  const legitimateBody = await legitimate.json();
  assert.equal(legitimateBody.pairing.status, "pending");
});

test("a pending request's public status is returned to the holder of its secret", async () => {
  const { request, secret } = createPairingRequest(input());
  const response = await GET(requestFor(request.id, secret), await ctxFor(request.id));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.deepEqual(body.pairing, {
    id: request.id,
    appName: "OpenCoven Chat",
    installationId: "9f4145de-9b43-4abc-876d-81ef63de60e0",
    scopes: ["chat:read"],
    status: "pending",
    createdAt: request.createdAt,
    expiresAt: request.expiresAt,
  });
});

test("approval is reflected on the next poll", async () => {
  const { request, secret } = createPairingRequest(input());
  decidePairingRequest(request.id, "approved");
  const response = await GET(requestFor(request.id, secret), await ctxFor(request.id));
  const body = await response.json();
  assert.equal(body.pairing.status, "approved");
});

test("denial is reflected on the next poll", async () => {
  const { request, secret } = createPairingRequest(input());
  decidePairingRequest(request.id, "denied");
  const response = await GET(requestFor(request.id, secret), await ctxFor(request.id));
  const body = await response.json();
  assert.equal(body.pairing.status, "denied");
});

test("a missing secret header returns the same generic 404 as a wrong one", async () => {
  const { request } = createPairingRequest(input());
  const missing = await GET(requestFor(request.id, null), await ctxFor(request.id));
  const wrong = await GET(requestFor(request.id, "wrong-secret"), await ctxFor(request.id));
  assert.equal(missing.status, 404);
  assert.equal(wrong.status, 404);
  const missingBody = await missing.json();
  const wrongBody = await wrong.json();
  assert.deepEqual(missingBody, wrongBody);
  assert.equal(missingBody.error.code, "not_found");
});

test("an unknown id returns the same generic 404, revealing nothing about other requests", async () => {
  const response = await GET(
    requestFor("00000000-0000-4000-8000-000000000000", "any-secret"),
    await ctxFor("00000000-0000-4000-8000-000000000000"),
  );
  assert.equal(response.status, 404);
  const body = await response.json();
  assert.equal(body.error.code, "not_found");
});

test("an expired request, polled with its correct secret, returns a stable 410 pairing_expired", async () => {
  // Synthesize a request whose expiry is already in the past relative to
  // real wall-clock time, so the route's own `Date.now()` (no clock
  // injection needed) sees it as expired.
  const longAgo = Date.now() - PAIRING_TTL_MS - 60_000;
  const { request, secret } = createPairingRequest(input(), longAgo);
  const response = await GET(requestFor(request.id, secret), await ctxFor(request.id));
  assert.equal(response.status, 410);
  const body = await response.json();
  assert.equal(body.error.code, "pairing_expired");
  assert.equal(body.error.retryable, false);
});

test("an expired request polled with the WRONG secret still returns the same generic 404 — expiry is only ever confirmed to the correct secret's holder", async () => {
  const longAgo = Date.now() - PAIRING_TTL_MS - 60_000;
  const { request } = createPairingRequest(input(), longAgo);
  const response = await GET(requestFor(request.id, "wrong-secret"), await ctxFor(request.id));
  assert.equal(response.status, 404);
  const body = await response.json();
  assert.equal(body.error.code, "not_found");
});

test("a poll after a completed exchange (replay) is also reported as pairing_expired to the correct secret's holder", async () => {
  const { request, secret } = createPairingRequest(input());
  decidePairingRequest(request.id, "approved");
  const consumed = consumeApprovedPairing(request.id, secret);
  assert.ok(consumed, "the exchange must have actually succeeded for this test to be meaningful");
  const response = await GET(requestFor(request.id, secret), await ctxFor(request.id));
  assert.equal(response.status, 410);
  const body = await response.json();
  assert.equal(body.error.code, "pairing_expired");
});

test("creating a 65th pairing request evicts the oldest to enforce the 64 cap, and polling that evicted request reports pairing_expired to its correct secret's holder — but the same generic 404 to a wrong secret", async () => {
  const entries: Array<{ id: string; secret: string }> = [];
  for (let index = 0; index < MAX_PAIRING_REQUESTS; index += 1) {
    const { request, secret } = createPairingRequest(
      input({ installationId: `df8b1b3e-9c1a-4f0a-8b1a-${String(index).padStart(12, "0")}` }),
    );
    entries.push({ id: request.id, secret });
  }
  // Simply reaching exactly the cap must not have evicted anything yet.
  const stillLive = await GET(requestFor(entries[0].id, entries[0].secret), await ctxFor(entries[0].id));
  assert.equal(stillLive.status, 200, "reading exactly 64 live requests must never evict the oldest");

  // The 65th create is the only thing allowed to evict — exactly the oldest.
  createPairingRequest(input({ installationId: "df8b1b3e-9c1a-4f0a-8b1a-999999999999" }));

  const oldest = entries[0];
  const wrongSecretPoll = await GET(requestFor(oldest.id, "wrong-secret"), await ctxFor(oldest.id));
  assert.equal(wrongSecretPoll.status, 404, "a wrong secret against the evicted id stays the same generic 404");
  const wrongSecretBody = await wrongSecretPoll.json();
  assert.equal(wrongSecretBody.error.code, "not_found");

  const correctSecretPoll = await GET(requestFor(oldest.id, oldest.secret), await ctxFor(oldest.id));
  assert.equal(
    correctSecretPoll.status,
    410,
    "the evicted request's correct secret still gets a stable pairing_expired, not a generic 404",
  );
  const correctSecretBody = await correctSecretPoll.json();
  assert.equal(correctSecretBody.error.code, "pairing_expired");
});

console.log("client/v1/pairing/requests/[id] route.test.ts: ok");
