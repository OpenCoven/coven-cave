// The reviewed operation registry. A value import, but a cheap one: operations.ts
// is frozen data whose own imports are all `import type` and therefore erased,
// so contract.ts keeps the property proxy-helpers.ts depends on — pulling it in
// costs the proxy no runtime dependency.
import { clientV1OperationRecords } from "./operations.ts";

export const CLIENT_V1_API_VERSION = "1.0";
export const CLIENT_V1_MIN_CLIENT_VERSION = "0.1.0";
export const CLIENT_V1_PAIRING_SECRET_HEADER = "x-coven-pairing-secret";

/**
 * Every Client v1 resource route requires a paired credential. Stated as a
 * contract fact rather than a runtime setting because there is no unpaired
 * mode to report — a client that reads `false` here would have nowhere to send
 * an unauthenticated request. It lives in the fixture so that introducing such
 * a mode has to change the contract in review rather than quietly at runtime.
 */
export const CLIENT_V1_PAIRING_REQUIRED = true;

const freezeReadonlyArray = <const T extends readonly string[]>(value: T): T => Object.freeze([...value]) as T;
const freezeReadonlyObject = <const T extends Record<string, unknown>>(value: T): Readonly<T> =>
  Object.freeze({ ...value });

export const CLIENT_V1_SCOPES = freezeReadonlyArray([
  "chat:read",
  "chat:write",
  "conversations:write",
  "attachments:write",
  "tasks:write",
  "github:write",
] as const);

/**
 * The live capability families this build serves.
 *
 * A REVIEWED LITERAL, deliberately not derived. `operations.ts` derives the
 * same list from operation membership and `operations.test.ts` asserts the two
 * agree, so this array is the compatibility ratchet: a family cannot appear
 * without an operation claiming it and a route owning that operation, and a
 * family cannot *disappear* as a side effect of deleting a route — the deletion
 * has to be spelled out here, in review. See operations.ts for why deriving
 * both sides from one source would make the pair assert nothing.
 *
 * A family names what the surface can do, never what a given caller may do:
 * `credentials` is administrator-authority only (see the operation ids ending
 * in `.admin.…`), and a paired bearer can never invoke it.
 */
export const CLIENT_V1_CAPABILITIES = freezeReadonlyArray([
  "health",
  "pairing",
  "credentials",
  "familiars",
  "projects",
  "conversations",
  "conversation-messages",
  "cursors",
] as const);

/**
 * Every operation this build can actually be asked to perform.
 *
 * The authoritative programmatic support inventory, and the thing an SDK's
 * `supports()` should read. Capability families above are the coarse summary
 * for display; these are the invokable units, so a client can tell
 * `conversations.list` from `conversations.read` rather than guessing from one
 * `conversations` label.
 *
 * NAMING IS PART OF THE CONTRACT. An id containing `.admin.` requires the
 * Cave's own per-launch sidecar token over direct loopback and is NEVER
 * reachable with a paired bearer, whatever scopes that bearer holds. The
 * infix is asserted against each operation's reviewed ingress class in
 * `operations.test.ts`, so the wire string is self-describing and a client does
 * not have to consult a table to avoid calling something it can never reach.
 *
 * An id also names a FIXED method and path for the life of `apiVersion` 1.x.
 * Moving a route is therefore a rename, and a rename is a compatibility
 * decision rather than an edit — which is what lets a client resolve an id to a
 * request without probing arbitrary paths.
 *
 * Like the capability list, a reviewed literal cross-checked against the
 * registry in `operations.ts` and against the routes on disk in
 * `src/app/api/api-contracts.test.ts`.
 */
export const CLIENT_V1_OPERATIONS = freezeReadonlyArray([
  "health.read",
  "pairing.create",
  "pairing.poll",
  "pairing.exchange",
  "pairing.admin.list",
  "pairing.admin.decide",
  "credentials.admin.list",
  "credentials.admin.revoke",
  "familiars.list",
  "projects.list",
  "conversations.list",
  "conversations.read",
  "messages.list",
] as const);

export const CLIENT_V1_ERROR_CODES = freezeReadonlyArray([
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
  "reconcile_required",
  "internal_error",
] as const);

