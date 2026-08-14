// Long-lived credential store for the `/api/client/v1` facade.
//
// A credential is the trust anchor a paired client presents on every request
// after pairing completes. Only the SHA-256 hash of the bearer token is ever
// persisted — the raw token exists exactly once, in the HTTP response that
// issues it, and cannot be recovered from disk or from a leaked backup. This
// mirrors the persisted half of passkey-store.ts, but for an opaque bearer
// token instead of a WebAuthn public key.

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import { caveHome } from "@/lib/coven-paths";
import { writeJsonAtomic } from "@/lib/server/atomic-write";
import { timingSafeEqualString } from "@/proxy-helpers";

import { CLIENT_V1_SCOPES, isUuid } from "./contract.ts";
import type { ClientV1Scope } from "./contract.ts";
import { withCredentialTransactionLock } from "./credential-transaction-lock.ts";
import type { ApprovedPairing } from "./pairing-store.ts";

export type ClientCredential = {
  id: string;
  appName: string;
  installationId: string;
  tokenHash: string;
  scopes: ApprovedPairing["scopes"];
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
};

/** Everything about a credential except the value that grants authority. */
export type SafeClientCredential = Omit<ClientCredential, "tokenHash">;

type StoreFile = { version: 1; credentials: ClientCredential[] };

// A credential that has just been reissued for the same installation should
// not still be usable via its old token; a real client's re-pair replaces
// rather than accumulates active tokens.
const REVOKE_ON_REPAIR = true;

// Throttle how often a "used at" timestamp is persisted: a chatty client would
// otherwise cause a disk write on every single request.
const LAST_USED_WRITE_THRESHOLD_MS = 60_000;

export function clientCredentialStorePath(): string {
  const override = process.env.COVEN_CAVE_CLIENT_CREDENTIAL_STORE_PATH?.trim();
  return override || path.join(/* turbopackIgnore: true */ caveHome(), "client-v1-credentials.json");
}

function emptyStore(): StoreFile {
  return { version: 1, credentials: [] };
}

// The exact own-key set the v1 schema allows on the top-level store file.
// A file with any missing, extra, or renamed top-level key is rejected
// wholesale — this store only ever GRANTS authority, so a store that has
// drifted from the schema (e.g. an extra key from a future format or a
// tampered file) must fail closed rather than partially parse.
const STORE_KEYS = ["version", "credentials"] as const;
const STORE_KEY_SET: ReadonlySet<string> = new Set(STORE_KEYS);

// The exact own-key set the v1 schema allows on a persisted credential.
// An entry with any missing, extra, or renamed key is rejected outright
// rather than tolerated — this store only ever GRANTS authority, so a
// once-valid-looking record that has been tampered with or drifted from the
// schema must not silently pass through with unexpected keys attached.
const CREDENTIAL_KEYS = [
  "id",
  "appName",
  "installationId",
  "tokenHash",
  "scopes",
  "createdAt",
  "lastUsedAt",
  "revokedAt",
] as const;
const CREDENTIAL_KEY_SET: ReadonlySet<string> = new Set(CREDENTIAL_KEYS);

const TOKEN_HASH_RE = /^[0-9a-f]{64}$/i;

const CLIENT_V1_SCOPE_SET: ReadonlySet<string> = new Set(CLIENT_V1_SCOPES);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isFiniteNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isNullOrFiniteNonNegativeNumber(value: unknown): value is number | null {
  return value === null || isFiniteNonNegativeNumber(value);
}

/**
 * Validates and normalizes a persisted `scopes` array: every element must be
 * a known `CLIENT_V1_SCOPES` string and the array must be non-empty. A
 * duplicate scope is rejected rather than silently deduplicated — a
 * persisted record should already be exactly what was issued, so a
 * duplicate is treated as a sign of tampering or corruption, not something
 * to paper over.
 */
function parseScopes(value: unknown): ClientV1Scope[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const seen = new Set<string>();
  const scopes: ClientV1Scope[] = [];
  for (const scope of value) {
    if (typeof scope !== "string" || !CLIENT_V1_SCOPE_SET.has(scope)) return null;
    if (seen.has(scope)) return null;
    seen.add(scope);
    scopes.push(scope as ClientV1Scope);
  }
  return scopes;
}

