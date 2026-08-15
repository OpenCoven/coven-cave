// Long-lived credential store for the `/api/client/v1` facade.
//
// A credential is the trust anchor a paired client presents on every request
// after pairing completes. The authority record keeps only the SHA-256 hash.
// Pairing exchange additionally keeps a short-lived AES-GCM-encrypted recovery
// copy in its adjacent settlement journal, decryptable only with the original
// high-entropy pairing secret, so a crash before the one permitted disclosure
// cannot strand a newly active credential. Once the disclosure fence is
// crossed, the terminal path never decrypts or reveals it again; the first
// authenticated bearer use then redacts the ciphertext and acknowledges
// delivery.

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import { caveHome } from "@/lib/coven-paths";
import { writeJsonAtomic } from "@/lib/server/atomic-write";
import { timingSafeEqualString } from "@/proxy-helpers";

import { CLIENT_V1_SCOPES, isUuid } from "./contract.ts";
import type { ClientV1Scope } from "./contract.ts";
import { withCredentialTransactionLock } from "./credential-transaction-lock.ts";
import {
  PAIRING_CLAIM_STALE_MS,
  PAIRING_EXCHANGE_RETRY_AFTER_MS,
} from "./pairing-store.ts";
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
  /**
   * Advances on every revocation event, including an administrator revoking
   * a credential that a pending pairing replacement already revoked. It is
   * deliberately private: settlement rollback uses it as a durable
   * compare-and-swap ownership fence, not as client-visible metadata.
   */
  revocationGeneration: number;
};

/** Everything about a credential except the value that grants authority. */
export type SafeClientCredential = Omit<ClientCredential, "tokenHash" | "revocationGeneration">;

type StoreFile = { version: 1; credentials: ClientCredential[] };

/**
 * A pending pairing issuance is deliberately persisted beside the credential
 * store.  The pairing request itself is process-local, so this is the durable
 * half of an exchange: it either contains the encrypted token needed to
 * finish an exact retry, or the predecessor state needed to undo an
 * incomplete replacement.
 */
type CredentialSettlementContext = {
  pairingId: string;
  pairingSecret: string;
  idempotencyKey: string;
  requestHash: string;
  claimId?: string;
};

type SealedToken = {
  nonce: string;
  ciphertext: string;
  authTag: string;
};

type ReplacedCredential = {
  id: string;
  previousRevokedAt: number | null;
  replacementRevokedAt: number;
  /**
   * The revocation generation written by this settlement transaction.
   * Legacy journals have no durable ownership fence and therefore set this
   * to null; their rollback removes only their replacement, never restores a
   * predecessor whose later ownership cannot be proven.
   */
  replacementRevocationGeneration: number | null;
};

type CredentialSettlementEntry = {
  pairingId: string;
  claimId: string;
  secretHash: string;
  idempotencyKey: string;
  requestHash: string;
  credential: ClientCredential;
  replaced: ReplacedCredential[];
  sealedToken: SealedToken | null;
  createdAt: number;
  expiresAt: number;
  recoveryClaimId: string | null;
  recoveryClaimStartedAt: number | null;
  /**
   * Crossing this durable fence authorizes precisely one in-memory caller to
   * put the token in an HTTP response. It is set before that caller returns,
   * because HTTP response delivery has no reliable acknowledgement channel.
   */
  exposedAt: number | null;
  /**
   * A subsequent authenticated bearer use proves the token was not lost in
   * delivery. Until then, the credential is bounded by `expiresAt`.
   */
  deliveryAcknowledgedAt: number | null;
};

type CredentialSettlementJournal = {
  version: 2;
  transactions: CredentialSettlementEntry[];
  replays: CredentialSettlementEntry[];
};

export type CredentialSettlementRecovery =
  | { kind: "none" | "pending" }
  | {
    kind: "issued";
    token: string;
    credential: SafeClientCredential;
    recoveryClaimId: string;
    claimId: string;
  }
  | {
    kind: "terminal";
    credential: SafeClientCredential;
    claimId: string;
  };

const SETTLEMENT_JOURNAL_VERSION = 2;
const LEGACY_SETTLEMENT_JOURNAL_VERSION = 1;
export const PAIRING_CREDENTIAL_RECOVERY_TTL_MS = PAIRING_CLAIM_STALE_MS;
export const PAIRING_CREDENTIAL_SETTLEMENT_MAX_ENTRIES = 64;
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

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

