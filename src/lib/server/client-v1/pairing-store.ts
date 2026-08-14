// Pairing request store for the `/api/client/v1` facade (in-memory, per-process).
//
// A pairing request is a proof-of-possession handshake: a caller creates a
// request and gets back a secret it alone holds; a human then approves or
// denies the request out-of-band (the local admin UI, which only ever sees
// public metadata — never the secret or its hash); the caller exchanges the
// secret for a long-lived credential exactly once. Records live in memory
// only, mirroring the challenge half of passkey-store.ts: nothing here is
// trusted with more than a few minutes of caller intent, and a restart
// correctly invalidates every outstanding request rather than resurrecting an
// approval a human never re-confirmed after the process came back up.

import { createHash, randomUUID } from "node:crypto";

import { timingSafeEqualString } from "@/proxy-helpers";

import type { ClientV1Scope, PairingRequestInput } from "./contract.ts";

export const PAIRING_TTL_MS = 5 * 60_000;

// Bounds an abandoned flood of pairing attempts the way passkey-store bounds
// outstanding WebAuthn challenges: well past any legitimate concurrent count,
// with oldest-first eviction so growth is capped rather than unlimited.
export const MAX_PAIRING_REQUESTS = 64;

// How long a genuinely-real (now-gone) request stays distinguishable from an
// unknown/never-existed one to someone who holds its correct secret. Short
// relative to PAIRING_TTL_MS on purpose: it exists only so a native client's
// next poll/exchange after expiry (or after its own successful, one-time
// exchange) learns "this is really over," not to extend how long a request
// stays actionable.
export const PAIRING_TOMBSTONE_TTL_MS = 2 * 60_000;
export const PAIRING_EXCHANGE_RETRY_AFTER_MS = 1_000;

export type PairingStatus = "pending" | "approved" | "denied";

type PairingRecord = {
  id: string;
  appName: string;
  installationId: string;
  scopes: ClientV1Scope[];
  secretHash: string;
  status: PairingStatus;
  createdAt: number;
  expiresAt: number;
  consumedAt: number | null;
  createReplay: PairingCreateReplay | null;
  decisionReplay: PairingDecisionReplay | null;
  // Set by `claimApprovedPairing` to exclusively reserve this record for one
  // in-flight exchange (claim -> await issueCredential -> finalize), and
  // cleared only by `rollbackApprovedPairingClaim` (still within TTL) or by
  // deletion (finalize, expiry-while-claimed rollback, or eviction). While
  // set, no other claim attempt — concurrent OR a replay — can ever succeed,
  // even with the correct secret: exclusivity is checked before anything
  // else touches the record.
  claimId: string | null;
  claimReplayKey: string | null;
  claimReplayRequestHash: string | null;
};

/** What the admin UI and the pairing caller may see — never the secret hash. */
export type PublicPairingRecord = {
  id: string;
  appName: string;
  installationId: string;
  readonly scopes: readonly ClientV1Scope[];
  status: PairingStatus;
  createdAt: number;
  expiresAt: number;
};

/** What a successful exchange hands to the credential store. */
export type ApprovedPairing = {
  appName: string;
  installationId: string;
  readonly scopes: readonly ClientV1Scope[];
  status: "approved";
};

export type PairingCreateReplayResponse = {
  id: string;
  secret: string;
  status: "pending";
  expiresAt: number;
};

type PairingCreateReplay = {
  idempotencyKey: string;
  requestHash: string;
  response: PairingCreateReplayResponse;
};

type PairingDecisionReplay = {
  idempotencyKey: string;
  requestHash: string;
  response: PublicPairingRecord;
};

export type PairingExchangeCredentialSnapshot = {
  id: string;
  appName: string;
  installationId: string;
  readonly scopes: readonly ClientV1Scope[];
  createdAt: number;
};

export type PairingExchangeTerminalReplay = {
  idempotencyKey: string;
  requestHash: string;
  credential: PairingExchangeCredentialSnapshot;
};

/**
 * The result of a successful `claimApprovedPairing`: the approved pairing
 * data (safe to pass straight to `issueCredential`) plus an opaque claim id
 * that exclusively owns the underlying record until `finalizeApprovedPairingClaim`
 * or `rollbackApprovedPairingClaim` is called with it. The claim id is never
 * derived from — and never reveals — the pairing's secret or its hash.
 */
export type ApprovedPairingClaim = {
  claimId: string;
  pairing: ApprovedPairing;
};

