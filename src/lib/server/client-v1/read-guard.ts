/**
 * The shared policy the Client v1 canonical read routes apply before serving.
 *
 * What is NOT here, deliberately: the `requireScope` call itself, and the
 * `consumeAuthenticated` charge on the success path. Both stay written out in
 * every route module, because that is the form
 * `src/app/api/api-contracts.test.ts` reads — it asserts, against a comment-,
 * string- and regex-stripped view of each route's own source, that the route
 * enforces a credential. A route that delegated the whole check to a helper
 * would satisfy the letter of that assertion only if the assertion were taught
 * to follow the import, which is exactly the loosening the assertion exists to
 * prevent. The pieces below are the parts that carry no credential decision:
 * parsing the header, parsing the query, and choosing which rate-limit bucket
 * an already-decided failure is charged against.
 */

import {
  CLIENT_V1_LIMITS,
  type ClientV1Scope,
} from "./contract.ts";
import type { ClientV1AuthResult } from "./auth.ts";
import {
  decodeClientV1Cursor,
  parseClientV1PageLimit,
  type ClientV1PageKey,
} from "./pagination.ts";
import { clientV1ErrorResponse, clientV1RateLimitResponse } from "./responses.ts";
import type { ClientV1Runtime } from "./runtime.ts";

/**
 * The single grant every canonical read requires.
 *
 * `chat:read` is the only read scope the contract publishes; the other five are
 * writes. Familiars, projects, conversations and their messages are all the
 * same read, so they are gated on the same grant rather than on five scopes
 * that do not exist.
 */
export const CLIENT_V1_READ_SCOPE: ClientV1Scope = "chat:read";

/** Query parameters the read routes serve. Anything else is a client bug. */
const SUPPORTED_READ_PARAMETERS = new Set(["cursor", "limit"]);

/**
 * A bearer is at most this many characters before it is refused unread.
 *
 * An issued bearer is 43 base64url characters. The cap is far above that and is
 * only here so an unbounded header cannot be pushed through `createHash` on
 * every request; it is not a format assertion, because the store compares
 * hashes and has no opinion about the alphabet.
 */
const MAX_BEARER_CHARACTERS = 512;

const BEARER_RE = /^Bearer[ \t]+([^\s]+)$/i;

/**
 * The credential from an `Authorization: Bearer …` header, or null.
 *
 * Header only. Not a query parameter, not a cookie: a credential in a URL
 * survives in shell history, referer headers and server logs, and a credential
 * a browser attaches on its own is a credential an attacker can spend
 * cross-origin.
 *
 * Returning null rather than throwing is what keeps a malformed header off the
 * credential store — requireScope answers `unauthorized` for a null bearer
 * without a lookup.
 */
export function clientV1BearerFrom(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header || header.length > MAX_BEARER_CHARACTERS + "Bearer ".length) return null;
  const match = BEARER_RE.exec(header.trim());
  if (!match) return null;
  const bearer = match[1];
  return bearer.length <= MAX_BEARER_CHARACTERS ? bearer : null;
}

/**
 * The page window one read request asks for.
 *
 * Throws on anything it cannot serve so the route answers `invalid_request`
 * rather than quietly serving a different page than the one requested. That
 * includes an unsupported parameter (`?limt=5` must not silently return fifty
 * rows) and a repeated supported one (`URLSearchParams.get` would pick the
 * first and discard the second without telling anybody).
 */
export function parseClientV1ReadPage(url: URL): {
  limit: number;
  after: ClientV1PageKey | null;
} {
  const seen = new Set<string>();
  for (const name of url.searchParams.keys()) {
    if (!SUPPORTED_READ_PARAMETERS.has(name)) {
      throw new Error(`Client v1 read requests do not support the "${name}" parameter.`);
    }
    if (seen.has(name)) {
      throw new Error(`Client v1 read requests accept "${name}" at most once.`);
    }
    seen.add(name);
  }
  const limit = parseClientV1PageLimit(url.searchParams.get("limit"));
  const rawCursor = url.searchParams.get("cursor");
  return {
    limit,
    after: rawCursor === null ? null : decodeClientV1Cursor(rawCursor),
  };
}

