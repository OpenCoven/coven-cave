import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { CLIENT_V1_LIMITS, parseClientV1Cursor } from "./contract.ts";
import {
  CLIENT_V1_CURSOR_VERSION,
  compareClientV1AscendingKeys,
  compareClientV1RecencyKeys,
  decodeClientV1Cursor,
  encodeClientV1Cursor,
  paginateClientV1Keyset,
  paginateClientV1Sequence,
  parseClientV1PageLimit,
  type ClientV1PageKey,
} from "./pagination.ts";

type Row = { id: string; at: string };

const ROWS: Row[] = [
  { id: "e", at: "2026-08-05T00:00:00.000Z" },
  { id: "d", at: "2026-08-04T00:00:00.000Z" },
  // A deliberate tie on the sort field: the id tiebreak is the only thing
  // making this order total, and a non-total order is a cursor that can skip
  // or repeat a row for reasons no client can see.
  { id: "c", at: "2026-08-03T00:00:00.000Z" },
  { id: "b", at: "2026-08-03T00:00:00.000Z" },
  { id: "a", at: "2026-08-01T00:00:00.000Z" },
];

const keyOf = (row: Row): ClientV1PageKey => ({ sort: row.at, id: row.id });

function page(limit: number, after: ClientV1PageKey | null) {
  return paginateClientV1Keyset(ROWS, {
    limit,
    after,
    keyOf,
    compare: compareClientV1RecencyKeys,
  });
}

test("cursor tokens round-trip and stay inside the contract's cursor budget", () => {
  const key: ClientV1PageKey = { sort: "2026-08-03T00:00:00.000Z", id: "conversation-1" };
  const encoded = encodeClientV1Cursor(key);
  assert.match(encoded, /^[A-Za-z0-9_-]+$/, "cursor must be unpadded base64url");
  assert.ok(
    encoded.length <= CLIENT_V1_LIMITS.cursorCharacters,
    `cursor is ${encoded.length} characters, over the contract's ${CLIENT_V1_LIMITS.cursorCharacters}`,
  );
  assert.deepEqual(decodeClientV1Cursor(encoded), key);
  // Opaque means opaque: the sort key and id must not be readable without
  // decoding, or a client will start composing cursors by hand.
  assert.equal(encoded.includes("conversation-1"), false);
});

test("every cursor token in the generated contract fixture is canonical", () => {
  const fixture = JSON.parse(
    readFileSync(new URL("./contract-fixture.json", import.meta.url), "utf8"),
  ) as { examples: unknown };
  const cursorTokens: Array<{ path: string; token: unknown }> = [];

  function collectCursorTokens(value: unknown, path: string): void {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return;
    const record = value as Record<string, unknown>;
    if (typeof record.cursor === "object" && record.cursor !== null) {
      const cursor = record.cursor as Record<string, unknown>;
      for (const field of ["current", "next", "previous"]) {
        if (field in cursor) {
          cursorTokens.push({ path: `${path}.cursor.${field}`, token: cursor[field] });
        }
      }
    }
    for (const [key, child] of Object.entries(record)) {
      collectCursorTokens(child, `${path}.${key}`);
    }
  }

  collectCursorTokens(fixture.examples, "examples");
  assert.ok(cursorTokens.length > 0, "fixture examples must publish at least one cursor token");
  for (const { path, token } of cursorTokens) {
    assert.equal(typeof token, "string", `${path} must be a string`);
    const decoded = decodeClientV1Cursor(token);
    assert.equal(encodeClientV1Cursor(decoded), token, `${path} must be canonical`);
  }
});

const BASE64URL_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/**
 * A different string that decodes to the same bytes as `token`.
 *
 * Unpadded base64url leaves unused low bits in the final character whenever the
 * payload length is not a multiple of three, so several spellings decode
 * identically. Only one of them is the spelling this Cave emits.
 *
 * Built by search rather than by arithmetic, and it throws when no twin exists,
 * so a payload length that happened to leave no spare bits fails the test
 * loudly instead of passing it vacuously.
 */