export type IdempotentApprovedPairingClaimResult =
  | { kind: "claimed"; claimId: string; pairing: ApprovedPairing }
  | { kind: "pending"; retryAfterMs: number }
  | { kind: "replay"; credential: PairingExchangeCredentialSnapshot }
  | { kind: "conflict" | "unclaimable" };

const requests = new Map<string, PairingRecord>();

// A bounded, short-lived "this id was real, and here's the minimum replay-safe
// state it ended with" marker. It always retains the secret hash plus a prune
// deadline so `isPairingRequestExpired` can answer "yes, genuinely
// expired/consumed" only to whoever already holds the correct secret. For the
// explicit idempotency lifecycles layered onto pairing create/decision/exchange
// it may also retain the original create response, the last idempotent decision
// response, or the post-exchange terminal snapshot. Nothing here is written to
// disk, and only the create replay keeps the raw short-lived pairing secret —
// never the long-lived bearer token.
type PairingTombstone = {
  secretHash: string;
  pruneAt: number;
  createReplay: PairingCreateReplay | null;
  decisionReplay: PairingDecisionReplay | null;
  exchangeReplay: PairingExchangeTerminalReplay | null;
};

const tombstones = new Map<string, PairingTombstone>();

// Compared against in constant time when an id lookup misses, so a wrong
// secret against an unknown id takes the same comparison shape as a wrong
// secret against a real one — the id's existence should not leak from timing.
const DECOY_HASH = createHash("sha256").update("client-v1-pairing-decoy").digest("hex");

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

function cloneScopes(scopes: readonly ClientV1Scope[]): ClientV1Scope[] {
  return [...scopes];
}

function clonePublicRecord(record: PublicPairingRecord): PublicPairingRecord {
  return {
    id: record.id,
    appName: record.appName,
    installationId: record.installationId,
    scopes: cloneScopes(record.scopes),
    status: record.status,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
  };
}

function cloneCreateReplayResponse(response: PairingCreateReplayResponse): PairingCreateReplayResponse {
  return {
    id: response.id,
    secret: response.secret,
    status: response.status,
    expiresAt: response.expiresAt,
  };
}

function cloneCreateReplay(replay: PairingCreateReplay | null): PairingCreateReplay | null {
  if (!replay) return null;
  return {
    idempotencyKey: replay.idempotencyKey,
    requestHash: replay.requestHash,
    response: cloneCreateReplayResponse(replay.response),
  };
}

function cloneDecisionReplay(replay: PairingDecisionReplay | null): PairingDecisionReplay | null {
  if (!replay) return null;
  return {
    idempotencyKey: replay.idempotencyKey,
    requestHash: replay.requestHash,
    response: clonePublicRecord(replay.response),
  };
}

function cloneCredentialSnapshot(
  credential: PairingExchangeCredentialSnapshot,
): PairingExchangeCredentialSnapshot {
  return {
    id: credential.id,
    appName: credential.appName,
    installationId: credential.installationId,
    scopes: cloneScopes(credential.scopes),
    createdAt: credential.createdAt,
  };
}

function cloneExchangeReplay(
  replay: PairingExchangeTerminalReplay | null,
): PairingExchangeTerminalReplay | null {
  if (!replay) return null;
  return {
    idempotencyKey: replay.idempotencyKey,
    requestHash: replay.requestHash,
    credential: cloneCredentialSnapshot(replay.credential),
  };
}

function isLive(record: PairingRecord, now: number): boolean {
  return record.consumedAt === null && record.expiresAt > now;
}

/** Drop every tombstone whose own (short) prune deadline has passed. */
function pruneTombstones(now: number): void {
  for (const [id, tombstone] of tombstones) {
    if (tombstone.pruneAt <= now) tombstones.delete(id);
  }
}

/**
 * Record that `record` just stopped being live (TTL expiry or a completed
 * exchange), bounded by the same cap as `requests` itself with oldest-first
 * eviction — a flood of expiries/replays can never grow this map without
 * bound either. The tombstone always keeps the secret hash and prune deadline,
 * and may additionally keep lifecycle-bounded create/decision/exchange replay
 * snapshots; the only raw secret it may retain is the original short-lived
 * pairing secret needed to replay the create response, never a bearer token.
 */
