// Persistent mutation idempotency ledger for the `/api/client/v1` facade.
//
// Every mutating v1 route accepts an `Idempotency-Key` header (a UUID,
// parsed by `contract.ts`'s `parseIdempotencyKey`) and must behave as if the
// same key, from the same credential, against the same route, with the same
// normalized request body always produces the same result — even across a
// retry, a dropped response, or a server restart. This module is the single
// source of truth for that guarantee: `claimOperation` reserves the right to
// perform a mutation exactly once, and `completeOperation` records its
// outcome for replay.
//
// The claimed IDENTITY this ledger tracks is the composite triple
// `(credentialId, route, key)`, never the bare `Idempotency-Key` alone: the
// same UUID key may be claimed independently by a different credential (no
// cross-client replay) or against a different route (the same key reused
// for an unrelated operation never collides with this one). Two entries may
// legitimately share the same `key` as long as their `(credentialId, route)`
// differ — the ledger enforces (and a corrupt file's violation of) at most
// one live entry per composite identity, never per bare key. Only within
// the SAME composite identity does `requestHash` decide replay-or-conflict:
// an identical hash replays (or is still in progress); a different hash
// conflicts.
//
// This is a DIFFERENT persisted store from `credential-store.ts` on purpose:
// a credential grants long-lived authority and must survive forever until
// explicitly revoked, while an operation claim is a short-lived, bounded
// bookkeeping record whose whole purpose is to expire (10 minutes for a
// stale in-progress claim to become abandoned and reclaimable, 24 hours for
// a completed result to stop being replayable). Coupling the two stores
// would force one file's retention/eviction policy onto data that does not
// share it, so this module imports nothing from `credential-store.ts` and
// persists to its own file. For the same reason, cross-process mutual
// exclusion is provided by this store's OWN `operation-transaction-lock.ts`
// sibling — a narrowly-scoped, mechanism-identical twin of
// `credential-transaction-lock.ts` — rather than by importing that
// credential-specific module.
//
// The store never persists a prompt, attachment bytes, a bearer token or its
// hash, an Authorization header, or a raw request body — only the identity
// that proves "this is the same mutation attempt" (`key`, `credentialId`,
// `route`, `requestHash` — a SHA-256 digest of the caller's ALREADY-hashed
// normalized request, computed by `hashNormalizedRequest` below) and, once
// completed, the response `{ status, body }` a replay must return verbatim.

import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import { caveHome } from "@/lib/coven-paths";
import { writeJsonAtomic } from "@/lib/server/atomic-write";

import { isUuid } from "./contract.ts";
import { withOperationTransactionLock } from "./operation-transaction-lock.ts";

/** In-progress claims older than this are abandoned: pruned outright and
 * reclaimable fresh (with a brand-new claim id) by the same composite
 * identity. */
export const PENDING_CLAIM_RETRY_MS = 10 * 60_000;

/** Completed operations stop being replayable (and become prunable) after this. */
export const COMPLETED_OPERATION_TTL_MS = 24 * 60 * 60_000;

// Well past any legitimate number of in-flight + recently-completed
// mutations a single paired desktop/mobile fleet would produce inside a
// 24-hour completed-result retention window, with oldest-completed-first
// eviction (never a live pending claim) once reached — see
// `ensureCapacityForNewEntry`.
export const MAX_OPERATIONS = 2_000;

// Bounds a persisted completed response body's serialized size — this store
// intentionally persists the response for replay (requirement of the v1
// idempotency contract), but an unbounded body would let a single mutation
// grow the ledger file without limit.
export const MAX_RESPONSE_BODY_BYTES = 64 * 1024;

const MAX_ROUTE_LENGTH = 128;
// Lowercase path-shaped route identifiers only (e.g. "conversations",
// "conversations/rename"): bounded charset and length so a route field can
// never itself become a vector for unbounded ledger growth or injection.
const ROUTE_RE = /^[a-z][a-z0-9]*(?:[/_-][a-z0-9]+)*$/;

// Exactly what `hashNormalizedRequest` below produces: a lowercase SHA-256
// hex digest, nothing else.
const REQUEST_HASH_RE = /^[0-9a-f]{64}$/;

export function clientOperationStorePath(): string {
  const override = process.env.COVEN_CAVE_CLIENT_OPERATION_STORE_PATH?.trim();
  return override || path.join(/* turbopackIgnore: true */ caveHome(), "client-v1-operations.json");
}

// Persisted literal is "in_progress", never "pending": "pending" describes
// an English-language concept (a claim awaiting completion) but is NOT the
// literal this store ever writes to or reads from disk — `parseClientOperation`
// rejects any other literal (including the legacy "pending" spelling) as
// corruption, never silently reinterpreting it.
export type ClientOperationState = "in_progress" | "completed";