/**
 * Strictly validates a single persisted credential entry against the exact
 * v1 schema, returning a clean, normalized record or `null` if anything is
 * off. Nothing here tolerates extra keys, malformed hashes/scopes, or
 * timestamps that precede `createdAt` — an entry that fails any check is
 * dropped rather than passed through, so a corrupt or tampered file can
 * only ever shrink the set of usable credentials, never smuggle one in.
 */
function parseClientCredential(value: unknown): ClientCredential | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;

  const keys = Object.keys(record);
  if (keys.length !== CREDENTIAL_KEYS.length) return null;
  if (!keys.every((key) => CREDENTIAL_KEY_SET.has(key))) return null;

  if (!isUuid(record.id)) return null;
  if (!isNonEmptyString(record.appName)) return null;
  if (!isUuid(record.installationId)) return null;
  if (typeof record.tokenHash !== "string" || !TOKEN_HASH_RE.test(record.tokenHash)) return null;

  const scopes = parseScopes(record.scopes);
  if (!scopes) return null;

  if (!isFiniteNonNegativeNumber(record.createdAt)) return null;
  const createdAt = record.createdAt;

  if (!isNullOrFiniteNonNegativeNumber(record.lastUsedAt)) return null;
  if (record.lastUsedAt !== null && record.lastUsedAt < createdAt) return null;

  if (!isNullOrFiniteNonNegativeNumber(record.revokedAt)) return null;
  if (record.revokedAt !== null && record.revokedAt < createdAt) return null;

  return {
    id: record.id,
    appName: record.appName,
    // Normalized to lowercase so an installation id written in mixed case
    // (e.g. by an external tool, or from before this normalization existed)
    // still compares as the SAME installation as one this module issues —
    // `issueCredential` always stores the canonical lowercase form.
    installationId: record.installationId.toLowerCase(),
    // Normalized to lowercase so an otherwise-valid uppercase hex hash from
    // an external write still compares consistently against hashes this
    // module always produces via `.digest("hex")` (which is lowercase).
    tokenHash: record.tokenHash.toLowerCase(),
    scopes,
    createdAt,
    lastUsedAt: record.lastUsedAt,
    revokedAt: record.revokedAt,
  };
}

/**
 * A mutation (`issueCredential`, `recordCredentialUse`, `revokeCredential`)
 * could not safely read the on-disk store and refused to proceed. Thrown
 * only from `readStoreForMutation`, and only ever from inside
 * `withCredentialTransaction`'s locked critical section, i.e. before any
 * `writeStore` for that call could have run — a caller seeing this error
 * knows the store on disk is exactly as it was before the call, never
 * partially rewritten or overwritten with a fresh-but-wrong copy. Never
 * carries the raw token, a token hash, or any persisted file content in its
 * message.
 */
export class CredentialStoreIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialStoreIntegrityError";
  }
}

export function isCredentialStoreIntegrityError(
  error: unknown,
): error is CredentialStoreIntegrityError {
  return error instanceof Error && error.name === "CredentialStoreIntegrityError";
}

// Narrow test-only seam for the one fs call this module's reads go through,
// so a test can simulate a read that rejects (e.g. EACCES) or hangs without
// depending on platform chmod semantics that differ across
// macOS/Linux/Windows, or on whether the test happens to run as root (where
// chmod-based permission denial doesn't apply at all). Never set in
// production; production code never calls the setter, so this is a no-op
// there.
let readFileForTest: ((path: string, encoding: "utf8") => Promise<string>) | null = null;

/** Test-only: install (or, given `null`, clear) a replacement for the
 * store's underlying `readFile` call. */
export function setReadFileForTest(
  hook: ((path: string, encoding: "utf8") => Promise<string>) | null,
): void {
  readFileForTest = hook;
}