export const CLIENT_V1_IDENTITY_KINDS = freezeReadonlyArray([
  "client",
  "credential",
  "familiar",
  "project",
  "conversation",
  "message",
  "event",
] as const);

export const CLIENT_V1_LIMITS = freezeReadonlyObject({
  idempotencyKeyCharacters: 36,
  requestIdCharacters: 64,
  revisionTokenCharacters: 128,
  cursorCharacters: 512,
  errorMessageCharacters: 256,
  errorDetailEntries: 16,
  errorDetailValueCharacters: 256,
  defaultPageSize: 50,
  maxPageSize: 100,
  instanceIdCharacters: 64,
  releaseVersionCharacters: 64,
  /**
   * The ceiling a consumer parser applies to one advertised capability or
   * operation id. Consumers must tolerate ids they do not know (see
   * parseClientV1AdvertisedCapabilities), so "unknown" cannot mean "unbounded"
   * — without a limit, tolerance is an invitation to allocate.
   */
  declarationIdCharacters: 64,
} as const);

export type ClientV1PublicRoute = {
  method: "GET" | "POST";
  path: string;
};

export const CLIENT_V1_PUBLIC_ROUTES = Object.freeze([
  Object.freeze({ method: "GET", path: "/api/client/v1/health" }),
  Object.freeze({ method: "POST", path: "/api/client/v1/pairing/requests" }),
  Object.freeze({ method: "GET", path: "/api/client/v1/pairing/requests/:id" }),
  Object.freeze({
    method: "POST",
    path: "/api/client/v1/pairing/requests/:id/exchange",
  }),
] satisfies ClientV1PublicRoute[]);

export const CLIENT_V1_DISCOVERY_CONTRACT = freezeReadonlyObject({
  fileName: "client-v1-discovery.json",
  mode: "0600",
  version: 1,
} as const);

export type ClientV1Scope = (typeof CLIENT_V1_SCOPES)[number];
export type ClientV1Capability = (typeof CLIENT_V1_CAPABILITIES)[number];
export type ClientV1Operation = (typeof CLIENT_V1_OPERATIONS)[number];
export type ClientV1ErrorCode = (typeof CLIENT_V1_ERROR_CODES)[number];
export type ClientV1IdentityKind = (typeof CLIENT_V1_IDENTITY_KINDS)[number];

export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | JsonObject;
export type JsonObject = { [key: string]: JsonValue };
export type ClientV1Record = JsonObject;
export type ClientV1IdempotencyKey = string & {
  readonly __clientV1IdempotencyKey: unique symbol;
};

export interface ClientV1PairingCreateRequest {
  appName: string;
  installationId: string;
  scopes: ClientV1Scope[];
}

export type ClientV1Identity = {
  kind: ClientV1IdentityKind;
  id: string;
  displayName?: string;
} & ClientV1Record;

export type ClientV1Revision = {
  token: string;
  updatedAt: string;
} & ClientV1Record;

export type ClientV1Cursor = {
  current?: string;
  next?: string;
  previous?: string;
  hasMore: boolean;
} & ClientV1Record;

export type ClientV1StatusRecord = {
  status: string;
} & ClientV1Record;

/**
 * The `data` half of the Client v1 health response.
 *
 * `apiVersion`, `minimumClientVersion` and `capabilities` are deliberately
 * absent: they ride the shared envelope, and repeating them here would let one
 * response carry two different answers to the same question.
 */
export type ClientV1Health = {
  instanceId: string;
  pairingRequired: typeof CLIENT_V1_PAIRING_REQUIRED;
  releaseVersion: string;
} & ClientV1Record;

export type ClientV1EnvelopeBase = {
  apiVersion: typeof CLIENT_V1_API_VERSION;
  minimumClientVersion: typeof CLIENT_V1_MIN_CLIENT_VERSION;
  capabilities: ClientV1Capability[];
  /**
   * The live operation inventory, on every response.
   *
   * Required rather than optional: it is what an SDK's `supports()` reads, and
   * a field a client has to test for presence of is a field it cannot rely on.
   * Ids only, deliberately — the envelope rides every response including error
   * responses, so the id→(method, path, authority) mapping lives in the
   * generated contract fixture, which a client vendors once. The mapping is
   * fixed for the life of `apiVersion` 1.x (see CLIENT_V1_OPERATIONS), so ids
   * plus the vendored fixture answer route availability with no probing.
   */
  operations: ClientV1Operation[];
  requestId?: string;
  identity?: ClientV1Identity;
  revision?: ClientV1Revision;
  cursor?: ClientV1Cursor;
} & ClientV1Record;