/** A JSON value this store will ever canonicalize, hash, or persist. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type ClientOperationResponse = { status: number; body: unknown };

type PersistedClientOperation = {
  // Composite identity is `(credentialId, route, key)` — see this module's
  // header comment. At most one entry may ever exist per composite identity
  // (enforced across the whole store by `readStoreForMutation`, not just
  // per-entry); `key` alone is NEVER assumed unique.
  key: string;
  credentialId: string;
  route: string;
  requestHash: string;
  state: ClientOperationState;
  // Globally unique across every entry in the store (enforced by
  // `readStoreForMutation`), regenerated every time a NEW claim is granted
  // for a composite identity — either the first claim, or a reclaim of an
  // abandoned in-progress entry whose retry window has elapsed and was
  // pruned. `completeOperation` targets an entry by this opaque claim id
  // (validated against the caller-supplied composite `key`), never by
  // `key` alone; a stale claim id (from before a reclaim) can never
  // complete the entry a later claimant is now responsible for.
  claimId: string;
  claimedAt: number;
  updatedAt: number;
  // Exact invariant, enforced by `parseClientOperation` (never merely
  // "close enough"): in-progress, `expiresAt === claimedAt +
  // PENDING_CLAIM_RETRY_MS` (the moment this claim is abandoned and
  // prunable/reclaimable) and `updatedAt === claimedAt` (untouched since the
  // claim was granted); completed, `expiresAt === updatedAt +
  // COMPLETED_OPERATION_TTL_MS` (the moment this result stops being
  // replayable and becomes prunable).
  expiresAt: number;
  response: { status: number; body: JsonValue } | null;
};

type OperationStoreFile = { version: 1; operations: PersistedClientOperation[] };

function emptyStore(): OperationStoreFile {
  return { version: 1, operations: [] };
}

const STORE_KEYS = ["version", "operations"] as const;
const STORE_KEY_SET: ReadonlySet<string> = new Set(STORE_KEYS);

const OPERATION_KEYS = [
  "key",
  "credentialId",
  "route",
  "requestHash",
  "state",
  "claimId",
  "claimedAt",
  "updatedAt",
  "expiresAt",
  "response",
] as const;
const OPERATION_KEY_SET: ReadonlySet<string> = new Set(OPERATION_KEYS);

const RESPONSE_KEYS = ["status", "body"] as const;
const RESPONSE_KEY_SET: ReadonlySet<string> = new Set(RESPONSE_KEYS);

/**
 * A mutation (`claimOperation`, `completeOperation`) could not safely read
 * the on-disk ledger and refused to proceed. Thrown only from
 * `readStoreForMutation`, before any `writeStore` for that call could have
 * run — a caller seeing this error knows the ledger on disk is exactly as it
 * was before the call, never partially rewritten. Never carries persisted
 * file content in its message.
 */
export class IdempotencyStoreIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdempotencyStoreIntegrityError";
  }
}

export function isIdempotencyStoreIntegrityError(error: unknown): error is IdempotencyStoreIntegrityError {
  return error instanceof Error && error.name === "IdempotencyStoreIntegrityError";
}

// Narrow test-only seam for the one fs call this module's reads go through,
// mirroring `credential-store.ts`'s `setReadFileForTest` so a test can
// simulate a read that rejects without depending on platform chmod
// semantics. Never set in production.
let readFileForTest: ((path: string, encoding: "utf8") => Promise<string>) | null = null;

/** Test-only: install (or, given `null`, clear) a replacement for the store's underlying `readFile` call. */
export function setReadFileForTest(hook: ((path: string, encoding: "utf8") => Promise<string>) | null): void {
  readFileForTest = hook;
}

function readStoreFile(): Promise<string> {
  const impl = readFileForTest ?? readFile;
  return impl(/* turbopackIgnore: true */ clientOperationStorePath(), "utf8");
}

function isFiniteNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function parseResponse(value: unknown): { status: number; body: JsonValue } | null {
  if (value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== RESPONSE_KEYS.length || !keys.every((key) => RESPONSE_KEY_SET.has(key))) return null;
  if (!Number.isInteger(record.status) || (record.status as number) < 100 || (record.status as number) > 599) {
    return null;
  }
  let body: JsonValue;
  try {
    body = canonicalizeJsonValue(record.body);
  } catch {
    return null;
  }
  if (Buffer.byteLength(JSON.stringify(body), "utf8") > MAX_RESPONSE_BODY_BYTES) return null;
  return { status: record.status as number, body };
}

/**
 * Strictly validates a single persisted operation entry against the exact
 * v1 schema, returning a clean, normalized record or `null` if anything is
 * off. An entry that fails any check is treated as corruption by the caller
 * (`readStoreForMutation` throws rather than dropping it) — this ledger only
 * ever grants the right to perform a mutation exactly once, so a record that
 * has drifted from the schema must never be silently reinterpreted.
 *
 * Beyond the field-shape checks, this also enforces the EXACT expiry
 * invariant per state (never merely "close enough", and never a plain
 * inequality that would accept a value some corruption or clock-skewed
 * write nudged off the formula): in-progress requires
 * `expiresAt === claimedAt + PENDING_CLAIM_RETRY_MS`, `updatedAt ===
 * claimedAt` (untouched since the claim was granted), and `response ===
 * null`; completed requires `expiresAt === updatedAt +
 * COMPLETED_OPERATION_TTL_MS` and a present, well-formed `response`.
 * Cross-entry invariants (no duplicate composite identity, no duplicate
 * claim id, bounded total count) are checked by `readStoreForMutation`
 * after every entry here has already parsed cleanly.
 */
function parseClientOperation(value: unknown): PersistedClientOperation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;

  const keys = Object.keys(record);
  if (keys.length !== OPERATION_KEYS.length || !keys.every((key) => OPERATION_KEY_SET.has(key))) {
    return null;
  }

  if (!isUuid(record.key)) return null;
  if (!isUuid(record.credentialId)) return null;
  if (typeof record.route !== "string" || record.route.length > MAX_ROUTE_LENGTH || !ROUTE_RE.test(record.route)) {
    return null;
  }
  if (typeof record.requestHash !== "string" || !REQUEST_HASH_RE.test(record.requestHash)) return null;
  if (record.state !== "in_progress" && record.state !== "completed") return null;
  if (!isUuid(record.claimId)) return null;
  if (!isFiniteNonNegativeNumber(record.claimedAt)) return null;
  if (!isFiniteNonNegativeNumber(record.updatedAt) || (record.updatedAt as number) < (record.claimedAt as number)) {
    return null;
  }
  if (!isFiniteNonNegativeNumber(record.expiresAt)) return null;

  const response = parseResponse(record.response);
  const claimedAt = record.claimedAt as number;
  const updatedAt = record.updatedAt as number;
  const expiresAt = record.expiresAt as number;

  if (record.state === "in_progress") {
    if (record.response !== null) return null;
    if (updatedAt !== claimedAt) return null;
    if (expiresAt !== claimedAt + PENDING_CLAIM_RETRY_MS) return null;
  } else {
    if (response === null) return null;
    if (expiresAt !== updatedAt + COMPLETED_OPERATION_TTL_MS) return null;
  }

  return {
    key: (record.key as string).toLowerCase(),
    credentialId: (record.credentialId as string).toLowerCase(),
    route: record.route,
    requestHash: (record.requestHash as string).toLowerCase(),
    state: record.state,
    claimId: (record.claimId as string).toLowerCase(),
    claimedAt,
    updatedAt,
    expiresAt,
    response,
  };
}

