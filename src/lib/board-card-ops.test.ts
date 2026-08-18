// @ts-nocheck
import assert from "node:assert/strict";
import { applyCardOps, hasCardOps, resolveLinkOpOutcomes } from "./board-card-ops.ts";

const NOW = "2026-07-03T12:00:00.000Z";
const base = {
  steps: [
    { id: "s1", text: "First", done: false, addedAt: "2026-07-01T00:00:00.000Z" },
    { id: "s2", text: "Second", done: true, addedAt: "2026-07-01T00:00:00.000Z", doneAt: "2026-07-02T00:00:00.000Z" },
  ],
  labels: ["alpha"],
  links: ["https://a.example"],
  attachments: [{ name: "spec.md", type: "text/markdown", size: 10, text: "# s" }],
};

// ── hasCardOps ────────────────────────────────────────────────────────────────
assert.equal(hasCardOps(undefined), false);
assert.equal(hasCardOps({}), false);
assert.equal(hasCardOps({ stepOps: [] }), false, "empty op arrays are not ops");
assert.equal(hasCardOps({ labelOps: [{ op: "add", value: "x" }] }), true);
const malformedCollections = {
  stepOps: { length: 1 },
  labelOps: { length: 1 },
  linkOps: { length: 1 },
  attachmentOps: { length: 1 },
};
assert.equal(
  hasCardOps(malformedCollections),
  false,
  "array-like collection objects do not count as ops",
);

// ── step ops ──────────────────────────────────────────────────────────────────
let out = applyCardOps(base, { stepOps: [{ op: "toggle", id: "s1" }] }, NOW);
assert.equal(out.steps[0].done, true, "toggle flips done");
assert.equal(out.steps[0].doneAt, NOW, "toggle stamps doneAt");
assert.equal(out.labels, undefined, "untargeted fields are not returned");

out = applyCardOps(base, { stepOps: [{ op: "toggle", id: "s2" }] }, NOW);
assert.equal(out.steps[1].done, false, "untoggle clears done");
assert.equal(out.steps[1].doneAt, undefined, "untoggle clears doneAt");

out = applyCardOps(base, { stepOps: [{ op: "add", text: "  Third  ", id: "client-id" }] }, NOW);
assert.equal(out.steps.length, 3);
assert.deepEqual(
  { id: out.steps[2].id, text: out.steps[2].text, done: out.steps[2].done, addedAt: out.steps[2].addedAt },
  { id: "client-id", text: "Third", done: false, addedAt: NOW },
  "add trims text and honours the client-supplied id",
);

out = applyCardOps(base, { stepOps: [{ op: "add", text: "auto" }] }, NOW);
assert.ok(out.steps[2].id.length > 0, "add without id generates one");

out = applyCardOps(base, { stepOps: [{ op: "add", text: "   " }] }, NOW);
assert.equal(out.steps.length, 2, "whitespace-only add is dropped");

out = applyCardOps(base, { stepOps: [{ op: "remove", id: "s1" }] }, NOW);
assert.deepEqual(out.steps.map((s) => s.id), ["s2"]);

out = applyCardOps(base, { stepOps: [{ op: "setDate", id: "s2", field: "startDate", value: "2026-07-10" }] }, NOW);
assert.equal(out.steps[1].startDate, "2026-07-10");
out = applyCardOps(base, { stepOps: [{ op: "setDate", id: "s2", field: "startDate", value: "" }] }, NOW);
assert.equal(out.steps[1].startDate, null, "empty value clears the date");

out = applyCardOps(base, { stepOps: [{ op: "reorder", id: "s2", dir: -1 }] }, NOW);
assert.deepEqual(out.steps.map((s) => s.id), ["s2", "s1"], "reorder swaps");
out = applyCardOps(base, { stepOps: [{ op: "reorder", id: "s1", dir: -1 }] }, NOW);
assert.deepEqual(out.steps.map((s) => s.id), ["s1", "s2"], "out-of-bounds reorder no-ops");

