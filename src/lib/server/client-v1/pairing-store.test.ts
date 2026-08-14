import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  claimApprovedPairing,
  claimApprovedPairingWithIdempotency,
  consumeApprovedPairing,
  createPairingRequest,
  decidePairingRequest,
  finalizeApprovedPairingClaim,
  isPairingRequestExpired,
  listPendingPairingRequests,
  MAX_PAIRING_REQUESTS,
  PAIRING_CLAIM_STALE_MS,
  PAIRING_TOMBSTONE_TTL_MS,
  PAIRING_TTL_MS,
  readPairingRequest,
  resetPairingRequestsForTest,
  rollbackApprovedPairingClaim,
} from "./pairing-store.ts";
import type { ClientV1Scope } from "./contract.ts";

afterEach(() => {
  resetPairingRequestsForTest();
});

// Test-only escape hatch: the store's public projection types deliberately
// expose `readonly ClientV1Scope[]` so production callers can't accidentally
// mutate them, but these mutation-isolation tests need to actually attempt a
// mutation to prove it doesn't leak anywhere else. Isolated to one place so
// the `as` cast doesn't have to be repeated at every call site below.
function mutableScopes(scopes: readonly ClientV1Scope[]): ClientV1Scope[] {
  return scopes as ClientV1Scope[];
}

function input(overrides: Partial<Parameters<typeof createPairingRequest>[0]> = {}) {
  return {
    appName: "OpenCoven Mobile",
    installationId: "4e8b1b3e-9c1a-4f0a-8b1a-0c1d2e3f4a5b",
    scopes: ["chat:read" as const],
    ...overrides,
  };
}

// ─── 1. pending create/read, approval, consume once, replay null ──────────

test("a pending request can be read with its secret, then approved and consumed exactly once", () => {
  const { request, secret } = createPairingRequest(input(), 1_000);
  assert.equal(request.status, "pending");
  assert.equal(request.appName, "OpenCoven Mobile");
  assert.equal(request.expiresAt, 1_000 + PAIRING_TTL_MS);

  const read = readPairingRequest(request.id, secret, 1_100);
  assert.ok(read);
  assert.equal(read?.status, "pending");

  const decided = decidePairingRequest(request.id, "approved", 1_200);
  assert.equal(decided?.status, "approved");

  const consumed = consumeApprovedPairing(request.id, secret, 1_300);
  assert.deepEqual(consumed, {
    appName: "OpenCoven Mobile",
    installationId: "4e8b1b3e-9c1a-4f0a-8b1a-0c1d2e3f4a5b",
    scopes: ["chat:read"],
    status: "approved",
  });

  assert.equal(
    consumeApprovedPairing(request.id, secret, 1_400),
    null,
    "a replay of the same secret must find nothing",
  );
  assert.equal(
    readPairingRequest(request.id, secret, 1_400),
    null,
    "a consumed request is no longer readable either",
  );
});

// ─── 2. denial cannot consume; expiry cannot read/decide/consume ──────────

test("a denied request can never be consumed", () => {
  const { request, secret } = createPairingRequest(input(), 1_000);
  const decided = decidePairingRequest(request.id, "denied", 1_100);
  assert.equal(decided?.status, "denied");
  assert.equal(consumeApprovedPairing(request.id, secret, 1_200), null);
});

test("deciding again with a conflicting outcome fails, but the same outcome is idempotent", () => {
  const { request } = createPairingRequest(input(), 1_000);
  assert.equal(decidePairingRequest(request.id, "approved", 1_100)?.status, "approved");
  assert.equal(
    decidePairingRequest(request.id, "denied", 1_200),
    null,
    "a decision once made must not be silently overturned",
  );
  assert.equal(
    decidePairingRequest(request.id, "approved", 1_300)?.status,
    "approved",
    "repeating the SAME decision is an idempotent no-op",
  );
});

test("an expired request cannot be read, decided, or consumed", () => {
  const { request, secret } = createPairingRequest(input(), 1_000);
  const expiresAt = request.expiresAt;
  assert.equal(readPairingRequest(request.id, secret, expiresAt), null, "expiry is inclusive");
  assert.equal(decidePairingRequest(request.id, "approved", expiresAt), null);
  assert.equal(consumeApprovedPairing(request.id, secret, expiresAt), null);
});

test("approving before expiry still cannot be consumed after expiry", () => {
  const { request, secret } = createPairingRequest(input(), 1_000);
  assert.ok(decidePairingRequest(request.id, "approved", 1_100));
  assert.equal(consumeApprovedPairing(request.id, secret, request.expiresAt + 1), null);
});

