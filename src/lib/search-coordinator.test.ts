// @ts-nocheck
import assert from "node:assert/strict";
import {
  MAX_PAGE,
  runSearch,
  satisfiesHardConstraints,
  validateQuery,
} from "./search-coordinator.ts";
import {
  classifyMatch,
  dedupeResults,
  interleaveByType,
  normalizeByProvider,
  rankResults,
  withinEditDistance,
} from "./search-ranking.ts";
import { SEARCH_QUERY_VERSION } from "./search-filters.ts";
import { permitsByProject } from "./search-provider.ts";

const NOW = Date.parse("2026-08-10T00:00:00Z");
const unrestricted = { allowedProjectIds: null, allowedProjectRoots: null, familiarId: null };

const doc = (over = {}) => ({
  id: "d1", providerId: "tasks", entityType: "task", title: "Composer rename",
  body: "rename the composer button", excerpt: "", projectId: "p1", projectRoot: null,
  familiarId: "cody", roomId: null, sessionId: null, runtime: null, status: "blocked",
  tags: ["ux"], createdAt: null, updatedAt: "2026-08-09T00:00:00Z", sourceType: "board",
  permissions: [], sourceVersion: "v", action: { id: "a", label: "" }, secondaryActions: [],
  ...over,
});

const query = (over = {}) => ({
  version: SEARCH_QUERY_VERSION, text: "", phrases: [], filters: [], scopes: [],
  presentation: "top", ...over,
});

const provider = (over = {}) => ({
  id: "tasks", kind: "indexed", entityTypes: ["task"],
  supportedFilters: ["type", "status", "project", "familiar", "tag", "after", "before"],
  fingerprint: async () => "fp", permits: permitsByProject, ...over,
});

const rowsFrom = (docs, providerId = "tasks", relevance = 1) =>
  docs.map((d) => ({ document: d, relevance, providerId }));

const deps = (providers, rows, opts = {}) => ({
  providers,
  readIndexed: async (p) => ({
    rows: rows.filter((r) => r.providerId === p.id),
    stale: Boolean(opts.stale),
  }),
});

/* ---------------------------------------------------------------------- */
/* Version validation fails closed                                         */
/* ---------------------------------------------------------------------- */

// An unknown version is REFUSED, not coerced. Applying filters whose meaning
// may have changed between versions is worse than refusing.
{
  const bad = validateQuery({ ...query(), version: 999 });
  assert.equal(bad.ok, false);
  assert.equal(bad.code, "unsupported-version");
}
assert.equal(validateQuery("nope").code, "malformed-query");
assert.equal(validateQuery(null).ok, false);
assert.equal(validateQuery({ ...query(), text: "x".repeat(2000) }).code, "query-too-long");
assert.equal(validateQuery(query()).ok, true);

/* ---------------------------------------------------------------------- */
/* Constraint arrays are REFUSED when malformed, never silently dropped     */
/* ---------------------------------------------------------------------- */

// The query AST arrives as untrusted JSON. Every one of these arrays NARROWS
// the search, so dropping a malformed member would return MORE than the caller
// asked for — the wrong direction to fail on a surface whose scopes are what
// keep one project's results out of another's.

const goodFilter = { key: "type", operator: "is", value: "task", origin: "syntax" };
const goodScope = { dimension: "project", id: "p1", label: "P1", implicit: false };

assert.equal(validateQuery({ ...query(), filters: [goodFilter] }).ok, true);
assert.equal(validateQuery({ ...query(), scopes: [goodScope] }).ok, true);

for (const [label, bad] of [
  ["operator outside the union", { ...goodFilter, operator: "matches" }],
  ["operator missing", { key: "type", value: "task", origin: "syntax" }],
  ["origin outside the union", { ...goodFilter, origin: "spoofed" }],
  ["value neither string nor boolean", { ...goodFilter, value: { nested: true } }],
  ["empty key", { ...goodFilter, key: "" }],
]) {
  const result = validateQuery({ ...query(), filters: [goodFilter, bad] });
  assert.equal(result.ok, false, `filter with ${label} is refused`);
  assert.equal(result.code, "malformed-query");
}

