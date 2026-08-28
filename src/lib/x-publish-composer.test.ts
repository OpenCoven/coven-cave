import assert from "node:assert/strict";
import test from "node:test";

import {
  composerGate,
  draftPublications,
  publishedPublications,
  unresolvedPublications,
  unresolvedSummary,
  weightedPostLength,
  X_POST_WEIGHTED_LIMIT,
  type XPublicationRecord,
} from "./x-publish-composer.ts";

function record(overrides: Partial<XPublicationRecord> = {}): XPublicationRecord {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    text: "hello",
    status: "draft",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

test("weighted length charges two for what X charges two for", () => {
  assert.equal(weightedPostLength(""), 0);
  assert.equal(weightedPostLength("hello"), 5);
  // A code point outside the weight-1 ranges costs two, and an astral one is
  // ONE character costing two — not two units of `String.length`.
  assert.equal(weightedPostLength("😀"), 2);
  assert.equal("😀".length, 2, "the naive count agrees here only by coincidence");
  assert.equal(weightedPostLength("漢字"), 4);
  assert.equal("漢字".length, 2, "a naive count would under-charge CJK by half");
  // The four weight-1 ranges, which a single 0x0000–0x10FF rule would miss.
  assert.equal(weightedPostLength("​"), 1, "U+200B is inside 0x2000–0x200D");
  assert.equal(weightedPostLength("—"), 1, "an em dash is inside 0x2010–0x201F");
  assert.equal(weightedPostLength("″"), 1, "U+2033 is inside 0x2032–0x2037");
  assert.equal(weightedPostLength("☀"), 2, "a code point in no weight-1 range costs two");
});

test("weighted length composes before it counts, as X does", () => {
  const composed = "é";
  const decomposed = "é";
  assert.notEqual(composed, decomposed, "the two spellings really are different strings");
  assert.equal(weightedPostLength(composed), 1);
  assert.equal(
    weightedPostLength(decomposed),
    1,
    "X normalizes to NFC before counting; charging two here would warn about a limit the post is nowhere near",
  );
  // A whole line of accented text is the case where the difference is visible.
  assert.equal(weightedPostLength("é".repeat(140)), 140);
});

test("the standard limit is a mark, not a gate", () => {
  // The store deliberately does not hard-code 280 because an entitlement can
  // raise it. This constant exists to LABEL text, so nothing here should ever
  // become a refusal.
  assert.equal(X_POST_WEIGHTED_LIMIT, 280);
  const long = "a".repeat(400);
  assert.equal(weightedPostLength(long), 400);
  assert.equal(
    composerGate({
      text: long,
      confirmation: { publicationId: record().id, text: long, token: "t" },
      publications: [],
    }).kind,
    "publish",
    "over-limit text must still be publishable — X and the account's entitlement decide",
  );
});

test("an unresolved attempt holds the composer, not just its own record", () => {
  const uncertain = record({ status: "uncertain", dispatchedAt: "2026-08-02T10:00:00.000Z" });
  const gate = composerGate({
    text: "a completely different post",
    confirmation: { publicationId: "22222222-2222-4222-8222-222222222222", text: "a completely different post", token: "t" },
    publications: [uncertain],
  });
  assert.equal(gate.kind, "resolve-first");
  assert.deepEqual(gate.kind === "resolve-first" ? gate.unresolved : [], [uncertain]);
});

test("clearing the box does not step past an unresolved attempt", () => {
  // The hold is checked before the text is looked at. Checking emptiness first
  // would let someone reach a neutral-looking "nothing to publish" state and
  // lose the backlog off the screen.
  const gate = composerGate({
    text: "",
    confirmation: null,
    publications: [record({ status: "uncertain" })],
  });
  assert.equal(gate.kind, "resolve-first");
});

test("a settled record does not hold anything", () => {
  for (const status of ["draft", "published", "abandoned"] as const) {
    assert.equal(
      composerGate({ text: "", confirmation: null, publications: [record({ status })] }).kind,
      "empty",
      `${status} must not hold the composer`,
    );
  }
});

test("confirmation is bound to the exact wording it was minted for", () => {
  const confirmation = { publicationId: record().id, text: "ship it", token: "t" };
  assert.equal(
    composerGate({ text: "ship it", confirmation, publications: [] }).kind,
    "publish",
  );
  assert.equal(
    composerGate({ text: "ship it!", confirmation, publications: [] }).kind,
    "confirm",
    "one added character lapses the approval, as it does on the server",
  );
  assert.equal(
    composerGate({ text: "ship it ", confirmation, publications: [] }).kind,
    "confirm",
    "a trailing space is a different post — the token is minted over exact bytes",
  );
  assert.equal(
    composerGate({ text: "ship it", confirmation: null, publications: [] }).kind,
    "confirm",
  );
});

test("whitespace alone is nothing to publish", () => {
  assert.equal(composerGate({ text: "   \n ", confirmation: null, publications: [] }).kind, "empty");
});

test("unresolved and published partitions are exactly the two statuses they name", () => {
  const all = [
    record({ id: "a", status: "draft" }),
    record({ id: "b", status: "uncertain" }),
    record({ id: "c", status: "published", publishedAt: "2026-08-01T00:00:00.000Z" }),
    record({ id: "d", status: "abandoned" }),
    record({ id: "e", status: "published", publishedAt: "2026-08-03T00:00:00.000Z" }),
  ];
  assert.deepEqual(unresolvedPublications(all).map((p) => p.id), ["b"]);
  assert.deepEqual(
    publishedPublications(all).map((p) => p.id),
    ["e", "c"],
    "sent posts read newest first",
  );
});

test("the draft partition is saved-but-never-sent, newest touched first", () => {
  const all = [
    record({ id: "a", status: "draft", updatedAt: "2026-08-01T00:00:00.000Z" }),
    record({ id: "b", status: "uncertain" }),
    record({ id: "c", status: "published" }),
    record({ id: "d", status: "abandoned" }),
    record({ id: "e", status: "draft", updatedAt: "2026-08-03T00:00:00.000Z" }),
  ];
  assert.deepEqual(
    draftPublications(all).map((p) => p.id),
    ["e", "a"],
    "drafts read newest touched first, like sent posts read newest sent first",
  );
});

test("the unresolved summary states what is known and nothing more", () => {
  const dispatchedAt = "2026-08-02T10:00:00.000Z";
  const summary = unresolvedSummary(record({ status: "uncertain", dispatchedAt }));
  // A clock time the reader can compare against X, not an ISO string — every
  // other role surface renders an instant this way.
  assert.ok(
    summary.includes(new Date(dispatchedAt).toLocaleString()),
    `expected a locale-rendered dispatch time in: ${summary}`,
  );
  assert.doesNotMatch(summary, /2026-08-02T10:00:00\.000Z/, "the raw ISO string is not for reading");
  assert.match(summary, /may or may not/);
  // It must never assert an outcome; that is the whole reason the record is
  // uncertain and the reason a human is being asked.
  assert.doesNotMatch(summary, /\b(failed|succeeded|posted successfully|was not posted)\b/i);
});

test("a record whose dispatch time is missing still names a time", () => {
  // `dispatchedAt` is present exactly while the status is uncertain, but the
  // summary must not render "Sent at undefined" if that invariant ever slips.
  const updatedAt = "2026-08-04T00:00:00.000Z";
  const summary = unresolvedSummary(record({ status: "uncertain", updatedAt }));
  assert.ok(summary.includes(new Date(updatedAt).toLocaleString()), summary);
  assert.doesNotMatch(summary, /undefined/);
});

test("a dispatch time that will not parse is shown raw, never as Invalid Date", () => {
  // The stored string is evidence of what was sent and when. If it is ever
  // something `Date` cannot read, showing it verbatim keeps that evidence;
  // "Invalid Date" would destroy it in the one message that must not.
  const summary = unresolvedSummary(record({ status: "uncertain", dispatchedAt: "not-a-date" }));
  assert.match(summary, /Sent at not-a-date/);
  assert.doesNotMatch(summary, /Invalid Date/);
});
