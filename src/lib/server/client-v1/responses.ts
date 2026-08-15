import { NextResponse } from "next/server.js";

import type { ClientV1ErrorBody, ClientV1ErrorCode } from "./contract.ts";

// Every `/api/client/v1` error code maps to exactly one HTTP status, so
// clients can dispatch on either the status or the `error` code and get the
// same answer.
const CLIENT_V1_ERROR_STATUS: Record<ClientV1ErrorCode, number> = {
  invalid_request: 400,
  unauthorized: 401,
  scope_denied: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  pairing_pending: 202,
  pairing_denied: 403,
  pairing_expired: 410,
  incompatible_version: 400,
  service_unavailable: 503,
  internal_error: 500,
};

const INTERNAL_ERROR_MESSAGE = "An internal error occurred.";

export function clientV1ErrorStatus(code: ClientV1ErrorCode): number {
  return CLIENT_V1_ERROR_STATUS[code];
}

/** Optional, non-sensitive extras that may ride along on an error response. */
export type ClientV1ErrorOptions = {
  details?: Record<string, string>;
  diagnosticId?: string;
};

/**
 * Builds the stable `/api/client/v1` error envelope. The caller supplies the
 * HTTP `status` explicitly (typically via `clientV1ErrorStatus(code)`), but we
 * still verify that it matches the canonical status for `code` so a handler
 * can't emit a contradictory response when the inputs disagree. Redaction is
 * triggered by either the caller-supplied or canonical status being 5xx, so we
 * never echo a potentially sensitive message when either side says "server
 * error". `details` and `diagnosticId` are passed through as given (callers are
 * responsible for keeping them free of sensitive internals) and are omitted
 * from the body entirely when not supplied.
 */
export function clientV1Error(
  status: number,
  code: ClientV1ErrorCode,
  message: string,
  retryable: boolean,
  options?: ClientV1ErrorOptions,
): NextResponse<ClientV1ErrorBody> {
  const canonicalStatus = clientV1ErrorStatus(code);
  const effectiveStatus = status === canonicalStatus ? status : canonicalStatus;
  const safeMessage = status >= 500 || canonicalStatus >= 500 ? INTERNAL_ERROR_MESSAGE : message;
  const body: ClientV1ErrorBody = {
    ok: false,
    error: {
      code,
      message: safeMessage,
      retryable,
      ...(options?.details !== undefined ? { details: options.details } : {}),
      ...(options?.diagnosticId !== undefined ? { diagnosticId: options.diagnosticId } : {}),
    },
  };
  return NextResponse.json(body, { status: effectiveStatus });
}

// The only HTTP statuses the `/api/client/v1` success envelope may be sent
// with. Every one of these is body-bearing (unlike 204/205/304, which must
// not carry a response body) and every one of these is actually used by the
// v1 contract today. Keeping this list narrow means an out-of-contract or
// bodyless status is rejected here instead of surfacing as a thrown error
// from `NextResponse.json` (204/205/304) or a misleading `{ ok: true }` body
// on top of a 4xx/5xx status.
export const CLIENT_V1_SUCCESS_STATUSES = [200, 201, 202] as const;

export type ClientV1SuccessStatus = (typeof CLIENT_V1_SUCCESS_STATUSES)[number];

const CLIENT_V1_SUCCESS_STATUS_SET: ReadonlySet<number> = new Set(CLIENT_V1_SUCCESS_STATUSES);

export function isClientV1SuccessStatus(value: unknown): value is ClientV1SuccessStatus {
  return typeof value === "number" && CLIENT_V1_SUCCESS_STATUS_SET.has(value);
}

/**
 * Builds the stable `/api/client/v1` success envelope: `{ ok: true, ...data }`.
 * `status` is restricted to `ClientV1SuccessStatus` (200/201/202) both by
 * type and by a runtime guard, so an unchecked/JavaScript caller can't sneak
 * a bodyless status (204/205/304) past `NextResponse.json` or emit an
 * `{ ok: true }` body alongside a 4xx/5xx status; invalid statuses throw
 * before a `NextResponse` is constructed.
 */
export function clientV1Ok<T extends Record<string, unknown>>(
  data: T,
  init?: { status?: ClientV1SuccessStatus },
): NextResponse<{ ok: true } & T> {
  const status = init?.status ?? 200;
  if (!isClientV1SuccessStatus(status)) {
    throw new Error(`clientV1Ok: invalid success status ${String(status)}`);
  }
  // `ok` is spread last so caller-supplied data can never override the
  // envelope's own `ok: true` field, even if `data` happens to carry an `ok`
  // key of its own.
  return NextResponse.json({ ...data, ok: true }, { status });
}
