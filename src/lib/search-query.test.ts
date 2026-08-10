// @ts-nocheck
import assert from "node:assert/strict";
import {
  broadenToGlobal,
  parseSearchQuery,
  searchQueryFromUrlParams,
  searchQueryToUrlParams,
  searchQueryToUrlString,
} from "./search-query.ts";
import {
  chipLabelFor,
  completeFilterKeys,
  completeFilterValues,
  emptySearchQueryState,
  filterAppliesToEntity,
  filterDefinition,
  isIsoCalendarDate,
  SEARCH_FILTER_DEFINITIONS,
  SEARCH_QUERY_VERSION,
} from "./search-filters.ts";

/** Filters as `key=value` pairs, so table rows stay readable. */
const pairs = (state) => state.filters.map((filter) => `${filter.key}=${String(filter.value)}`).sort();
const parse = (input, options) => parseSearchQuery(input, options);

/* ---------------------------------------------------------------------- */
/* Lexical parsing                                                         */
/* ---------------------------------------------------------------------- */

// Free text survives untouched.
{
  const { state } = parse("rename the composer", { naturalLanguage: false });
  assert.equal(state.text, "rename the composer");
  assert.deepEqual(state.filters, []);
  assert.deepEqual(state.phrases, []);
  assert.equal(state.version, SEARCH_QUERY_VERSION);
  assert.equal(state.presentation, "top");
}

// Quoted exact phrases leave the free text.
{
  const { state } = parse('composer "exact phrase" tail', { naturalLanguage: false });
  assert.deepEqual(state.phrases, ["exact phrase"]);
  assert.equal(state.text, "composer tail");
}

// key:value filters, including a quoted multi-word value.
{
  const { state } = parse('type:task status:blocked room:"code workshop"', {
    naturalLanguage: false,
  });
  assert.deepEqual(pairs(state), ["room=code workshop", "status=blocked", "type=task"]);
  assert.equal(state.text, "");
  assert.equal(
    state.filters.every((filter) => filter.origin === "syntax"),
    true,
    "typed filters are attributed to syntax, not inference",
  );
}

// Aliases resolve to the canonical key.
{
  const { state } = parse("kind:task label:ux agent:cody", { naturalLanguage: false });
  assert.deepEqual(pairs(state), ["familiar=cody", "tag=ux", "type=task"]);
}

// Operators come from the registry, not from the token shape.
{
  const { state } = parse("has:errors after:2026-08-01 before:2026-08-09", {
    naturalLanguage: false,
  });
  const byKey = Object.fromEntries(state.filters.map((filter) => [filter.key, filter.operator]));
  assert.deepEqual(byKey, { has: "has", after: "after", before: "before" });
}

/* ---------------------------------------------------------------------- */
/* Forgiveness — the load-bearing contract                                 */
/* ---------------------------------------------------------------------- */

// THE rule: a colon never breaks search. Every malformed shape below stays
// searchable text, and none of them throws.
for (const input of [
  "ratio:",
  "nonsense:value",
  "status:",
  "status:not-a-status",
  "after:not-a-date",
  "after:2026-13-45",
  ":leading",
  'unmatched "quote here',
  "http://example.com/path",
]) {
  const result = parse(input, { naturalLanguage: false });
  assert.ok(result.state.text.length > 0, `"${input}" must remain searchable text`);
  assert.deepEqual(result.state.filters, [], `"${input}" must not produce a filter`);
}

// An unknown key offers key completions when it is a near miss.
{
  const { suggestions } = parse("stat:blocked", { naturalLanguage: false });
  const keys = suggestions.find((entry) => entry.kind === "filter-key");
  assert.ok(keys, "a near-miss key suggests real keys");
  assert.ok(keys.options.includes("status"));
}

// A known key with no value offers its values.
{
  const { state, suggestions } = parse("status:", { naturalLanguage: false });
  assert.equal(state.text, "status:");
  const values = suggestions.find((entry) => entry.kind === "filter-value");
  assert.equal(values.key, "status");
  assert.ok(values.options.includes("blocked"));
}

// A known key with a bad value suggests the near matches only.
{
  const { suggestions } = parse("status:blo", { naturalLanguage: false });
  const values = suggestions.find((entry) => entry.kind === "filter-value");
  assert.deepEqual(values.options, ["blocked"]);
}

// An unmatched quote is reported but its content stays searchable.
{
  const { state, suggestions } = parse('alpha "beta gamma', { naturalLanguage: false });
  assert.equal(state.text, "alpha beta gamma");
  assert.deepEqual(state.phrases, []);
  assert.ok(suggestions.some((entry) => entry.kind === "unmatched-quote"));
}