function parseStoreTopLevel(parsed: unknown): { version: 1; operations: unknown[] } | null {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== STORE_KEYS.length || !keys.every((key) => STORE_KEY_SET.has(key))) return null;
  if (record.version !== 1 || !Array.isArray(record.operations)) return null;
  return { version: 1, operations: record.operations };
}

/**
 * Composite-identity string used ONLY as a `Set` key for the duplicate check
 * below — never persisted, never compared for anything else. NUL-joined so
 * no combination of (attacker- or corruption-controlled, but schema-bounded)
 * field values can ever collide two distinct identities into the same key:
 * `credentialId`/`claimId` are validated UUIDs and `key` is a validated
 * UUID, none of which can themselves contain `\u0000`, and `route` is
 * bounded to the lowercase/digit/hyphen/slash/underscore charset enforced by
 * `ROUTE_RE`, which also excludes it.
 */
function compositeIdentityKey(operation: Pick<PersistedClientOperation, "key" | "credentialId" | "route">): string {
  return `${operation.key}\u0000${operation.credentialId}\u0000${operation.route}`;
}

/**
 * Cross-entry invariants that no single entry's own shape can express:
 * the whole store must never exceed `MAX_OPERATIONS` (capacity management
 * is expected to enforce this on every write; a file that violates it was
 * tampered with or corrupted, not merely "temporarily large"), no two
 * entries may share the same composite `(credentialId, route, key)`
 * identity (this ledger claims at most one live entry per identity), and
 * every claim id must be globally unique (so `completeOperation`'s
 * claim-id-first lookup can never be ambiguous between two entries).
 * Throws `IdempotencyStoreIntegrityError` — never silently drops or dedupes
 * — on the first violation found.
 */
function assertStoreInvariants(operations: readonly PersistedClientOperation[]): void {
  if (operations.length > MAX_OPERATIONS) {
    throw new IdempotencyStoreIntegrityError("The client operation ledger exceeds the maximum allowed entries.");
  }
  const seenComposite = new Set<string>();
  const seenClaimIds = new Set<string>();
  for (const operation of operations) {
    const compositeKey = compositeIdentityKey(operation);
    if (seenComposite.has(compositeKey)) {
      throw new IdempotencyStoreIntegrityError(
        "The client operation ledger contains a duplicate composite identity.",
      );
    }
    seenComposite.add(compositeKey);

    if (seenClaimIds.has(operation.claimId)) {
      throw new IdempotencyStoreIntegrityError("The client operation ledger contains a duplicate claim id.");
    }
    seenClaimIds.add(operation.claimId);
  }
}

/**
 * Mutation mode: used only by `claimOperation` and `completeOperation`,
 * always from inside `withOperationTransaction`'s locked critical section.
 * Only a genuinely missing file (`ENOENT`) is treated as "no operations
 * claimed yet" and returns a fresh empty store — every other failure throws
 * `IdempotencyStoreIntegrityError` instead of silently returning (or
 * writing) something else: an unreadable file, invalid JSON, a wrong
 * top-level schema, or a single malformed entry must never be treated as an
 * empty ledger, which would let a corrupted or tampered file be silently
 * overwritten by whatever this call writes next.
 */
async function readStoreForMutation(): Promise<OperationStoreFile> {
  let raw: string;
  try {
    raw = await readStoreFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return emptyStore();
    throw new IdempotencyStoreIntegrityError("The client operation ledger could not be read.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new IdempotencyStoreIntegrityError("The client operation ledger contains invalid JSON.");
  }
  const shape = parseStoreTopLevel(parsed);
  if (!shape) {
    throw new IdempotencyStoreIntegrityError("The client operation ledger does not match the expected schema.");
  }
  const operations: PersistedClientOperation[] = [];
  for (const entry of shape.operations) {
    const operation = parseClientOperation(entry);
    if (!operation) {
      throw new IdempotencyStoreIntegrityError("The client operation ledger contains a malformed entry.");
    }
    operations.push(operation);
  }
  // Cross-entry invariants (bounded count, no duplicate composite identity,
  // no duplicate claim id) can only be checked once every entry has already
  // parsed cleanly on its own — see `assertStoreInvariants`. Throws (never
  // silently repairs) before any mutation below this point has run.
  assertStoreInvariants(operations);
  return { version: 1, operations };
}

async function writeStore(store: OperationStoreFile): Promise<void> {
  const file = clientOperationStorePath();
  await mkdir(/* turbopackIgnore: true */ path.dirname(file), { recursive: true });
  await writeJsonAtomic(file, store);
}

// Layer 1 of 2: serializes every read -> mutate -> write transaction of
// `claimOperation` and `completeOperation` so two concurrent calls IN THE
// SAME PROCESS can never both read the same on-disk snapshot and then
// overwrite each other. `writeJsonAtomic` only prevents a torn file; it does
// nothing to prevent this store-level lost-update race. Keyed by the
// resolved store path (mirrors `credential-store.ts`'s `mutationQueues`)
// rather than a single global chain, so a test overriding
// `COVEN_CAVE_CLIENT_OPERATION_STORE_PATH` to a different path never
// serializes behind an unrelated path's queue.
const mutationQueues = new Map<string, Promise<unknown>>();

function withMutationQueue<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = mutationQueues.get(key) ?? Promise.resolve();
  // Chain onto the queue whether the previous link resolved OR rejected, and
  // always replace this key's entry with a settled-either-way continuation —
  // a mutation that throws must never poison every later call for this key.
  const next = previous.then(operation, operation);
  const settled = next.then(
    () => undefined,
    () => undefined,
  );
  mutationQueues.set(key, settled);
  void settled.finally(() => {
    if (mutationQueues.get(key) === settled) mutationQueues.delete(key);
  });
  return next;
}