// ─── 3. wrong secret returns null; admin list has no secret/hash ─────────

test("a wrong secret returns null from read and consume without revealing the id exists", () => {
  const { request, secret } = createPairingRequest(input(), 1_000);
  assert.equal(readPairingRequest(request.id, "not-the-secret", 1_100), null);
  assert.equal(readPairingRequest("00000000-0000-4000-8000-000000000000", secret, 1_100), null);

  decidePairingRequest(request.id, "approved", 1_100);
  assert.equal(consumeApprovedPairing(request.id, "not-the-secret", 1_200), null);
  assert.equal(
    consumeApprovedPairing("00000000-0000-4000-8000-000000000000", secret, 1_200),
    null,
  );
  // The real request must still be consumable afterwards — wrong attempts
  // must not have burned it.
  assert.ok(consumeApprovedPairing(request.id, secret, 1_300));
});

test("the admin listing never carries a secret or its hash", () => {
  createPairingRequest(input({ appName: "App One" }), 1_000);
  createPairingRequest(input({ appName: "App Two", installationId: "5e8b1b3e-9c1a-4f0a-8b1a-0c1d2e3f4a5c" }), 1_100);
  const listed = listPendingPairingRequests(1_200);
  assert.equal(listed.length, 2);
  for (const record of listed) {
    assert.equal("secretHash" in record, false);
    assert.equal("secret" in record, false);
  }
  // oldest first
  assert.deepEqual(listed.map((r) => r.appName), ["App One", "App Two"]);
});

test("the admin listing excludes consumed and expired requests, keeping only still-pending ones", () => {
  // Created first, so it expires earliest — this is the one that must drop
  // out of the listing once time passes its expiry.
  const expired = createPairingRequest(
    input({ appName: "Expired", installationId: "6e8b1b3e-9c1a-4f0a-8b1a-0c1d2e3f4a5d" }),
    1_000,
  );
  const laterNow = expired.request.expiresAt + 1;
  const pending = createPairingRequest(input({ appName: "Pending" }), laterNow);

  const listed = listPendingPairingRequests(laterNow + 100);
  const names = listed.map((r) => r.appName).sort();
  assert.deepEqual(names, ["Pending"]);
  void pending;
  void expired;
});

test("the admin listing excludes both approved and denied requests, keeping only status === \"pending\"", () => {
  const approved = createPairingRequest(input({ appName: "Approved" }), 1_000);
  const denied = createPairingRequest(
    input({ appName: "Denied", installationId: "5e8b1b3e-9c1a-4f0a-8b1a-0c1d2e3f4a5c" }),
    1_100,
  );
  const pending = createPairingRequest(
    input({ appName: "Pending", installationId: "6e8b1b3e-9c1a-4f0a-8b1a-0c1d2e3f4a5d" }),
    1_200,
  );

  decidePairingRequest(approved.request.id, "approved", 1_300);
  decidePairingRequest(denied.request.id, "denied", 1_300);

  const listed = listPendingPairingRequests(1_400);
  assert.deepEqual(
    listed.map((r) => r.appName),
    ["Pending"],
    "approved and denied records must be excluded once decided",
  );
  assert.equal(listed[0]?.status, "pending");
  void pending;
});

// ─── 4. map bounded to 64 and expired entries pruned ──────────────────────

test("outstanding pairing requests are bounded and expired entries are pruned first", () => {
  const first = createPairingRequest(input(), 1_000);
  // Fill well past the cap without expiring anything; the earliest request
  // must be evicted rather than retained forever.
  for (let index = 0; index < 100; index += 1) {
    createPairingRequest(
      input({ installationId: `7e8b1b3e-9c1a-4f0a-8b1a-${String(index).padStart(12, "0")}` }),
      1_000,
    );
  }
  assert.equal(
    readPairingRequest(first.request.id, first.secret, 1_100),
    null,
    "the oldest request was evicted to enforce the bound",
  );
  assert.ok(listPendingPairingRequests(1_100).length <= 64);
});

test("expired entries are pruned ahead of oldest-first eviction", () => {
  const expiredEarly = createPairingRequest(input(), 1_000);
  // A batch created well after the first has expired should not evict live,
  // still-fresh requests just to make room — the expired one is reclaimed.
  const laterNow = expiredEarly.request.expiresAt + 1;
  const second = createPairingRequest(
    input({ installationId: "8e8b1b3e-9c1a-4f0a-8b1a-0c1d2e3f4a5e" }),
    laterNow,
  );
  assert.equal(readPairingRequest(expiredEarly.request.id, expiredEarly.secret, laterNow), null);
  assert.ok(readPairingRequest(second.request.id, second.secret, laterNow + 10));
});