function tombstone(
  record: PairingRecord,
  now: number,
  extras: { exchangeReplay?: PairingExchangeTerminalReplay | null } = {},
): void {
  pruneTombstones(now);
  if (!tombstones.has(record.id)) {
    while (tombstones.size >= MAX_PAIRING_REQUESTS) {
      const oldest = tombstones.keys().next();
      if (oldest.done) break;
      tombstones.delete(oldest.value);
    }
  }
  tombstones.set(record.id, {
    secretHash: record.secretHash,
    pruneAt: now + PAIRING_TOMBSTONE_TTL_MS,
    createReplay: cloneCreateReplay(record.createReplay),
    decisionReplay: cloneDecisionReplay(record.decisionReplay),
    exchangeReplay: cloneExchangeReplay(extras.exchangeReplay ?? null),
  });
}

/**
 * Drop every record whose TTL has passed. Safe to call from any read path
 * (list/read/decide) as well as before a create: it only ever removes
 * records that are already dead, so it can never evict a live request.
 */
function pruneExpired(now: number): void {
  for (const [id, record] of requests) {
    if (record.expiresAt <= now) {
      tombstone(record, now);
      requests.delete(id);
    }
  }
}

/**
 * Make room for a new record, called ONLY immediately before a create.
 * First reclaims anything already expired, then — and only if still at or
 * over the cap — evicts the oldest surviving (still-live) records
 * oldest-first. The `>=` guard means eviction stops as soon as inserting one
 * more record would land exactly at `MAX_PAIRING_REQUESTS`, so a create at
 * capacity leaves exactly 64 records afterward, never fewer. This is the
 * only place a live request can ever be evicted — reads, listings, and
 * decisions must never call this, only `pruneExpired`.
 *
 * A record evicted here is still genuinely live (unlike `pruneExpired`'s
 * already-dead records) — a caller could be mid-poll on it right now — so it
 * is tombstoned exactly like a TTL expiry before being deleted: the holder of
 * its correct secret still learns a stable `pairing_expired` on its next
 * poll/exchange, rather than the same generic response given to a wrong
 * secret or an id that never existed.
 */
function makeCapacityForCreate(now: number): void {
  pruneExpired(now);
  while (requests.size >= MAX_PAIRING_REQUESTS) {
    const oldest = requests.entries().next();
    if (oldest.done) break;
    const [id, record] = oldest.value;
    tombstone(record, now);
    requests.delete(id);
  }
}

function toPublic(record: PairingRecord): PublicPairingRecord {
  return {
    id: record.id,
    appName: record.appName,
    installationId: record.installationId,
    // Cloned so the caller's array can never alias — and therefore never
    // mutate — the internal record's authorization scopes. Every reader of
    // a `PublicPairingRecord` (read, admin list, decide) gets its own fresh
    // array from this one projection point.
    scopes: cloneScopes(record.scopes),
    status: record.status,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
  };
}

function findCreateReplayByKey(
  idempotencyKey: string,
): PairingCreateReplay | null {
  for (const record of requests.values()) {
    if (record.createReplay?.idempotencyKey === idempotencyKey) {
      return cloneCreateReplay(record.createReplay);
    }
  }
  for (const tombstone of tombstones.values()) {
    if (tombstone.createReplay?.idempotencyKey === idempotencyKey) {
      return cloneCreateReplay(tombstone.createReplay);
    }
  }
  return null;
}

export type IdempotentPairingCreateResult =
  | { kind: "created" | "replay"; response: PairingCreateReplayResponse }
  | { kind: "conflict" };

export type PairingCreateReplayLookupResult =
  | { kind: "new" }
  | { kind: "replay"; response: PairingCreateReplayResponse }
  | { kind: "conflict" };

export function lookupPairingRequestCreateIdempotency(
  idempotencyKey: string,
  requestHash: string,
  now = Date.now(),
): PairingCreateReplayLookupResult {
  pruneExpired(now);
  pruneTombstones(now);
  const replay = findCreateReplayByKey(idempotencyKey);
  if (!replay) return { kind: "new" };
  if (replay.requestHash !== requestHash) return { kind: "conflict" };
  return {
    kind: "replay",
    response: cloneCreateReplayResponse(replay.response),
  };
}

export function createPairingRequestWithIdempotency(
  input: PairingRequestInput,
  idempotencyKey: string,
  requestHash: string,
  now = Date.now(),
): IdempotentPairingCreateResult {
  const replay = lookupPairingRequestCreateIdempotency(idempotencyKey, requestHash, now);
  if (replay.kind !== "new") return replay;
  const { request, secret } = createPairingRequest(input, now, {
    idempotencyKey,
    requestHash,
  });
  return {
    kind: "created",
    response: {
      id: request.id,
      secret,
      status: "pending",
      expiresAt: request.expiresAt,
    },
  };
}