export type ClientV1Error = {
  code: ClientV1ErrorCode;
  message: string;
  details?: Record<string, string>;
  retryable: boolean;
} & ClientV1Record;

export type ClientV1SuccessEnvelope<TData extends ClientV1Record = ClientV1Record> = ClientV1EnvelopeBase & {
  data: TData;
  // Excludes `error` at the type level so success and error envelopes stay a
  // precise discriminated union instead of both accepting either field via
  // ClientV1Record's string index signature.
  error?: never;
};

export type ClientV1ErrorEnvelope = ClientV1EnvelopeBase & {
  error: ClientV1Error;
  data?: never;
};

/**
 * One operation as the generated fixture publishes it.
 *
 * This is the record that lets a client resolve an advertised id to a request
 * without probing arbitrary paths — the second hard constraint #4869 sets. It
 * is published in the fixture rather than in the envelope because the envelope
 * rides every response and this does not need to.
 */
export type ClientV1OperationManifestEntry = {
  id: string;
  method: string;
  path: string;
  ingress: string;
  scope: string | null;
  families: string[];
};

export type ClientV1ContractManifest = {
  apiVersion: typeof CLIENT_V1_API_VERSION;
  minimumClientVersion: typeof CLIENT_V1_MIN_CLIENT_VERSION;
  capabilities: ClientV1Capability[];
  operations: ClientV1OperationManifestEntry[];
  discovery: typeof CLIENT_V1_DISCOVERY_CONTRACT;
  pairingRequired: typeof CLIENT_V1_PAIRING_REQUIRED;
  pairingScopes: ClientV1Scope[];
  pairingSecretHeader: typeof CLIENT_V1_PAIRING_SECRET_HEADER;
  publicRoutes: ClientV1PublicRoute[];
  identityKinds: ClientV1IdentityKind[];
  errorCodes: ClientV1ErrorCode[];
  limits: typeof CLIENT_V1_LIMITS;
};

export type ClientV1ContractFixture = {
  contract: ClientV1ContractManifest;
  examples: {
    status: ClientV1StatusRecord;
    health: ClientV1Health;
    identity: ClientV1Identity;
    revision: ClientV1Revision;
    cursor: ClientV1Cursor;
    successEnvelope: ClientV1SuccessEnvelope<ClientV1StatusRecord>;
    errorEnvelope: ClientV1ErrorEnvelope;
    healthEnvelope: ClientV1SuccessEnvelope<ClientV1Health>;
    pairingCreatedEnvelope: ClientV1SuccessEnvelope<{
      requestId: string;
      secret: string;
      expiresAt: number;
    }>;
    pairingStatusEnvelope: ClientV1SuccessEnvelope<{
      id: string;
      status: "approved";
      expiresAt: number;
    }>;
    pairingExchangeEnvelope: ClientV1SuccessEnvelope<{
      bearer: string;
      credential: {
        id: string;
        appName: string;
        installationId: string;
        scopes: ClientV1Scope[];
        createdAt: number;
        lastUsedAt: null;
        revokedAt: null;
        revocationReason: null;
      };
    }>;
    discoveryRecord: {
      version: 1;
      endpoint: string;
      pid: number;
      nonce: string;
      startedAt: string;
    };
  };
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_8601_TIMESTAMP_RE =
  /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
const ARRAY_INDEX_RE = /^(?:0|[1-9]\d*)$/;
const CLIENT_V1_SCOPE_SET = new Set<string>(CLIENT_V1_SCOPES);
const CLIENT_V1_CAPABILITY_SET = new Set<string>(CLIENT_V1_CAPABILITIES);
const CLIENT_V1_OPERATION_SET = new Set<string>(CLIENT_V1_OPERATIONS);
const CLIENT_V1_ERROR_CODE_SET = new Set<string>(CLIENT_V1_ERROR_CODES);
const CLIENT_V1_IDENTITY_KIND_SET = new Set<string>(CLIENT_V1_IDENTITY_KINDS);

function rejectNonJsonValue(): never {
  throw new Error("Client v1 values must be JSON-safe plain values.");
}

function parseClientV1JsonValueInner(value: unknown, ancestors: Set<object>): JsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    if (Number.isFinite(value) && !Object.is(value, -0)) return value;
    return rejectNonJsonValue();
  }
  if (typeof value !== "object" || ancestors.has(value)) {
    return rejectNonJsonValue();
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) {
        return rejectNonJsonValue();
      }
      for (const key of Reflect.ownKeys(value)) {
        if (key === "length") continue;
        if (typeof key !== "string" || !ARRAY_INDEX_RE.test(key) || Number(key) >= value.length) {
          return rejectNonJsonValue();
        }
      }
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
          return rejectNonJsonValue();
        }
        parseClientV1JsonValueInner(descriptor.value, ancestors);
      }
      return value as JsonValue[];
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return rejectNonJsonValue();
    }
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") return rejectNonJsonValue();
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
        return rejectNonJsonValue();
      }
      parseClientV1JsonValueInner(descriptor.value, ancestors);
    }
    return value as JsonObject;
  } finally {
    ancestors.delete(value);
  }
}