function nonCanonicalTwin(token: string): string {
  const bytes = Buffer.from(token, "base64url");
  for (const candidate of BASE64URL_ALPHABET) {
    const twin = `${token.slice(0, -1)}${candidate}`;
    if (twin !== token && Buffer.from(twin, "base64url").equals(bytes)) return twin;
  }
  throw new Error("this token has no non-canonical twin to test with");
}

test("cursor decoding refuses everything that is not a cursor this Cave minted", () => {
  const valid = encodeClientV1Cursor({ sort: "s", id: "i" });
  const rejected: [string, unknown][] = [
    ["empty", ""],
    ["not a string", 7],
    ["null", null],
    ["outside the base64url alphabet", "not+valid/base64="],
    ["padded", `${valid}=`],
    // The case the alphabet check above CANNOT reach: a different spelling,
    // entirely inside the alphabet, that Buffer.from decodes to exactly the
    // same bytes because unpadded base64url leaves spare low bits in the last
    // character. Only the round-trip check rejects this one — without it the
    // decode succeeds and a cursor nobody minted is accepted as canonical.
    ["a non-canonical spelling of a real cursor", nonCanonicalTwin(valid)],
    ["not JSON", Buffer.from("not json at all", "utf8").toString("base64url")],
    ["a JSON array", Buffer.from("[1,2,3]", "utf8").toString("base64url")],
    [
      "a future cursor version",
      Buffer.from(JSON.stringify({ v: 2, s: "s", i: "i" }), "utf8").toString("base64url"),
    ],
    [
      "a missing id",
      Buffer.from(JSON.stringify({ v: CLIENT_V1_CURSOR_VERSION, s: "s" }), "utf8").toString("base64url"),
    ],
    [
      "an empty id",
      Buffer.from(JSON.stringify({ v: CLIENT_V1_CURSOR_VERSION, s: "s", i: "" }), "utf8").toString("base64url"),
    ],
    [
      "a non-string sort key",
      Buffer.from(JSON.stringify({ v: CLIENT_V1_CURSOR_VERSION, s: 1, i: "i" }), "utf8").toString("base64url"),
    ],
    [
      "an unexpected field",
      Buffer.from(
        JSON.stringify({ v: CLIENT_V1_CURSOR_VERSION, s: "s", i: "i", extra: "x" }),
        "utf8",
      ).toString("base64url"),
    ],
    ["over the cursor budget", "A".repeat(CLIENT_V1_LIMITS.cursorCharacters + 1)],
  ];
  for (const [label, candidate] of rejected) {
    assert.throws(() => decodeClientV1Cursor(candidate), /cursor/i, label);
  }
  // The budget boundary itself is admissible, not merely one below it.
  //
  // This used to encode a 120-character sort key and assert only that the token
  // came out `<= cursorCharacters`. That token is around 180 characters — it
  // never reaches the ceiling, so the sentence above was a claim the test did
  // not make, and the ceiling could be wrong by hundreds of characters with
  // nothing failing. Measured: moving the check to
  // `cursorCharacters - 200` left this case green. So the key is now grown
  // until the encoded token sits EXACTLY on the budget, and one character more
  // is required to be refused — which is what makes `>` rather than `>=` the
  // tested comparison.
  let sortLength = 1;
  let encoded = encodeClientV1Cursor({ sort: "s".repeat(sortLength), id: "i" });
  while (encoded.length < CLIENT_V1_LIMITS.cursorCharacters && sortLength < 2000) {
    sortLength += 1;
    encoded = encodeClientV1Cursor({ sort: "s".repeat(sortLength), id: "i" });
  }
  // base64url of a 3-byte-aligned payload lands on the ceiling exactly; if the
  // arithmetic ever stops working out the loop above overshoots and this fails
  // loudly rather than testing a token below the boundary again.
  assert.equal(
    encoded.length,
    CLIENT_V1_LIMITS.cursorCharacters,
    "no key encodes to a token exactly on the cursor budget",
  );
  assert.deepEqual(decodeClientV1Cursor(encoded), { sort: "s".repeat(sortLength), id: "i" });
  // One character past the budget is refused, so the boundary is a boundary
  // rather than a suggestion.
  assert.throws(
    () => decodeClientV1Cursor(`${encoded}A`),
    /exceeds 512 characters/,
  );
});

