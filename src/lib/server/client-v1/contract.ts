// Public contract for the loopback-only, paired-and-scoped `/api/client/v1`
// Cave API. Route handlers under `src/app/api/client/v1/*` will parse
// untrusted request bodies through the functions below and delegate business
// logic to sibling modules in `src/lib/server/client-v1/*`; this module owns
// only the shape of the wire contract (version constants, scopes, error
// codes, and strict parsers) so it stays stable and reviewable on its own as
// the handlers and stores are built out in later tasks.

/** Semantic version of the `/api/client/v1` wire contract itself. */
export const CLIENT_V1_API_VERSION = "1.0";

/** Oldest client build the server will still talk to. */
export const CLIENT_V1_MIN_CLIENT_VERSION = "0.1.0";

// The full, least-privilege scope set a pairing may request. There is
// deliberately no wildcard/admin scope: every capability a paired client can
// exercise must be named here and approved explicitly during pairing.
export const CLIENT_V1_SCOPES = [
  "chat:read",
  "chat:write",
  "conversations:write",
  "attachments:write",
  "tasks:write",
  "github:write",
] as const;

export type ClientV1Scope = (typeof CLIENT_V1_SCOPES)[number];

const CLIENT_V1_SCOPE_SET: ReadonlySet<string> = new Set(CLIENT_V1_SCOPES);

export function isClientV1Scope(value: unknown): value is ClientV1Scope {
  return typeof value === "string" && CLIENT_V1_SCOPE_SET.has(value);
}

export const CLIENT_V1_ERROR_CODES = [
  "invalid_request",
  "unauthorized",
  "scope_denied",
  "not_found",
  "conflict",
  "rate_limited",
  "pairing_pending",
  "pairing_denied",
  "pairing_expired",
  "incompatible_version",
  "service_unavailable",
  "internal_error",
] as const;

export type ClientV1ErrorCode = (typeof CLIENT_V1_ERROR_CODES)[number];

/** The stable error envelope every `/api/client/v1` failure response shares. */
export type ClientV1ErrorBody = {
  ok: false;
  error: {
    code: ClientV1ErrorCode;
    message: string;
    retryable: boolean;
    details?: Record<string, string>;
    diagnosticId?: string;
  };
};

/**
 * Thrown by strict parsers (e.g. {@link parseIdempotencyKey},
 * {@link parsePairingRequest}) that report failure via exception rather than
 * a result wrapper. Callers convert this into the stable `/api/client/v1`
 * error envelope via `clientV1Error`.
 */
export class ClientV1RequestError extends Error {
  readonly code: ClientV1ErrorCode;

  constructor(code: ClientV1ErrorCode, message: string) {
    super(message);
    this.name = "ClientV1RequestError";
    this.code = code;
  }
}

export type PairingRequestInput = {
  appName: string;
  installationId: string;
  scopes: ClientV1Scope[];
};

// Strict RFC 4122 UUID: version nibble restricted to 1-8 and variant nibble
// restricted to 8/9/a/b, case-insensitive on input, normalized to lower case.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const APP_NAME_MIN_LENGTH = 2;
const APP_NAME_MAX_LENGTH = 80;

// True plain objects only: object literals and `Object.create(null)`/
// `Object.create(Object.prototype)` values. Arrays and class instances
// (including built-ins like `Date`/`Map`) have a different prototype and are
// rejected, so a pairing request can't smuggle in unexpected getters,
// methods, or prototype-chain surprises.
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function invalidRequest(message: string): never {
  throw new ClientV1RequestError("invalid_request", message);
}

// Trims surrounding whitespace (headers and body fields commonly pick up
// incidental padding) before validating against the strict UUID shape, so
// callers never have to trim themselves.
function normalizeUuid(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return UUID_RE.test(trimmed) ? trimmed : null;
}

/**
 * Strictly parses an `Idempotency-Key` header/body value. Surrounding
 * whitespace is trimmed before validation (headers commonly pick up
 * incidental padding), but the remaining value must be exactly a UUID string
 * with a valid RFC 4122 version (1-8) and variant (8/9/a/b) nibble; anything
 * else — missing, non-string, or malformed — throws a
 * {@link ClientV1RequestError} rather than being coerced, so idempotency
 * storage keys stay canonical. Returns the normalized (lower case) UUID
 * string directly on success.
 */
export function parseIdempotencyKey(value: string | null): string {
  const uuid = normalizeUuid(value);
  if (!uuid) {
    throw new ClientV1RequestError("invalid_request", "Idempotency-Key must be a UUID");
  }
  return uuid;
}

/**
 * Strictly parses a pairing request body. Rejects anything that is not a
 * true plain object — arrays, `null`, primitives, and class instances
 * (including built-ins like `Date`) are all rejected, not just non-objects —
 * an out-of-bounds or non-string `appName`, a non-UUID `installationId`, and
 * any `scopes` entry outside the known least-privilege set (including
 * unknown or admin-shaped scopes). Duplicate scopes are de-duplicated while
 * preserving first-seen order, and at least one scope is required. Returns
 * the parsed {@link PairingRequestInput} directly on success; throws a
 * {@link ClientV1RequestError} on any validation failure rather than
 * returning a result wrapper.
 */
export function parsePairingRequest(body: unknown): PairingRequestInput {
  if (!isPlainObject(body)) {
    invalidRequest("Request body must be a JSON object");
  }

  const { appName, installationId, scopes } = body;

  if (typeof appName !== "string") {
    invalidRequest("appName must be a string");
  }
  const trimmedAppName = appName.trim();
  if (trimmedAppName.length < APP_NAME_MIN_LENGTH || trimmedAppName.length > APP_NAME_MAX_LENGTH) {
    invalidRequest(
      `appName must be between ${APP_NAME_MIN_LENGTH} and ${APP_NAME_MAX_LENGTH} characters`,
    );
  }

  const normalizedInstallationId = normalizeUuid(installationId);
  if (!normalizedInstallationId) {
    invalidRequest("installationId must be a UUID");
  }

  if (!Array.isArray(scopes) || scopes.length === 0) {
    invalidRequest("scopes must be a non-empty array");
  }

  const seen = new Set<ClientV1Scope>();
  const orderedScopes: ClientV1Scope[] = [];
  for (const scope of scopes) {
    if (!isClientV1Scope(scope)) {
      invalidRequest(`Unknown scope: ${JSON.stringify(scope)}`);
    }
    if (!seen.has(scope)) {
      seen.add(scope);
      orderedScopes.push(scope);
    }
  }

  return {
    appName: trimmedAppName,
    installationId: normalizedInstallationId,
    scopes: orderedScopes,
  };
}