// THE regression the audit found: an edit resolved against the CURRENT card
// preserves elements the editor's render state didn't know about.
const serverCard = {
  ...base,
  steps: [...base.steps, { id: "s3", text: "Added elsewhere", done: false, addedAt: NOW }],
};
out = applyCardOps(serverCard, { stepOps: [{ op: "toggle", id: "s1" }] }, NOW);
assert.equal(out.steps.length, 3, "toggling s1 keeps the concurrently added s3");
assert.equal(out.steps[2].id, "s3");

// ── list ops (labels/links) ───────────────────────────────────────────────────
out = applyCardOps(base, { labelOps: [{ op: "add", value: " beta " }] }, NOW);
assert.deepEqual(out.labels, ["alpha", "beta"], "label add trims");
out = applyCardOps(base, { labelOps: [{ op: "add", value: "alpha" }] }, NOW);
assert.deepEqual(out.labels, ["alpha"], "duplicate add is idempotent");
out = applyCardOps(base, { labelOps: [{ op: "remove", value: "alpha" }] }, NOW);
assert.deepEqual(out.labels, []);
out = applyCardOps(base, { linkOps: [{ op: "add", value: "https://b.example" }, { op: "remove", value: "https://a.example" }] }, NOW);
assert.deepEqual(out.links, ["https://b.example"], "link ops apply in order");
out = applyCardOps(
  { ...base, links: ["https://example.com/docs/", "https://example.com/human-note?keep=1#raw"] },
  { linkOps: [{ op: "addNormalizedUrl", value: " https://example.com/docs#intro " }] },
  NOW,
);
assert.deepEqual(
  out.links,
  ["https://example.com/docs/", "https://example.com/human-note?keep=1#raw"],
  "normalized duplicate links are ignored against latest existing links",
);
assert.equal(
  out.links[1],
  "https://example.com/human-note?keep=1#raw",
  "unrelated existing human links stay byte-for-byte unchanged",
);
out = applyCardOps(
  { ...base, links: ["https://example.com/docs/", "https://example.com/human-note?keep=1#raw"] },
  { linkOps: [{ op: "addNormalizedUrl", value: " https://example.com/new#frag " }] },
  NOW,
);
assert.deepEqual(
  out.links,
  [
    "https://example.com/docs/",
    "https://example.com/human-note?keep=1#raw",
    "https://example.com/new",
  ],
  "new normalized links append in canonical normalized form",
);
out = applyCardOps(
  { ...base, links: ["https://example.com/docs/"] },
  {
    linkOps: [
      { op: "addNormalizedUrl", value: "not a url" },
      { op: "addNormalizedUrl", value: "mailto:team@example.com" },
      { op: "addNormalizedUrl", value: "ftp://example.com/file" },
    ],
  },
  NOW,
);
assert.deepEqual(out.links, ["https://example.com/docs/"], "invalid and non-http inputs are ignored");
out = applyCardOps(
  { ...base, links: [] },
  {
    linkOps: [
      { op: "addNormalizedUrl", value: " https://example.com/docs#one " },
      { op: "addNormalizedUrl", value: "https://example.com/docs#two" },
      { op: "addNormalizedUrl", value: "https://example.com/docs" },
    ],
  },
  NOW,
);
assert.deepEqual(
  out.links,
  ["https://example.com/docs"],
  "normalized duplicates within one op batch are ignored after the canonical first append",
);
out = applyCardOps(
  { ...base, links: ["https://example.com/docs/"] },
  {
    linkOps: [
      { op: "remove", value: "https://example.com/docs/" },
      { op: "addNormalizedUrl", value: "https://example.com/docs#intro" },
      { op: "add", value: " https://example.com/docs#intro " },
    ],
  },
  NOW,
);
assert.deepEqual(
  out.links,
  ["https://example.com/docs", "https://example.com/docs#intro"],
  "ordinary add/remove semantics stay raw and exact around canonical normalized storage",
);
out = applyCardOps(
  { ...base, links: ["https://example.com/docs", "https://example.com/human-note"] },
  {
    linkOps: [
      { op: "add", value: "https://example.com/docs" },
      { op: "add", value: "https://example.com/new" },
    ],
  },
  NOW,
);
assert.deepEqual(
  out.links,
  ["https://example.com/docs", "https://example.com/human-note", "https://example.com/new"],
  "duplicate add is ignored and the new link appends through public applyCardOps",
);
assert.equal(out.links[1], "https://example.com/human-note", "unrelated existing links stay byte-for-byte unchanged");