/** Create a pairing request; returns its public metadata plus the raw secret. */
export function createPairingRequest(
  input: PairingRequestInput,
  now = Date.now(),
  options: { idempotencyKey?: string; requestHash?: string } = {},
): { request: PublicPairingRecord; secret: string } {
  makeCapacityForCreate(now);
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const secret = Buffer.from(bytes).toString("base64url");
  const id = randomUUID();
  const createReplay =
    options.idempotencyKey && options.requestHash
      ? {
          idempotencyKey: options.idempotencyKey,
          requestHash: options.requestHash,
          response: {
            id,
            secret,
            status: "pending" as const,
            expiresAt: now + PAIRING_TTL_MS,
          },
        }
      : null;
  const record: PairingRecord = {
    id,
    appName: input.appName,
    installationId: input.installationId,
    // Cloned so the internal record's authorization scopes can never be
    // mutated later through the caller's `input.scopes` array — the caller
    // may hold onto and later mutate the array it passed in, and this store
    // must hold its own independent copy of what was actually requested.
    scopes: [...input.scopes],
    secretHash: hashSecret(secret),
    status: "pending",
    createdAt: now,
    expiresAt: now + PAIRING_TTL_MS,
    consumedAt: null,
    createReplay,
    decisionReplay: null,
    claimId: null,
    claimReplayKey: null,
    claimReplayRequestHash: null,
  };
  requests.set(record.id, record);
  return { request: toPublic(record), secret };
}

/**
 * Read a request's public status. The caller must present the exact secret it
 * was handed at creation; a wrong secret and a missing id both return null so
 * neither this function's return value nor its timing distinguishes them.
 */
export function readPairingRequest(
  id: string,
  secret: string,
  now = Date.now(),
): PublicPairingRecord | null {
  pruneExpired(now);
  const record = requests.get(id);
  const suppliedHash = hashSecret(secret);
  if (!record) {
    timingSafeEqualString(suppliedHash, DECOY_HASH);
    return null;
  }
  const secretOk = timingSafeEqualString(suppliedHash, record.secretHash);
  if (!secretOk || !isLive(record, now)) return null;
  return toPublic(record);
}

/**
 * Local admin UI listing: only requests that are still live, unconsumed, and
 * awaiting a human decision (`status === "pending"`), oldest first. Once a
 * request has been approved or denied it must drop out of this queue
 * immediately — the admin has already acted on it, so it has nothing left to
 * decide — but never a secret or its hash.
 */
export function listPendingPairingRequests(now = Date.now()): PublicPairingRecord[] {
  pruneExpired(now);
  const pending: PublicPairingRecord[] = [];
  for (const record of requests.values()) {
    if (record.status === "pending" && isLive(record, now)) pending.push(toPublic(record));
  }
  return pending;
}

/**
 * Record a human's approve/deny decision. Succeeds only for a live,
 * unconsumed record. Deciding again with the SAME outcome is a no-op success
 * (idempotent retry); deciding again with the OPPOSITE outcome fails, since a
 * decision once made must not be silently overturned.
 */
export function decidePairingRequest(
  id: string,
  decision: "approved" | "denied",
  now = Date.now(),
): PublicPairingRecord | null {
  pruneExpired(now);
  const record = requests.get(id);
  if (!record || !isLive(record, now)) return null;
  if (record.status === "pending") {
    record.status = decision;
    return toPublic(record);
  }
  return record.status === decision ? toPublic(record) : null;
}

export type IdempotentPairingDecisionResult =
  | { kind: "decided" | "replay"; request: PublicPairingRecord }
  | { kind: "idempotency_conflict" | "state_conflict" | "not_found" };

export function decidePairingRequestWithIdempotency(
  id: string,
  decision: "approved" | "denied",
  idempotencyKey: string,
  requestHash: string,
  now = Date.now(),
): IdempotentPairingDecisionResult {
  pruneExpired(now);
  pruneTombstones(now);
  const record = requests.get(id);
  const tombstone = tombstones.get(id);
  const liveReplay = record?.decisionReplay;
  if (liveReplay?.idempotencyKey === idempotencyKey) {
    if (liveReplay.requestHash !== requestHash) return { kind: "idempotency_conflict" };
    return { kind: "replay", request: clonePublicRecord(liveReplay.response) };
  }
  const tombstoneReplay = tombstone?.decisionReplay;
  if (tombstoneReplay?.idempotencyKey === idempotencyKey) {
    if (tombstoneReplay.requestHash !== requestHash) return { kind: "idempotency_conflict" };
    return { kind: "replay", request: clonePublicRecord(tombstoneReplay.response) };
  }
  if (!record || !isLive(record, now)) return { kind: "not_found" };
  if (record.status === "pending") {
    record.status = decision;
    const response = toPublic(record);
    record.decisionReplay = {
      idempotencyKey,
      requestHash,
      response: clonePublicRecord(response),
    };
    return { kind: "decided", request: response };
  }
  if (record.status === decision) {
    return { kind: "decided", request: toPublic(record) };
  }
  return { kind: "state_conflict" };
}