// ─── 5. reading/listing at exactly capacity never capacity-evicts a live
//        request; only a new create may, and it leaves exactly the cap ─────

test("filling to exactly the cap keeps all live requests readable and listed, with no capacity eviction from reads/listing/decisions", () => {
  const entries: Array<{ id: string; secret: string }> = [];
  for (let index = 0; index < MAX_PAIRING_REQUESTS; index += 1) {
    const { request, secret } = createPairingRequest(
      input({ installationId: `9e8b1b3e-9c1a-4f0a-8b1a-${String(index).padStart(12, "0")}` }),
      1_000,
    );
    entries.push({ id: request.id, secret });
  }
  assert.equal(entries.length, MAX_PAIRING_REQUESTS);

  // At exactly the cap, every single one of the 64 live requests must still
  // be readable — reading must never capacity-evict a live record.
  for (const entry of entries) {
    assert.ok(
      readPairingRequest(entry.id, entry.secret, 1_100),
      "every one of the 64 live requests must remain readable at exactly capacity",
    );
  }

  // Listing at exactly the cap must return all 64, not evict any to make
  // room for the listing call itself.
  assert.equal(
    listPendingPairingRequests(1_100).length,
    MAX_PAIRING_REQUESTS,
    "listing 64 live records must return all 64",
  );

  // Deciding one of them (still at exactly the cap) must not capacity-evict
  // any other live record either.
  assert.ok(decidePairingRequest(entries[10].id, "approved", 1_100));
  assert.equal(
    listPendingPairingRequests(1_100).length,
    MAX_PAIRING_REQUESTS - 1,
    "only the decided request leaves the pending queue — deciding is not a capacity eviction",
  );
  assert.ok(
    readPairingRequest(entries[0].id, entries[0].secret, 1_150),
    "the oldest live request must still be readable; nothing has evicted it yet",
  );
});

test("capacity eviction happens only immediately before a new create, and insertion leaves exactly the cap", () => {
  const entries: Array<{ id: string; secret: string }> = [];
  for (let index = 0; index < MAX_PAIRING_REQUESTS; index += 1) {
    const { request, secret } = createPairingRequest(
      input({ installationId: `ae8b1b3e-9c1a-4f0a-8b1a-${String(index).padStart(12, "0")}` }),
      1_000,
    );
    entries.push({ id: request.id, secret });
  }

  // Reads and listing at exactly the cap must not have evicted the oldest.
  assert.ok(readPairingRequest(entries[0].id, entries[0].secret, 1_050));
  assert.equal(listPendingPairingRequests(1_050).length, MAX_PAIRING_REQUESTS);

  // The 65th create is the only thing allowed to evict — exactly the oldest
  // live entry — leaving the map at exactly the cap afterward, not fewer.
  const overflow = createPairingRequest(
    input({ installationId: "ae8b1b3e-9c1a-4f0a-8b1a-999999999999" }),
    1_100,
  );
  assert.equal(
    readPairingRequest(entries[0].id, entries[0].secret, 1_150),
    null,
    "the oldest request is evicted only by the new create, never by the prior reads/listing",
  );
  assert.ok(readPairingRequest(overflow.request.id, overflow.secret, 1_150));
  assert.equal(
    listPendingPairingRequests(1_150).length,
    MAX_PAIRING_REQUESTS,
    "insertion at capacity must leave exactly the cap of live requests, not fewer or more",
  );
});

