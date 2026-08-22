/**
 * Keyset pagination for the Client v1 canonical reads.
 *
 * `cursors` is one of the capabilities the contract advertises, and the shared
 * envelope already carries a `ClientV1Cursor`. This module is the half that was
 * missing: minting and reading the opaque token that rides in it.
 *
 * The shape follows the daemon's session pager (OpenCoven/coven#783) rather
 * than inventing a second dialect for the same problem — keyset ordering over a
 * total `(sortKey, id)` comparator, an over-fetch of one row to derive
 * `hasMore`, and an opaque URL-safe base64 cursor. Two deliberate differences:
 *
 *   - the page ceiling is `CLIENT_V1_LIMITS.maxPageSize` (100), not the
 *     daemon's 1000. The number that governs a Client v1 route is the one the
 *     contract publishes to clients; a route serving 1000 would be serving a
 *     size its own fixture says is impossible.
 *   - an out-of-range `limit` is refused rather than clamped. Clamping answers
 *     a request nobody made, and the client cannot tell the difference between
 *     "your ceiling is lower than you thought" and "that is the whole set".
 *
 * Offsets are deliberately absent. Every store behind these routes is mutated
 * by the running Cave while a client pages through it, and an offset silently
 * skips or repeats rows whenever anything is inserted or deleted above the
 * window. A keyset resumes from a position in the *ordering*, so a deleted row
 * costs the client nothing.
 */

import { CLIENT_V1_LIMITS, type ClientV1Cursor } from "./contract.ts";

/**
 * Version tag inside the encoded cursor.
 *
 * Present so a future change to the payload can be refused outright instead of
 * being misread: an unversioned token that gains a field decodes as a valid
 * token with a missing one, and the page it resumes is silently wrong.
 */
export const CLIENT_V1_CURSOR_VERSION = 1;

/**
 * The position a cursor resumes from.
 *
 * `sort` is whatever the resource orders by (an ISO timestamp for the recency
 * lists, an id for the alphabetical ones). `id` is the tiebreak that makes the
 * ordering total — without it two records sharing a sort key are unordered
 * relative to each other, and a page boundary that lands between them either
 * repeats both or skips both.
 */
export type ClientV1PageKey = {
  sort: string;
  id: string;
};

export type ClientV1PageResult<T> = {
  items: T[];
  /**
   * Absent — not `{ hasMore: false }` — when there is no token to publish.
   *
   * `parseClientV1Cursor` refuses a cursor carrying neither `current`, `next`
   * nor `previous`, so an empty first page has no representable cursor and the
   * envelope must omit the field rather than carry an unparseable one.
   */
  cursor?: ClientV1Cursor;
};

const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;
const POSITIVE_INTEGER_RE = /^[1-9][0-9]*$/;

function cursorError(detail: string): Error {
  return new Error(`Client v1 cursor is not readable: ${detail}.`);
}

export function encodeClientV1Cursor(key: ClientV1PageKey): string {
  return Buffer.from(
    JSON.stringify({ v: CLIENT_V1_CURSOR_VERSION, s: key.sort, i: key.id }),
    "utf8",
  ).toString("base64url");
}

export function decodeClientV1Cursor(raw: unknown): ClientV1PageKey {
  if (typeof raw !== "string" || raw.length === 0) {
    throw cursorError("it is not a non-empty string");
  }
  if (raw.length > CLIENT_V1_LIMITS.cursorCharacters) {
    throw cursorError(`it exceeds ${CLIENT_V1_LIMITS.cursorCharacters} characters`);
  }
  if (!BASE64URL_RE.test(raw)) {
    throw cursorError("it is outside the unpadded base64url alphabet");
  }
  const decoded = Buffer.from(raw, "base64url");
  // Buffer.from is lenient: it drops characters it cannot place rather than
  // failing, so a token with trailing junk decodes to a perfectly valid
  // payload. Re-encoding is what makes the token canonical, and canonical is
  // what makes "this is a cursor we minted" checkable at all.
  if (decoded.toString("base64url") !== raw) {
    throw cursorError("it is not a canonical encoding");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded.toString("utf8"));
  } catch {
    throw cursorError("its payload is not JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw cursorError("its payload is not an object");
  }
  const payload = parsed as Record<string, unknown>;
  const keys = Object.keys(payload).sort();
  if (keys.length !== 3 || keys[0] !== "i" || keys[1] !== "s" || keys[2] !== "v") {
    throw cursorError("its payload carries unexpected fields");
  }
  if (payload.v !== CLIENT_V1_CURSOR_VERSION) {
    throw cursorError(`its version is not ${CLIENT_V1_CURSOR_VERSION}`);
  }
  if (typeof payload.s !== "string") throw cursorError("its sort key is not a string");
  if (typeof payload.i !== "string" || payload.i.length === 0) {
    throw cursorError("its id is missing");
  }
  return { sort: payload.s, id: payload.i };
}