export function parseClientV1JsonValue(value: unknown): JsonValue {
  return parseClientV1JsonValueInner(value, new Set());
}

export function parseClientV1JsonObject(value: unknown): JsonObject {
  const parsed = parseClientV1JsonValue(value);
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error("Client v1 values must be JSON-safe plain objects.");
  }
  return parsed;
}

function requiredRecord(value: unknown, name: string): ClientV1Record {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Client v1 ${name} must be an object.`);
  }
  return parseClientV1JsonObject(value);
}

function requiredString(value: unknown, name: string, maxLength?: number): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Client v1 ${name} must be a non-empty string.`);
  }
  if (maxLength !== undefined && value.length > maxLength) {
    throw new Error(`Client v1 ${name} must be at most ${maxLength} characters.`);
  }
  return value;
}

function requiredIsoTimestamp(value: unknown, name: string): string {
  const iso = requiredString(value, name);
  const match = ISO_8601_TIMESTAMP_RE.exec(iso);
  if (!match) {
    throw new Error(`Client v1 ${name} must be an ISO-8601 timestamp.`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > daysInMonth) {
    throw new Error(`Client v1 ${name} must be an ISO-8601 timestamp.`);
  }
  return iso;
}

function parseUniqueStringEnumList<T extends string>(
  value: unknown,
  name: string,
  supported: ReadonlySet<string>,
): T[] {
  // Shape before JSON-safety, so an ABSENT list is reported as the field it is.
  // The other order answered a missing `operations` with "values must be
  // JSON-safe plain values", which names neither the field nor the problem —
  // and `operations` is required, so absence is the failure a client is most
  // likely to hit.
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Client v1 ${name} must be a non-empty array.`);
  }
  parseClientV1JsonValue(value);
  const items: T[] = [];
  for (const candidate of value) {
    if (typeof candidate !== "string" || !supported.has(candidate)) {
      throw new Error(`Client v1 ${name} entry is not supported.`);
    }
    if (items.includes(candidate as T)) {
      throw new Error(`Client v1 ${name} must not contain duplicates.`);
    }
    items.push(candidate as T);
  }
  return items;
}

export function parseClientV1IdempotencyKey(value: unknown): ClientV1IdempotencyKey {
  if (typeof value !== "string" || value.length !== CLIENT_V1_LIMITS.idempotencyKeyCharacters || !UUID_RE.test(value)) {
    throw new Error("Client v1 idempotency key must be a UUID.");
  }
  return value as ClientV1IdempotencyKey;
}

export function parseClientV1PairingScopes(value: unknown): ClientV1Scope[] {
  return parseUniqueStringEnumList<ClientV1Scope>(value, "pairing scopes", CLIENT_V1_SCOPE_SET);
}

export function parseClientV1PairingCreateRequest(
  value: unknown,
): ClientV1PairingCreateRequest {
  const request = requiredRecord(value, "pairing request");
  const allowedKeys = new Set(["appName", "installationId", "scopes"]);
  if (Object.keys(request).some((key) => !allowedKeys.has(key))) {
    throw new Error("Client v1 pairing request contains an unsupported field.");
  }
  const appName = requiredString(request.appName, "pairing appName", 128).trim();
  if (/[\u0000-\u001f\u007f]/u.test(appName)) {
    throw new Error("Client v1 pairing appName contains invalid characters.");
  }
  const installationId = requiredString(
    request.installationId,
    "pairing installationId",
    128,
  ).trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(installationId)) {
    throw new Error("Client v1 pairing installationId is malformed.");
  }
  return {
    appName,
    installationId,
    scopes: parseClientV1PairingScopes(request.scopes),
  };
}

export function parseClientV1PairingRequestId(value: unknown): string {
  if (typeof value !== "string" || !UUID_RE.test(value)) {
    throw new Error("Client v1 pairing request id must be a UUID.");
  }
  return value;
}

export function parseClientV1PairingSecret(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/u.test(value)) {
    throw new Error("Client v1 pairing secret is malformed.");
  }
  return value;
}

export function parseClientV1Capabilities(value: unknown): ClientV1Capability[] {
  return parseUniqueStringEnumList<ClientV1Capability>(value, "capabilities", CLIENT_V1_CAPABILITY_SET);
}

export function parseClientV1Operations(value: unknown): ClientV1Operation[] {
  return parseUniqueStringEnumList<ClientV1Operation>(value, "operations", CLIENT_V1_OPERATION_SET);
}

/**
 * A declaration id as it appears on the wire, with no membership test.
 *
 * THE PRODUCER AND CONSUMER RULES ARE DELIBERATELY DIFFERENT, and this is the
 * consumer half.
 *
 * Cave is the producer: `parseClientV1Capabilities` and
 * `parseClientV1Operations` above are registry-closed, so this build cannot
 * export an id that no reviewed record backs, and the generated fixture pins
 * what it does export.
 *
 * A CONSUMER — Chat, an SDK, anything vendoring an older fixture — must not
 * refuse an envelope merely because a newer compatible Cave advertises
 * something it has not heard of. Adding an operation or family is additive by
 * contract: a new id never becomes *required* just by appearing, so an older
 * consumer that ignores it keeps working. A strict consumer would invert that,
 * turning every additive minor release into a breaking one.
 *
 * So the consumer parsers below validate SHAPE — a non-empty array of unique,
 * well-formed, bounded id strings — and preserve unknown ids for diagnostics
 * rather than rejecting them. What a consumer must never do is the opposite
 * error: treating an id it does not understand as behaviour it supports.
 */
const CLIENT_V1_DECLARATION_ID = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u;

function parseAdvertisedIds(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Client v1 ${name} must be a non-empty array.`);
  }
  parseClientV1JsonValue(value);
  const ids: string[] = [];
  for (const candidate of value) {
    if (
      typeof candidate !== "string"
      || candidate.length > CLIENT_V1_LIMITS.declarationIdCharacters
      || !CLIENT_V1_DECLARATION_ID.test(candidate)
    ) {
      throw new Error(`Client v1 ${name} entry is malformed.`);
    }
    if (ids.includes(candidate)) {
      throw new Error(`Client v1 ${name} must not contain duplicates.`);
    }
    ids.push(candidate);
  }
  return ids;
}