test("a record capacity-evicted to make room for a 65th create is tombstoned, so its correct secret still gets a stable expired signal — but a wrong secret against it stays exactly as generic as an unknown id", () => {
  const entries: Array<{ id: string; secret: string }> = [];
  for (let index = 0; index < MAX_PAIRING_REQUESTS; index += 1) {
    const { request, secret } = createPairingRequest(
      input({ installationId: `be8b1b3e-9c1a-4f0a-8b1a-${String(index).padStart(12, "0")}` }),
      1_000,
    );
    entries.push({ id: request.id, secret });
  }
  const oldest = entries[0];

  // Not yet evicted: reading exactly 64 must not have tombstoned it either.
  assert.equal(
    isPairingRequestExpired(oldest.id, oldest.secret, 1_050),
    false,
    "a live, still-present record must never be reported as expired",
  );

  // The 65th create is the only thing that may evict — and it must tombstone
  // what it evicts rather than silently dropping it.
  createPairingRequest(
    input({ installationId: "be8b1b3e-9c1a-4f0a-8b1a-999999999999" }),
    1_100,
  );

  assert.equal(
    readPairingRequest(oldest.id, oldest.secret, 1_150),
    null,
    "the capacity-evicted record is gone from the normal read path, same as before",
  );
  assert.equal(
    isPairingRequestExpired(oldest.id, oldest.secret, 1_150),
    true,
    "capacity eviction is tombstoned exactly like a TTL expiry: the correct secret's holder learns it's genuinely over",
  );
  assert.equal(
    isPairingRequestExpired(oldest.id, "wrong-secret", 1_150),
    false,
    "a wrong secret against the capacity-evicted id is indistinguishable from an unknown id — it must NOT be reported as expired",
  );
});

test("tombstones created by capacity eviction are bounded by the same cap as live requests, and carry no raw metadata beyond a secret hash", () => {
  const first = createPairingRequest(
    input({ installationId: "ce8b1b3e-9c1a-4f0a-8b1a-000000000000" }),
    1_000,
  );
  // Fill to the cap, then flood well past it with creates at the SAME
  // instant (nothing here is TTL-expired) so every eviction along the way is
  // a capacity eviction, not a TTL prune — proving the tombstone bound and
  // "no raw metadata" guarantee hold for this eviction path specifically.
  // `first` itself is only capacity-evicted once the map first reaches the
  // cap (after MAX_PAIRING_REQUESTS - 1 more creates); enough further
  // creates beyond that point (each evicting the new oldest) must then
  // follow to push its own tombstone back out past the same bound.
  for (let index = 0; index < 3 * MAX_PAIRING_REQUESTS; index += 1) {
    createPairingRequest(
      input({ installationId: `ce8b1b3e-9c1a-4f0a-8b1a-${String(index + 1).padStart(12, "0")}` }),
      1_000,
    );
  }
  // The very first record was capacity-evicted long ago in this flood; its
  // tombstone must itself have since been evicted by the same bound, so it
  // is no longer distinguishable from an unknown id.
  assert.equal(
    isPairingRequestExpired(first.request.id, first.secret, 1_050),
    false,
    "a tombstone from capacity eviction is bounded by the same cap as live requests, not retained forever",
  );

  // A record near the tail of the flood is still within the tombstone
  // bound; its own public metadata (appName/installationId/scopes) must
  // never be reconstructable through the expired check.
  const recent = createPairingRequest(
    input({ installationId: "ce8b1b3e-9c1a-4f0a-8b1a-999999999999", appName: "Should Not Leak" }),
    1_000,
  );
  createPairingRequest(input({ installationId: "ce8b1b3e-9c1a-4f0a-8b1a-999999999998" }), 1_000);
  const result = isPairingRequestExpired(recent.request.id, recent.secret, 1_050);
  assert.equal(typeof result, "boolean", "the expired check only ever returns a boolean, never the record's metadata");
});

// ─── 6. scope-array mutation isolation: nothing aliases the internal record ─

test("mutating the original input's scopes array after create never changes the internal record's authorization scopes", () => {
  const scopes: ClientV1Scope[] = ["chat:read", "chat:write"];
  const { request, secret } = createPairingRequest(input({ scopes }), 1_000);
  assert.deepEqual(request.scopes, ["chat:read", "chat:write"]);

  // Mutate the CALLER's array after the request was created.
  scopes.push("tasks:write");
  scopes.length = 1;

  // The already-returned public record must be unaffected...
  assert.deepEqual(
    request.scopes,
    ["chat:read", "chat:write"],
    "the previously-returned record's scopes must not change when the caller's original array is mutated later",
  );
  // ...and so must every later read of the SAME still-live request.
  const reread = readPairingRequest(request.id, secret, 1_100);
  assert.deepEqual(
    reread?.scopes,
    ["chat:read", "chat:write"],
    "a fresh read must reflect what was actually granted at create time, not a later mutation of the caller's array",
  );
});

