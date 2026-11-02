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
