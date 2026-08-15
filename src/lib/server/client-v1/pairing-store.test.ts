import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import type { PairingRequestInput } from "./contract.ts";

const {
  PAIRING_TTL_MS,
  consumeApprovedPairing,
  createPairingRequest,
  decidePairingRequest,
  readPairingRequest,
  resetPairingStoreForTest,
} = await import("./pairing-store.ts");

const REQUEST: PairingRequestInput = {
  appName: "Cave iOS",
  installationId: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  scopes: ["chat:read", "chat:write"],
};

beforeEach(() => {
  resetPairingStoreForTest();
});

test("createPairingRequest returns a one-time secret and readPairingRequest exposes only safe metadata", () => {
  const created = createPairingRequest(REQUEST, 1_000);
  assert.match(created.id, /^[0-9a-f-]{36}$/i);
  assert.equal(created.secret.length, 43, "32 random bytes are returned as base64url");
  assert.equal(created.status, "pending");
  assert.equal(created.createdAt, 1_000);
  assert.equal(created.expiresAt, 1_000 + PAIRING_TTL_MS);
  assert.equal(created.consumedAt, null);
  assert.ok(!("secretHash" in created), "the hash stays internal");

  const readable = readPairingRequest(created.id, created.secret, 1_100);
  assert.deepEqual(readable, {
    id: created.id,
    appName: REQUEST.appName,
    installationId: REQUEST.installationId,
    scopes: [...REQUEST.scopes],
    status: "pending",
    createdAt: 1_000,
    expiresAt: 1_000 + PAIRING_TTL_MS,
    consumedAt: null,
  });
  assert.equal(readPairingRequest(created.id, "wrong-secret", 1_100), null);
});

test("approved pairings can be consumed exactly once and are deleted before any replay", () => {
  const created = createPairingRequest(REQUEST, 1_000);
  assert.equal(decidePairingRequest(created.id, "approved", 1_100)?.status, "approved");

  const consumed = consumeApprovedPairing(created.id, created.secret, 1_200);
  assert.deepEqual(consumed, {
    id: created.id,
    appName: REQUEST.appName,
    installationId: REQUEST.installationId,
    scopes: [...REQUEST.scopes],
    status: "approved",
    createdAt: 1_000,
    expiresAt: 1_000 + PAIRING_TTL_MS,
    consumedAt: 1_200,
  });
  assert.equal(
    consumeApprovedPairing(created.id, created.secret, 1_300),
    null,
    "the consumed approval is gone before replay",
  );
  assert.equal(readPairingRequest(created.id, created.secret, 1_300), null);
});

test("pending, denied, expired, and secret-mismatched requests fail safely when consumed", () => {
  const pending = createPairingRequest(REQUEST, 1_000);
  assert.equal(consumeApprovedPairing(pending.id, pending.secret, 1_100), null);

  const denied = createPairingRequest({ ...REQUEST, installationId: "3fa85f64-5717-4562-b3fc-2c963f66afa7" }, 2_000);
  assert.equal(decidePairingRequest(denied.id, "denied", 2_100)?.status, "denied");
  assert.equal(consumeApprovedPairing(denied.id, denied.secret, 2_200), null);

  const expired = createPairingRequest({ ...REQUEST, installationId: "3fa85f64-5717-4562-b3fc-2c963f66afa8" }, 3_000);
  assert.deepEqual(readPairingRequest(expired.id, expired.secret, expired.expiresAt), {
    id: expired.id,
    appName: REQUEST.appName,
    installationId: "3fa85f64-5717-4562-b3fc-2c963f66afa8",
    scopes: [...REQUEST.scopes],
    status: "expired",
    createdAt: 3_000,
    expiresAt: 3_000 + PAIRING_TTL_MS,
    consumedAt: null,
  });
  assert.equal(decidePairingRequest(expired.id, "approved", expired.expiresAt)?.status, "expired");
  assert.equal(consumeApprovedPairing(expired.id, expired.secret, expired.expiresAt), null);

  const approved = createPairingRequest({ ...REQUEST, installationId: "3fa85f64-5717-4562-b3fc-2c963f66afa9" }, 4_000);
  assert.equal(decidePairingRequest(approved.id, "approved", 4_100)?.status, "approved");
  assert.equal(consumeApprovedPairing(approved.id, "not-the-secret", 4_200), null);
  assert.equal(readPairingRequest(approved.id, approved.secret, 4_200)?.status, "approved");
});

test("pairing requests are bounded and prune the oldest entries", () => {
  const first = createPairingRequest(REQUEST, 1_000);
  for (let index = 0; index < 80; index += 1) {
    createPairingRequest(
      {
        ...REQUEST,
        installationId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      },
      1_001 + index,
    );
  }

  assert.equal(
    readPairingRequest(first.id, first.secret, 2_000),
    null,
    "the oldest request is evicted once the cap is exceeded",
  );
});

console.log("pairing-store.test.ts: ok");