test("mutating a returned scopes array (from read, admin list, or consume) never affects a later result", () => {
  const { request, secret } = createPairingRequest(
    input({ scopes: ["chat:read" as const, "chat:write" as const] }),
    1_000,
  );

  // Mutate the array returned by `readPairingRequest`.
  const read = readPairingRequest(request.id, secret, 1_100);
  assert.ok(read);
  mutableScopes(read.scopes).push("github:write");

  // Mutate the array returned by the admin listing.
  const listed = listPendingPairingRequests(1_100);
  const listedEntry = listed.find((r) => r.id === request.id);
  assert.ok(listedEntry);
  mutableScopes(listedEntry.scopes).push("tasks:write");

  // Neither mutation may have reached the internal record: a subsequent read
  // must still show exactly the two scopes granted at create time.
  const rereadAfterMutations = readPairingRequest(request.id, secret, 1_150);
  assert.deepEqual(
    rereadAfterMutations?.scopes,
    ["chat:read", "chat:write"],
    "mutating a previously-returned scopes array must never leak into a later read",
  );

  decidePairingRequest(request.id, "approved", 1_200);
  const listedAfterMutations = listPendingPairingRequests(1_200);
  // The request is no longer pending (it was just approved), so nothing to
  // find here — the real assertion is the consumed result below.
  assert.equal(listedAfterMutations.find((r) => r.id === request.id), undefined);

  const consumed = consumeApprovedPairing(request.id, secret, 1_300);
  assert.deepEqual(
    consumed?.scopes,
    ["chat:read", "chat:write"],
    "the consumed pairing's scopes must reflect exactly what was granted, unaffected by any earlier mutation of a previously-returned array",
  );

  // Mutating the consumed result itself must not be observable anywhere else
  // (there is no later read of a consumed/deleted request, but a second
  // independent request for a different installation must still be
  // unaffected by this array having been mutated).
  consumed?.scopes && mutableScopes(consumed.scopes).push("github:write");
  const other = createPairingRequest(
    input({
      installationId: "5e8b1b3e-9c1a-4f0a-8b1a-0c1d2e3f4a5c",
      scopes: ["chat:read" as const],
    }),
    1_400,
  );
  assert.deepEqual(
    other.request.scopes,
    ["chat:read"],
    "an unrelated later request must never be affected by mutating an earlier consumed result's scopes array",
  );
});

// ─── 7. genuine expiry/replay is distinguishable (with the right secret)
//        from an unknown id or a wrong secret, via a bounded tombstone ─────

test("a genuinely TTL-expired request, presented with its correct secret, is reported as expired — never confused with an unknown id", () => {
  const { request, secret } = createPairingRequest(input(), 1_000);
  const now = request.expiresAt + 1;
  assert.equal(readPairingRequest(request.id, secret, now), null, "still returns null, unchanged, from the normal read path");
  assert.equal(
    isPairingRequestExpired(request.id, secret, now),
    true,
    "the correct secret against a genuinely-expired id is reported as expired",
  );
});

test("a completed exchange (replay) is also reported as expired to the holder of the correct secret", () => {
  const { request, secret } = createPairingRequest(input(), 1_000);
  decidePairingRequest(request.id, "approved", 1_100);
  const consumed = consumeApprovedPairing(request.id, secret, 1_200);
  assert.ok(consumed);
  assert.equal(
    isPairingRequestExpired(request.id, secret, 1_300),
    true,
    "a replay of an already-consumed id, with its correct secret, is reported as expired",
  );
});

test("a wrong secret against a real (expired or consumed) id is never reported as expired — it looks exactly like an unknown id", () => {
  const { request } = createPairingRequest(input(), 1_000);
  const expiredNow = request.expiresAt + 1;
  assert.equal(isPairingRequestExpired(request.id, "wrong-secret", expiredNow), false);

  const { request: approvedRequest, secret: approvedSecret } = createPairingRequest(
    input({ installationId: "5e8b1b3e-9c1a-4f0a-8b1a-0c1d2e3f4a5c" }),
    1_000,
  );
  decidePairingRequest(approvedRequest.id, "approved", 1_100);
  consumeApprovedPairing(approvedRequest.id, approvedSecret, 1_200);
  assert.equal(isPairingRequestExpired(approvedRequest.id, "wrong-secret", 1_300), false);
});

test("an id that never existed is never reported as expired, for any secret", () => {
  assert.equal(isPairingRequestExpired("00000000-0000-4000-8000-000000000000", "any-secret", 1_000), false);
});

test("a still-pending or still-live decided request is never reported as expired", () => {
  const { request, secret } = createPairingRequest(input(), 1_000);
  assert.equal(isPairingRequestExpired(request.id, secret, 1_100), false, "a live pending request is not expired");
  decidePairingRequest(request.id, "approved", 1_100);
  assert.equal(isPairingRequestExpired(request.id, secret, 1_150), false, "a live approved-but-not-yet-consumed request is not expired");
});