function readStoreFile(): Promise<string> {
  const impl = readFileForTest ?? readFile;
  return impl(/* turbopackIgnore: true */ clientCredentialStorePath(), "utf8");
}

/**
 * Validates the top-level shape only (not the individual credential
 * entries): exactly the v1 schema's own-key set, `version: 1`, and an array
 * `credentials`. Returns `null` for anything else — a non-object, an array,
 * an extra/missing top-level key, a missing/wrong version, or a non-array
 * `credentials`.
 */
function parseStoreTopLevel(parsed: unknown): { version: 1; credentials: unknown[] } | null {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== STORE_KEYS.length || !keys.every((key) => STORE_KEY_SET.has(key))) {
    return null;
  }
  if (record.version !== 1 || !Array.isArray(record.credentials)) return null;
  return { version: 1, credentials: record.credentials };
}

/**
 * Read-only mode: used by `verifyCredential` and `listCredentials` only.
 * A genuinely missing file, an unreadable file, invalid JSON, a wrong
 * top-level schema, and any individual malformed credential entry all
 * collapse to the empty store (or, for entries, are dropped from it) rather
 * than throwing — this store only ever GRANTS authority, so a caller that
 * can't fully trust what it read must fail closed, never surface a
 * "success"-shaped answer built from a partially-broken file. Never call
 * this from a mutation: it can silently narrow the credential set exactly
 * because it favors availability over precision, which is safe for read-only
 * callers but not for a caller about to overwrite the file.
 */
async function readStore(): Promise<StoreFile> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readStoreFile());
  } catch {
    return emptyStore();
  }
  const shape = parseStoreTopLevel(parsed);
  if (!shape) return emptyStore();
  const credentials = shape.credentials
    .map(parseClientCredential)
    .filter((credential): credential is ClientCredential => credential !== null);
  return { version: 1, credentials };
}

/**
 * Mutation mode: used only by `issueCredential`, `recordCredentialUse`, and
 * `revokeCredential`, always from inside `withCredentialTransaction`'s locked
 * critical section. Only a genuinely missing file (`ENOENT`) is treated as
 * "no credentials issued yet" and returns a fresh empty store — every other
 * failure throws `CredentialStoreIntegrityError` instead of silently
 * returning (or writing) something else:
 *
 *   - an unreadable file (e.g. `EACCES`, or any other read failure that
 *     isn't "the file doesn't exist") never becomes an empty store, because
 *     `issueCredential` would then happily write a brand-new store over
 *     whatever (possibly non-empty) file it couldn't actually read;
 *   - invalid JSON or a wrong top-level schema never becomes an empty store,
 *     for the same reason;
 *   - a single malformed persisted credential entry never gets silently
 *     filtered out, because `revokeCredential`/`recordCredentialUse` would
 *     then falsely report "not found" for a credential that genuinely
 *     exists on disk but merely failed to parse this one time, and a
 *     subsequent `issueCredential` would persist a store missing it.
 *
 * Every one of these throws before any `writeStore` call for this
 * invocation, so the on-disk file is left exactly as it was.
 */