test("a full continuation page that is also the last page publishes no next", () => {
  // The over-fetch is the ONLY evidence for `hasMore`, and this is the case
  // where a page is full and the set is nonetheless exhausted. Getting it wrong
  // hands the client a `next` that leads to an empty page — which terminates,
  // so a walk-to-exhaustion test cannot see it, and every route-level walk here
  // is one. Only asserting `hasMore`/`next` on the boundary page catches it.
  const first = page(2, null);
  const second = page(2, decodeClientV1Cursor(first.cursor!.next!));
  assert.deepEqual(second.items.map((row) => row.id), ["c", "b"]);
  assert.equal(second.cursor!.hasMore, true);
  // The set holds five rows, so the third page is exactly one short of full and
  // must not publish a token. The exact-multiple case is the fourth page below.
  const third = page(2, decodeClientV1Cursor(second.cursor!.next!));
  assert.deepEqual(third.items.map((row) => row.id), ["a"]);
  assert.equal(third.cursor!.hasMore, false);
  assert.equal(third.cursor!.next, undefined);

  // Now the exact multiple: a limit that divides the remaining set evenly, so
  // the final page comes back FULL. `hasMore` must still be false.
  const firstOfFour = page(4, null);
  assert.equal(firstOfFour.items.length, 4);
  assert.equal(firstOfFour.cursor!.hasMore, true);
  const finalFull = page(1, decodeClientV1Cursor(firstOfFour.cursor!.next!));
  assert.deepEqual(finalFull.items.map((row) => row.id), ["a"]);
  assert.equal(finalFull.items.length, 1, "the final page is exactly full at this limit");
  assert.equal(finalFull.cursor!.hasMore, false);
  assert.equal(finalFull.cursor!.next, undefined);
});

test("page limit defaults to the contract page size and is bounded by its ceiling", () => {
  assert.equal(parseClientV1PageLimit(null), CLIENT_V1_LIMITS.defaultPageSize);
  assert.equal(parseClientV1PageLimit("1"), 1);
  assert.equal(
    parseClientV1PageLimit(String(CLIENT_V1_LIMITS.maxPageSize)),
    CLIENT_V1_LIMITS.maxPageSize,
  );
  for (const candidate of [
    "0",
    "-1",
    "1.5",
    "1e2",
    " 10",
    "10 ",
    "",
    "010",
    "abc",
    "+5",
    String(CLIENT_V1_LIMITS.maxPageSize + 1),
  ]) {
    assert.throws(() => parseClientV1PageLimit(candidate), /limit/i, candidate);
  }
});

test("the first page over-fetches to decide hasMore and never leaks the probe row", () => {
  const first = page(2, null);
  assert.deepEqual(first.items.map((row) => row.id), ["e", "d"]);
  // No `current`: nothing was resumed, so publishing one would hand back a
  // token the client never sent.
  assert.deepEqual(first.cursor, {
    next: encodeClientV1Cursor(keyOf(ROWS[1])),
    hasMore: true,
  });
  assert.doesNotThrow(() => parseClientV1Cursor(first.cursor!));
});

test("following next walks the whole set exactly once and then stops", () => {
  const seen: string[] = [];
  let after: ClientV1PageKey | null = null;
  for (let guard = 0; guard < 10; guard += 1) {
    const result = page(2, after);
    seen.push(...result.items.map((row) => row.id));
    const next = result.cursor?.next;
    if (!next) break;
    after = decodeClientV1Cursor(next);
  }
  assert.deepEqual(seen, ["e", "d", "c", "b", "a"]);
});

test("a tied sort key is separated by the id tiebreak rather than repeated", () => {
  // "c" and "b" share a timestamp. A cursor comparing the sort key alone would
  // either serve both again or skip both.
  const boundary = page(3, null);
  assert.deepEqual(boundary.items.map((row) => row.id), ["e", "d", "c"]);
  const next = page(3, decodeClientV1Cursor(boundary.cursor!.next!));
  assert.deepEqual(next.items.map((row) => row.id), ["b", "a"]);
  assert.equal(next.cursor?.hasMore, false);
  assert.equal(next.cursor?.next, undefined);
});