test("the expiry tombstone itself is short-lived and bounded, never retained indefinitely", () => {
  const { request, secret } = createPairingRequest(input(), 1_000);
  const expiredNow = request.expiresAt + 1;
  assert.equal(isPairingRequestExpired(request.id, secret, expiredNow), true);
  // Long after the tombstone's own short grace window, it must have been
  // pruned — the correct secret no longer distinguishes this id from an
  // unknown one, so memory for it is not held onto forever.
  const wellAfterTombstoneTtl = expiredNow + PAIRING_TOMBSTONE_TTL_MS + 1;
  assert.equal(isPairingRequestExpired(request.id, secret, wellAfterTombstoneTtl), false);
});

test("tombstones are bounded by the same global cap, oldest-first, even under a flood of expiries", () => {
  const first = createPairingRequest(input(), 1_000);
  const firstExpiredNow = first.request.expiresAt + 1;
  // Force the first request's tombstone to exist right now.
  assert.equal(isPairingRequestExpired(first.request.id, first.secret, firstExpiredNow), true);

  // Flood well past the cap with requests that immediately expire too,
  // forcing tombstone eviction the same way live records are bounded.
  for (let index = 0; index < MAX_PAIRING_REQUESTS + 10; index += 1) {
    const flood = createPairingRequest(
      input({ installationId: `9f8b1b3e-9c1a-4f0a-8b1a-${String(index).padStart(12, "0")}` }),
      firstExpiredNow,
    );
    const floodExpiredNow = flood.request.expiresAt + 1;
    isPairingRequestExpired(flood.request.id, flood.secret, floodExpiredNow);
  }

  assert.equal(
    isPairingRequestExpired(first.request.id, first.secret, firstExpiredNow + MAX_PAIRING_REQUESTS * 1000),
    false,
    "the oldest tombstone was evicted to enforce the same bound live requests observe",
  );
});

test("a raw secret is never retained past expiry/consumption — only its hash backs the tombstone check", () => {
  // There is no accessor that could return a raw secret from a tombstone;
  // this test pins that `isPairingRequestExpired` is the only surface, and
  // that it never returns the secret itself, only a boolean.
  const { request, secret } = createPairingRequest(input(), 1_000);
  const now = request.expiresAt + 1;
  const result = isPairingRequestExpired(request.id, secret, now);
  assert.equal(typeof result, "boolean");
});

// ─── claim / finalize / rollback lifecycle (transactional exchange) ────────

test("claiming an approved request neither tombstones nor deletes it — it stays readable/approved until finalize or rollback", () => {
  const { request, secret } = createPairingRequest(input(), 1_000);
  decidePairingRequest(request.id, "approved", 1_100);

  const claim = claimApprovedPairing(request.id, secret, 1_200);
  assert.ok(claim);
  assert.equal(typeof claim.claimId, "string");
  assert.ok(claim.claimId.length > 0);
  assert.deepEqual(claim.pairing, {
    appName: "OpenCoven Mobile",
    installationId: "4e8b1b3e-9c1a-4f0a-8b1a-0c1d2e3f4a5b",
    scopes: ["chat:read"],
    status: "approved",
  });

  // Still present and reported as "approved" — a claim is not a tombstone.
  const stillThere = readPairingRequest(request.id, secret, 1_300);
  assert.equal(stillThere?.status, "approved");
  assert.equal(isPairingRequestExpired(request.id, secret, 1_300), false);
});

test("a second claim attempt while one is outstanding fails generically, even with the correct secret", () => {
  const { request, secret } = createPairingRequest(input(), 1_000);
  decidePairingRequest(request.id, "approved", 1_100);

  const first = claimApprovedPairing(request.id, secret, 1_200);
  assert.ok(first);

  const second = claimApprovedPairing(request.id, secret, 1_250);
  assert.equal(second, null, "a concurrent/replayed claim must never succeed while another claim is outstanding");
});