async function readStoreForMutation(): Promise<StoreFile> {
  let raw: string;
  try {
    raw = await readStoreFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return emptyStore();
    throw new CredentialStoreIntegrityError(
      "The client credential store could not be read.",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CredentialStoreIntegrityError(
      "The client credential store contains invalid JSON.",
    );
  }
  const shape = parseStoreTopLevel(parsed);
  if (!shape) {
    throw new CredentialStoreIntegrityError(
      "The client credential store does not match the expected schema.",
    );
  }
  const credentials: ClientCredential[] = [];
  for (const entry of shape.credentials) {
    const credential = parseClientCredential(entry);
    if (!credential) {
      throw new CredentialStoreIntegrityError(
        "The client credential store contains a malformed credential entry.",
      );
    }
    credentials.push(credential);
  }
  return { version: 1, credentials };
}

async function writeStore(store: StoreFile): Promise<void> {
  const file = clientCredentialStorePath();
  await mkdir(/* turbopackIgnore: true */ path.dirname(file), { recursive: true });
  await writeJsonAtomic(file, store);
}

// Layer 1 of 2: serializes the entire read -> mutate -> write transaction of
// every mutating export (`issueCredential`, `recordCredentialUse`,
// `revokeCredential`) so two concurrent calls IN THE SAME PROCESS can never
// both read the same on-disk snapshot and then overwrite each other.
// `writeJsonAtomic` only prevents a TORN file (a reader observing a
// half-written one); it does nothing to prevent this store-level lost-update
// race — that's what this queue is for. Read-only `listCredentials` and
// `verifyCredential` intentionally stay outside the queue: they never
// mutate, so they have nothing to lose a race over, and serializing them
// too would only add needless latency.
//
// Keyed by the resolved store path (mirrors `x-sources.ts`'s
// `withMutationMutex`) rather than a single global chain: `COVEN_CAVE_CLIENT_CREDENTIAL_STORE_PATH`
// is normally fixed for a process's lifetime, but a test worker importing this
// module once and then pointing different tests at different override paths
// must not have one test's queue turn serialize behind an unrelated path's.
//
// This queue alone is NOT sufficient on its own: it says nothing about a
// SECOND OS process (e.g. two Cave server instances, or a CLI tool and a
// server, pointed at the same cave home) racing the same file. See
// `withCredentialTransaction` below, which layers a crash-safe cross-process
// `node:sqlite` mutex (`withCredentialTransactionLock`) on top of this queue
// for that cross-process case.
const mutationQueues = new Map<string, Promise<unknown>>();

function withMutationQueue<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = mutationQueues.get(key) ?? Promise.resolve();
  // Chain onto the queue whether the previous link resolved OR rejected
  // (`.then(operation, operation)`), and likewise always replace this key's
  // entry with a settled-either-way continuation. A mutation that throws
  // (e.g. an fs error) must not leave a rejected promise sitting in
  // `mutationQueues` — that would poison every later call for this key,
  // which would then "inherit" this call's rejection instead of getting its
  // own chance to run. `next` (returned to the caller) still resolves/rejects
  // on THIS call's own outcome, so callers keep seeing accurate return
  // values/throws.
  const next = previous.then(operation, operation);
  const settled = next.then(
    () => undefined,
    () => undefined,
  );
  mutationQueues.set(key, settled);
  // Once this call's turn has fully settled, drop the key so the map cannot
  // grow unboundedly across many distinct override paths (e.g. many test
  // workers over a long-running process) — but only if nothing has queued
  // behind it in the meantime (`settled` is still the latest tail for `key`).
  void settled.finally(() => {
    if (mutationQueues.get(key) === settled) mutationQueues.delete(key);
  });
  return next;
}

// Test-only seam: lets concurrency tests force a real interleaving window
// inside a locked mutation's critical section, right after its `readStore()`
// and before it mutates/writes, so a test can prove the queue above
// serializes calls deterministically instead of hoping flaky scheduling
// happens to reproduce a lost update. Never set in production; production
// code never calls the setter, so this is a no-op there.
let postReadDelayForTest: (() => Promise<void>) | null = null;

/** Test-only: install (or, given `null`, clear) a delay every locked
 * mutation awaits right after reading the store and before mutating it. */
