/**
 * Read the fields a route reports from an upstream 2xx, and refuse to call a
 * drifted body a success (#6368).
 *
 * A 200 whose body lacks the field the route reports — an issue number, a
 * comment id, a login — is not success. Defaulting the field (`?? 0`,
 * `?? ""`) told the client a write landed when nothing confirmed it, and on a
 * read it replaced known data with blanks. These helpers return `null` for a
 * missing or mistyped field so the route answers with one of two shapes:
 *
 * - `upstream-drift` (read): the upstream answered, but not in a shape we can
 *   use. Nothing was changed; the caller may retry.
 * - `ambiguous-write` (write): the upstream accepted the request, but its
 *   answer does not confirm what landed. `dispatched: true` tells the client
 *   not to retry blindly, which could post the same thing twice. This is the
 *   route-level twin of `x-client.ts`'s `ambiguous-write`.
 */
import { UpstreamCooldownError } from "./upstream-fetch.ts";

export type UpstreamAnswerCode = "upstream-drift" | "ambiguous-write";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A JSON number that is a positive safe integer (GitHub issue/PR numbers). */
export function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

/**
 * A resource id as a non-empty string. GitHub REST ids are positive integers;
 * GraphQL node ids are non-empty strings. Anything else is drift.
 */
export function resourceId(value: unknown): string | null {
  if (typeof value === "number") return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
  if (typeof value === "string") return value.trim() ? value : null;
  return null;
}

/** A non-empty login string; a number, object or blank is drift. */
export function login(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

/** The login of a GitHub user object (`{ login }`), or null when it drifted. */
export function userLogin(user: unknown): string | null {
  return isRecord(user) ? login(user.login) : null;
}

/** A read answered in a shape we cannot use. Nothing changed; safe to retry. */
export function upstreamDrift(upstream: string, what: string) {
  return Response.json(
    { ok: false, code: "upstream-drift" satisfies UpstreamAnswerCode, error: `${upstream} answered without ${what}` },
    { status: 502 },
  );
}

/**
 * A write the upstream accepted whose answer does not confirm what landed.
 * The client must check before retrying.
 */
export function ambiguousWrite(upstream: string, action: string) {
  return Response.json(
    {
      ok: false,
      code: "ambiguous-write" satisfies UpstreamAnswerCode,
      dispatched: true,
      error: `${upstream} accepted the ${action}, but its answer did not confirm it. Check before trying again.`,
    },
    { status: 502 },
  );
}

// ── Writes that may or may not have landed (#6369) ──────────────────────────

/**
 * Transport failures that happen before a request reaches the upstream: the
 * connection never opened, or the name never resolved. Anything else (a
 * deadline mid-request, a reset, a torn response) may have arrived after the
 * upstream acted.
 */
const NEVER_SENT_CODES = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET_CONNECT",
]);

function errorCode(error: unknown): string | null {
  if (!isRecord(error) && !(error instanceof Error)) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

/** True only when the write provably never reached the upstream. */
export function writeNeverSent(error: unknown): boolean {
  if (error instanceof UpstreamCooldownError) return true;
  const cause = error instanceof Error ? (error as { cause?: unknown }).cause : undefined;
  const code = errorCode(error) ?? errorCode(cause);
  return code !== null && NEVER_SENT_CODES.has(code);
}

/**
 * The answer for a write that threw. A write that provably never left is a
 * plain failure the caller may retry; any other transport failure leaves the
 * outcome unknown, so it is an ambiguous write and must not be retried blindly
 * (model: x-client.ts, which treats a write's transport failure the same way).
 */
export function writeThrew(upstream: string, action: string, error: unknown, fallback: string): Response {
  if (writeNeverSent(error)) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : fallback }, { status: 502 });
  }
  return ambiguousWrite(upstream, action);
}

/**
 * A 5xx answer to a write: the upstream may have acted before it failed, so
 * the outcome is unknown (x-client.ts treats a write's 5xx the same way).
 */
export function isAmbiguousWriteStatus(status: number): boolean {
  return status >= 500;
}