// An empty quoted string is dropped rather than becoming a match-everything phrase.
{
  const { state } = parse('alpha "" beta', { naturalLanguage: false });
  assert.deepEqual(state.phrases, []);
  assert.equal(state.text, "alpha beta");
}

/* ---------------------------------------------------------------------- */
/* Repetition, per the registry                                            */
/* ---------------------------------------------------------------------- */

// `type` permits multiple values, so both survive.
{
  const { state } = parse("type:task type:session", { naturalLanguage: false });
  assert.deepEqual(pairs(state), ["type=session", "type=task"]);
}

// `room` does not, so the later value corrects the earlier one.
{
  const { state } = parse("room:alpha room:beta", { naturalLanguage: false });
  assert.deepEqual(pairs(state), ["room=beta"]);
}

// An exact repeat is idempotent rather than duplicated.
{
  const { state } = parse("tag:ux tag:ux", { naturalLanguage: false });
  assert.deepEqual(pairs(state), ["tag=ux"]);
}

/* ---------------------------------------------------------------------- */
/* Deterministic natural language                                          */
/* ---------------------------------------------------------------------- */

const now = new Date("2026-08-09T12:00:00Z");

// The spec's worked example, chip for chip — and "show" must not survive as
// search text, or every result would have to contain the word "show".
{
  const { state } = parse("show blocked tasks for Cody", { now });
  assert.deepEqual(pairs(state), ["familiar=Cody", "status=blocked", "type=task"]);
  assert.equal(state.text, "");
  assert.equal(
    state.filters.every((filter) => filter.origin === "natural-language"),
    true,
    "inferred filters are attributed so the surface can show them as removable chips",
  );
}

// The spec's other pairing.
{
  const { state } = parse("failed sessions", { now });
  assert.deepEqual(pairs(state), ["status=failed", "type=session"]);
}

// Project by name.
{
  const { state } = parse("in Psyche Build", { now });
  assert.deepEqual(pairs(state), ["project=Psyche Build"]);
}

// Signals.
{
  assert.deepEqual(pairs(parse("with errors", { now }).state), ["has=errors"]);
  assert.deepEqual(pairs(parse("needs a decision", { now }).state), ["has=decision"]);
}

// Relative dates resolve against the caller's clock, not a hidden one.
{
  assert.deepEqual(pairs(parse("today", { now }).state), ["after=2026-08-09"]);
  assert.deepEqual(pairs(parse("yesterday", { now }).state), [
    "after=2026-08-08",
    "before=2026-08-09",
  ]);
  assert.deepEqual(pairs(parse("last week", { now }).state), ["after=2026-08-02"]);
  assert.deepEqual(pairs(parse("last 3 days", { now }).state), ["after=2026-08-06"]);
}

// With no clock supplied, date language is left alone rather than guessed.
{
  const { state } = parse("last week", {});
  assert.deepEqual(state.filters, []);
  assert.equal(state.text, "last week");
}

// Ambiguity is preserved, never silently interpreted.
for (const input of ["blocked", "sessions", "for", "in", "cody"]) {
  const { state } = parse(input, { now });
  assert.deepEqual(state.filters, [], `"${input}" is ambiguous and must not infer a filter`);
  assert.equal(state.text, input);
}

// A lowercase name after "for" is not a proper noun, so it stays text.
{
  const { state } = parse("notes for tomorrow", { now });
  assert.deepEqual(state.filters, []);
  assert.equal(state.text, "notes for tomorrow");
}

// Typed syntax and inference compose, and typed values are not overwritten.
{
  const { state } = parse("type:file blocked tasks", { now });
  assert.deepEqual(pairs(state), ["status=blocked", "type=file", "type=task"]);
}

// Language rules can be turned off wholesale.
{
  const { state } = parse("show blocked tasks for Cody", { now, naturalLanguage: false });
  assert.deepEqual(state.filters, []);
  assert.equal(state.text, "show blocked tasks for Cody");
}

/* ---------------------------------------------------------------------- */
/* Canonical URL round trip                                                */
/* ---------------------------------------------------------------------- */

// Serialization is canonical: same state, byte-identical link, every time.
{
  const a = parse('type:task type:session tag:ux "exact phrase" composer', { now }).state;
  const b = parse('composer tag:ux type:session "exact phrase" type:task', { now }).state;
  assert.equal(searchQueryToUrlString(a), searchQueryToUrlString(b));
}

// Round trip restores chips, phrases, text, and presentation.
{
  const original = {
    ...parse('type:task status:blocked tag:ux "exact phrase" composer', { now }).state,
    presentation: "grouped",
  };
  const restored = searchQueryFromUrlParams(searchQueryToUrlParams(original));
  assert.equal(restored.text, original.text);
  assert.deepEqual(restored.phrases, original.phrases);
  assert.deepEqual(pairs(restored), pairs(original));
  assert.equal(restored.presentation, "grouped");
}