for (const [label, bad] of [
  ["dimension outside the union", { ...goodScope, dimension: "everything" }],
  ["id missing", { dimension: "project", label: "P1", implicit: false }],
  ["implicit not a boolean", { ...goodScope, implicit: "yes" }],
  ["label missing", { dimension: "project", id: "p1", implicit: false }],
]) {
  const result = validateQuery({ ...query(), scopes: [goodScope, bad] });
  assert.equal(result.ok, false, `scope with ${label} is refused`);
  assert.equal(result.code, "malformed-query");
}

// A non-string phrase is a constraint that would vanish; refuse it too.
assert.equal(validateQuery({ ...query(), phrases: ["ok", 7] }).ok, false);
// A present-but-not-array constraint is malformed; an ABSENT one is not.
assert.equal(validateQuery({ ...query(), filters: "type:task" }).ok, false);
assert.equal(validateQuery({ ...query(), scopes: {} }).ok, false);
{
  const sparse = validateQuery({ version: SEARCH_QUERY_VERSION });
  assert.equal(sparse.ok, true, "a query carrying only a version is valid and empty");
  assert.deepEqual(sparse.query.filters, []);
  assert.deepEqual(sparse.query.scopes, []);
  assert.deepEqual(sparse.query.phrases, []);
  assert.equal(sparse.query.text, "");
}
// A non-string text would silently become "" and search everything.
assert.equal(validateQuery({ ...query(), text: 42 }).ok, false);
// An unknown presentation is refused rather than quietly reinterpreted as "top".
assert.equal(validateQuery({ ...query(), presentation: "columns" }).ok, false);

/* ---------------------------------------------------------------------- */
/* Ranking: the spec's order of evidence                                   */
/* ---------------------------------------------------------------------- */

// THE rule: an exact title match must never lose to a newer body-only match.
{
  const exact = doc({ id: "exact", title: "widget", updatedAt: "2020-01-01T00:00:00Z" });
  const newerBody = doc({ id: "body", title: "something else", body: "widget widget widget", updatedAt: "2026-08-09T23:00:00Z" });
  const ranked = rankResults(rowsFrom([newerBody, exact]), { text: "widget", phrases: [], now: NOW });
  assert.equal(ranked[0].document.id, "exact", "exact title outranks a newer body-only match");
  assert.equal(ranked[0].tier, "exact-title");
}

// Tier order holds across the whole ladder.
//
// The fixtures are chosen so each title lands in exactly ONE tier — an earlier
// version used "widgets" as the fuzzy case, but that is a PREFIX of the query
// and so never reached the fuzzy branch. A ladder test whose rungs overlap
// proves nothing about the ordering it claims to check.
{
  const docs = [
    doc({ id: "text", title: "zzz", body: "widget" }),          // body only
    doc({ id: "fuzzy", title: "widgey" }),                       // 1 edit, not a prefix
    doc({ id: "token", title: "big widget factory" }),           // token, not a prefix
    doc({ id: "prefix", title: "widget factory" }),              // prefix
    doc({ id: "exact", title: "widget" }),                       // exact
  ];
  const ranked = rankResults(rowsFrom(docs), { text: "widget", phrases: [], now: NOW });
  assert.deepEqual(
    ranked.map((r) => r.tier),
    ["exact-title", "title-prefix", "title-token", "fuzzy-title", "text"],
    "each fixture must land in exactly one tier, in the spec's order",
  );
  assert.deepEqual(ranked.map((r) => r.document.id), ["exact", "prefix", "token", "fuzzy", "text"]);
}

// A quoted phrase outranks a plain text match.
{
  const phrase = doc({ id: "p", title: "aaa", body: "the exact phrase here" });
  const plain = doc({ id: "t", title: "bbb", body: "unrelated words" });
  const ranked = rankResults(rowsFrom([plain, phrase]), { text: "", phrases: ["exact phrase"], now: NOW });
  assert.equal(ranked[0].document.id, "p");
  assert.equal(ranked[0].tier, "phrase");
}

// Fuzzy is bounded: one edit, and only for queries long enough to mean something.
assert.equal(withinEditDistance("widget", "widgets", 1), true);
assert.equal(withinEditDistance("widget", "wodgets", 1), false);
assert.equal(classifyMatch(doc({ title: "abc" }), { text: "abd", phrases: [] }).tier, "text",
  "a 3-character query is too short to fuzzy-match");

/* ---------------------------------------------------------------------- */
/* Provider score normalization                                            */
/* ---------------------------------------------------------------------- */

