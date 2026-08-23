import {
  CLIENT_V1_API_VERSION,
  CLIENT_V1_CAPABILITIES,
  CLIENT_V1_ERROR_CODES,
  CLIENT_V1_LIMITS,
  CLIENT_V1_MIN_CLIENT_VERSION,
  CLIENT_V1_OPERATIONS,
  parseClientV1Capabilities,
  parseClientV1Operations,
  parseClientV1Cursor,
  parseClientV1ErrorDetails,
  parseClientV1ErrorEnvelope,
  parseClientV1Identity,
  parseClientV1JsonObject,
  parseClientV1RequestId,
  parseClientV1Revision,
  parseClientV1SuccessEnvelope,
  type ClientV1Capability,
  type ClientV1Cursor,
  type ClientV1ErrorCode,
  type ClientV1ErrorEnvelope,
  type ClientV1EnvelopeBase,
  type ClientV1Identity,
  type ClientV1Operation,
  type ClientV1Record,
  type ClientV1Revision,
  type ClientV1SuccessEnvelope,
} from "./contract.ts";
import type { ClientV1RateLimitResult } from "./rate-limit.ts";

export type ClientV1EnvelopeOptions = {
  capabilities?: readonly ClientV1Capability[];
  operations?: readonly ClientV1Operation[];
  requestId?: string;
  identity?: ClientV1Identity;
  revision?: ClientV1Revision;
  cursor?: ClientV1Cursor;
};

export type ClientV1SuccessResponseOptions = ClientV1EnvelopeOptions & {
  headers?: HeadersInit;
  status?: number;
};

export type ClientV1ErrorResponseOptions = ClientV1EnvelopeOptions & {
  details?: Record<string, string>;
  headers?: HeadersInit;
  retryable?: boolean;
  status?: number;
};

const CLIENT_V1_ERROR_CODE_SET = new Set<string>(CLIENT_V1_ERROR_CODES);

