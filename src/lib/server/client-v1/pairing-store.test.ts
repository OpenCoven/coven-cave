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