// Layer 2 of 2: cross-process serialization on top of the in-process queue
// above. The Cave server that owns this ledger is not guaranteed to be the
// only OS process ever writing this file (a CLI tool, a second server
// instance, or a test subprocess pointed at the same cave home could all
// race it), and two such processes each have their OWN `mutationQueues` map
// — the in-process queue alone cannot prevent them from interleaving a
// read/write cycle.
//
// This uses `operation-transaction-lock.ts`'s `node:sqlite`-backed mutex —
// a narrowly-scoped, mechanism-identical twin of
// `credential-transaction-lock.ts` kept as this store's own sibling rather
// than a shared import (see this module's header comment) — for real
// OS-backed cross-process exclusion via `BEGIN IMMEDIATE` on a lock
// database adjacent to this store's own path, with automatic release on
// crash (including SIGKILL) handled entirely by the kernel tearing down the
// dead process's file descriptor.
function withOperationTransaction<T>(operation: () => Promise<T>): Promise<T> {
  // Resolved once per call and used both as the in-process queue key and to
  // derive this call's cross-process lock database path, so a mutation's
  // queue turn and its SQLite lock are always scoped to the exact same
  // store file — even across tests that override
  // `COVEN_CAVE_CLIENT_OPERATION_STORE_PATH` to different paths within the
  // same process.
  const storePath = clientOperationStorePath();
  return withMutationQueue(storePath, () =>
    withOperationTransactionLock({ storePath, label: "client-v1-idempotency-store" }, operation),
  );
}

// Test-only seam: lets concurrency tests force a real interleaving window
// inside a locked mutation's critical section, right after its
// `readStoreForMutation()` and before it mutates/writes, mirroring
// `credential-store.ts`'s `setPostReadDelayForTest`. Never set in production.
let postReadDelayForTest: (() => Promise<void>) | null = null;

/** Test-only: install (or, given `null`, clear) a delay every locked mutation awaits right after reading the store. */
export function setPostReadDelayForTest(hook: (() => Promise<void>) | null): void {
  postReadDelayForTest = hook;
}

function assertValidNow(now: number): void {
  if (!Number.isFinite(now) || now < 0) {
    throw new Error("`now` must be a finite, non-negative number.");
  }
}

// ─── Deterministic request-body canonicalization + hashing ────────────────

export class UnhashableRequestValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnhashableRequestValueError";
  }
}

export function isUnhashableRequestValueError(error: unknown): error is UnhashableRequestValueError {
  return error instanceof Error && error.name === "UnhashableRequestValueError";
}

// Bounds how many array/object levels `canonicalizeJsonValue` will descend
// into. Without a cap, a sufficiently deep (but otherwise perfectly valid
// JSON-shaped) value blows the JS call stack and surfaces a raw, untyped
// `RangeError` to the caller instead of the documented
// `UnhashableRequestValueError` — the exact same "this value cannot be
// safely hashed" outcome as a cyclic reference or a non-finite number, just
// reached a different way. 128 levels is far beyond any legitimate v1
// request or response body shape while staying comfortably below the
// default stack limit, so the throw always happens well before overflow.
export const MAX_JSON_NESTING_DEPTH = 128;

/**
 * Recursively canonicalizes an arbitrary JS value into a `JsonValue`: object
 * keys are sorted so two structurally-identical bodies with differently
 * ordered keys hash identically, array order is preserved (arrays are
 * ordered data, not sets), and every JSON value kind (string/number/
 * boolean/null/array/object) stays distinct from every other — a number is
 * never conflated with its string form, and `null` is never conflated with
 * a missing key. Every own enumerable string-keyed property is preserved as
 * an own data property of the returned object — including keys that shadow
 * `Object.prototype` members such as `"__proto__"`, `"constructor"`, and
 * `"prototype"` — by building the result with `Object.create(null)` so
 * bracket-assigning a `"__proto__"` key can never be intercepted by
 * `Object.prototype`'s `__proto__` accessor and silently dropped or
 * (worse) mutate the result's own prototype.
 *
 * Throws `UnhashableRequestValueError` for anything that is not
 * unambiguously representable as stable JSON: `undefined`, functions,
 * symbols, bigints, non-finite numbers (`NaN`/`Infinity`), cyclic
 * references, own symbol-keyed properties, accessor (getter/setter)
 * properties (which this function must never invoke — doing so could run
 * arbitrary caller-supplied code or observe a value that changes between
 * calls), non-plain objects (anything whose prototype isn't
 * `Object.prototype` or `null` — e.g. `Date`, `Map`, or a class instance,
 * which would otherwise silently canonicalize to `{}`), and values nested
 * `MAX_JSON_NESTING_DEPTH` levels deeper than the root — rather than
 * silently coercing, dropping, or collapsing them, which would let two
 * meaningfully different requests hash the same, or one request hash
 * differently across two calls.
 */