test("replaying the same cursor is idempotent rather than advancing or looping", () => {
  const first = page(2, null);
  const after = decodeClientV1Cursor(first.cursor!.next!);
  const once = page(2, after);
  const twice = page(2, after);
  assert.deepEqual(once.items, twice.items);
  assert.deepEqual(once.cursor, twice.cursor);
});

test("a first page holding the whole set publishes no cursor at all", () => {
  const last = page(5, null);
  assert.deepEqual(last.items.map((row) => row.id), ["e", "d", "c", "b", "a"]);
  // `{ hasMore: false }` on its own is not a cursor the contract accepts, and
  // asserting that here is the point: the paginator must not hand the envelope
  // builder a value parseClientV1Cursor throws on.
  assert.equal(last.cursor, undefined);
  assert.throws(() => parseClientV1Cursor({ hasMore: false }), /at least one/);
});

test("an empty first page publishes no cursor at all", () => {
  const empty = paginateClientV1Keyset([] as Row[], {
    limit: 10,
    after: null,
    keyOf,
    compare: compareClientV1RecencyKeys,
  });
  assert.deepEqual(empty.items, []);
  // parseClientV1Cursor refuses a cursor carrying no token, so emitting
  // `{ hasMore: false }` with nothing else on a *first* page would make the
  // envelope builder throw. Omitting the field entirely is the only shape the
  // contract accepts here.
  assert.equal(empty.cursor, undefined);
});

test("an empty continuation page keeps the cursor the client sent", () => {
  const after: ClientV1PageKey = { sort: "1970-01-01T00:00:00.000Z", id: "zzzz" };
  const empty = page(10, after);
  assert.deepEqual(empty.items, []);
  assert.deepEqual(empty.cursor, {
    current: encodeClientV1Cursor(after),
    hasMore: false,
  });
  assert.doesNotThrow(() => parseClientV1Cursor(empty.cursor!));
});

test("a cursor whose row has been deleted resumes at the next surviving row", () => {
  // Keyset paging is defined by the ordering, not by a row still existing, so
  // deleting the row a client is holding must not strand it.
  const after: ClientV1PageKey = { sort: "2026-08-04T00:00:00.000Z", id: "d" };
  const survived = paginateClientV1Keyset(
    ROWS.filter((row) => row.id !== "d"),
    { limit: 2, after, keyOf, compare: compareClientV1RecencyKeys },
  );
  assert.deepEqual(survived.items.map((row) => row.id), ["c", "b"]);
});

test("ascending pagination walks the same set from the other end", () => {
  const ascending = [...ROWS].sort((a, b) => compareClientV1AscendingKeys(keyOf(a), keyOf(b)));
  assert.deepEqual(ascending.map((row) => row.id), ["a", "b", "c", "d", "e"]);
  const first = paginateClientV1Keyset(ascending, {
    limit: 2,
    after: null,
    keyOf,
    compare: compareClientV1AscendingKeys,
  });
  assert.deepEqual(first.items.map((row) => row.id), ["a", "b"]);
});

test("sequence pagination resumes by position, not by comparing keys", () => {
  // Chat turns are a chain, not a sorted set: a user turn and its assistant
  // reply share a createdAt stamp, so ordering them by (createdAt, id) would
  // swap the reply in front of the message it answers. Position is the only
  // correct resume key here.
  const turns = [
    { id: "t1", at: "2026-08-01T00:00:00.000Z" },
    { id: "t2", at: "2026-08-01T00:00:00.000Z" },
    { id: "t3", at: "2026-08-02T00:00:00.000Z" },
  ];
  const first = paginateClientV1Sequence(turns, { limit: 2, after: null, keyOf });
  assert.notEqual(first, null);
  assert.deepEqual(first!.items.map((turn) => turn.id), ["t1", "t2"]);
  assert.equal(first!.cursor?.hasMore, true);
  const second = paginateClientV1Sequence(turns, {
    limit: 2,
    after: decodeClientV1Cursor(first!.cursor!.next!),
    keyOf,
  });
  assert.deepEqual(second!.items.map((turn) => turn.id), ["t3"]);
  assert.equal(second!.cursor?.hasMore, false);
});