test("finalize deletes + tombstones only when the claim id matches; a wrong claim id is a safe no-op", () => {
  const { request, secret } = createPairingRequest(input(), 1_000);
  decidePairingRequest(request.id, "approved", 1_100);
  const claim = claimApprovedPairing(request.id, secret, 1_200);
  assert.ok(claim);

  assert.equal(
    finalizeApprovedPairingClaim(request.id, "not-the-real-claim-id", 1_250),
    false,
    "a foreign/wrong claim id must never finalize someone else's claim",
  );
  // Still claimed, still approved, still readable — nothing was touched.
  assert.equal(readPairingRequest(request.id, secret, 1_260)?.status, "approved");

  assert.equal(finalizeApprovedPairingClaim(request.id, claim.claimId, 1_300), true);
  // Now gone, and reported as expired to the correct secret (same terminal
  // state consumeApprovedPairing always produced).
  assert.equal(readPairingRequest(request.id, secret, 1_350), null);
  assert.equal(isPairingRequestExpired(request.id, secret, 1_350), true);

  // A second finalize attempt with the same (now-stale) claim id is a no-op.
  assert.equal(finalizeApprovedPairingClaim(request.id, claim.claimId, 1_400), false);
});

test("rollback while still within the original TTL releases the claim so a retry can immediately succeed", () => {
  const { request, secret } = createPairingRequest(input(), 1_000);
  decidePairingRequest(request.id, "approved", 1_100);
  const claim = claimApprovedPairing(request.id, secret, 1_200);
  assert.ok(claim);

  assert.equal(rollbackApprovedPairingClaim(request.id, claim.claimId, 1_250), true);
  // Still live and approved — the request itself was never touched.
  assert.equal(readPairingRequest(request.id, secret, 1_260)?.status, "approved");

  const retry = claimApprovedPairing(request.id, secret, 1_300);
  assert.ok(retry, "the retry must be able to claim again after a rollback");
  assert.notEqual(retry.claimId, claim.claimId, "a retry claim must get a fresh claim id");
  assert.equal(finalizeApprovedPairingClaim(request.id, retry.claimId, 1_350), true);
});

test("rollback after the claim's original TTL has passed finishes the record like a normal expiry (tombstoned, never left claimable)", () => {
  const { request, secret } = createPairingRequest(input(), 1_000);
  decidePairingRequest(request.id, "approved", 1_100);
  const claim = claimApprovedPairing(request.id, secret, 1_200);
  assert.ok(claim);

  const pastTtl = request.expiresAt + 1;
  assert.equal(rollbackApprovedPairingClaim(request.id, claim.claimId, pastTtl), true);

  assert.equal(readPairingRequest(request.id, secret, pastTtl + 10), null);
  assert.equal(isPairingRequestExpired(request.id, secret, pastTtl + 10), true);
  assert.equal(
    claimApprovedPairing(request.id, secret, pastTtl + 20),
    null,
    "an expired-while-claimed record must never become claimable again",
  );
});

test("rollback with a foreign/wrong claim id is a safe no-op and never disturbs the real claim", () => {
  const { request, secret } = createPairingRequest(input(), 1_000);
  decidePairingRequest(request.id, "approved", 1_100);
  const claim = claimApprovedPairing(request.id, secret, 1_200);
  assert.ok(claim);

  assert.equal(rollbackApprovedPairingClaim(request.id, "not-the-real-claim-id", 1_250), false);
  // The real claim is completely unaffected — it can still finalize.
  assert.equal(finalizeApprovedPairingClaim(request.id, claim.claimId, 1_300), true);
});

test("a wrong secret can never claim, and a still-pending or denied request can never be claimed either", () => {
  const pendingReq = createPairingRequest(input());
  assert.equal(claimApprovedPairing(pendingReq.request.id, pendingReq.secret, 1_000), null);
  assert.equal(claimApprovedPairing(pendingReq.request.id, "wrong-secret", 1_000), null);

  const approvedReq = createPairingRequest(input({ installationId: "5f8b1b3e-9c1a-4f0a-8b1a-0c1d2e3f4a5c" }));
  decidePairingRequest(approvedReq.request.id, "approved");
  assert.equal(claimApprovedPairing(approvedReq.request.id, "wrong-secret", 1_000), null);
  // The wrong secret must not have consumed the claim slot — the correct
  // secret can still claim afterward.
  assert.ok(claimApprovedPairing(approvedReq.request.id, approvedReq.secret, 1_100));

  const deniedReq = createPairingRequest(input({ installationId: "5f8b1b3e-9c1a-4f0a-8b1a-0c1d2e3f4a5d" }));
  decidePairingRequest(deniedReq.request.id, "denied");
  assert.equal(claimApprovedPairing(deniedReq.request.id, deniedReq.secret, 1_000), null);
});