/**
 * Exclusively claim an approved request's secret for exchange, WITHOUT
 * tombstoning or deleting it. Returns the approved pairing data (safe to pass
 * straight to `issueCredential`) plus an opaque claim id — the caller must
 * follow up with exactly one of `finalizeApprovedPairingClaim` (on a
 * successful issuance) or `rollbackApprovedPairingClaim` (on a failure),
 * never neither and never both.
 *
 * At most one claim can ever be outstanding for a given record at a time:
 * once `record.claimId` is set, every other claim attempt — a genuine
 * concurrent racer or a byte-for-byte replay of this exact request, even one
 * presenting the correct secret — fails exactly like a wrong secret or an
 * unknown id (fail-closed, generic; the caller's own poll/exchange fallback
 * decides what to report). This is what makes the destructive-tombstone-first
 * design unnecessary: exclusivity is enforced by `claimId`, not by having
 * already deleted the record.
 */
export function claimApprovedPairing(
  id: string,
  secret: string,
  now = Date.now(),
): ApprovedPairingClaim | null {
  pruneExpired(now);
  const record = requests.get(id);
  const suppliedHash = hashSecret(secret);
  if (!record) {
    timingSafeEqualString(suppliedHash, DECOY_HASH);
    return null;
  }
  const secretOk = timingSafeEqualString(suppliedHash, record.secretHash);
  if (
    !secretOk ||
    !isLive(record, now) ||
    record.status !== "approved" ||
    record.claimId !== null
  ) {
    return null;
  }
  record.claimId = randomUUID();
  record.claimReplayKey = null;
  record.claimReplayRequestHash = null;
  return {
    claimId: record.claimId,
    pairing: {
      appName: record.appName,
      installationId: record.installationId,
      // Cloned for the same reason `toPublic` clones: the claimed pairing's
      // scopes must be an independent array so a caller mutating this
      // result (or, downstream, `issueCredential` storing it) can never
      // reach back into — or be reached by — any other array derived from
      // this record.
      scopes: [...record.scopes],
      status: "approved",
    },
  };
}

export function claimApprovedPairingWithIdempotency(
  id: string,
  secret: string,
  idempotencyKey: string,
  requestHash: string,
  now = Date.now(),
): IdempotentApprovedPairingClaimResult {
  pruneExpired(now);
  pruneTombstones(now);
  const record = requests.get(id);
  const suppliedHash = hashSecret(secret);
  if (!record) {
    const marker = tombstones.get(id);
    if (!marker || !timingSafeEqualString(suppliedHash, marker.secretHash)) {
      timingSafeEqualString(suppliedHash, marker?.secretHash ?? DECOY_HASH);
      return { kind: "unclaimable" };
    }
    if (marker.exchangeReplay?.idempotencyKey === idempotencyKey) {
      if (marker.exchangeReplay.requestHash !== requestHash) return { kind: "conflict" };
      return {
        kind: "replay",
        credential: cloneCredentialSnapshot(marker.exchangeReplay.credential),
      };
    }
    return { kind: "unclaimable" };
  }
  const secretOk = timingSafeEqualString(suppliedHash, record.secretHash);
  if (!secretOk || !isLive(record, now) || record.status !== "approved") {
    return { kind: "unclaimable" };
  }
  if (record.claimId !== null) {
    if (record.claimReplayKey === idempotencyKey) {
      if (record.claimReplayRequestHash !== requestHash) return { kind: "conflict" };
      return { kind: "pending", retryAfterMs: PAIRING_EXCHANGE_RETRY_AFTER_MS };
    }
    return { kind: "unclaimable" };
  }
  record.claimId = randomUUID();
  record.claimReplayKey = idempotencyKey;
  record.claimReplayRequestHash = requestHash;
  return {
    kind: "claimed",
    claimId: record.claimId,
    pairing: {
      appName: record.appName,
      installationId: record.installationId,
      scopes: cloneScopes(record.scopes),
      status: "approved",
    },
  };
}

