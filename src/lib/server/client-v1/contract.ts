// Public v1 contract for the standalone OpenCoven Chat client facade
// (`/api/client/v1`). This module defines the version, scopes, error taxonomy,
// and strict request parsers that later route handlers depend on. Nothing
// here talks to disk, network, or auth — it is pure types + validation so the
// contract can be locked and tested in isolation before any route exists.

/** Semver-ish string identifying the shape of this facade's responses. */
export const CLIENT_V1_API_VERSION = "1.0";

/** Oldest client build the server still accepts pairing/requests from. */
export const CLIENT_V1_MIN_CLIENT_VERSION = "0.1.0";

/**
 * The full set of scopes a client can request during pairing. Keep this list
 * additive — removing or renaming an entry breaks already-paired clients.
 */
export const CLIENT_V1_SCOPES = [
  "chat:read",
  "chat:write",
  "conversations:write",
  "attachments:write",
  "tasks:write",
  "github:write",
] as const;

export type ClientV1Scope = (typeof CLIENT_V1_SCOPES)[number];

const SCOPE_SET: ReadonlySet<string> = new Set(CLIENT_V1_SCOPES);

function isClientV1Scope(value: unknown): value is ClientV1Scope {
  return typeof value === "string" && SCOPE_SET.has(value);
}

/**
 * Stable error codes for the v1 facade. These are part of the wire contract:
 * clients branch on `code`, not on `message` (which is human text and may be
 * localized or reworded later).
 *
 * `forbidden` (added for Task 7's conversation mutations) is distinct from
 * `scope_denied`: `scope_denied` describes the CALLER'S bearer credential
 * lacking a required scope, while `forbidden` describes a Cave-side
 * familiar/project authorization rule rejecting an otherwise well-scoped,
 * well-shaped request (e.g. the requested familiar has no grant for the
 * requested project) — reusing `scope_denied` for that case would incorrectly
 * suggest the credential itself needs a different scope to succeed.
 */
export type ClientV1ErrorCode =
  | "invalid_request"
  | "unauthorized"
  | "scope_denied"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "operation_already_started"
  | "rate_limited"
  | "pairing_pending"
  | "pairing_denied"
  | "pairing_expired"
  | "pairing_already_exchanged"
  | "incompatible_version"
  | "service_unavailable"
  | "internal_error";

export type ClientV1ErrorBody = {
  ok: false;
  error: {
    code: ClientV1ErrorCode;
    message: string;
    retryable: boolean;
    details?: Record<string, unknown>;
    diagnosticId?: string;
  };
};

/** Body a client submits to begin pairing a new installation. */
export type PairingRequestInput = {
  appName: string;
  installationId: string;
  scopes: ClientV1Scope[];
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Case-insensitive check that a value is a syntactically valid RFC 4122
 * UUID (version 1-8, variant 8/9/a/b). Shared by every module in this
 * facade that needs to validate an id-shaped string — pairing/credential
 * identifiers and installation ids alike — so the shape rule lives in
 * exactly one place.
 */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

const APP_NAME_MIN_LENGTH = 2;
const APP_NAME_MAX_LENGTH = 80;

// The pairing request body's ENTIRE allowed shape — exactly these three keys,
// nothing else. Checked before any field is read so an extra/typo'd key
// (e.g. a caller accidentally forwarding an admin-only field, or probing for
// undocumented behavior) is rejected outright rather than silently ignored.
const PAIRING_REQUEST_ALLOWED_KEYS: ReadonlySet<string> = new Set([
  "appName",
  "installationId",
  "scopes",
]);

/**
 * Parses and validates an `Idempotency-Key` header value. Accepts only
 * RFC 4122-shaped UUIDs (version 1-8, variant 8/9/a/b) after trimming
 * surrounding whitespace; throws on anything else, including `null`/empty.
 */
export function parseIdempotencyKey(value: string | null): string {
  const trimmed = (value ?? "").trim();
  if (!isUuid(trimmed)) {
    throw new Error("Idempotency-Key must be a valid UUID.");
  }
  return trimmed;
}

/**
 * Parses and validates a pairing request body. Rejects malformed shapes,
 * out-of-range app names, non-UUID installation ids, and empty or unknown
 * scopes. Identity fields are trimmed; scopes are deduplicated while
 * preserving the order of first occurrence.
 */
export function parsePairingRequest(value: unknown): PairingRequestInput {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Pairing request must be a JSON object.");
  }

  const record = value as Record<string, unknown>;

  for (const key of Object.keys(record)) {
    if (!PAIRING_REQUEST_ALLOWED_KEYS.has(key)) {
      throw new Error(`Pairing request contains an unknown field: "${key}".`);
    }
  }

  if (typeof record.appName !== "string") {
    throw new Error("Pairing request field \"appName\" must be a string.");
  }
  const appName = record.appName.trim();
  if (appName.length < APP_NAME_MIN_LENGTH || appName.length > APP_NAME_MAX_LENGTH) {
    throw new Error(
      `Pairing request field "appName" must be between ${APP_NAME_MIN_LENGTH} and ${APP_NAME_MAX_LENGTH} characters.`,
    );
  }

  if (typeof record.installationId !== "string") {
    throw new Error("Pairing request field \"installationId\" must be a string.");
  }
  const installationId = record.installationId.trim();
  if (!isUuid(installationId)) {
    throw new Error("Pairing request field \"installationId\" must be a valid UUID.");
  }

  if (!Array.isArray(record.scopes) || record.scopes.length === 0) {
    throw new Error("Pairing request field \"scopes\" must be a non-empty array.");
  }

  const scopes: ClientV1Scope[] = [];
  const seen = new Set<string>();
  for (const scope of record.scopes) {
    if (typeof scope !== "string") {
      throw new Error(`Pairing request contains an unknown scope: ${String(scope)}.`);
    }
    const normalizedScope = scope.trim();
    if (!isClientV1Scope(normalizedScope)) {
      throw new Error(`Pairing request contains an unknown scope: ${normalizedScope || String(scope)}.`);
    }
    if (!seen.has(normalizedScope)) {
      seen.add(normalizedScope);
      scopes.push(normalizedScope);
    }
  }

  return { appName, installationId, scopes };
}
