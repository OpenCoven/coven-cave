// Stable JSON response helpers for the `/api/client/v1` facade. Route
// handlers should build every response through `clientV1Ok` / `clientV1Error`
// so the wire envelope stays identical across endpoints and across releases.

import type { ClientV1ErrorBody, ClientV1ErrorCode } from "./contract.ts";

/**
 * Generic message shown to the client for 5xx responses. Server-side errors
 * (stack traces, file paths, connection strings, etc.) must never reach the
 * wire — callers who need the real detail should log it themselves before
 * calling this helper.
 */
const SAFE_SERVER_ERROR_MESSAGE = "An internal error occurred. Please try again later.";

function isServerErrorStatus(status: number): boolean {
  return status >= 500 && status <= 599;
}

export type ClientV1ErrorOptions = {
  details?: Record<string, unknown>;
  diagnosticId?: string;
};

/**
 * Builds the stable v1 error envelope: `{ ok: false, error: { code, message,
 * retryable, details?, diagnosticId? } }`. For 5xx statuses, the provided
 * `message` is never forwarded to the client verbatim — a safe generic
 * message is substituted instead so a raw thrown error can't leak internals.
 */
export function clientV1Error(
  status: number,
  code: ClientV1ErrorCode,
  message: string,
  retryable: boolean,
  options?: ClientV1ErrorOptions,
): Response {
  const safeMessage = isServerErrorStatus(status) ? SAFE_SERVER_ERROR_MESSAGE : message;

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

  return Response.json(body, { status });
}

/**
 * Builds a v1 success response, preserving the caller's typed body verbatim.
 * Defaults to HTTP 200; pass `{ status }` (or other `ResponseInit` fields)
 * via `init` to override.
 */
export function clientV1Ok<T>(body: T, init?: ResponseInit): Response {
  return Response.json(body, { status: 200, ...init });
}