function requiredRecord(value: unknown, name: string): ClientV1Record {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Client v1 ${name} must be an object.`);
  }
  return parseClientV1JsonObject(value);
}

function requiredErrorMessage(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Client v1 error message must be a non-empty string.");
  }
  if (value.length > CLIENT_V1_LIMITS.errorMessageCharacters) {
    throw new Error(
      `Client v1 error message must be at most ${CLIENT_V1_LIMITS.errorMessageCharacters} characters.`,
    );
  }
  return value;
}

function defineEnumerableValue(target: Record<string, unknown>, key: string, value: unknown) {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function cloneClientV1JsonValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneClientV1JsonValue(entry)) as T;
  }
  if (value === null || typeof value !== "object") {
    return value;
  }

  const clone = Object.create(Object.getPrototypeOf(value)) as Record<string, unknown>;
  for (const [key, entry] of Object.entries(value)) {
    defineEnumerableValue(clone, key, cloneClientV1JsonValue(entry));
  }
  return clone as T;
}

function defaultCapabilities(): ClientV1Capability[] {
  return [...CLIENT_V1_CAPABILITIES];
}

function defaultOperations(): ClientV1Operation[] {
  return [...CLIENT_V1_OPERATIONS];
}

function envelopeBase(options: ClientV1EnvelopeOptions = {}): ClientV1EnvelopeBase {
  return {
    apiVersion: CLIENT_V1_API_VERSION,
    minimumClientVersion: CLIENT_V1_MIN_CLIENT_VERSION,
    capabilities: options.capabilities ? [...parseClientV1Capabilities(options.capabilities)] : defaultCapabilities(),
    // Registry-closed on the way out, like capabilities: this is the producer
    // side, and a build may not export an id no reviewed record backs.
    operations: options.operations ? [...parseClientV1Operations(options.operations)] : defaultOperations(),
    ...(options.requestId !== undefined ? { requestId: parseClientV1RequestId(options.requestId) } : {}),
    ...(options.identity !== undefined
      ? { identity: cloneClientV1JsonValue(parseClientV1Identity(options.identity)) }
      : {}),
    ...(options.revision !== undefined
      ? { revision: cloneClientV1JsonValue(parseClientV1Revision(options.revision)) }
      : {}),
    ...(options.cursor !== undefined
      ? { cursor: cloneClientV1JsonValue(parseClientV1Cursor(options.cursor)) }
      : {}),
  };
}

function requireErrorCode(code: ClientV1ErrorCode): ClientV1ErrorCode {
  if (!CLIENT_V1_ERROR_CODE_SET.has(code)) {
    throw new Error("Client v1 error code is not supported.");
  }
  return code;
}

function assertSuccessStatus(status: number) {
  if (!Number.isInteger(status) || status < 200 || status > 299) {
    throw new Error("Client v1 success responses must use a 2xx HTTP status.");
  }
  if (status === 204 || status === 205) {
    throw new Error("Client v1 success responses must not use a bodyless status.");
  }
}

function assertErrorStatus(status: number) {
  if (!Number.isInteger(status) || status < 400 || status > 599) {
    throw new Error("Client v1 error responses must use a 4xx or 5xx HTTP status.");
  }
}

function canonicalErrorStatus(code: ClientV1ErrorCode, status?: number): number {
  const canonicalStatus = httpStatusForClientV1ErrorCode(code);
  if (status === undefined) {
    return canonicalStatus;
  }
  assertErrorStatus(status);
  if (status !== canonicalStatus) {
    throw new Error(
      `Client v1 error response status must match canonical HTTP status ${canonicalStatus} for ${code}.`,
    );
  }
  return canonicalStatus;
}

export function httpStatusForClientV1ErrorCode(code: ClientV1ErrorCode): number {
  switch (code) {
    case "invalid_request":
      return 400;
    case "unauthorized":
      return 401;
    case "scope_denied":
      return 403;
    case "pairing_denied":
      return 403;
    case "not_found":
      return 404;
    case "pairing_expired":
      return 410;
    case "conflict":
      return 409;
    case "pairing_pending":
      return 409;
    case "reconcile_required":
      return 409;
    case "incompatible_version":
      return 426;
    case "rate_limited":
      return 429;
    case "internal_error":
      return 500;
    case "service_unavailable":
      return 503;
  }
}

// Phase 0 success helpers intentionally validate only the shared envelope
// contract. Route-specific builders belong in later modules.
export function clientV1Success<TData extends ClientV1Record>(
  data: TData,
  options: ClientV1EnvelopeOptions = {},
): ClientV1SuccessEnvelope<TData> {
  return parseClientV1SuccessEnvelope<TData>({
    ...envelopeBase(options),
    data: cloneClientV1JsonValue(requiredRecord(data, "response data")),
  });
}

export function clientV1Error(
  code: ClientV1ErrorCode,
  message: string,
  options: Omit<ClientV1ErrorResponseOptions, "status"> = {},
): ClientV1ErrorEnvelope {
  const details = options.details === undefined ? undefined : { ...parseClientV1ErrorDetails(options.details) };
  return parseClientV1ErrorEnvelope({
    ...envelopeBase(options),
    error: {
      code: requireErrorCode(code),
      message: requiredErrorMessage(message),
      ...(details ? { details } : {}),
      retryable: options.retryable === true,
    },
  });
}

export function clientV1SuccessResponse<TData extends ClientV1Record>(
  data: TData,
  options: ClientV1SuccessResponseOptions = {},
): Response {
  const { headers, status = 200, ...envelopeOptions } = options;
  assertSuccessStatus(status);
  return Response.json(clientV1Success(data, envelopeOptions), { headers, status });
}

export function clientV1ErrorResponse(
  code: ClientV1ErrorCode,
  message: string,
  options: ClientV1ErrorResponseOptions = {},
): Response {
  const { headers, status: requestedStatus, ...envelopeOptions } = options;
  const status = canonicalErrorStatus(code, requestedStatus);
  return Response.json(clientV1Error(code, message, envelopeOptions), {
    headers,
    status,
  });
}

export function clientV1RateLimitResponse(
  result: ClientV1RateLimitResult,
): Response {
  return clientV1ErrorResponse("rate_limited", "Rate limit exceeded.", {
    details: {
      limit: String(result.limit),
      resetAt: String(result.resetAt),
    },
    headers: {
      "retry-after": String(result.retryAfterSeconds),
    },
    retryable: true,
  });
}

export function clientV1OperationInProgressError(operation: string): ClientV1ErrorEnvelope {
  return clientV1Error("conflict", "The operation is already in progress.", {
    details: {
      operation,
      reason: "operation_in_progress",
    },
    retryable: true,
  });
}