const longUrl = `https://example.com/${"a".repeat(2_000)}`;
out = applyCardOps(base, { linkOps: [{ op: "add", value: longUrl }] }, NOW);
assert.equal(out.links[1].length, 2_000, "stored link values are capped at the list max");
assert.equal(out.links[1], longUrl.slice(0, 2_000), "the capped value is stored exactly as accepted");
assert.doesNotThrow(() => new URL(out.links[1]), "the capped stored value remains a valid HTTP URL");

// ── attachment ops ────────────────────────────────────────────────────────────
out = applyCardOps(base, { attachmentOps: [{ op: "add", attachments: [{ name: "b.txt", type: "text/plain", size: 1, text: "b" }] }] }, NOW);
assert.deepEqual(out.attachments.map((a) => a.name), ["spec.md", "b.txt"]);
out = applyCardOps(base, { attachmentOps: [{ op: "remove", name: "spec.md" }] }, NOW);
assert.deepEqual(out.attachments, []);
out = applyCardOps(base, { attachmentOps: [{ op: "remove", name: "nope.md" }] }, NOW);
assert.deepEqual(out.attachments.map((a) => a.name), ["spec.md"], "removing a missing name no-ops");

// ── malformed ops are skipped, never throw ────────────────────────────────────
out = applyCardOps(base, {
  stepOps: [null, 42, { op: "explode" }, { op: "toggle", id: 7 }, { op: "reorder", id: "s1", dir: 5 }],
  labelOps: [{ op: "add", value: 9 }, { op: "add", value: "  " }],
}, NOW);
assert.deepEqual(out.steps.map((s) => s.id), ["s1", "s2"], "junk step ops no-op");
assert.deepEqual(out.labels, ["alpha"], "junk label ops no-op");

const baseSnapshot = structuredClone(base);
assert.doesNotThrow(
  () => applyCardOps(base, malformedCollections, NOW),
  "malformed op collections are ignored instead of throwing",
);
out = applyCardOps(base, malformedCollections, NOW);
assert.deepEqual(out, {}, "all-malformed collections produce no resolved patch");
assert.deepEqual(base, baseSnapshot, "ignoring malformed collections preserves the source card");

out = applyCardOps(base, {
  stepOps: { length: 1 },
  linkOps: [{ op: "add", value: "https://b.example" }],
}, NOW);
assert.equal(out.steps, undefined, "malformed step collections are skipped entirely");
assert.deepEqual(
  out.links,
  ["https://a.example", "https://b.example"],
  "valid collections still apply when sibling collections are malformed",
);

// ── resolveLinkOpOutcomes — truthful per-request added/duplicate/invalid ────
// This is the same dedup pass applyLinkOps uses internally for
// "addNormalizedUrl", exposed so a caller (updateCard) can report exactly
// what happened to each requested URL instead of inferring it from whether
// the URL merely appears in the resulting card.
let outcomes = resolveLinkOpOutcomes(
  ["https://example.com/docs/", "https://example.com/human-note?keep=1#raw"],
  [{ op: "addNormalizedUrl", value: " https://example.com/docs#intro " }],
);
assert.deepEqual(
  outcomes,
  [{
    requestedUrl: " https://example.com/docs#intro ",
    normalizedUrl: "https://example.com/docs",
    outcome: "duplicate",
  }],
  "a normalized-equivalent request against an existing human-authored link reports duplicate",
);

outcomes = resolveLinkOpOutcomes(
  ["https://example.com/docs/"],
  [{ op: "addNormalizedUrl", value: "https://example.com/new#frag" }],
);
assert.deepEqual(
  outcomes,
  [{
    requestedUrl: "https://example.com/new#frag",
    normalizedUrl: "https://example.com/new",
    outcome: "added",
  }],
  "a genuinely new normalized URL reports added",
);