// Default presentation is omitted from the link rather than spelled out.
{
  const params = searchQueryToUrlParams(parse("composer", { now }).state);
  assert.equal(params.has("view"), false);
}

// Explicit scopes travel; implicit ones do not, because they belong to the
// sharer's workspace and would silently narrow a recipient's results.
{
  const state = {
    ...emptySearchQueryState(),
    scopes: [
      { dimension: "project", id: "coven-cave", label: "Coven Cave", implicit: false },
      { dimension: "room", id: "code", label: "Code", implicit: true },
    ],
  };
  const params = searchQueryToUrlParams(state);
  assert.deepEqual(params.getAll("scope"), ["project:coven-cave"]);
  const restored = searchQueryFromUrlParams(params);
  assert.equal(restored.scopes.length, 1);
  assert.equal(restored.scopes[0].implicit, false);
}

// An unknown future version falls closed to plain text rather than applying
// filters whose meaning may have changed.
{
  const params = new URLSearchParams();
  params.set("v", "999");
  params.set("q", "composer");
  params.append("type", "task");
  params.append("scope", "project:coven-cave");
  const restored = searchQueryFromUrlParams(params);
  assert.equal(restored.text, "composer");
  assert.deepEqual(restored.filters, []);
  assert.deepEqual(restored.scopes, []);
  assert.equal(restored.version, SEARCH_QUERY_VERSION);
}

// A missing version is treated as current, so hand-written links work.
{
  const params = new URLSearchParams("q=composer&type=task");
  const restored = searchQueryFromUrlParams(params);
  assert.deepEqual(pairs(restored), ["type=task"]);
}

// Garbage in a link is ignored rather than fatal.
{
  const params = new URLSearchParams("v=1&type=not-a-type&status=blocked&scope=bogus&scope=:x");
  const restored = searchQueryFromUrlParams(params);
  assert.deepEqual(pairs(restored), ["status=blocked"]);
  assert.deepEqual(restored.scopes, []);
}

/* ---------------------------------------------------------------------- */
/* Broadening                                                              */
/* ---------------------------------------------------------------------- */

// Command/Control+Enter drops context scopes and keeps explicit filters.
{
  const state = {
    ...parse("type:task", { now }).state,
    scopes: [
      { dimension: "project", id: "coven-cave", label: "Coven Cave", implicit: true },
      { dimension: "familiar", id: "cody", label: "Cody", implicit: false },
    ],
  };
  const broadened = broadenToGlobal(state);
  assert.deepEqual(broadened.scopes.map((scope) => scope.id), ["cody"]);
  assert.deepEqual(pairs(broadened), ["type=task"]);
}

/* ---------------------------------------------------------------------- */
/* The registry is data                                                    */
/* ---------------------------------------------------------------------- */

// Every documented key exists, so the spec's filter list and the registry
// cannot drift apart silently.
for (const key of [
  "type", "status", "project", "familiar", "room",
  "runtime", "source", "has", "after", "before", "tag",
]) {
  assert.ok(filterDefinition(key), `registry is missing the documented key ${key}`);
}

// URL keys are unique, or two filters would collide in a link.
{
  const urlKeys = SEARCH_FILTER_DEFINITIONS.map((definition) => definition.urlKey);
  assert.equal(new Set(urlKeys).size, urlKeys.length);
}

// Applicability is declared, which is what makes a truthful filtered-empty
// state possible instead of silently widening.
{
  assert.equal(filterAppliesToEntity(filterDefinition("status"), "task"), true);
  assert.equal(filterAppliesToEntity(filterDefinition("status"), "project"), false);
  assert.equal(filterAppliesToEntity(filterDefinition("tag"), "project"), true);
}

// Completions and chip labels come from the table.
{
  assert.ok(completeFilterKeys("st").some((definition) => definition.key === "status"));
  assert.deepEqual(completeFilterValues(filterDefinition("type"), "ta"), ["task"]);
  assert.equal(chipLabelFor({ key: "status", operator: "is", value: "in_progress", origin: "syntax" }), "In progress");
  assert.equal(chipLabelFor({ key: "tag", operator: "is", value: "ux", origin: "syntax" }), "#ux");
}

// Date validation rejects impossible calendar dates, not just bad shapes.
{
  assert.equal(isIsoCalendarDate("2026-08-09"), true);
  assert.equal(isIsoCalendarDate("2026-02-30"), false);
  assert.equal(isIsoCalendarDate("2026-8-9"), false);
}

console.log("search-query.test.ts: ok");