/** Consumer-side: advertised capability families, unknown ids preserved. */
export function parseClientV1AdvertisedCapabilities(value: unknown): string[] {
  return parseAdvertisedIds(value, "capabilities");
}

/** Consumer-side: the advertised operation inventory, unknown ids preserved. */
export function parseClientV1AdvertisedOperations(value: unknown): string[] {
  return parseAdvertisedIds(value, "operations");
}

export function parseClientV1RequestId(value: unknown): string {
  return requiredString(value, "requestId", CLIENT_V1_LIMITS.requestIdCharacters);
}

export function parseClientV1Health(value: unknown): ClientV1Health {
  const health = requiredRecord(value, "health");
  requiredString(health.instanceId, "health instanceId", CLIENT_V1_LIMITS.instanceIdCharacters);
  if (health.pairingRequired !== CLIENT_V1_PAIRING_REQUIRED) {
    throw new Error("Client v1 health pairingRequired must be true.");
  }
  requiredString(health.releaseVersion, "health releaseVersion", CLIENT_V1_LIMITS.releaseVersionCharacters);
  return health as ClientV1Health;
}

export function parseClientV1Identity(value: unknown): ClientV1Identity {
  const identity = requiredRecord(value, "identity");
  if (typeof identity.kind !== "string" || !CLIENT_V1_IDENTITY_KIND_SET.has(identity.kind)) {
    throw new Error("Client v1 identity kind is not supported.");
  }
  requiredString(identity.id, "identity id");
  if (identity.displayName !== undefined) requiredString(identity.displayName, "identity displayName");
  return identity as ClientV1Identity;
}