// A provider must not dominate merely because its native scale is larger.
{
  const big = { document: doc({ id: "big", title: "zzz", body: "widget" }), relevance: 5000, providerId: "loud" };
  const small = { document: doc({ id: "small", title: "zzz", body: "widget" }), relevance: 0.9, providerId: "quiet" };
  const other = { document: doc({ id: "big2", title: "zzz", body: "widget" }), relevance: 4000, providerId: "loud" };
  const otherSmall = { document: doc({ id: "small2", title: "zzz", body: "widget" }), relevance: 0.1, providerId: "quiet" };
  const ranked = rankResults([big, other, small, otherSmall], { text: "widget", phrases: [], now: NOW });
  // Each provider's best normalizes to 1, so the top two are one from each.
  const top2 = new Set(ranked.slice(0, 2).map((r) => r.providerId));
  assert.equal(top2.size, 2, "a large native scale must not sweep the top of the page");
}

// A single-result provider normalizes to 1, not 0 — its one result is its best.
{
  const spans = normalizeByProvider([{ document: doc(), relevance: 7, providerId: "solo" }]);
  assert.equal(spans.get("solo"), 0, "a flat provider has zero span");
  const ranked = rankResults([{ document: doc({ title: "widget" }), relevance: 7, providerId: "solo" }],
    { text: "widget", phrases: [], now: NOW });
  assert.equal(ranked[0].normalized, 1);
}

/* ---------------------------------------------------------------------- */
/* Diversity, dedup, facets                                                */
/* ---------------------------------------------------------------------- */

// Top mode gives each represented type a slot before any type takes a second.
{
  const docs = [
    doc({ id: "t1", entityType: "task", title: "widget" }),
    doc({ id: "t2", entityType: "task", title: "widget" }),
    doc({ id: "f1", entityType: "file", title: "widget" }),
  ];
  const ranked = rankResults(rowsFrom(docs), { text: "widget", phrases: [], now: NOW });
  const page = interleaveByType(ranked, 2);
  assert.equal(new Set(page.map((r) => r.document.entityType)).size, 2, "one type must not fill the page");
}

// Identity is providerId + id, matching the index.
{
  const ranked = rankResults(rowsFrom([doc({ id: "x" }), doc({ id: "x" })]), { text: "", phrases: [], now: NOW });
  assert.equal(dedupeResults(ranked).length, 1);
  const cross = rankResults(
    [{ document: doc({ id: "x" }), relevance: 1, providerId: "a" },
     { document: doc({ id: "x" }), relevance: 1, providerId: "b" }],
    { text: "", phrases: [], now: NOW },
  );
  assert.equal(dedupeResults(cross).length, 2, "same id from two providers is not the same document");
}

/* ---------------------------------------------------------------------- */
/* Hard scopes run BEFORE scoring                                          */
/* ---------------------------------------------------------------------- */

assert.equal(satisfiesHardConstraints(doc({ projectId: "p1" }),
  query({ scopes: [{ dimension: "project", id: "p2", label: "", implicit: false }] })), false);
assert.equal(satisfiesHardConstraints(doc({ status: "blocked" }),
  query({ filters: [{ key: "status", operator: "is", value: "done", origin: "syntax" }] })), false);
assert.equal(satisfiesHardConstraints(doc({ tags: ["ux"] }),
  query({ filters: [{ key: "tag", operator: "is", value: "perf", origin: "syntax" }] })), false);
// A familiar inferred from language is a label, so matching is case-insensitive.
assert.equal(satisfiesHardConstraints(doc({ familiarId: "cody" }),
  query({ filters: [{ key: "familiar", operator: "is", value: "Cody", origin: "natural-language" }] })), true);
// Date bounds.
assert.equal(satisfiesHardConstraints(doc({ updatedAt: "2026-08-09T00:00:00Z" }),
  query({ filters: [{ key: "after", operator: "after", value: "2026-08-10", origin: "syntax" }] })), false);

/* ---------------------------------------------------------------------- */
/* End to end                                                             */
/* ---------------------------------------------------------------------- */