test("sequence pagination reports an unresolvable cursor rather than guessing", () => {
  const turns = [{ id: "t1", at: "2026-08-01T00:00:00.000Z" }];
  // The active branch moved under the client. Restarting silently at the top
  // would replay the transcript as if nothing happened; resuming at position 0
  // would serve a different branch under the same cursor.
  assert.equal(
    paginateClientV1Sequence(turns, {
      limit: 2,
      after: { sort: "2026-08-01T00:00:00.000Z", id: "gone" },
      keyOf,
    }),
    null,
  );
});

test("sequence pagination on an empty transcript publishes no cursor", () => {
  const empty = paginateClientV1Sequence([] as Row[], { limit: 2, after: null, keyOf });
  assert.deepEqual(empty!.items, []);
  assert.equal(empty!.cursor, undefined);
});

test("the encoder never mints a token this module's own decoder refuses", () => {
  // encode and decode are a pair, and nothing asserted they agreed. Page keys
  // are read straight out of stores that do not validate their own JSON, so a
  // non-string sort key is reachable — and JSON.stringify carries a number
  // through happily while dropping an `undefined` key entirely. The token then
  // came back as `invalid_request` ("its sort key is not a string") for a
  // cursor THIS SERVER wrote, which a client following `next` reads as its own
  // bug and cannot page past.
  assert.throws(
    () => encodeClientV1Cursor({ sort: 1767225600000 as unknown as string, id: "c1" }),
    /page key must be two strings/,
  );
  assert.throws(
    () => encodeClientV1Cursor({ sort: undefined as unknown as string, id: "c1" }),
    /page key must be two strings/,
  );
  assert.throws(
    () => encodeClientV1Cursor({ sort: "s", id: "" }),
    /page key must be two strings/,
  );
  // The property the pair owes each other, stated once: anything minted decodes
  // back to the key it was minted from.
  for (const key of [
    { sort: "", id: "i" },
    { sort: "2026-08-01T00:00:00.000Z", id: "conversation-1" },
    { sort: "💀", id: "💀" },
    { sort: "a".repeat(120), id: "b".repeat(120) },
  ]) {
    assert.deepEqual(decodeClientV1Cursor(encodeClientV1Cursor(key)), key);
  }
});

test("the key comparator stays a strict weak order when a sort key is not a string", () => {
  // `undefined < "a"` and `undefined > "a"` are BOTH false, so an unguarded
  // comparison collapses to a tie against every string — and the id tiebreak
  // then makes the order CYCLIC rather than merely arbitrary. These three keys
  // are the measured witness: before the coercion each compared greater than
  // the next, and Array#sort returned three different orders for the three
  // input permutations. A keyset over a cyclic order skips rows.
  const bad = { sort: undefined as unknown as string, id: "m" };
  const low = { sort: "a", id: "z" };
  const high = { sort: "b", id: "a" };
  const cycle = compareClientV1RecencyKeys(bad, low) > 0
    && compareClientV1RecencyKeys(low, high) > 0
    && compareClientV1RecencyKeys(high, bad) > 0;
  assert.equal(cycle, false);
  const orders = new Set(
    [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]].map((permutation) =>
      permutation
        .map((index) => [bad, low, high][index])
        .sort(compareClientV1RecencyKeys)
        .map((key) => key.id)
        .join(",")),
  );
  assert.equal(orders.size, 1, `sort order depended on input order: ${[...orders].join(" | ")}`);
  // Antisymmetry, in both comparators, for the same reason.
  assert.equal(
    Math.sign(compareClientV1AscendingKeys(bad, low)),
    -Math.sign(compareClientV1AscendingKeys(low, bad)),
  );
});