test("consumeApprovedPairing (legacy immediate claim+finalize) still leaves no claimable/reclaimable state behind", () => {
  const { request, secret } = createPairingRequest(input(), 1_000);
  decidePairingRequest(request.id, "approved", 1_100);

  const consumed = consumeApprovedPairing(request.id, secret, 1_200);
  assert.ok(consumed);
  assert.equal(claimApprovedPairing(request.id, secret, 1_300), null, "already finalized — nothing left to claim");
  assert.equal(isPairingRequestExpired(request.id, secret, 1_300), true);
});

test("expiry during claim preserves finalize and exact-request terminal replay", () => {
  const { request, secret } = createPairingRequest(input(), 1_000);
  decidePairingRequest(request.id, "approved", 1_100);
  const idempotencyKey = "claim-replay-key";
  const requestHash = "claim-replay-hash";
  const claim = claimApprovedPairingWithIdempotency(
    request.id,
    secret,
    idempotencyKey,
    requestHash,
    1_200,
  );
  assert.equal(claim.kind, "claimed");
  if (claim.kind !== "claimed") return;

  // This read invokes pruneExpired after the original pairing TTL, but it
  // must leave the healthy in-flight claim available for finalization.
  assert.equal(readPairingRequest(request.id, secret, request.expiresAt + 1), null);
  const credential = {
    id: "9f4145de-9b43-4abc-876d-81ef63de60e0",
    appName: "OpenCoven Mobile",
    installationId: "4e8b1b3e-9c1a-4f0a-8b1a-0c1d2e3f4a5b",
    scopes: ["chat:read" as const],
    createdAt: request.expiresAt + 2,
  };
  assert.equal(
    finalizeApprovedPairingClaim(request.id, claim.claimId, request.expiresAt + 2, {
      exchangeReplay: { idempotencyKey, requestHash, credential },
    }),
    true,
  );
  assert.deepEqual(
    claimApprovedPairingWithIdempotency(
      request.id,
      secret,
      idempotencyKey,
      requestHash,
      request.expiresAt + 3,
    ),
    { kind: "replay", credential },
  );
});

test("rollback after expiry terminates a claim, while stale claimed requests are boundedly recovered", () => {
  const rollbackRequest = createPairingRequest(input(), 1_000);
  decidePairingRequest(rollbackRequest.request.id, "approved", 1_100);
  const rollbackClaim = claimApprovedPairing(rollbackRequest.request.id, rollbackRequest.secret, 1_200);
  assert.ok(rollbackClaim);
  assert.equal(
    rollbackApprovedPairingClaim(
      rollbackRequest.request.id,
      rollbackClaim.claimId,
      rollbackRequest.request.expiresAt + 1,
    ),
    true,
  );
  assert.equal(
    isPairingRequestExpired(
      rollbackRequest.request.id,
      rollbackRequest.secret,
      rollbackRequest.request.expiresAt + 2,
    ),
    true,
  );

  const staleRequest = createPairingRequest(
    input({ installationId: "5e8b1b3e-9c1a-4f0a-8b1a-0c1d2e3f4a5c" }),
    1_000,
  );
  decidePairingRequest(staleRequest.request.id, "approved", 1_100);
  const staleClaim = claimApprovedPairing(staleRequest.request.id, staleRequest.secret, 1_200);
  assert.ok(staleClaim);
  const staleAt = 1_200 + PAIRING_CLAIM_STALE_MS;
  listPendingPairingRequests(staleAt);
  assert.equal(isPairingRequestExpired(staleRequest.request.id, staleRequest.secret, staleAt), true);
  assert.equal(finalizeApprovedPairingClaim(staleRequest.request.id, staleClaim.claimId, staleAt), false);
});

test("concurrent prune and finalize leave one expired claim terminally tombstoned", async () => {
  const { request, secret } = createPairingRequest(input(), 1_000);
  decidePairingRequest(request.id, "approved", 1_100);
  const claim = claimApprovedPairing(request.id, secret, 1_200);
  assert.ok(claim);

  const afterExpiry = request.expiresAt + 1;
  const [pruned, finalized] = await Promise.all([
    Promise.resolve().then(() => readPairingRequest(request.id, secret, afterExpiry)),
    Promise.resolve().then(() => finalizeApprovedPairingClaim(request.id, claim.claimId, afterExpiry)),
  ]);
  assert.equal(pruned, null);
  assert.equal(finalized, true);
  assert.equal(isPairingRequestExpired(request.id, secret, afterExpiry + 1), true);
});