/**
 * Finish a successful exchange: verifies `claimId` still matches the exact
 * claim this record is currently held by, then deletes + tombstones it — the
 * same terminal state `consumeApprovedPairing` always left a record in, just
 * reached only AFTER the caller's credential issuance has already succeeded.
 * A stale/foreign claim id (wrong claimant, already finalized/rolled back, or
 * the record is simply gone — e.g. pruned or capacity-evicted while claimed)
 * is a safe no-op: returns `false` without touching anything, since there is
 * nothing left here that this claim still owns.
 */
export function finalizeApprovedPairingClaim(
  id: string,
  claimId: string,
  now = Date.now(),
  options: { exchangeReplay?: PairingExchangeTerminalReplay | null } = {},
): boolean {
  const record = requests.get(id);
  if (!record || record.claimId !== claimId) return false;
  record.consumedAt = now;
  requests.delete(id);
  // Tombstoned the same way an expired record is, so a replay of this exact
  // exchange (or a poll after it) is reported as the same stable
  // "pairing_expired" a genuine TTL expiry gets — never the DECOY_HASH-style
  // generic response reserved for an unknown id or a wrong secret.
  tombstone(record, now, { exchangeReplay: options.exchangeReplay ?? null });
  return true;
}

/**
 * Undo a claim after a failed exchange (credential issuance threw), WITHOUT
 * ever risking a second active credential for the same approved pairing.
 *
 * A stale/foreign claim id — the record was already finalized, already
 * rolled back, or evicted/pruned out from under this claim entirely — is a
 * safe no-op: returns `false`, and nothing is touched.
 *
 * Otherwise: if the record is still within its ORIGINAL TTL (`isLive` uses
 * `expiresAt`, which a claim never extends or resets), the claim is released
 * and the request becomes claimable again — restoring exactly the same
 * "approved, awaiting exchange" availability a retry needs. If the TTL has
 * since passed while this claim was outstanding, the request is instead
 * finished the same way a normal expiry is: deleted and tombstoned, so the
 * holder of the correct secret still gets a stable `pairing_expired` rather
 * than an exchange that silently goes nowhere forever.
 */
export function rollbackApprovedPairingClaim(
  id: string,
  claimId: string,
  now = Date.now(),
): boolean {
  const record = requests.get(id);
  if (!record || record.claimId !== claimId) return false;
  if (isLive(record, now)) {
    record.claimId = null;
    record.claimReplayKey = null;
    record.claimReplayRequestHash = null;
    return true;
  }
  record.consumedAt = now;
  requests.delete(id);
  tombstone(record, now);
  return true;
}

/**
 * Legacy convenience wrapper: exchange an approved request's secret for the
 * approved pairing data in one immediate step (claim, then finalize
 * straight away), for callers that have no async work to perform in between
 * and therefore no use for the claim/finalize/rollback lifecycle directly.
 * Kept for existing direct callers/tests; the exchange ROUTE itself must
 * never use this — it needs the claim held open across `await
 * issueCredential(...)` so a store failure can roll back instead of having
 * already destructively consumed the approval.
 */
export function consumeApprovedPairing(
  id: string,
  secret: string,
  now = Date.now(),
): ApprovedPairing | null {
  const claim = claimApprovedPairing(id, secret, now);
  if (!claim) return null;
  finalizeApprovedPairingClaim(id, claim.claimId, now);
  return claim.pairing;
}

/**
 * Reports whether `id` is a genuinely real pairing request that has since
 * stopped being live (TTL expiry or a completed exchange) — but ONLY to a
 * caller who presents the exact secret it was issued at create time. An
 * unknown id or a wrong secret returns `false` here exactly like a normal
 * miss: this function exists so poll/exchange can return a stable
 * `pairing_expired` to someone who legitimately held a request through its
 * end, never so a caller without the secret can learn whether some id ever
 * existed.
 */
export function isPairingRequestExpired(id: string, secret: string, now = Date.now()): boolean {
  pruneExpired(now);
  pruneTombstones(now);
  const marker = tombstones.get(id);
  const suppliedHash = hashSecret(secret);
  if (!marker) {
    timingSafeEqualString(suppliedHash, DECOY_HASH);
    return false;
  }
  return timingSafeEqualString(suppliedHash, marker.secretHash);
}

/** Test seam: drop all outstanding pairing requests. */
export function resetPairingRequestsForTest(): void {
  requests.clear();
  tombstones.clear();
}