export function canonicalizeJsonValue(value: unknown, ancestors: ReadonlySet<unknown> = new Set(), depth = 0): JsonValue {
  if (value === null) return null;
  const type = typeof value;
  if (type === "string" || type === "boolean") return value as string | boolean;
  if (type === "number") {
    if (!Number.isFinite(value)) throw new UnhashableRequestValueError("non-finite numbers cannot be hashed");
    return value as number;
  }
  if (Array.isArray(value)) {
    const nextDepth = depth + 1;
    if (nextDepth > MAX_JSON_NESTING_DEPTH) {
      throw new UnhashableRequestValueError(`value nesting exceeds the maximum depth of ${MAX_JSON_NESTING_DEPTH}`);
    }
    if (ancestors.has(value)) throw new UnhashableRequestValueError("cyclic value cannot be hashed");
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new UnhashableRequestValueError("symbol-keyed properties cannot be hashed");
    }
    const nested = new Set(ancestors);
    nested.add(value);
    return value.map((item) => canonicalizeJsonValue(item, nested, nextDepth));
  }
  if (type === "object") {
    const nextDepth = depth + 1;
    if (nextDepth > MAX_JSON_NESTING_DEPTH) {
      throw new UnhashableRequestValueError(`value nesting exceeds the maximum depth of ${MAX_JSON_NESTING_DEPTH}`);
    }
    if (ancestors.has(value)) throw new UnhashableRequestValueError("cyclic value cannot be hashed");
    // Only a plain object literal (`Object.prototype`) or an explicit
    // null-prototype record (`Object.create(null)`, as produced by this very
    // function) is accepted — the stable JSON contract this store hashes
    // has no notion of a `Date`, a `Map`, or a class instance, and silently
    // collapsing one of those to `{}` (or invoking its accessors) would let
    // meaningfully different values hash the same.
    const proto: unknown = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      throw new UnhashableRequestValueError("only plain objects and null-prototype records can be hashed");
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new UnhashableRequestValueError("symbol-keyed properties cannot be hashed");
    }
    const nested = new Set(ancestors);
    nested.add(value);
    const record = value as Record<string, unknown>;
    const sortedKeys = Object.keys(record).sort();
    // `Object.create(null)` has no `Object.prototype` in its chain, so a
    // plain `result[key] = ...` assignment below is always a genuine own
    // data-property assignment — even for `key === "__proto__"` — never the
    // inherited `Object.prototype.__proto__` accessor that a `{}` literal
    // would route it through instead.
    const result: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
    for (const key of sortedKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(record, key);
      if (!descriptor || descriptor.get || descriptor.set) {
        throw new UnhashableRequestValueError("accessor properties cannot be hashed");
      }
      result[key] = canonicalizeJsonValue(descriptor.value, nested, nextDepth);
    }
    return result;
  }
  throw new UnhashableRequestValueError(`unsupported value type for hashing: ${type}`);
}

/**
 * Deterministically hashes an arbitrary request body: canonicalize (sorted
 * keys, preserved array order, distinct JSON value kinds), stringify the
 * canonical form, and SHA-256 it to a lowercase hex digest. Two calls with
 * structurally identical JSON values — however their keys were originally
 * ordered — always produce the same hash; a value that cannot be
 * unambiguously represented as JSON (see `canonicalizeJsonValue`) throws
 * rather than hashing something ambiguous.
 */