/** Adjacent, encrypted recovery journal for pairing credential issuance. */
export function clientCredentialSettlementJournalPath(): string {
  return `${clientCredentialStorePath()}.pairing-settlement.json`;
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
  "revocationGeneration",
] as const;
const CREDENTIAL_KEY_SET: ReadonlySet<string> = new Set(CREDENTIAL_KEYS);
const LEGACY_CREDENTIAL_KEYS = CREDENTIAL_KEYS.filter((key) => key !== "revocationGeneration");
const LEGACY_CREDENTIAL_KEY_SET: ReadonlySet<string> = new Set(LEGACY_CREDENTIAL_KEYS);

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

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function nextRevocationGeneration(generation: number): number {
  if (generation >= Number.MAX_SAFE_INTEGER) {
    throw new CredentialStoreIntegrityError("Credential revocation generation is exhausted.");
  }
  return generation + 1;
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
  const isLegacy = keys.length === LEGACY_CREDENTIAL_KEYS.length
    && keys.every((key) => LEGACY_CREDENTIAL_KEY_SET.has(key));
  if (
    !isLegacy
    && (keys.length !== CREDENTIAL_KEYS.length || !keys.every((key) => CREDENTIAL_KEY_SET.has(key)))
  ) {
    return null;
  }

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
  if (!isLegacy && !isNonNegativeSafeInteger(record.revocationGeneration)) return null;

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
    // A legacy record predates durable revocation ownership. Treat it as
    // generation zero; the next mutation upgrades it by persisting the
    // explicit generation field.
    revocationGeneration: isLegacy ? 0 : record.revocationGeneration as number,
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

function emptySettlementJournal(): CredentialSettlementJournal {
  return { version: SETTLEMENT_JOURNAL_VERSION, transactions: [], replays: [] };
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function parseSealedToken(value: unknown): SealedToken | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!hasExactKeys(record, ["nonce", "ciphertext", "authTag"])) return null;
  if (
    typeof record.nonce !== "string"
    || typeof record.ciphertext !== "string"
    || typeof record.authTag !== "string"
    || !BASE64URL_RE.test(record.nonce)
    || !BASE64URL_RE.test(record.ciphertext)
    || !BASE64URL_RE.test(record.authTag)
  ) {
    return null;
  }
  try {
    if (Buffer.from(record.nonce, "base64url").length !== 12) return null;
    if (Buffer.from(record.authTag, "base64url").length !== 16) return null;
    if (Buffer.from(record.ciphertext, "base64url").length === 0) return null;
  } catch {
    return null;
  }
  return {
    nonce: record.nonce,
    ciphertext: record.ciphertext,
    authTag: record.authTag,
  };
}

function parseReplacedCredential(value: unknown): ReplacedCredential | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const legacy = hasExactKeys(record, ["id", "previousRevokedAt", "replacementRevokedAt"]);
  if (
    !legacy
    && !hasExactKeys(record, [
      "id",
      "previousRevokedAt",
      "replacementRevokedAt",
      "replacementRevocationGeneration",
    ])
  ) {
    return null;
  }
  if (
    !isUuid(record.id)
    || !isNullOrFiniteNonNegativeNumber(record.previousRevokedAt)
    || !isFiniteNonNegativeNumber(record.replacementRevokedAt)
    || (!legacy && !isNonNegativeSafeInteger(record.replacementRevocationGeneration))
  ) {
    return null;
  }
  return {
    id: record.id,
    previousRevokedAt: record.previousRevokedAt,
    replacementRevokedAt: record.replacementRevokedAt,
    replacementRevocationGeneration: legacy ? null : record.replacementRevocationGeneration as number,
  };
}