export function parseClientV1Revision(value: unknown): ClientV1Revision {
  const revision = requiredRecord(value, "revision");
  requiredString(revision.token, "revision token", CLIENT_V1_LIMITS.revisionTokenCharacters);
  requiredIsoTimestamp(revision.updatedAt, "revision updatedAt");
  return revision as ClientV1Revision;
}

export function parseClientV1Cursor(value: unknown): ClientV1Cursor {
  const cursor = requiredRecord(value, "cursor");
  if (typeof cursor.hasMore !== "boolean") {
    throw new Error("Client v1 cursor hasMore must be a boolean.");
  }
  const current = cursor.current === undefined
    ? undefined
    : requiredString(cursor.current, "cursor current", CLIENT_V1_LIMITS.cursorCharacters);
  const next = cursor.next === undefined
    ? undefined
    : requiredString(cursor.next, "cursor next", CLIENT_V1_LIMITS.cursorCharacters);
  const previous = cursor.previous === undefined
    ? undefined
    : requiredString(cursor.previous, "cursor previous", CLIENT_V1_LIMITS.cursorCharacters);
  if (!current && !next && !previous) {
    throw new Error("Client v1 cursor must publish at least one current, next, or previous token.");
  }
  return cursor as ClientV1Cursor;
}

export function parseClientV1StatusRecord(value: unknown): ClientV1StatusRecord {
  const status = requiredRecord(value, "status");
  requiredString(status.status, "status");
  return status as ClientV1StatusRecord;
}

export function parseClientV1ErrorDetails(value: unknown): Record<string, string> {
  const details = requiredRecord(value, "error details");
  const entries = Object.entries(details);
  if (entries.length > CLIENT_V1_LIMITS.errorDetailEntries) {
    throw new Error(
      `Client v1 error details must have at most ${CLIENT_V1_LIMITS.errorDetailEntries} entries.`,
    );
  }
  for (const [key, detail] of entries) {
    requiredString(key, "error detail key");
    requiredString(
      detail,
      `error detail "${key}"`,
      CLIENT_V1_LIMITS.errorDetailValueCharacters,
    );
  }
  return details as Record<string, string>;
}

function parseClientV1EnvelopeBase(value: unknown): ClientV1EnvelopeBase {
  const envelope = requiredRecord(value, "envelope");
  if (envelope.apiVersion !== CLIENT_V1_API_VERSION) {
    throw new Error(`Client v1 apiVersion must be ${CLIENT_V1_API_VERSION}.`);
  }
  if (envelope.minimumClientVersion !== CLIENT_V1_MIN_CLIENT_VERSION) {
    throw new Error(
      `Client v1 minimumClientVersion must be ${CLIENT_V1_MIN_CLIENT_VERSION}.`,
    );
  }
  parseClientV1Capabilities(envelope.capabilities);
  parseClientV1Operations(envelope.operations);
  if (envelope.requestId !== undefined) parseClientV1RequestId(envelope.requestId);
  if (envelope.identity !== undefined) parseClientV1Identity(envelope.identity);
  if (envelope.revision !== undefined) parseClientV1Revision(envelope.revision);
  if (envelope.cursor !== undefined) parseClientV1Cursor(envelope.cursor);
  return envelope as ClientV1EnvelopeBase;
}