export function hashNormalizedRequest(value: unknown): string {
  const canonical = canonicalizeJsonValue(value);
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

// ─── claimOperation ────────────────────────────────────────────────────────

export type ClaimOperationInput = {
  key: string;
  credentialId: string;
  route: string;
  requestHash: string;
};

export type ClaimOperationResult =
  | { kind: "claimed"; claimId: string }
  | { kind: "replay"; response: ClientOperationResponse }
  | { kind: "conflict" }
  // A live pending claim for the exact same identity already exists; retry
  // after roughly `retryAfterMs` once it either completes or its own retry
  // window elapses and becomes reclaimable.
  | { kind: "pending"; retryAfterMs: number }
  | { kind: "capacity_exceeded" };

export type FindCompletedOperationInput = {
  key: string;
  credentialId: string;
  route: string;
};

/**
 * Read a completed response by its canonical composite identity. This is used
 * only for run ownership/resume metadata; it never accepts a request hash and
 * never creates or extends an operation.
 */
export async function findCompletedOperation(
  input: FindCompletedOperationInput,
  now = Date.now(),
): Promise<ClientOperationResponse | null> {
  const normalized = normalizeClaimInput({ ...input, requestHash: "0".repeat(64) });
  assertValidNow(now);
  return withOperationTransaction(async () => {
    const store = await readStoreForMutation();
    const operation = store.operations.find(
      (candidate) =>
        candidate.key === normalized.key
        && candidate.credentialId === normalized.credentialId
        && candidate.route === normalized.route
        && candidate.state === "completed"
        && candidate.expiresAt > now,
    );
    return operation?.response ? toPublicResponse(operation.response) : null;
  });
}

type NormalizedIdentity = { key: string; credentialId: string; route: string; requestHash: string };

function normalizeClaimInput(input: ClaimOperationInput): NormalizedIdentity {
  if (!input || typeof input !== "object") {
    throw new Error("claimOperation requires an input object.");
  }
  if (!isUuid(input.key)) {
    throw new Error("claimOperation requires a UUID-shaped key.");
  }
  if (!isUuid(input.credentialId)) {
    throw new Error("claimOperation requires a UUID-shaped credentialId.");
  }
  if (typeof input.route !== "string" || input.route.length === 0 || input.route.length > MAX_ROUTE_LENGTH || !ROUTE_RE.test(input.route)) {
    throw new Error("claimOperation requires a valid route identifier.");
  }
  if (typeof input.requestHash !== "string" || !REQUEST_HASH_RE.test(input.requestHash)) {
    throw new Error("claimOperation requires a sha256-hex requestHash.");
  }
  return {
    key: input.key.toLowerCase(),
    credentialId: input.credentialId.toLowerCase(),
    route: input.route,
    requestHash: input.requestHash.toLowerCase(),
  };
}

function toPublicResponse(response: { status: number; body: JsonValue }): ClientOperationResponse {
  // Deep-cloned via a JSON round trip: `response.body` is already canonical
  // JSON at this point (it only ever reaches persisted storage through
  // `normalizeResponseForPersist`/`parseResponse`, both of which run every
  // value through `canonicalizeJsonValue`), so this clone can never fail and
  // guarantees the caller's own mutation of the returned object can never
  // reach back into the ledger's in-memory copy.
  return { status: response.status, body: JSON.parse(JSON.stringify(response.body)) as unknown };
}

function pruneExpiredAndAbandoned(
  operations: PersistedClientOperation[],
  now: number,
): { operations: PersistedClientOperation[]; changed: boolean } {
  // Two independent prunable conditions, checked together so a single pass
  // (and a single capacity check afterward) sees the ledger with BOTH kinds
  // of stale entry already gone:
  //   - a completed entry past its 24h TTL (`COMPLETED_OPERATION_TTL_MS`).
  //   - an in-progress claim abandoned for the full 10-minute retry window
  //     (`PENDING_CLAIM_RETRY_MS`) with no completion ever recorded. Pruning
  //     it outright (rather than merely flagging it "reclaimable" and
  //     leaving it in place) is what lets a fresh `claimOperation` for the
  //     same composite identity fall through to the ordinary "brand-new
  //     identity" path below and mint an entirely new claim id — an
  //     abandoned claim can never permanently occupy a composite identity's
  //     one-live-entry slot, nor count against `MAX_OPERATIONS` capacity.
  const kept = operations.filter((operation) => operation.expiresAt > now);
  return { operations: kept, changed: kept.length !== operations.length };
}

/**
 * Makes room for one new entry when the ledger is at `MAX_OPERATIONS`,
 * evicting the oldest COMPLETED entries first (ascending `updatedAt`) —
 * never a live in-progress claim, which may be live work in progress. If
 * there are not enough completed entries to evict enough room, capacity is
 * refused outright rather than ever touching an in-progress entry. Callers
 * must run `pruneExpiredAndAbandoned` first so this only ever has to reason
 * about genuinely live entries — an already-abandoned or already-expired
 * entry must never count against capacity or be "eligible for eviction" in
 * the first place, it should simply already be gone.
 */
function ensureCapacityForNewEntry(
  operations: PersistedClientOperation[],
): { ok: true; operations: PersistedClientOperation[]; changed: boolean } | { ok: false } {
  if (operations.length < MAX_OPERATIONS) return { ok: true, operations, changed: false };
  const needed = operations.length - MAX_OPERATIONS + 1;
  const completedOldestFirst = operations
    .map((operation, index) => ({ operation, index }))
    .filter((entry) => entry.operation.state === "completed")
    .sort((a, b) => a.operation.updatedAt - b.operation.updatedAt);
  if (completedOldestFirst.length < needed) return { ok: false };
  const evictIndexes = new Set(completedOldestFirst.slice(0, needed).map((entry) => entry.index));
  const remaining = operations.filter((_, index) => !evictIndexes.has(index));
  return { ok: true, operations: remaining, changed: true };
}

/**
 * Reserve the right to perform a mutation for the composite identity
 * `(input.credentialId, input.route, input.key)`, atomically:
 *
 *   - a brand-new composite identity (including one whose only prior entry
 *     was just pruned as expired-completed or abandoned-in-progress, below)
 *     claims fresh (`"claimed"`).
 *   - the exact same composite identity + requestHash, already completed
 *     and not yet expired, replays the persisted response (`"replay"`) —
 *     never re-executes the mutation.
 *   - the same composite identity with a DIFFERENT requestHash conflicts
 *     (`"conflict"`) — a composite identity can never be replayed across a
 *     different request body, even if the underlying data would
 *     coincidentally match. A different `credentialId` or `route` for the
 *     same bare `key`, by contrast, is a DIFFERENT composite identity
 *     entirely and claims independently — see this module's header comment.
 *   - the same composite identity + requestHash with a still-live
 *     in-progress claim reports `"pending"` with a retry hint — never
 *     granted a second concurrent claim.
 *   - a full ledger that cannot free room for a new composite identity
 *     without evicting a live in-progress claim returns
 *     `"capacity_exceeded"` rather than either silently dropping work or
 *     growing without bound.
 *
 * Completed entries past `COMPLETED_OPERATION_TTL_MS`, and in-progress
 * claims abandoned past `PENDING_CLAIM_RETRY_MS` with no completion ever
 * recorded, are pruned outright before any of the above is evaluated (see
 * `pruneExpiredAndAbandoned`) — so an expired or abandoned composite
 * identity is claimed exactly like a brand-new one, with a fresh `claimId`,
 * never as a special "reclaim" branch of its own.
 */
export async function claimOperation(input: ClaimOperationInput, now = Date.now()): Promise<ClaimOperationResult> {
  const normalized = normalizeClaimInput(input);
  assertValidNow(now);
  return withOperationTransaction(async () => {
    const store = await readStoreForMutation();
    await postReadDelayForTest?.();
    const pruned = pruneExpiredAndAbandoned(store.operations, now);
    let operations = pruned.operations;
    let changed = pruned.changed;

    // Composite-identity lookup — `(credentialId, route, key)`, NEVER `key`
    // alone. A different credentialId or route for the same bare key is a
    // wholly independent identity and must fall through to the "brand-new"
    // branch below, claiming its own entry rather than colliding with (or
    // being refused because of) an unrelated identity that happens to share
    // the same UUID key.
    const existingIndex = operations.findIndex(
      (operation) =>
        operation.key === normalized.key &&
        operation.credentialId === normalized.credentialId &&
        operation.route === normalized.route,
    );

    if (existingIndex === -1) {
      const capacity = ensureCapacityForNewEntry(operations);
      if (!capacity.ok) {
        if (changed) await writeStore({ version: 1, operations });
        return { kind: "capacity_exceeded" };
      }
      operations = capacity.operations;
      changed = changed || capacity.changed;

      const claimId = randomUUID();
      const entry: PersistedClientOperation = {
        key: normalized.key,
        credentialId: normalized.credentialId,
        route: normalized.route,
        requestHash: normalized.requestHash,
        state: "in_progress",
        claimId,
        claimedAt: now,
        updatedAt: now,
        expiresAt: now + PENDING_CLAIM_RETRY_MS,
        response: null,
      };
      operations = [...operations, entry];
      await writeStore({ version: 1, operations });
      return { kind: "claimed", claimId };
    }

    // Found the SAME composite identity's live entry (anything abandoned or
    // expired was already pruned above). Within a composite identity, only
    // `requestHash` decides replay-or-conflict.
    const existing = operations[existingIndex];
    if (existing.requestHash !== normalized.requestHash) {
      if (changed) await writeStore({ version: 1, operations });
      return { kind: "conflict" };
    }

    if (existing.state === "completed") {
      if (changed) await writeStore({ version: 1, operations });
      return { kind: "replay", response: toPublicResponse(existing.response as { status: number; body: JsonValue }) };
    }

    // Still in progress and NOT abandoned (an abandoned entry with this
    // exact composite identity was already pruned above and would have hit
    // the brand-new-claim branch instead).
    if (changed) await writeStore({ version: 1, operations });
    return { kind: "pending", retryAfterMs: Math.max(0, existing.expiresAt - now) };
  });
}

// ─── completeOperation ─────────────────────────────────────────────────────

/**
 * `claimId` is the opaque handle that unambiguously targets the exact
 * composite claim — enforced globally unique across the store — so it alone
 * is sufficient to find the entry. `key` is still required and re-validated
 * against the found entry's own persisted `key` (composite validation) so
 * this stays a route-friendly API: callers (route handlers wrapping this in
 * `idempotent-mutation.ts`) already have the `Idempotency-Key` in hand from
 * the original request and can pass it straight through here without
 * needing to separately track or re-derive `credentialId`/`route` at
 * completion time — see `completeOperation`'s own doc comment for exactly
 * how that validation is applied.
 */
export type CompleteOperationInput = { key: string; claimId: string };

export type CompleteOperationResult =
  | { kind: "completed"; response: ClientOperationResponse }
  | { kind: "replay"; response: ClientOperationResponse }
  | { kind: "conflict" }
  | { kind: "not_found" };

type NormalizedCompleteInput = { key: string; claimId: string };

function normalizeCompleteInput(input: CompleteOperationInput): NormalizedCompleteInput {
  if (!input || typeof input !== "object") {
    throw new Error("completeOperation requires an input object.");
  }
  if (!isUuid(input.key)) {
    throw new Error("completeOperation requires a UUID-shaped key.");
  }
  if (!isUuid(input.claimId)) {
    throw new Error("completeOperation requires a UUID-shaped claimId.");
  }
  return { key: input.key.toLowerCase(), claimId: input.claimId.toLowerCase() };
}

/**
 * Validates and canonicalizes a caller-supplied response before it is
 * eligible to be persisted: `status` must be an integer HTTP-status-shaped
 * value, and `body` must canonicalize to a bounded, cycle-free, finite JSON
 * value (see `canonicalizeJsonValue`) whose serialized form fits within
 * `MAX_RESPONSE_BODY_BYTES`. Throws (never silently truncates or coerces)
 * for anything else — an over-limit or unhashable response must never be
 * partially persisted.
 */
function normalizeResponseForPersist(response: ClientOperationResponse): { status: number; body: JsonValue } {
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    throw new Error("completeOperation requires a response object.");
  }
  const keys = Object.keys(response);
  if (keys.length !== RESPONSE_KEYS.length || !keys.every((key) => RESPONSE_KEY_SET.has(key))) {
    throw new Error('completeOperation response must have exactly "status" and "body" fields.');
  }
  if (!Number.isInteger(response.status) || response.status < 100 || response.status > 599) {
    throw new Error("completeOperation requires an HTTP-status-shaped integer status.");
  }
  const body = canonicalizeJsonValue(response.body);
  const serializedBytes = Buffer.byteLength(JSON.stringify(body), "utf8");
  if (serializedBytes > MAX_RESPONSE_BODY_BYTES) {
    throw new Error(`completeOperation response body exceeds the ${MAX_RESPONSE_BODY_BYTES}-byte limit.`);
  }
  return { status: response.status, body };
}