export function setPostReadDelayForTest(hook: (() => Promise<void>) | null): void {
  postReadDelayForTest = hook;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Guards every public mutation's `now` parameter before the transaction is
 * even entered: a caller-supplied `now` that is non-finite (`NaN`,
 * `Infinity`) or negative can never produce a valid persisted timestamp
 * (`parseClientCredential` requires finite, non-negative numbers), so it
 * must be rejected outright rather than silently clamped or allowed to
 * poison a freshly written record. Thrown before any `readStoreForMutation`
 * call, so a rejected call never even acquires the transaction lock, let
 * alone writes anything.
 */
function assertValidNow(now: number): void {
  if (!Number.isFinite(now) || now < 0) {
    throw new Error("`now` must be a finite, non-negative number.");
  }
}

/**
 * The latest monotonic timestamp a mutation may persist for a credential
 * given a caller-supplied `now` that could be stale (captured before a
 * transaction wait) or even explicitly earlier than the credential's own
 * history: never earlier than `now` itself, never earlier than the
 * credential's `createdAt`, and never earlier than its most recent
 * previously-persisted timestamp (`lastUsedAt`, falling back to
 * `createdAt` when there isn't one yet). This is the single clamp shared by
 * `recordCredentialUse`'s throttle candidate, `revokeCredential`'s
 * `revokedAt`, and re-pairing's prior-credential `revokedAt` in
 * `issueCredential` — every one of them must move a credential's
 * chronology strictly forward, never backward, regardless of clock skew or
 * an explicitly inverted `now`.
 */
function monotonicTimestamp(now: number, createdAt: number, lastPersisted: number | null): number {
  return Math.max(now, createdAt, lastPersisted ?? createdAt);
}

// Layer 2 of 2: cross-process serialization on top of the in-process queue
// above. Two OS processes sharing the same store file (two Cave server
// instances, or a CLI tool and a server, pointed at the same cave home) each
// have their OWN `mutationQueue`, so the in-process queue alone cannot
// prevent them from interleaving a read/write cycle.
//
// This uses `credential-transaction-lock.ts`'s `node:sqlite`-backed mutex
// rather than a bespoke fixed-lock-file protocol of this store's own (the
// module this replaced, `credential-file-lock.ts`, had an unavoidable
// check/rename race in its stale-owner reclaim path and could be poisoned
// by a failed acquire/release). `BEGIN IMMEDIATE` on a lock database
// adjacent to this store's own path gives real OS-backed cross-process
// exclusion, with automatic release on crash (including SIGKILL) handled
// entirely by the kernel tearing down the dead process's file descriptor —
// see that module's own top-of-file comment for the full rationale.
/**
 * The single transaction boundary every credential mutation runs inside:
 * acquire the in-process queue turn, then the cross-process SQLite lock
 * adjacent to this store's path, then run `operation` (which must do its
 * own `readStore()` -> mutate -> `writeStore()` inside this callback so the
 * read happens only after both are held). The lock is released by
 * `withCredentialTransactionLock` itself once `operation` settles, whether
 * it resolves or rejects — this function never has to manage that release.
 * Never call this from `listCredentials`/`verifyCredential`: those are
 * read-only and must not pay for a lock they don't need to correctly answer.
 */
function withCredentialTransaction<T>(operation: () => Promise<T>): Promise<T> {
  // Resolved once per call and used both as the in-process queue key and to
  // derive this call's cross-process lock database path, so a mutation's
  // queue turn and its SQLite lock are always scoped to the exact same
  // store file — even across tests that override
  // `COVEN_CAVE_CLIENT_CREDENTIAL_STORE_PATH` to different paths within the
  // same process.
  const storePath = clientCredentialStorePath();
  return withMutationQueue(storePath, () =>
    withCredentialTransactionLock({ storePath, label: "client-v1-credential-store" }, operation),
  );
}

// Built as an explicit key-by-key projection rather than an object-rest
// spread, so a `SafeClientCredential` can never carry an extra key even if
// some future code path ever constructed a `ClientCredential` with one.
function toSafe(credential: ClientCredential): SafeClientCredential {
  return {
    id: credential.id,
    appName: credential.appName,
    installationId: credential.installationId,
    // Cloned so the caller's array can never alias — and therefore never
    // mutate — the internal record's authorization scopes. Every reader of
    // a `SafeClientCredential` (issue, list, verify's match, and any future
    // caller) gets its own fresh array from this one projection point.
    scopes: [...credential.scopes],
    createdAt: credential.createdAt,
    lastUsedAt: credential.lastUsedAt,
    revokedAt: credential.revokedAt,
  };
}

/**
 * Issue a fresh credential for an approved pairing. Re-pairing the same
 * installation id revokes any still-active prior credential for it first, so
 * an installation never ends up with two live tokens at once — the new
 * pairing supersedes the old rather than adding to it.
 *
 * The installation id is validated as UUID-shaped and normalized to
 * lowercase before it is stored or compared: an installation identifies
 * itself the same way regardless of the case a particular client happened
 * to send, so `re-pair as "ABCD..."` must revoke a credential issued for
 * `"abcd..."` rather than being treated as a different installation.
 */
export async function issueCredential(
  approvedPairing: ApprovedPairing,
  now = Date.now(),
): Promise<{ token: string; credential: SafeClientCredential }> {
  if (!isUuid(approvedPairing.installationId)) {
    throw new Error("issueCredential requires a UUID-shaped installationId.");
  }
  // Rejected before the transaction is even entered — see `assertValidNow`.
  assertValidNow(now);
  const installationId = approvedPairing.installationId.toLowerCase();
  // The read -> mutate -> write below runs under `withCredentialTransaction`,
  // which calls the raw `readStoreForMutation`/`writeStore` directly (never a
  // public export of this module) — reacquiring the transaction from inside
  // itself would deadlock a process on its own in-flight mutation.
  // `readStoreForMutation` (not the read-only `readStore`) is required here:
  // an unreadable/corrupt file must abort this issuance rather than being
  // treated as "no credentials yet" and silently overwritten with a
  // brand-new store that drops whatever was actually on disk.
  return withCredentialTransaction(async () => {
    const store = await readStoreForMutation();
    await postReadDelayForTest?.();
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const token = Buffer.from(bytes).toString("base64url");
    // `now` is captured by the caller before this call even reaches the
    // transaction queue/lock, and can be an arbitrary caller-supplied value
    // besides — by the time this line runs, an unrelated racing issuance for
    // the SAME installation (see below) may already have persisted a
    // `createdAt` at or after `now`. Every same-installation credential
    // already on disk (active or revoked; a re-pair history can span more
    // than one) is considered so `createdAt` is always monotonic enough for
    // `listCredentials`'s newest-first ordering to keep placing the newest
    // issuance first: if `now` doesn't already exceed the latest existing
    // `createdAt` for this installation, this credential's `createdAt` is
    // bumped to one past it (capped at `Number.MAX_SAFE_INTEGER`, past which
    // it merely ties instead of overflowing) rather than left at `now`.
    let createdAt = now;
    for (const existing of store.credentials) {
      if (existing.installationId !== installationId) continue;
      if (createdAt <= existing.createdAt) {
        createdAt =
          existing.createdAt < Number.MAX_SAFE_INTEGER ? existing.createdAt + 1 : existing.createdAt;
      }
    }
    const credential: ClientCredential = {
      id: randomUUID(),
      appName: approvedPairing.appName,
      installationId,
      tokenHash: hashToken(token),
      // Cloned so the internal record's authorization scopes can never be
      // mutated later through the caller's `approvedPairing.scopes` array —
      // that array may itself be a pairing-store record's live field (see
      // `consumeApprovedPairing`), and this store must hold its own
      // independent copy of what was actually granted.
      scopes: [...approvedPairing.scopes],
      createdAt,
      lastUsedAt: null,
      revokedAt: null,
    };
    const remaining = store.credentials.map((existing) => {
      if (
        !REVOKE_ON_REPAIR ||
        existing.installationId !== installationId ||
        existing.revokedAt !== null
      ) {
        return existing;
      }
      // The prior credential's own `revokedAt` must never precede its own
      // `createdAt`/`lastUsedAt` — using the ORIGINAL `now` here (not the
      // possibly-bumped `createdAt` above) so this credential's revocation
      // time reflects when it actually happened, independent of whatever
      // ordering adjustment the newly issued credential needed.
      return { ...existing, revokedAt: monotonicTimestamp(now, existing.createdAt, existing.lastUsedAt) };
    });
    remaining.push(credential);
    await writeStore({ version: 1, credentials: remaining });
    return { token, credential: toSafe(credential) };
  });
}

/** Safe metadata for every credential, newest first. Never includes tokenHash. */
export async function listCredentials(): Promise<SafeClientCredential[]> {
  const { credentials } = await readStore();
  return credentials.map(toSafe).sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Verify a bearer token against every stored hash in constant time, returning
 * the credential it belongs to or null if it is malformed, unknown, or
 * revoked. The raw token is hashed once here and never compared or persisted
 * in its raw form; every stored hash is checked so timing does not vary with
 * how many earlier credentials in the store are unrelated non-matches.
 *
 * `now` is accepted for symmetry with the store's other time-taking
 * operations and to leave room for a future expiry policy; credentials
 * currently have no TTL of their own; only pairing requests do.
 */
export async function verifyCredential(
  token: string,
  now = Date.now(),
): Promise<SafeClientCredential | null> {
  void now;
  if (!token) return null;
  const { credentials } = await readStore();
  const suppliedHash = hashToken(token);
  let match: ClientCredential | null = null;
  for (const credential of credentials) {
    if (timingSafeEqualString(suppliedHash, credential.tokenHash)) match = credential;
  }
  if (!match || match.revokedAt !== null) return null;
  return toSafe(match);
}

/**
 * Advance a credential's `lastUsedAt`, but only write to disk when the new
 * value is at least a minute newer than the last persisted one — a busy
 * client would otherwise cause a write on every single request. The
 * timestamp itself only ever moves forward: a caller-supplied `now` that is
 * stale (captured before this call's transaction turn) or explicitly
 * earlier than the credential's own history is clamped up to the
 * credential's `createdAt`/existing `lastUsedAt` via `monotonicTimestamp`
 * before the throttle is evaluated, so a persisted `lastUsedAt` can never
 * precede `createdAt` and never regress.
 */
export async function recordCredentialUse(id: string, now = Date.now()): Promise<void> {
  // Rejected before the transaction is even entered — see `assertValidNow`.
  assertValidNow(now);
  await withCredentialTransaction(async () => {
    // `readStoreForMutation`: an unreadable/corrupt file must throw here
    // rather than being treated as "credential not found" — that would
    // silently no-op a real credential's bookkeeping and, worse, mask the
    // underlying I/O failure entirely.
    const store = await readStoreForMutation();
    await postReadDelayForTest?.();
    const credential = store.credentials.find((entry) => entry.id === id);
    if (!credential) return;
    const previous = credential.lastUsedAt;
    const candidate = monotonicTimestamp(now, credential.createdAt, previous);
    // `candidate` is, by construction, never earlier than `previous` — so
    // this throttle is the only gate left: it also naturally covers the
    // "candidate didn't actually move" case (an inverted/stale `now` clamped
    // straight back to `previous` has `candidate - previous === 0`, well
    // under the threshold), leaving `lastUsedAt` untouched rather than
    // rewriting the file for a no-op change.
    if (previous !== null && candidate - previous < LAST_USED_WRITE_THRESHOLD_MS) return;
    credential.lastUsedAt = candidate;
    await writeStore(store);
  });
}

/**
 * Revoke a credential. Idempotent: revoking an already-revoked credential
 * stays successful but never moves its `revokedAt` timestamp forward, so the
 * recorded revocation time is always the first one. A caller-supplied `now`
 * that is stale or explicitly earlier than the credential's own
 * `createdAt`/`lastUsedAt` is clamped forward via `monotonicTimestamp`
 * before being persisted, so `revokedAt` can never precede `createdAt`.
 */
export async function revokeCredential(id: string, now = Date.now()): Promise<boolean> {
  // Rejected before the transaction is even entered — see `assertValidNow`.
  assertValidNow(now);
  return withCredentialTransaction(async () => {
    // `readStoreForMutation`: an unreadable/corrupt file must throw here
    // rather than being treated as "credential not found" — a caller must
    // never be told a credential doesn't exist when the truth is simply
    // that the store couldn't be read this one time.
    const store = await readStoreForMutation();
    await postReadDelayForTest?.();
    const credential = store.credentials.find((entry) => entry.id === id);
    if (!credential) return false;
    if (credential.revokedAt === null) {
      credential.revokedAt = monotonicTimestamp(now, credential.createdAt, credential.lastUsedAt);
      await writeStore(store);
    }
    return true;
  });
}