/**
 * Refuse any query parameter on a route that serves a single record.
 *
 * A one-record read has nothing to page, so `limit` and `cursor` are as
 * meaningless on it as `offset`. Ignoring them would be the friendlier
 * behaviour and the worse one: a client that sends `?limit=5` and is answered
 * normally learns that the parameter is accepted everywhere, and carries that
 * belief to a route where it changes the answer.
 */
export function assertClientV1NoReadQuery(url: URL): void {
  for (const name of url.searchParams.keys()) {
    throw new Error(`Client v1 read requests do not support the "${name}" parameter.`);
  }
}

/**
 * Charge one authentication failure against the bucket it belongs to.
 *
 * The two failures are metered separately because they bound different things.
 * `unauthorized` means no credential was established, so the only key available
 * is the caller's loopback stamp — one process-wide constant, which makes this
 * a single shared bucket exactly like pairing creation, and for the same
 * reason: every finer key would be attacker-chosen. `scope_denied` means a real
 * credential asked for a grant it does not hold, so it is charged to that
 * credential's own authenticated budget, where it cannot starve anyone else.
 *
 * `ownership_refused` is metered against neither bucket: the credential
 * boundary never even answered, so there is no credential to charge and no
 * attacker-chosen key to bound — and the refusal is a host condition the
 * operator must see, so converting it into a 429 after a few requests would
 * hide the diagnosis the distinct envelope exists to carry (cave-e7xwk). The
 * negative refusal TTL already bounds the probe work, so skipping the charge
 * cannot amplify anything.
 *
 * A caller that has exhausted its bucket is answered 429 instead of the
 * original refusal. That is deliberate: the refusal itself is the signal an
 * attacker is reading, so once the budget is gone it stops being served.
 */
export function chargeClientV1AuthFailure(
  runtime: ClientV1Runtime,
  failure: Extract<ClientV1AuthResult, { ok: false }>,
  sourceIdentity: string,
): Response {
  if (failure.reason === "ownership_refused") return failure.response;
  const budget = failure.reason === "scope_denied"
    ? runtime.rateLimiter.consumeAuthenticated(failure.credential.id)
    : runtime.rateLimiter.consumeInvalidBearer(sourceIdentity);
  return budget.allowed ? failure.response : clientV1RateLimitResponse(budget);
}

/**
 * The 400 a route answers when parseClientV1ReadPage refused the query.
 *
 * The thrown message is forwarded in `details.reason` because it is the only
 * thing that tells a client author *which* parameter was wrong, and every one
 * of those messages is authored in this module — none of them carries a value
 * the caller supplied except the parameter name it already knows. Truncated to
 * the contract's detail budget so a long parameter name cannot make the error
 * builder throw while building an error.
 */
export function clientV1InvalidReadRequest(cause: unknown): Response {
  const reason = cause instanceof Error ? cause.message : "The read request is not valid.";
  return clientV1ErrorResponse("invalid_request", "The read request is not valid.", {
    details: { reason: reason.slice(0, CLIENT_V1_LIMITS.errorDetailValueCharacters) },
  });
}

/**
 * The 500 a route answers when the store, or the projection over it, refused.
 *
 * Without it the throw escaped the handler and Next answered with its own
 * error page — a body that is not a Client v1 envelope, on a surface whose
 * whole contract is that every response is one. A client parsing the envelope
 * fails to read its own failure, which is the exact trap the *Reaching the API
 * at all* section warns about for the proxy's rejections.
 *
 * It is reachable from ordinary data, not just from a bug: no store behind
 * these routes validates the JSON it returns, and `projectClientV1*` refuses a
 * record whose required field is absent or wrongly typed (see reads.ts). One
 * hand-edited `projects.json` row, one conversation file written by an older
 * Cave, or one daemon that renamed a roster field reaches this path.
 *
 * `retryable` is deliberately false. The store answers the same way next
 * second, so a client that retries is spending its budget to be told the same
 * thing; the operator has to repair the record.
 *
 * The cause is deliberately NOT forwarded to the client. Every message on this
 * path names a field of a stored record, and some of them would carry the
 * value — details on an error a caller cannot fix is a description of the
 * server's disk.
 */
export function clientV1ReadFailure(): Response {
  return clientV1ErrorResponse("internal_error", "The read could not be served.");
}

/** The contract's page-size ceiling, re-exported so routes can name it once. */
export const CLIENT_V1_MAX_PAGE_SIZE = CLIENT_V1_LIMITS.maxPageSize;