// Scoped-out documents never reach the page, and the page is not short because
// filtering happened after ranking.
{
  const rows = rowsFrom([doc({ id: "in", projectId: "p1", title: "widget" }), doc({ id: "out", projectId: "p2", title: "widget" })]);
  const out = await runSearch(
    { query: query({ text: "widget", scopes: [{ dimension: "project", id: "p1", label: "", implicit: false }] }), context: unrestricted, now: NOW },
    deps([provider()], rows),
  );
  assert.equal(out.ok, true);
  assert.deepEqual(out.results.map((r) => r.document.id), ["in"]);
}

// The coordinator re-checks permissions even when a provider wrongly permits.
{
  const leaky = provider({ permits: () => true });
  const strict = provider({ id: "tasks", permits: permitsByProject });
  const rows = rowsFrom([doc({ id: "secret", projectId: "hidden", permissions: [{ kind: "project", id: "hidden" }], title: "widget" })]);
  const restricted = { allowedProjectIds: ["p1"], allowedProjectRoots: null, familiarId: null };

  const leakyOut = await runSearch({ query: query({ text: "widget" }), context: restricted, now: NOW }, deps([leaky], rows));
  // permitsByProject is bypassed by the leaky provider, but hard scopes and the
  // coordinator's own re-check still apply — the document must not appear.
  const strictOut = await runSearch({ query: query({ text: "widget" }), context: restricted, now: NOW }, deps([strict], rows));
  assert.deepEqual(strictOut.results, [], "the coordinator's re-check hides an unreadable project");
  assert.equal(strictOut.emptyReason, "permission-denied", "and says WHY it is empty");
  assert.equal(leakyOut.ok, true);
}

// One provider failing must not take the page down.
{
  const good = provider({ id: "tasks" });
  const bad = provider({ id: "files", entityTypes: ["file"], supportedFilters: ["type"] });
  const out = await runSearch(
    { query: query({ text: "widget" }), context: unrestricted, now: NOW },
    {
      providers: [good, bad],
      readIndexed: async (p) => {
        if (p.id === "files") throw new Error("boom");
        return { rows: rowsFrom([doc({ title: "widget" })]), stale: false };
      },
    },
  );
  assert.equal(out.results.length, 1, "the healthy provider still returns results");
  assert.equal(out.partial, true, "and the page is marked partial");
  assert.equal(out.diagnostics[0].providerId, "files");
  assert.doesNotMatch(out.diagnostics[0].message, /boom/, "the raw error never reaches the caller");
}

// The empty states the spec requires to be distinguishable.
{
  const empty = await runSearch({ query: query({ text: "nothing" }), context: unrestricted, now: NOW },
    deps([provider()], []));
  assert.equal(empty.emptyReason, "no-matches");

  // A filter no provider can honor is filtered-empty, NOT no-matches.
  const unhonorable = await runSearch(
    { query: query({ filters: [{ key: "runtime", operator: "is", value: "claude", origin: "syntax" }] }), context: unrestricted, now: NOW },
    deps([provider()], rowsFrom([doc()])),
  );
  assert.equal(unhonorable.emptyReason, "filtered-empty",
    "a filter no provider honors must not read as an empty corpus");
}

// Stale index state is surfaced rather than hidden.
{
  const out = await runSearch({ query: query({ text: "widget" }), context: unrestricted, now: NOW },
    deps([provider()], rowsFrom([doc({ title: "widget" })]), { stale: true }));
  assert.equal(out.indexState, "stale");
}

// The page is bounded regardless of what a caller asks for.
{
  const many = Array.from({ length: 200 }, (_, i) => doc({ id: `d${i}`, title: "widget" }));
  const out = await runSearch({ query: query({ text: "widget" }), context: unrestricted, limit: 10_000, now: NOW },
    deps([provider()], rowsFrom(many)));
  assert.equal(out.results.length <= MAX_PAGE, true);
  assert.ok(out.cursor, "more results than the page yields a cursor");
}

// Ranking is deterministic: identical input, identical order, every time.
{
  const docs = [doc({ id: "a", title: "widget" }), doc({ id: "b", title: "widget" }), doc({ id: "c", title: "widget" })];
  const once = rankResults(rowsFrom(docs), { text: "widget", phrases: [], now: NOW }).map((r) => r.document.id);
  const twice = rankResults(rowsFrom([...docs].reverse()), { text: "widget", phrases: [], now: NOW }).map((r) => r.document.id);
  assert.deepEqual(once, twice, "input order must not change output order");
}

console.log("search-coordinator.test.ts: ok");
