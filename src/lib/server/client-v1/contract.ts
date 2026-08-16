export const CLIENT_V1_API_VERSION = "1.0";
export const CLIENT_V1_MIN_CLIENT_VERSION = "0.1.0";

export const CLIENT_V1_SCOPES = Object.freeze([
  "chat:read",
  "chat:write",
  "conversations:write",
  "attachments:write",
  "tasks:write",
  "github:write",
] as const);

export const CLIENT_V1_CAPABILITIES = Object.freeze([
  "pairing",
  "credentials",
  "familiars",
  "projects",
  "conversations",
  "conversation-messages",
  "streaming",
  "cursors",
  "revisions",
] as const);

export const CLIENT_V1_ERROR_CODES = Object.freeze([
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

export const CLIENT_V1_IDENTITY_KINDS = Object.freeze([
  "client",
  "credential",
  "familiar",
  "project",
  "conversation",
  "message",
  "event",
] as const);

export const CLIENT_V1_LIMITS = Object.freeze({
  idempotencyKeyCharacters: 36,
  requestIdCharacters: 64,
  revisionTokenCharacters: 128,
  cursorCharacters: 512,
  errorMessageCharacters: 256,
  errorDetailEntries: 16,
  errorDetailValueCharacters: 256,
  defaultPageSize: 50,
  maxPageSize: 100,
} as const);

export type ClientV1Scope = (typeof CLIENT_V1_SCOPES)[number];
export type ClientV1Capability = (typeof CLIENT_V1_CAPABILITIES)[number];
export type ClientV1ErrorCode = (typeof CLIENT_V1_ERROR_CODES)[number];
export type ClientV1IdentityKind = (typeof CLIENT_V1_IDENTITY_KINDS)[number];

export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | JsonObject;
export type JsonObject = { [key: string]: JsonValue };
export type ClientV1Record = JsonObject;
export type ClientV1IdempotencyKey = string & {
  readonly __clientV1IdempotencyKey: unique symbol;
};

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

export type ClientV1EnvelopeBase = {
  apiVersion: typeof CLIENT_V1_API_VERSION;
  minimumClientVersion: typeof CLIENT_V1_MIN_CLIENT_VERSION;
  capabilities: ClientV1Capability[];
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
};

export type ClientV1ErrorEnvelope = ClientV1EnvelopeBase & {
  error: ClientV1Error;
};

export type ClientV1ContractManifest = {
  apiVersion: typeof CLIENT_V1_API_VERSION;
  minimumClientVersion: typeof CLIENT_V1_MIN_CLIENT_VERSION;
  capabilities: ClientV1Capability[];
  pairingScopes: ClientV1Scope[];
  identityKinds: ClientV1IdentityKind[];
  errorCodes: ClientV1ErrorCode[];
  limits: typeof CLIENT_V1_LIMITS;
};

export type ClientV1ContractFixture = {
  contract: ClientV1ContractManifest;
  examples: {
    status: ClientV1StatusRecord;
    identity: ClientV1Identity;
    revision: ClientV1Revision;
    cursor: ClientV1Cursor;
    successEnvelope: ClientV1SuccessEnvelope<ClientV1StatusRecord>;
    errorEnvelope: ClientV1ErrorEnvelope;
  };
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_8601_TIMESTAMP_RE =
  /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
const ARRAY_INDEX_RE = /^(?:0|[1-9]\d*)$/;
const CLIENT_V1_SCOPE_SET = new Set<string>(CLIENT_V1_SCOPES);
const CLIENT_V1_CAPABILITY_SET = new Set<string>(CLIENT_V1_CAPABILITIES);
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
  parseClientV1JsonValue(value);
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Client v1 ${name} must be a non-empty array.`);
  }
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

export function parseClientV1Capabilities(value: unknown): ClientV1Capability[] {
  return parseUniqueStringEnumList<ClientV1Capability>(value, "capabilities", CLIENT_V1_CAPABILITY_SET);
}

export function parseClientV1RequestId(value: unknown): string {
  return requiredString(value, "requestId", CLIENT_V1_LIMITS.requestIdCharacters);
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

// Each fixture invocation gets its own frozen limits copy so mutating one
// fixture's output can never leak into CLIENT_V1_LIMITS or a later fixture.
function cloneClientV1Limits(): typeof CLIENT_V1_LIMITS {
  return Object.freeze({ ...CLIENT_V1_LIMITS });
}

function defaultCapabilities(): ClientV1Capability[] {
  return [...CLIENT_V1_CAPABILITIES];
}

function envelopeBase(
  overrides: Partial<Pick<ClientV1EnvelopeBase, "requestId" | "identity" | "revision" | "cursor" | "capabilities">> = {},
): ClientV1EnvelopeBase {
  return {
    apiVersion: CLIENT_V1_API_VERSION,
    minimumClientVersion: CLIENT_V1_MIN_CLIENT_VERSION,
    capabilities: overrides.capabilities ? [...overrides.capabilities] : defaultCapabilities(),
    ...(overrides.requestId ? { requestId: overrides.requestId } : {}),
    ...(overrides.identity ? { identity: { ...overrides.identity } } : {}),
    ...(overrides.revision ? { revision: { ...overrides.revision } } : {}),
    ...(overrides.cursor ? { cursor: { ...overrides.cursor } } : {}),
  };
}

export function createClientV1ContractFixture(): ClientV1ContractFixture {
  const status: ClientV1StatusRecord = {
    status: "ok",
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
    current: "conversation-list:cursor:0",
    next: "conversation-list:cursor:1",
    hasMore: true,
  };

  return {
    contract: {
      apiVersion: CLIENT_V1_API_VERSION,
      minimumClientVersion: CLIENT_V1_MIN_CLIENT_VERSION,
      capabilities: defaultCapabilities(),
      pairingScopes: [...CLIENT_V1_SCOPES],
      identityKinds: [...CLIENT_V1_IDENTITY_KINDS],
      errorCodes: [...CLIENT_V1_ERROR_CODES],
      limits: cloneClientV1Limits(),
    },
    // Phase 0 fixture governance stays foundation-only: shared primitives,
    // generic envelopes, and no route DTOs or success-shape guessing.
    examples: {
      status,
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
    },
  };
}

export function renderClientV1ContractFixture(): string {
  return `${JSON.stringify(sortClientV1JsonKeys(createClientV1ContractFixture()), null, 2)}\n`;
}