// Phase 0 intentionally validates only the shared success-envelope contract.
// Future route modules can layer stricter payload discriminators on top.
export function parseClientV1SuccessEnvelope<TData extends ClientV1Record = ClientV1Record>(
  value: unknown,
): ClientV1SuccessEnvelope<TData> {
  const envelope = parseClientV1EnvelopeBase(value);
  if (envelope.error !== undefined) {
    throw new Error("Client v1 success envelope must not contain an error.");
  }
  requiredRecord(envelope.data, "success response data");
  return envelope as ClientV1SuccessEnvelope<TData>;
}

export function parseClientV1ErrorEnvelope(value: unknown): ClientV1ErrorEnvelope {
  const envelope = parseClientV1EnvelopeBase(value);
  if (envelope.data !== undefined) {
    throw new Error("Client v1 error envelope must not contain data.");
  }
  const error = requiredRecord(envelope.error, "error");
  if (typeof error.code !== "string" || !CLIENT_V1_ERROR_CODE_SET.has(error.code)) {
    throw new Error("Client v1 error code is not supported.");
  }
  requiredString(error.message, "error message", CLIENT_V1_LIMITS.errorMessageCharacters);
  if (error.details !== undefined) parseClientV1ErrorDetails(error.details);
  if (typeof error.retryable !== "boolean") {
    throw new Error("Client v1 error retryable must be a boolean.");
  }
  return envelope as ClientV1ErrorEnvelope;
}

export function sortClientV1JsonKeys(value: JsonValue): JsonValue {
  const parsed = parseClientV1JsonValue(value);
  if (Array.isArray(parsed)) return parsed.map(sortClientV1JsonKeys);
  if (parsed === null || typeof parsed !== "object") return parsed;
  return Object.fromEntries(
    Object.keys(parsed)
      .sort()
      .map((key) => [key, sortClientV1JsonKeys(parsed[key])]),
  ) as JsonObject;
}

function defineEnumerableValue(target: JsonObject, key: string, value: JsonValue) {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function cloneClientV1JsonValue<T extends JsonValue>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneClientV1JsonValue(entry)) as T;
  }
  if (value === null || typeof value !== "object") {
    return value;
  }

  const clone = Object.create(Object.getPrototypeOf(value)) as JsonObject;
  for (const [key, entry] of Object.entries(value)) {
    defineEnumerableValue(clone, key, cloneClientV1JsonValue(entry));
  }
  return clone as T;
}

function cloneClientV1Record<T extends ClientV1Record>(value: T): T {
  return cloneClientV1JsonValue(value);
}

function defaultCapabilities(): ClientV1Capability[] {
  return [...CLIENT_V1_CAPABILITIES];
}

function defaultOperations(): ClientV1Operation[] {
  return [...CLIENT_V1_OPERATIONS];
}

function envelopeBase(
  overrides: Partial<
    Pick<
      ClientV1EnvelopeBase,
      "requestId" | "identity" | "revision" | "cursor" | "capabilities" | "operations"
    >
  > = {},
): ClientV1EnvelopeBase {
  return {
    apiVersion: CLIENT_V1_API_VERSION,
    minimumClientVersion: CLIENT_V1_MIN_CLIENT_VERSION,
    capabilities: overrides.capabilities ? [...overrides.capabilities] : defaultCapabilities(),
    operations: overrides.operations ? [...overrides.operations] : defaultOperations(),
    ...(overrides.requestId ? { requestId: overrides.requestId } : {}),
    ...(overrides.identity ? { identity: cloneClientV1Record(overrides.identity) } : {}),
    ...(overrides.revision ? { revision: cloneClientV1Record(overrides.revision) } : {}),
    ...(overrides.cursor ? { cursor: cloneClientV1Record(overrides.cursor) } : {}),
  };
}