outcomes = resolveLinkOpOutcomes(
  [],
  [
    { op: "addNormalizedUrl", value: "https://example.com/docs#one" },
    { op: "addNormalizedUrl", value: "https://example.com/docs#two" },
    { op: "addNormalizedUrl", value: "https://example.com/docs" },
  ],
);
assert.deepEqual(
  outcomes,
  [
    { requestedUrl: "https://example.com/docs#one", normalizedUrl: "https://example.com/docs", outcome: "added" },
    { requestedUrl: "https://example.com/docs#two", normalizedUrl: "https://example.com/docs", outcome: "duplicate" },
    { requestedUrl: "https://example.com/docs", normalizedUrl: "https://example.com/docs", outcome: "duplicate" },
  ],
  "normalized duplicates within one request batch are distinguished from the first add, in request order",
);

outcomes = resolveLinkOpOutcomes(
  ["https://example.com/docs/"],
  [
    { op: "addNormalizedUrl", value: "not a url" },
    { op: "addNormalizedUrl", value: "mailto:team@example.com" },
    { op: "addNormalizedUrl", value: "ftp://example.com/file" },
  ],
);
assert.deepEqual(
  outcomes,
  [
    { requestedUrl: "not a url", normalizedUrl: null, outcome: "invalid" },
    { requestedUrl: "mailto:team@example.com", normalizedUrl: null, outcome: "invalid" },
    { requestedUrl: "ftp://example.com/file", normalizedUrl: null, outcome: "invalid" },
  ],
  "non-HTTP(S) or unparseable requests are reported invalid, distinct from duplicate",
);

outcomes = resolveLinkOpOutcomes(
  ["https://example.com/docs"],
  [
    { op: "addNormalizedUrl", value: "https://example.com/new" },
    { op: "addNormalizedUrl", value: "https://example.com/docs" },
    { op: "addNormalizedUrl", value: "not a url" },
  ],
);
assert.deepEqual(
  outcomes,
  [
    { requestedUrl: "https://example.com/new", normalizedUrl: "https://example.com/new", outcome: "added" },
    { requestedUrl: "https://example.com/docs", normalizedUrl: "https://example.com/docs", outcome: "duplicate" },
    { requestedUrl: "not a url", normalizedUrl: null, outcome: "invalid" },
  ],
  "a mixed batch reports each request's true outcome independently",
);

assert.deepEqual(
  resolveLinkOpOutcomes(["https://example.com/docs"], [{ op: "add", value: "https://example.com/new" }]),
  [],
  "plain add/remove ops are outside this report — only addNormalizedUrl requests carry a client-facing outcome",
);
assert.deepEqual(
  resolveLinkOpOutcomes(["https://example.com/docs"], []),
  [],
  "an empty op list resolves no outcomes",
);

// ── resolveLinkOpOutcomes — mixed ordinary + normalized-add sequencing ──────
// Regression coverage: outcome resolution must observe every ordinary
// add/remove in exact sequence (with the same canonical-set recomputation
// applyLinkOps performs), not skip straight to the addNormalizedUrl requests.
outcomes = resolveLinkOpOutcomes(
  ["https://example.com/docs"],
  [
    { op: "remove", value: "https://example.com/docs" },
    { op: "addNormalizedUrl", value: "https://example.com/docs#intro" },
  ],
);
assert.deepEqual(
  outcomes,
  [{ requestedUrl: "https://example.com/docs#intro", normalizedUrl: "https://example.com/docs", outcome: "added" }],
  "removing the exact stored URL first frees its normalized key for a later normalized-add",
);
out = applyCardOps(
  { ...base, links: ["https://example.com/docs"] },
  {
    linkOps: [
      { op: "remove", value: "https://example.com/docs" },
      { op: "addNormalizedUrl", value: "https://example.com/docs#intro" },
    ],
  },
  NOW,
);
assert.deepEqual(
  out.links,
  ["https://example.com/docs"],
  "applyCardOps stores the canonical URL after the remove clears the exact match",
);