/**
 * The page size for one request, from the raw `limit` query parameter.
 *
 * Absent means the contract's `defaultPageSize`. Anything else has to be a
 * plain positive integer inside `maxPageSize`: no leading zeros, no sign, no
 * exponent, no surrounding space. `Number("1e2")` is 100 and `Number(" 10")` is
 * 10, so parsing with `Number` alone would accept spellings the contract never
 * published and quietly serve a page the client did not ask for.
 */
export function parseClientV1PageLimit(raw: string | null | undefined): number {
  if (raw === null || raw === undefined) return CLIENT_V1_LIMITS.defaultPageSize;
  if (!POSITIVE_INTEGER_RE.test(raw)) {
    throw new Error(
      `Client v1 limit must be a whole number between 1 and ${CLIENT_V1_LIMITS.maxPageSize}.`,
    );
  }
  const limit = Number(raw);
  if (limit > CLIENT_V1_LIMITS.maxPageSize) {
    throw new Error(
      `Client v1 limit must be a whole number between 1 and ${CLIENT_V1_LIMITS.maxPageSize}.`,
    );
  }
  return limit;
}

function compareStrings(left: string, right: string): number {
  // Codepoint order, never localeCompare: the comparator has to agree with
  // itself across processes and locales or a cursor minted by one request
  // resumes somewhere else on the next.
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/** Newest first, id descending on a tie. */
export function compareClientV1RecencyKeys(left: ClientV1PageKey, right: ClientV1PageKey): number {
  const bySort = compareStrings(right.sort, left.sort);
  if (bySort !== 0) return bySort;
  return compareStrings(right.id, left.id);
}

/** Lowest first, id ascending on a tie. */
export function compareClientV1AscendingKeys(left: ClientV1PageKey, right: ClientV1PageKey): number {
  const bySort = compareStrings(left.sort, right.sort);
  if (bySort !== 0) return bySort;
  return compareStrings(left.id, right.id);
}

function pageCursor(
  after: ClientV1PageKey | null,
  next: ClientV1PageKey | null,
): ClientV1Cursor | undefined {
  if (!after && !next) return undefined;
  return {
    ...(after ? { current: encodeClientV1Cursor(after) } : {}),
    ...(next ? { next: encodeClientV1Cursor(next) } : {}),
    hasMore: next !== null,
  };
}

/**
 * One page of an ordered set, resumed by comparing keys.
 *
 * `sorted` must already be ordered by `compare`. The window starts at the first
 * entry strictly after `after` in that ordering, which is what makes a cursor
 * survive the deletion of the row it names: the token records a position in the
 * order, not an index into an array.
 *
 * Re-sending the same cursor therefore returns the same page rather than
 * advancing — pagination is a function of (set, cursor, limit) and nothing
 * else. A client that follows `next` terminates because `next` is published
 * only when a further row exists.
 */
export function paginateClientV1Keyset<T>(
  sorted: readonly T[],
  options: {
    limit: number;
    after: ClientV1PageKey | null;
    keyOf: (item: T) => ClientV1PageKey;
    compare: (left: ClientV1PageKey, right: ClientV1PageKey) => number;
  },
): ClientV1PageResult<T> {
  const { after, compare, keyOf, limit } = options;
  const start = after === null
    ? 0
    : sorted.findIndex((item) => compare(keyOf(item), after) > 0);
  const window = start < 0 ? [] : sorted.slice(start, start + limit + 1);
  const items = window.slice(0, limit);
  // The over-fetched row is the evidence for `hasMore` and is never served: a
  // page of `limit + 1` would break the ceiling the contract publishes.
  const next = window.length > limit && items.length > 0
    ? keyOf(items[items.length - 1])
    : null;
  return { items, cursor: pageCursor(after, next) };
}

/**
 * One page of an ordered *sequence*, resumed by position.
 *
 * Chat turns are a chain rather than a sorted set. A user turn and the
 * assistant reply that answers it are persisted with the same `createdAt`
 * stamp, so ordering by `(createdAt, id)` would reorder a conversation into
 * nonsense; and turn ids are unique only inside one transcript. The sequence
 * itself is the order, so the cursor names the last item served and the next
 * page starts after it.
 *
 * Returns `null` when the cursor names an item the sequence no longer
 * contains, which for a transcript means the active branch moved underneath the
 * client. That is a state the client has to reconcile rather than an error the
 * server can paper over: restarting at the top silently replays the
 * conversation, and resuming at position zero serves a different branch under
 * the same token.
 */
export function paginateClientV1Sequence<T>(
  sequence: readonly T[],
  options: {
    limit: number;
    after: ClientV1PageKey | null;
    keyOf: (item: T) => ClientV1PageKey;
  },
): ClientV1PageResult<T> | null {
  const { after, keyOf, limit } = options;
  let start = 0;
  if (after !== null) {
    const index = sequence.findIndex((item) => keyOf(item).id === after.id);
    if (index < 0) return null;
    start = index + 1;
  }
  const window = sequence.slice(start, start + limit + 1);
  const items = window.slice(0, limit);
  const next = window.length > limit && items.length > 0
    ? keyOf(items[items.length - 1])
    : null;
  return { items, cursor: pageCursor(after, next) };
}