function parseSettlementEntry(
  value: unknown,
  version: typeof SETTLEMENT_JOURNAL_VERSION | typeof LEGACY_SETTLEMENT_JOURNAL_VERSION,
): CredentialSettlementEntry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const legacyKeys = [
    "pairingId",
    "claimId",
    "secretHash",
    "idempotencyKey",
    "requestHash",
    "credential",
    "replaced",
    "sealedToken",
    "createdAt",
    "expiresAt",
    "recoveryClaimId",
    "recoveryClaimStartedAt",
  ] as const;
  const currentKeys = [...legacyKeys, "exposedAt", "deliveryAcknowledgedAt"] as const;
  if (!hasExactKeys(record, version === LEGACY_SETTLEMENT_JOURNAL_VERSION ? legacyKeys : currentKeys)) {
    return null;
  }
  if (
    !isUuid(record.pairingId)
    || !isUuid(record.claimId)
    || typeof record.secretHash !== "string"
    || !TOKEN_HASH_RE.test(record.secretHash)
    || !isUuid(record.idempotencyKey)
    || typeof record.requestHash !== "string"
    || !TOKEN_HASH_RE.test(record.requestHash)
    || !Array.isArray(record.replaced)
    || !isFiniteNonNegativeNumber(record.createdAt)
    || !isFiniteNonNegativeNumber(record.expiresAt)
    || record.expiresAt < record.createdAt
    || (record.recoveryClaimId !== null && !isUuid(record.recoveryClaimId))
    || !isNullOrFiniteNonNegativeNumber(record.recoveryClaimStartedAt)
    || ((record.recoveryClaimId === null) !== (record.recoveryClaimStartedAt === null))
  ) {
    return null;
  }
  const credential = parseClientCredential(record.credential);
  const sealedToken = record.sealedToken === null ? null : parseSealedToken(record.sealedToken);
  const exposedAt = version === LEGACY_SETTLEMENT_JOURNAL_VERSION
    ? null
    : isNullOrFiniteNonNegativeNumber(record.exposedAt)
      ? record.exposedAt
      : undefined;
  const deliveryAcknowledgedAt = version === LEGACY_SETTLEMENT_JOURNAL_VERSION
    ? null
    : isNullOrFiniteNonNegativeNumber(record.deliveryAcknowledgedAt)
      ? record.deliveryAcknowledgedAt
      : undefined;
  if (
    !credential
    || sealedToken === undefined
    || exposedAt === undefined
    || deliveryAcknowledgedAt === undefined
  ) {
    return null;
  }
  const replaced: ReplacedCredential[] = [];
  const replacementIds = new Set<string>();
  for (const entry of record.replaced) {
    const parsed = parseReplacedCredential(entry);
    if (!parsed || replacementIds.has(parsed.id)) return null;
    replacementIds.add(parsed.id);
    replaced.push(parsed);
  }
  return {
    pairingId: record.pairingId,
    claimId: record.claimId,
    secretHash: record.secretHash.toLowerCase(),
    idempotencyKey: record.idempotencyKey,
    requestHash: record.requestHash.toLowerCase(),
    credential,
    replaced,
    sealedToken,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    recoveryClaimId: record.recoveryClaimId,
    recoveryClaimStartedAt: record.recoveryClaimStartedAt,
    exposedAt,
    deliveryAcknowledgedAt,
  };
}