outcomes = resolveLinkOpOutcomes(
  ["https://example.com/human-note"],
  [
    { op: "add", value: "https://example.com/docs" },
    { op: "addNormalizedUrl", value: "https://example.com/docs#intro" },
  ],
);
assert.deepEqual(
  outcomes,
  [{ requestedUrl: "https://example.com/docs#intro", normalizedUrl: "https://example.com/docs", outcome: "duplicate" }],
  "an ordinary add earlier in the same batch is observed and blocks the later normalized-add equivalent",
);

outcomes = resolveLinkOpOutcomes(
  [],
  [
    { op: "addNormalizedUrl", value: "https://example.com/docs#one" },
    { op: "remove", value: "https://example.com/docs#one" },
    { op: "addNormalizedUrl", value: "https://example.com/docs#two" },
  ],
);
assert.deepEqual(
  outcomes,
  [
    { requestedUrl: "https://example.com/docs#one", normalizedUrl: "https://example.com/docs", outcome: "added" },
    { requestedUrl: "https://example.com/docs#two", normalizedUrl: "https://example.com/docs", outcome: "duplicate" },
  ],
  "ordinary remove of the raw request does not remove its canonically stored value",
);
out = applyCardOps(
  { ...base, links: [] },
  {
    linkOps: [
      { op: "addNormalizedUrl", value: "https://example.com/docs#one" },
      { op: "remove", value: "https://example.com/docs#one" },
      { op: "addNormalizedUrl", value: "https://example.com/docs#two" },
      { op: "remove", value: "https://example.com/docs" },
    ],
  },
  NOW,
);
assert.deepEqual(
  out.links,
  [],
  "a later ordinary remove only removes the exact canonical value that was stored",
);

outcomes = resolveLinkOpOutcomes(
  ["https://example.com/docs"],
  [
    { op: "add", value: "https://example.com/unrelated" },
    { op: "remove", value: "https://example.com/other" },
  ],
);
assert.deepEqual(outcomes, [], "unrelated ordinary ops emit no outcome");
out = applyCardOps(
  { ...base, links: ["https://example.com/docs"] },
  {
    linkOps: [
      { op: "add", value: "https://example.com/unrelated" },
      { op: "remove", value: "https://example.com/other" },
    ],
  },
  NOW,
);
assert.deepEqual(
  out.links,
  ["https://example.com/docs", "https://example.com/unrelated"],
  "unrelated ordinary ops preserve output order/content exactly as applyLinkOps would",
);

outcomes = resolveLinkOpOutcomes(
  ["https://example.com/docs"],
  [
    { op: "add", value: "https://example.com/unrelated" },
    { op: "addNormalizedUrl", value: "not a url" },
    { op: "remove", value: 42 },
    { op: "addNormalizedUrl", value: "mailto:team@example.com" },
    null,
  ],
);
assert.deepEqual(
  outcomes,
  [
    { requestedUrl: "not a url", normalizedUrl: null, outcome: "invalid" },
    { requestedUrl: "mailto:team@example.com", normalizedUrl: null, outcome: "invalid" },
  ],
  "invalid/malformed operations remain safely ignored/reported consistently alongside ordinary ops",
);

// ── blank addNormalizedUrl requests — every one still gets a positional
// outcome, unlike ordinary add/remove which silently ignores a blank value.
// A caller (chat-follow-up-links.ts) maps requested URLs to outcomes by
// array position, so a blank request that emitted no entry would desync
// that accounting instead of reporting the truthful "invalid" it is.
outcomes = resolveLinkOpOutcomes(
  ["https://example.com/docs"],
  [{ op: "addNormalizedUrl", value: "" }],
);
assert.deepEqual(
  outcomes,
  [{ requestedUrl: "", normalizedUrl: null, outcome: "invalid" }],
  "an empty-string addNormalizedUrl request reports invalid rather than being silently dropped",
);
out = applyCardOps(
  { ...base, links: ["https://example.com/docs"] },
  { linkOps: [{ op: "addNormalizedUrl", value: "" }] },
  NOW,
);
assert.deepEqual(out.links, ["https://example.com/docs"], "an empty-string addNormalizedUrl request never mutates stored links");