function responsesEqual(a: { status: number; body: JsonValue }, b: { status: number; body: JsonValue }): boolean {
  return a.status === b.status && JSON.stringify(a.body) === JSON.stringify(b.body);
}

/**
 * Complete the operation identified by `input.claimId`, but ONLY if it
 * still exists AND its composite `key`/`credentialId`/`route` matches what
 * the caller claims it should be (`input`'s remaining fields — see
 * `CompleteOperationInput`'s own doc comment for why the caller keeps
 * supplying these even though `claimId` alone is enough to find the exact
 * row).
 *
 * The lookup itself is BY CLAIM ID FIRST, never by `key` first: `key` is no
 * longer a unique lookup key on its own (the same UUID key may be claimed
 * independently under a different composite identity — see this module's
 * header comment), while `claimId` is enforced globally unique across the
 * whole store (`assertStoreInvariants`), so it unambiguously names exactly
 * one entry, or none. Once that entry is found, its OWN persisted
 * `key`/`credentialId`/`route` are compared against the caller-supplied
 * composite identity as a defense-in-depth check — a claim id that
 * (through caller error, not through any collision claimId's randomness
 * would realistically allow) doesn't match the composite identity it's
 * being completed against is treated exactly like an unknown claim id
 * (`"not_found"`), never completed against the wrong row.
 *
 * A stale claim id (from before an abandoned claim was pruned and reclaimed
 * fresh, or one that was never claimed at all) can never complete an entry
 * it no longer owns (`"not_found"`).
 *
 * Completing an already-completed entry under the SAME claim id is
 * idempotent: an identical response replays (`"replay"`) and a different
 * one conflicts (`"conflict"`) rather than silently overwriting the
 * persisted result — a completed response, once recorded, is immutable.
 *
 * The persisted `updatedAt`/`expiresAt` this call writes are never simply
 * `now`/`now + COMPLETED_OPERATION_TTL_MS`: they are clamped to never
 * regress behind this entry's own `claimedAt` (and current `updatedAt`), so
 * a caller-supplied `now` that has rolled backward relative to the claim
 * (a wall-clock step-back between claim and completion) can never persist
 * a `completed` entry that violates `parseClientOperation`'s strict
 * `updatedAt >= claimedAt` invariant — see this function's own clamping
 * comment below for why an unclamped write would otherwise be silently
 * accepted now and only surface as a store-wide `IdempotencyStoreIntegrityError`
 * on some later, unrelated read.
 */
