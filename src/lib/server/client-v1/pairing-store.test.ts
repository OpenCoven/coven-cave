import assert from "node:assert/strict";
import test from "node:test";

import {
  PAIRING_TTL_MS,
  createPairingStore,
} from "./pairing-store.ts";

const pairingInput = {
  appName: "OpenCoven Mobile",
  installationId: "4e8b1b3e-9c1a-4f0a-8b1a-0c1d2e3f4a5b",
  scopes: ["chat:read" as const],
};

test("pairing records stay process-local and persist only the SHA-256 secret hash", () => {
  let now = 1_000;
  const firstProcess = createPairingStore({ now: () => now });
  const secondProcess = createPairingStore({ now: () => now });

  const issued = firstProcess.create(pairingInput);
  assert.match(issued.secret, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(secondProcess.poll(issued.id, issued.secret), null);

  const inspected = firstProcess.inspect(issued.id);
  assert.ok(inspected);
  assert.match(inspected.secretHash, /^[a-f0-9]{64}$/);
  assert.notEqual(inspected.secretHash, issued.secret);
  assert.equal(JSON.stringify(inspected).includes(issued.secret), false);

  assert.deepEqual(firstProcess.poll(issued.id, issued.secret), {
    id: issued.id,
    appName: pairingInput.appName,
    installationId: pairingInput.installationId,
    scopes: ["chat:read"],
    status: "pending",
    createdAt: 1_000,
    expiresAt: 1_000 + PAIRING_TTL_MS,
    decidedAt: null,
  });

  now += 1;
});

test("pairing requests expire at the inclusive five-minute TTL boundary", () => {
  let now = 10_000;
  const store = createPairingStore({ now: () => now });
  const issued = store.create(pairingInput);

  now = issued.expiresAt - 1;
  assert.equal(store.poll(issued.id, issued.secret)?.status, "pending");

  now = issued.expiresAt;
  assert.equal(store.poll(issued.id, issued.secret), null);
  assert.equal(store.decide(issued.id, "approved", now), false);
  assert.equal(store.consume(issued.id, issued.secret), null);
  assert.equal(store.inspect(issued.id), null);
});

test("pairing decisions expose approved and denied poll states", () => {
  let now = 20_000;
  const store = createPairingStore({ now: () => now });
  const approved = store.create(pairingInput);
  const denied = store.create({
    ...pairingInput,
    installationId: "5e8b1b3e-9c1a-4f0a-8b1a-0c1d2e3f4a5c",
  });

  now = 20_100;
  assert.equal(store.decide(approved.id, "approved", now), true);
  assert.equal(store.poll(approved.id, approved.secret)?.status, "approved");
  assert.equal(store.decide(approved.id, "denied", now + 1), false);

  assert.equal(store.decide(denied.id, "denied", now), true);
  assert.equal(store.poll(denied.id, denied.secret)?.status, "denied");
  assert.equal(store.consume(denied.id, denied.secret), null);
});

test("an approved pairing can be consumed exactly once and rejects replay", () => {
  let now = 30_000;
  const store = createPairingStore({ now: () => now });
  const issued = store.create(pairingInput);

  now = 30_100;
  assert.equal(store.decide(issued.id, "approved", now), true);
  assert.equal(store.consume(issued.id, "wrong-secret"), null);
  assert.deepEqual(store.consume(issued.id, issued.secret), {
    appName: pairingInput.appName,
    installationId: pairingInput.installationId,
    scopes: ["chat:read"],
    status: "approved",
  });
  assert.equal(store.consume(issued.id, issued.secret), null);
  assert.equal(store.poll(issued.id, issued.secret), null);
});

test("pairing storage is bounded by maxEntries with oldest-first eviction", () => {
  let now = 40_000;
  const store = createPairingStore({ maxEntries: 2, now: () => now });
  const first = store.create(pairingInput);
  now += 1;
  const second = store.create({
    ...pairingInput,
    installationId: "5e8b1b3e-9c1a-4f0a-8b1a-0c1d2e3f4a5c",
  });
  now += 1;
  const third = store.create({
    ...pairingInput,
    installationId: "6e8b1b3e-9c1a-4f0a-8b1a-0c1d2e3f4a5d",
  });

  assert.equal(store.poll(first.id, first.secret), null);
  assert.equal(store.poll(second.id, second.secret)?.status, "pending");
  assert.equal(store.poll(third.id, third.secret)?.status, "pending");
});

test("route lookups distinguish bad secrets, expiry, and consumed replay without exposing hashes", () => {
  let now = 50_000;
  const store = createPairingStore({ now: () => now });
  const issued = store.create(pairingInput);

  assert.deepEqual(store.lookup(issued.id, "wrong-secret"), {
    kind: "secret_mismatch",
  });
  assert.deepEqual(store.consumeForExchange(issued.id, issued.secret), {
    kind: "pending",
  });

  now = issued.expiresAt;
  assert.deepEqual(store.lookup(issued.id, issued.secret), {
    kind: "found",
    pairing: {
      id: issued.id,
      status: "expired",
      expiresAt: issued.expiresAt,
    },
  });
  assert.deepEqual(store.consumeForExchange(issued.id, issued.secret), {
    kind: "expired",
  });

  const approved = store.create({
    ...pairingInput,
    installationId: "7e8b1b3e-9c1a-4f0a-8b1a-0c1d2e3f4a5e",
  });
  now += 1;
  assert.equal(store.decide(approved.id, "approved", now), true);
  assert.equal(store.consumeForExchange(approved.id, approved.secret).kind, "approved");
  assert.deepEqual(store.consumeForExchange(approved.id, approved.secret), {
    kind: "consumed",
  });
  assert.equal(JSON.stringify(store.lookup(approved.id, approved.secret)).includes("Hash"), false);
});

test("admin inspection lists pending requests and returns decision metadata without secret material", () => {
  let now = 60_000;
  const store = createPairingStore({ now: () => now });
  const pending = store.create(pairingInput);
  const approved = store.create({
    ...pairingInput,
    installationId: "8e8b1b3e-9c1a-4f0a-8b1a-0c1d2e3f4a5f",
  });
  now += 10;
  assert.equal(store.decide(approved.id, "approved", now), true);

  assert.deepEqual(store.listPending(), [{
    id: pending.id,
    appName: pairingInput.appName,
    installationId: pairingInput.installationId,
    scopes: ["chat:read"],
    status: "pending",
    createdAt: 60_000,
    expiresAt: 60_000 + PAIRING_TTL_MS,
    decidedAt: null,
  }]);
  assert.equal(store.get(approved.id)?.status, "approved");
  assert.equal(JSON.stringify(store.listPending()).includes(pending.secret), false);
});

test("restoreConsumed returns a spent approval to exchangeable exactly once", () => {
  let now = 90_000;
  const store = createPairingStore({ now: () => now });
  const issued = store.create(pairingInput);
  now += 10;
  assert.equal(store.decide(issued.id, "approved", now), true);
  assert.equal(store.consumeForExchange(issued.id, issued.secret).kind, "approved");
  assert.equal(store.consumeForExchange(issued.id, issued.secret).kind, "consumed");

  // The exchange route consumes before it issues, so that a failed issue does
  // not cost the user a fresh request and a second administrator approval.
  assert.equal(store.restoreConsumed(issued.id), true);
  assert.equal(store.get(issued.id)?.status, "approved");
  assert.equal(store.consumeForExchange(issued.id, issued.secret).kind, "approved");

  // Nothing to restore is not the same as restoring nothing: a live record, an
  // unknown id, and an expired one all refuse rather than manufacture state.
  const live = store.create({
    ...pairingInput,
    installationId: "9e8b1b3e-9c1a-4f0a-8b1a-0c1d2e3f4a60",
  });
  assert.equal(store.restoreConsumed(live.id), false);
  assert.equal(store.restoreConsumed("00000000-0000-4000-8000-000000000000"), false);

  now = issued.expiresAt + 1;
  assert.equal(store.restoreConsumed(issued.id), false);
  assert.equal(store.get(issued.id), null);
});