outcomes = resolveLinkOpOutcomes(
  ["https://example.com/docs"],
  [{ op: "addNormalizedUrl", value: "   " }],
);
assert.deepEqual(
  outcomes,
  [{ requestedUrl: "   ", normalizedUrl: null, outcome: "invalid" }],
  "a whitespace-only addNormalizedUrl request reports invalid with the raw (untrimmed) requestedUrl preserved",
);
out = applyCardOps(
  { ...base, links: ["https://example.com/docs"] },
  { linkOps: [{ op: "addNormalizedUrl", value: "   " }] },
  NOW,
);
assert.deepEqual(out.links, ["https://example.com/docs"], "a whitespace-only addNormalizedUrl request never mutates stored links");

// A surrounding-whitespace but otherwise valid URL still reports its raw
// request and canonical normalized outcome, and stores that canonical URL.
outcomes = resolveLinkOpOutcomes(
  [],
  [{ op: "addNormalizedUrl", value: "  https://example.com/fresh  " }],
);
assert.deepEqual(
  outcomes,
  [{ requestedUrl: "  https://example.com/fresh  ", normalizedUrl: "https://example.com/fresh", outcome: "added" }],
  "a surrounding-whitespace valid URL reports its canonical normalizedUrl while requestedUrl keeps the raw request",
);
out = applyCardOps(
  { ...base, links: [] },
  { linkOps: [{ op: "addNormalizedUrl", value: "  https://example.com/fresh  " }] },
  NOW,
);
assert.deepEqual(
  out.links,
  ["https://example.com/fresh"],
  "the stored value is the canonical normalized URL",
);

// Ordinary add/remove blank values remain silently ignored — no outcome, no
// mutation — distinct from the addNormalizedUrl behavior above.
outcomes = resolveLinkOpOutcomes(
  ["https://example.com/docs"],
  [{ op: "add", value: "" }, { op: "add", value: "   " }, { op: "remove", value: "" }],
);
assert.deepEqual(outcomes, [], "ordinary add/remove with blank values emit no outcome");
out = applyCardOps(
  { ...base, links: ["https://example.com/docs"] },
  { linkOps: [{ op: "add", value: "" }, { op: "add", value: "   " }, { op: "remove", value: "" }] },
  NOW,
);
assert.deepEqual(out.links, ["https://example.com/docs"], "ordinary add/remove with blank values never mutate stored links");

// A mixed positional batch: every addNormalizedUrl request (blank or not)
// reports exactly one outcome, in request order, while interleaved ordinary
// add/remove ops (including blank ones) contribute no outcome of their own.
outcomes = resolveLinkOpOutcomes(
  ["https://example.com/existing"],
  [
    { op: "add", value: "  " },
    { op: "addNormalizedUrl", value: "" },
    { op: "remove", value: "https://unrelated.example" },
    { op: "addNormalizedUrl", value: " https://example.com/new " },
    { op: "addNormalizedUrl", value: "https://example.com/existing" },
  ],
);
assert.deepEqual(
  outcomes,
  [
    { requestedUrl: "", normalizedUrl: null, outcome: "invalid" },
    { requestedUrl: " https://example.com/new ", normalizedUrl: "https://example.com/new", outcome: "added" },
    { requestedUrl: "https://example.com/existing", normalizedUrl: "https://example.com/existing", outcome: "duplicate" },
  ],
  "a mixed batch reports one outcome per addNormalizedUrl request, in order, unaffected by interleaved blank ordinary ops",
);
out = applyCardOps(
  { ...base, links: ["https://example.com/existing"] },
  {
    linkOps: [
      { op: "add", value: "  " },
      { op: "addNormalizedUrl", value: "" },
      { op: "remove", value: "https://unrelated.example" },
      { op: "addNormalizedUrl", value: " https://example.com/new " },
      { op: "addNormalizedUrl", value: "https://example.com/existing" },
    ],
  },
  NOW,
);
assert.deepEqual(
  out.links,
  ["https://example.com/existing", "https://example.com/new"],
  "the mixed batch mutates links exactly as its non-blank/non-duplicate members dictate",
);

console.log("board-card-ops: ok");