async function readSettlementJournalForMutation(): Promise<CredentialSettlementJournal> {
  const file = clientCredentialSettlementJournalPath();
  let raw: string;
  try {
    raw = await readFile(/* turbopackIgnore: true */ file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
      return emptySettlementJournal();
    }
    throw new CredentialStoreIntegrityError("The pairing credential settlement journal could not be read.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CredentialStoreIntegrityError("The pairing credential settlement journal contains invalid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new CredentialStoreIntegrityError("The pairing credential settlement journal does not match the expected schema.");
  }
  const record = parsed as Record<string, unknown>;
  if (
    !hasExactKeys(record, ["version", "transactions", "replays"])
    || (record.version !== SETTLEMENT_JOURNAL_VERSION && record.version !== LEGACY_SETTLEMENT_JOURNAL_VERSION)
    || !Array.isArray(record.transactions)
    || !Array.isArray(record.replays)
    || record.transactions.length > PAIRING_CREDENTIAL_SETTLEMENT_MAX_ENTRIES
    || record.replays.length > PAIRING_CREDENTIAL_SETTLEMENT_MAX_ENTRIES
  ) {
    throw new CredentialStoreIntegrityError("The pairing credential settlement journal does not match the expected schema.");
  }
  const version = record.version;
  const transactions: CredentialSettlementEntry[] = [];
  const replays: CredentialSettlementEntry[] = [];
  const identities = new Set<string>();
  for (const rawEntry of record.transactions) {
    const entry = parseSettlementEntry(rawEntry, version);
    const identity = entry && `${entry.pairingId}:${entry.idempotencyKey}:${entry.requestHash}`;
    if (
      !entry
      || entry.sealedToken === null
      || entry.exposedAt !== null
      || entry.deliveryAcknowledgedAt !== null
      || !identity
      || identities.has(identity)
    ) {
      throw new CredentialStoreIntegrityError("The pairing credential settlement journal contains a malformed entry.");
    }
    identities.add(identity);
    transactions.push(entry);
  }
  for (const rawEntry of record.replays) {
    const parsedEntry = parseSettlementEntry(rawEntry, version);
    // Legacy terminal entries were created by a version that could have
    // already returned their token. Treat them as uncertain delivery, never
    // as a replay grant, and bound the credential until first authenticated
    // use confirms it reached its holder.
    const entry = parsedEntry && version === LEGACY_SETTLEMENT_JOURNAL_VERSION
      ? { ...parsedEntry, exposedAt: parsedEntry.createdAt }
      : parsedEntry;
    const identity = entry && `${entry.pairingId}:${entry.idempotencyKey}:${entry.requestHash}`;
    if (
      !entry
      || entry.exposedAt === null
      || entry.exposedAt > entry.expiresAt
      || (
        entry.deliveryAcknowledgedAt !== null
        && (
          entry.deliveryAcknowledgedAt < entry.exposedAt
          || entry.sealedToken !== null
        )
      )
      || (entry.deliveryAcknowledgedAt === null && entry.sealedToken === null)
      || !identity
      || identities.has(identity)
    ) {
      throw new CredentialStoreIntegrityError("The pairing credential settlement journal contains a malformed entry.");
    }
    identities.add(identity);
    replays.push(entry);
  }
  return { version: SETTLEMENT_JOURNAL_VERSION, transactions, replays };
}

async function writeSettlementJournal(journal: CredentialSettlementJournal): Promise<void> {
  const file = clientCredentialSettlementJournalPath();
  await mkdir(/* turbopackIgnore: true */ path.dirname(file), { recursive: true });
  await writeJsonAtomic(file, journal);
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

function assertSettlementContext(context: CredentialSettlementContext): void {
  if (
    !isUuid(context.pairingId)
    || !isUuid(context.idempotencyKey)
    || (context.claimId !== undefined && !isUuid(context.claimId))
    || !TOKEN_HASH_RE.test(context.requestHash)
    || !isNonEmptyString(context.pairingSecret)
  ) {
    throw new Error("Invalid pairing credential settlement context.");
  }
}

function settlementAad(entry: Pick<CredentialSettlementEntry, "pairingId" | "idempotencyKey" | "requestHash">): Buffer {
  return Buffer.from(`${entry.pairingId}\n${entry.idempotencyKey}\n${entry.requestHash}`, "utf8");
}

function settlementEncryptionKey(secret: string): Buffer {
  return createHash("sha256")
    .update("coven-cave/client-v1/pairing-credential-settlement/v1\0")
    .update(secret)
    .digest();
}

function sealSettlementToken(
  token: string,
  secret: string,
  entry: Pick<CredentialSettlementEntry, "pairingId" | "idempotencyKey" | "requestHash">,
): SealedToken {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", settlementEncryptionKey(secret), nonce);
  cipher.setAAD(settlementAad(entry));
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return {
    nonce: nonce.toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
    authTag: cipher.getAuthTag().toString("base64url"),
  };
}

function unsealSettlementToken(entry: CredentialSettlementEntry, secret: string): string | null {
  if (!entry.sealedToken) return null;
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      settlementEncryptionKey(secret),
      Buffer.from(entry.sealedToken.nonce, "base64url"),
    );
    decipher.setAAD(settlementAad(entry));
    decipher.setAuthTag(Buffer.from(entry.sealedToken.authTag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(entry.sealedToken.ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

function isSettlementContextForEntry(
  entry: CredentialSettlementEntry,
  context: CredentialSettlementContext,
): boolean {
  return (
    entry.pairingId === context.pairingId
    && entry.idempotencyKey === context.idempotencyKey
    && entry.requestHash === context.requestHash.toLowerCase()
    && timingSafeEqualString(entry.secretHash, hashToken(context.pairingSecret))
  );
}

function hasPersistedSettlementCredential(
  store: StoreFile,
  entry: CredentialSettlementEntry,
): boolean {
  const credential = store.credentials.find((candidate) => candidate.id === entry.credential.id);
  return Boolean(
    credential
    && credential.appName === entry.credential.appName
    && credential.installationId === entry.credential.installationId
    && credential.tokenHash === entry.credential.tokenHash
    && credential.createdAt === entry.credential.createdAt
    && credential.lastUsedAt === entry.credential.lastUsedAt
    && credential.revocationGeneration === entry.credential.revocationGeneration
    && credential.scopes.length === entry.credential.scopes.length
    && credential.scopes.every((scope, index) => scope === entry.credential.scopes[index]),
  );
}

function hasActiveSettlementCredential(
  store: StoreFile,
  entry: CredentialSettlementEntry,
): boolean {
  const credential = store.credentials.find((candidate) => candidate.id === entry.credential.id);
  return Boolean(
    credential
    && credential.appName === entry.credential.appName
    && credential.installationId === entry.credential.installationId
    && credential.tokenHash === entry.credential.tokenHash
    && credential.createdAt === entry.credential.createdAt
    && credential.revokedAt === null
    && credential.scopes.length === entry.credential.scopes.length
    && credential.scopes.every((scope, index) => scope === entry.credential.scopes[index]),
  );
}

/**
 * Undo only the precise writes this transaction made. The timestamp and
 * durable revocation generation together form the compare-and-swap fence:
 * an administrator's later revocation advances the generation even when the
 * timestamp is already populated by this temporary replacement, so rollback
 * can never reactivate that predecessor.
 */
function rollbackSettlementCredential(store: StoreFile, entry: CredentialSettlementEntry): boolean {
  if (!hasPersistedSettlementCredential(store, entry)) return false;
  store.credentials = store.credentials.filter((credential) => credential.id !== entry.credential.id);
  for (const replaced of entry.replaced) {
    const credential = store.credentials.find((candidate) => candidate.id === replaced.id);
    if (
      replaced.replacementRevocationGeneration !== null
      && credential?.revokedAt === replaced.replacementRevokedAt
      && credential.revocationGeneration === replaced.replacementRevocationGeneration
    ) {
      credential.revokedAt = replaced.previousRevokedAt;
    }

  }
  return true;
}

/**
 * An exposure-fenced credential that never makes a successful authenticated
 * request may have been lost between HTTP response construction and delivery.
 * Its predecessor stays revoked: reactivating an old bearer would create a
 * second, equally unacknowledged authority. Instead revoke the uncertain
 * replacement at the bounded delivery deadline and require a fresh pairing.
 */
function revokeUnacknowledgedSettlementCredential(
  store: StoreFile,
  entry: CredentialSettlementEntry,
  now: number,
): boolean {
  const credential = store.credentials.find((candidate) => candidate.id === entry.credential.id);
  if (!credential || credential.revokedAt !== null) return false;
  credential.revokedAt = monotonicTimestamp(now, credential.createdAt, credential.lastUsedAt);
  credential.revocationGeneration = nextRevocationGeneration(credential.revocationGeneration);
  return true;
}

function pruneSettlementJournal(
  store: StoreFile,
  journal: CredentialSettlementJournal,
  now: number,
): { storeChanged: boolean; journalChanged: boolean } {
  let storeChanged = false;
  const transactions: CredentialSettlementEntry[] = [];
  for (const entry of journal.transactions) {
    if (entry.expiresAt > now) {
      transactions.push(entry);
      continue;
    }
    storeChanged = rollbackSettlementCredential(store, entry) || storeChanged;
  }
  const replays: CredentialSettlementEntry[] = [];
  for (const entry of journal.replays) {
    if (entry.expiresAt > now) {
      replays.push(entry);
      continue;
    }
    if (entry.deliveryAcknowledgedAt === null) {
      storeChanged = revokeUnacknowledgedSettlementCredential(store, entry, now) || storeChanged;
    }
  }
  const journalChanged =
    transactions.length !== journal.transactions.length || replays.length !== journal.replays.length;
  journal.transactions = transactions;
  journal.replays = replays;
  return { storeChanged, journalChanged };
}

async function persistSettlementCleanup(
  store: StoreFile,
  journal: CredentialSettlementJournal,
  changed: { storeChanged: boolean; journalChanged: boolean },
): Promise<void> {
  // Restore authority before dropping its recovery record.  A crash after the
  // first write is safe to repeat; the inverse ordering could orphan an
  // active replacement with no way to recover or roll it back.
  if (changed.storeChanged) await writeStore(store);
  if (changed.journalChanged) await writeSettlementJournal(journal);
}

function crashAtCredentialSettlementPoint(point: string): void {
  if (process.env.COVEN_CAVE_TEST_CREDENTIAL_SETTLEMENT_CRASH_POINT !== point) return;
  process.kill(process.pid, "SIGKILL");
}

function makeReplacementCredential(
  store: StoreFile,
  approvedPairing: ApprovedPairing,
  token: string,
  now: number,
): { credential: ClientCredential; replaced: ReplacedCredential[]; credentials: ClientCredential[] } {
  const installationId = approvedPairing.installationId.toLowerCase();
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
    scopes: [...approvedPairing.scopes],
    createdAt,
    lastUsedAt: null,
    revokedAt: null,
    revocationGeneration: 0,
  };
  const replaced: ReplacedCredential[] = [];
  const credentials = store.credentials.map((existing) => {
    if (
      !REVOKE_ON_REPAIR
      || existing.installationId !== installationId
      || existing.revokedAt !== null
    ) {
      return existing;
    }
    const replacementRevokedAt = monotonicTimestamp(now, existing.createdAt, existing.lastUsedAt);
    const replacementRevocationGeneration = nextRevocationGeneration(existing.revocationGeneration);
    replaced.push({
      id: existing.id,
      previousRevokedAt: existing.revokedAt,
      replacementRevokedAt,
      replacementRevocationGeneration,
    });
    return {
      ...existing,
      revokedAt: replacementRevokedAt,
      revocationGeneration: replacementRevocationGeneration,
    };
  });
  credentials.push(credential);
  return { credential, replaced, credentials };
}

/**
 * Issue a pairing credential only after an encrypted, exact-request recovery
 * record has been atomically written under the credential store's existing
 * SQLite/file-lock transaction. A hard crash before the disclosure fence can
 * recover this token exactly once; an unfinished transaction that outlives
 * its bounded lease restores the predecessor credential instead.
 */
export async function issueCredentialForPairingSettlement(
  approvedPairing: ApprovedPairing,
  context: CredentialSettlementContext,
  now = Date.now(),
): Promise<{ token: string; credential: SafeClientCredential }> {
  if (!isUuid(approvedPairing.installationId)) {
    throw new Error("issueCredential requires a UUID-shaped installationId.");
  }
  assertValidNow(now);
  assertSettlementContext(context);
  return withCredentialTransaction(async () => {
    const store = await readStoreForMutation();
    const journal = await readSettlementJournalForMutation();
    const cleanup = pruneSettlementJournal(store, journal, now);
    await persistSettlementCleanup(store, journal, cleanup);

    if (journal.transactions.some((entry) => entry.credential.installationId === approvedPairing.installationId.toLowerCase())) {
      throw new Error("A credential replacement for this installation is awaiting settlement.");
    }
    if (journal.transactions.length >= PAIRING_CREDENTIAL_SETTLEMENT_MAX_ENTRIES) {
      throw new Error("Pairing credential settlement capacity is temporarily unavailable.");
    }
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const token = Buffer.from(bytes).toString("base64url");
    const replacement = makeReplacementCredential(store, approvedPairing, token, now);
    const entryWithoutToken = {
      pairingId: context.pairingId,
      claimId: context.claimId ?? randomUUID(),
      secretHash: hashToken(context.pairingSecret),
      idempotencyKey: context.idempotencyKey,
      requestHash: context.requestHash.toLowerCase(),
      credential: replacement.credential,
      replaced: replacement.replaced,
      createdAt: now,
      expiresAt: now + PAIRING_CREDENTIAL_RECOVERY_TTL_MS,
      recoveryClaimId: null,
      recoveryClaimStartedAt: null,
      exposedAt: null,
      deliveryAcknowledgedAt: null,
    };
    const entry: CredentialSettlementEntry = {
      ...entryWithoutToken,
      sealedToken: sealSettlementToken(token, context.pairingSecret, entryWithoutToken),
    };
    journal.transactions.push(entry);
    await writeSettlementJournal(journal);
    await writeStore({ version: 1, credentials: replacement.credentials });
    crashAtCredentialSettlementPoint("after-credential-write");
    return { token, credential: toSafe(replacement.credential) };
  });
}

/**
 * Find durable state for this exact request. Recovering an unfinished
 * issuance takes a short journal lease so concurrent retries cannot both
 * cross the disclosure fence. A terminal receipt intentionally returns
 * metadata only: it must never decrypt or re-reveal the bearer.
 */
export async function recoverPairingCredentialSettlement(
  context: CredentialSettlementContext,
  now = Date.now(),
): Promise<CredentialSettlementRecovery> {
  assertValidNow(now);
  assertSettlementContext(context);
  return withCredentialTransaction(async () => {
    const store = await readStoreForMutation();
    const journal = await readSettlementJournalForMutation();
    const cleanup = pruneSettlementJournal(store, journal, now);
    await persistSettlementCleanup(store, journal, cleanup);

    const replay = journal.replays.find((entry) => isSettlementContextForEntry(entry, context));
    if (replay) {
      if (!hasActiveSettlementCredential(store, replay)) {
        journal.replays = journal.replays.filter((entry) => entry !== replay);
        await writeSettlementJournal(journal);
        return { kind: "none" };
      }
      return {
        kind: "terminal",
        credential: toSafe(replay.credential),
        claimId: replay.claimId,
      };
    }

    const transaction = journal.transactions.find((entry) => isSettlementContextForEntry(entry, context));
    if (!transaction) return { kind: "none" };
    if (!hasPersistedSettlementCredential(store, transaction)) {
      journal.transactions = journal.transactions.filter((entry) => entry !== transaction);
      await writeSettlementJournal(journal);
      return { kind: "none" };
    }
    const persistedCredential = store.credentials.find(
      (candidate) => candidate.id === transaction.credential.id,
    );
    if (persistedCredential?.revokedAt !== null) {
      const storeChanged = rollbackSettlementCredential(store, transaction);
      journal.transactions = journal.transactions.filter((entry) => entry !== transaction);
      if (storeChanged) await writeStore(store);
      await writeSettlementJournal(journal);
      return { kind: "none" };
    }
    if (
      transaction.recoveryClaimId !== null
      && transaction.recoveryClaimStartedAt !== null
      && now < transaction.recoveryClaimStartedAt + PAIRING_EXCHANGE_RETRY_AFTER_MS
    ) {
      return { kind: "pending" };
    }
    const token = unsealSettlementToken(transaction, context.pairingSecret);
    if (!token || hashToken(token) !== transaction.credential.tokenHash) {
      throw new CredentialStoreIntegrityError("The pairing credential settlement journal could not be decrypted.");
    }
    transaction.recoveryClaimId = randomUUID();
    transaction.recoveryClaimStartedAt = now;
    await writeSettlementJournal(journal);
    return {
      kind: "issued",
      token,
      credential: toSafe(transaction.credential),
      recoveryClaimId: transaction.recoveryClaimId,
      claimId: transaction.claimId,
    };
  });
}

/**
 * Atomically cross the one-time disclosure fence for an issued transaction.
 * The winning in-memory caller already has the plaintext token; after this
 * function succeeds it may return that token once. Every retry sees only
 * terminal metadata, even if the original HTTP response was lost.
 */
export async function settlePairingCredentialSettlement(
  context: CredentialSettlementContext,
  recoveryClaimId: string | null,
  claimId: string,
  now = Date.now(),
): Promise<boolean> {
  assertValidNow(now);
  assertSettlementContext(context);
  if (!isUuid(claimId)) throw new Error("Invalid pairing credential settlement claim.");
  return withCredentialTransaction(async () => {
    const store = await readStoreForMutation();
    const journal = await readSettlementJournalForMutation();
    const cleanup = pruneSettlementJournal(store, journal, now);
    await persistSettlementCleanup(store, journal, cleanup);

    const replay = journal.replays.find((entry) => isSettlementContextForEntry(entry, context));
    if (replay) {
      // An older claimant may still have plaintext bytes in memory, but a
      // terminal receipt is an absolute no-reveal fence, including for the
      // claimant that originally wrote it.
      if (!hasActiveSettlementCredential(store, replay)) {
        journal.replays = journal.replays.filter((entry) => entry !== replay);
        await writeSettlementJournal(journal);
      }
      return false;
    }
    const transaction = journal.transactions.find((entry) => isSettlementContextForEntry(entry, context));
    if (
      !transaction
      || !hasPersistedSettlementCredential(store, transaction)
      || store.credentials.find((candidate) => candidate.id === transaction.credential.id)?.revokedAt !== null
      || transaction.claimId !== claimId
      || transaction.recoveryClaimId !== recoveryClaimId
    ) {
      return false;
    }
    // Do not evict a still-live terminal receipt for capacity: its defined
    // retention policy is expiry, not unrelated pairing traffic.
    if (journal.replays.length >= PAIRING_CREDENTIAL_SETTLEMENT_MAX_ENTRIES) return false;
    journal.transactions = journal.transactions.filter((entry) => entry !== transaction);
    journal.replays.push({
      ...transaction,
      exposedAt: now,
      deliveryAcknowledgedAt: null,
    });
    await writeSettlementJournal(journal);
    return true;
  });
}

/**
 * Record that a holder has actually authenticated with a disclosure-fenced
 * credential. HTTP cannot tell us whether a 200 response reached its peer, so
 * this durable bearer-use acknowledgement is the only promotion signal we
 * trust. It also redacts the encrypted recovery copy; terminal retries retain
 * metadata, never recoverable bearer material.
 */
export async function acknowledgePairingCredentialDelivery(
  id: string,
  now = Date.now(),
): Promise<boolean> {
  assertValidNow(now);
  // The production caller invokes this only after `verifyCredential`, whose
  // persisted credential schema already requires a UUID. Returning true for
  // an impossible no-journal id keeps injected authorizer tests independent
  // of the durable store without weakening real authority decisions.
  if (!isUuid(id)) return true;
  return withCredentialTransaction(async () => {
    const store = await readStoreForMutation();
    const journal = await readSettlementJournalForMutation();
    const cleanup = pruneSettlementJournal(store, journal, now);
    await persistSettlementCleanup(store, journal, cleanup);

    const replay = journal.replays.find((entry) => entry.credential.id === id);
    if (!replay) {
      // The normal no-journal path is intentionally true. A custom verifier
      // in a unit test may not have a backing store; production reaches here
      // only after `verifyCredential` already proved the bearer.
      return store.credentials.find((credential) => credential.id === id)?.revokedAt !== null
        ? false
        : true;
    }
    if (!hasActiveSettlementCredential(store, replay)) {
      journal.replays = journal.replays.filter((entry) => entry !== replay);
      await writeSettlementJournal(journal);
      return false;
    }
    if (replay.deliveryAcknowledgedAt !== null) return true;
    replay.deliveryAcknowledgedAt = now;
    replay.sealedToken = null;
    await writeSettlementJournal(journal);
    return true;
  });
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
    // A regular re-pair must not supersede an unresolved durable pairing
    // transaction for this installation: doing so could make its predecessor
    // revocation irreversible before the replacement has a replay receipt.
    // Stale transactions are safely rolled back first; a live one is left for
    // its exact pairing retry to recover.
    const settlementJournal = await readSettlementJournalForMutation();
    const settlementCleanup = pruneSettlementJournal(store, settlementJournal, now);
    await persistSettlementCleanup(store, settlementJournal, settlementCleanup);
    if (
      settlementJournal.transactions.some(
        (entry) => entry.credential.installationId === installationId,
      )
    ) {
      throw new Error("A credential replacement for this installation is awaiting settlement.");
    }
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
      revocationGeneration: 0,
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
      return {
        ...existing,
        revokedAt: monotonicTimestamp(now, existing.createdAt, existing.lastUsedAt),
        revocationGeneration: nextRevocationGeneration(existing.revocationGeneration),
      };
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
 * Verify a bearer token against every stored authority hash in constant time,
 * returning the credential it belongs to or null if it is malformed, unknown,
 * or revoked. The raw token is hashed once here and never stored in the
 * authority record; every stored hash is checked so timing does not vary with
 * how many earlier credentials in the store are unrelated non-matches.
 *
 * `now` also bounds an exposure-fenced credential whose first response may
 * have been lost: it is valid only until the holder makes the first
 * authenticated request, which durably acknowledges delivery.
 */
export async function verifyCredential(
  token: string,
  now = Date.now(),
): Promise<SafeClientCredential | null> {
  if (!token) return null;
  const { credentials } = await readStore();
  const suppliedHash = hashToken(token);
  let match: ClientCredential | null = null;
  for (const credential of credentials) {
    if (timingSafeEqualString(suppliedHash, credential.tokenHash)) match = credential;
  }
  if (!match || match.revokedAt !== null) return null;
  // A malformed/unreadable journal must not turn an uncertain credential
  // into an indefinitely valid bearer. Fail closed until the local authority
  // can be repaired or the credential is explicitly revoked.
  let journal: CredentialSettlementJournal;
  try {
    journal = await readSettlementJournalForMutation();
  } catch {
    return null;
  }
  const pendingDelivery = journal.replays.find(
    (entry) =>
      entry.credential.id === match.id
      && entry.deliveryAcknowledgedAt === null,
  );
  if (pendingDelivery && pendingDelivery.expiresAt <= now) return null;
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
 * Revoke a credential. The first revoke records a stable `revokedAt`;
 * every explicit revoke advances the private generation, including one that
 * finds an already-revoked credential. That durable generation makes an
 * administrator's revocation supersede a temporary pairing replacement
 * revocation with the same timestamp. A caller-supplied `now` that is stale
 * or explicitly earlier than the credential's own `createdAt`/`lastUsedAt`
 * is clamped forward via `monotonicTimestamp` before being persisted, so
 * `revokedAt` can never precede `createdAt`.
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
    }
    credential.revocationGeneration = nextRevocationGeneration(credential.revocationGeneration);
    await writeStore(store);
    return true;
  });
}