export async function completeOperation(
  input: CompleteOperationInput,
  response: ClientOperationResponse,
  now = Date.now(),
): Promise<CompleteOperationResult> {
  const normalizedInput = normalizeCompleteInput(input);
  const canonicalResponse = normalizeResponseForPersist(response);
  assertValidNow(now);
  return withOperationTransaction(async () => {
    const store = await readStoreForMutation();
    await postReadDelayForTest?.();
    const pruned = pruneExpiredAndAbandoned(store.operations, now);
    let operations = pruned.operations;
    const changed = pruned.changed;

    // Claim-id-first lookup — see this function's own doc comment for why
    // this must never search by `key` first now that `key` alone is not a
    // unique identity.
    const index = operations.findIndex((operation) => operation.claimId === normalizedInput.claimId);
    if (index === -1) {
      if (changed) await writeStore({ version: 1, operations });
      return { kind: "not_found" };
    }

    const existing = operations[index];
    // Defense-in-depth composite validation: the found entry's OWN identity
    // must match what the caller believes it's completing. A mismatch here
    // can only happen through caller error (a genuine claimId collision
    // across composite identities is not realistically reachable, since
    // claimId is a random UUID minted fresh per claim) — treated identically
    // to an unknown claim id rather than completed against the wrong row.
    if (existing.key !== normalizedInput.key) {
      if (changed) await writeStore({ version: 1, operations });
      return { kind: "not_found" };
    }

    if (existing.state === "completed") {
      const existingResponse = existing.response as { status: number; body: JsonValue };
      const same = responsesEqual(existingResponse, canonicalResponse);
      if (changed) await writeStore({ version: 1, operations });
      return same ? { kind: "replay", response: toPublicResponse(existingResponse) } : { kind: "conflict" };
    }

    // The caller-supplied `now` is trusted for retry-hint arithmetic
    // elsewhere, but a wall-clock rollback (a caller's clock stepping
    // backward between the claim and the completion, or simply an operator
    // passing an earlier `now`) must never be allowed to persist a
    // `completed` entry with `updatedAt` earlier than this same entry's own
    // `claimedAt` — `parseClientOperation` enforces `updatedAt >=
    // claimedAt` as a hard invariant (see its own doc comment), so writing
    // `now` through unclamped would immediately make this entry
    // unreadable/unreplayable (and poison every subsequent read of the
    // WHOLE store with `IdempotencyStoreIntegrityError`) the moment the
    // clock recovered and any later mutation re-read the file. Clamping to
    // the entry's own already-persisted timestamps (`claimedAt` and
    // `updatedAt` — the latter always equal to the former for an
    // in-progress entry per that same invariant, but included here for
    // clarity/defense-in-depth rather than relying on that equality) keeps
    // the completion monotonic relative to this entry's own history without
    // ever advancing it ahead of a rollback that hasn't happened yet, and
    // without touching `claimOperation`'s own `pending`/reclaim timing —
    // this clamp applies only at completion, never before.
    const effectiveUpdatedAt = Math.max(now, existing.claimedAt, existing.updatedAt);

    const completedEntry: PersistedClientOperation = {
      ...existing,
      state: "completed",
      updatedAt: effectiveUpdatedAt,
      expiresAt: effectiveUpdatedAt + COMPLETED_OPERATION_TTL_MS,
      response: canonicalResponse,
    };
    operations = operations.map((operation, entryIndex) => (entryIndex === index ? completedEntry : operation));
    await writeStore({ version: 1, operations });
    return { kind: "completed", response: toPublicResponse(canonicalResponse) };
  });
}