export function createClientV1ContractFixture(): ClientV1ContractFixture {
  const status: ClientV1StatusRecord = {
    status: "ok",
  };
  // Placeholder values, never the running instance or release: the fixture is
  // a shape contract, and stamping the real version into it would make every
  // release re-write the file that exists to prove the shape did not change.
  const health: ClientV1Health = {
    instanceId: "00000000-0000-4000-8000-000000000000",
    pairingRequired: CLIENT_V1_PAIRING_REQUIRED,
    releaseVersion: "0.0.0",
  };
  const identity: ClientV1Identity = {
    kind: "conversation",
    id: "conversation-example",
    displayName: "Example conversation",
  };
  const revision: ClientV1Revision = {
    token: "conversation-example-revision-1",
    updatedAt: "2026-08-15T00:00:01.000Z",
  };
  const cursor: ClientV1Cursor = {
    // Keep contract.ts data-only for the proxy import graph. contract.test.ts
    // verifies these reviewed literals against the runtime cursor encoder.
    current: "eyJ2IjoxLCJzIjoiMjAyNi0wOC0xNVQwMDowMDowMS4wMDBaIiwiaSI6ImNvbnZlcnNhdGlvbi1leGFtcGxlIn0",
    next: "eyJ2IjoxLCJzIjoiMjAyNi0wOC0xNFQwMDowMDowMC4wMDBaIiwiaSI6ImNvbnZlcnNhdGlvbi1leGFtcGxlLW5leHQifQ",
    hasMore: true,
  };

  return {
    contract: {
      apiVersion: CLIENT_V1_API_VERSION,
      minimumClientVersion: CLIENT_V1_MIN_CLIENT_VERSION,
      capabilities: defaultCapabilities(),
      operations: clientV1OperationRecords(),
      discovery: cloneClientV1Record(CLIENT_V1_DISCOVERY_CONTRACT),
      pairingRequired: CLIENT_V1_PAIRING_REQUIRED,
      pairingScopes: [...CLIENT_V1_SCOPES],
      pairingSecretHeader: CLIENT_V1_PAIRING_SECRET_HEADER,
      publicRoutes: CLIENT_V1_PUBLIC_ROUTES.map((route) => ({ ...route })),
      identityKinds: [...CLIENT_V1_IDENTITY_KINDS],
      errorCodes: [...CLIENT_V1_ERROR_CODES],
      limits: cloneClientV1Record(CLIENT_V1_LIMITS),
    },
    examples: {
      status,
      health,
      identity,
      revision,
      cursor,
      successEnvelope: {
        ...envelopeBase({
          requestId: "request-example-success",
          identity,
          revision,
          cursor,
          capabilities: defaultCapabilities(),
        }),
        data: { ...status },
      },
      errorEnvelope: {
        ...envelopeBase({
          requestId: "request-example-error",
          capabilities: defaultCapabilities(),
        }),
        error: {
          code: "reconcile_required",
          message: "Client state must be reconciled.",
          details: { reason: "resume_from_canonical_state" },
          retryable: true,
        },
      },
      // The health envelope carries the compatibility record the route
      // actually serves, not a bare status. Pinning `{ status: "ok" }` here
      // would let the fixture agree with itself while disagreeing with
      // /api/client/v1/health.
      healthEnvelope: {
        ...envelopeBase(),
        data: { ...health },
      },
      pairingCreatedEnvelope: {
        ...envelopeBase(),
        data: {
          requestId: "018f4f1a-77c2-7a31-8a15-55a25aaba001",
          secret: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          expiresAt: 1_755_731_112_617,
        },
      },
      pairingStatusEnvelope: {
        ...envelopeBase(),
        data: {
          id: "018f4f1a-77c2-7a31-8a15-55a25aaba001",
          status: "approved",
          expiresAt: 1_755_731_112_617,
        },
      },
      pairingExchangeEnvelope: {
        ...envelopeBase(),
        data: {
          bearer: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
          credential: {
            id: "018f4f1a-77c2-7a31-8a15-55a25aaba002",
            appName: "OpenCoven Chat",
            installationId: "chat-install-1",
            scopes: ["chat:read", "chat:write"],
            createdAt: 1_755_730_812_617,
            lastUsedAt: null,
            revokedAt: null,
            revocationReason: null,
          },
        },
      },
      discoveryRecord: {
        version: 1,
        endpoint: "http://127.0.0.1:3020",
        pid: 4321,
        nonce: "018f4f1a-77c2-7a31-8a15-55a25aaba003",
        startedAt: "2026-08-20T20:20:12.617Z",
      },
    },
  };
}

export function renderClientV1ContractFixture(): string {
  return `${JSON.stringify(sortClientV1JsonKeys(createClientV1ContractFixture()), null, 2)}\n`;
}
