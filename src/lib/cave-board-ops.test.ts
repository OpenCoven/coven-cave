// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// updateCard applies intent ops against the CURRENT card under the board lock —
// the regression the 2026-07-02 board audit flagged: full-array PATCHes computed
// from stale render state silently clobbered concurrent element edits. Isolated
// to a temp home so it never touches the real ~/.coven/cave/board.json.

const tmpHome = await mkdtemp(path.join(tmpdir(), "cave-board-ops-"));
process.env.HOME = tmpHome;
process.env.COVEN_HOME = path.join(tmpHome, ".coven");

const board = await import("./cave-board.ts");

assert.ok(
  board.BOARD_PATH.startsWith(tmpHome),
  `refusing to run: BOARD_PATH (${board.BOARD_PATH}) is not under the temp home`,
);

const card = await board.createCard({
  title: "Ops under the lock",
  labels: ["seed"],
  steps: [{ text: "one" }, { text: "two" }],
});
const [s1, s2] = card.steps;

// ── The clobber regression: two "concurrent" op patches both survive ─────────
// (withBoardLock serializes them; each resolves against the then-current card.)
await Promise.all([
  board.updateCard(card.id, { ops: { stepOps: [{ op: "toggle", id: s1.id }] } }),
  board.updateCard(card.id, { ops: { stepOps: [{ op: "add", text: "three" }] } }),
  board.updateCard(card.id, { ops: { labelOps: [{ op: "add", value: "urgent" }] } }),
]);
let stored = (await board.loadBoard()).cards.find((c) => c.id === card.id);
assert.equal(stored.steps.length, 3, "the concurrent add survives the toggle");
assert.equal(stored.steps.find((s) => s.id === s1.id).done, true, "the toggle survives the add");
assert.deepEqual(stored.labels, ["seed", "urgent"], "the label add survives both");

// ── Ops flow through the SAME normalization as plain patches ─────────────────
const pngDataUrl =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const withAtt = await board.updateCard(card.id, {
  ops: { attachmentOps: [{ op: "add", attachments: [
    { name: "spec.md", type: "text/markdown", size: 4, text: "# s" },
    { name: "shot.png", type: "image/png", mimeType: "image/png", size: 68, dataUrl: pngDataUrl },
  ] }] },
});
assert.equal(withAtt.attachments.length, 2, "attachment ops add");
assert.equal(withAtt.attachments[1].dataUrl, undefined, "op-added images stored lean (dataUrl stripped)");

const linkOps = await board.updateCard(card.id, {
  ops: {
    linkOps: [
      { op: "add", value: "https://example.com/docs" },
      { op: "add", value: "https://example.com/docs" },
      { op: "add", value: "https://example.com/new" },
    ],
  },
});
assert.deepEqual(
  linkOps.links,
  ["https://example.com/docs", "https://example.com/new"],
  "duplicate link adds collapse while a new link appends under the board lock",
);
assert.equal(linkOps.attachments[0].text, "# s", "unrelated attachment content survives the link edit");
assert.equal(linkOps.attachments[1].dataUrl, undefined, "unrelated image bytes stay lean after the link edit");

const removed = await board.updateCard(card.id, {
  ops: { attachmentOps: [{ op: "remove", name: "shot.png" }] },
});
assert.deepEqual(removed.attachments.map((a) => a.name), ["spec.md"], "attachment ops remove by name");

// ── opsOutcome — truthful added/duplicate/invalid, resolved under the lock ──
// Card starts with one human-authored link plus what the prior linkOps block
// left on it ("https://example.com/docs", "https://example.com/new").
const humanCard = await board.updateCard(card.id, {
  links: ["https://example.com/docs", "https://example.com/new", "https://human.example/note?keep=1#raw"],
});
assert.deepEqual(
  humanCard.links,
  ["https://example.com/docs", "https://example.com/new", "https://human.example/note?keep=1#raw"],
  "seeds a mixed human-authored + prior-op link set for the outcome checks below",
);

const mixedOutcome = {};
const mixed = await board.updateCard(card.id, {
  ops: {
    linkOps: [
      { op: "addNormalizedUrl", value: "https://example.com/docs#intro" }, // duplicate of an existing link
      { op: "addNormalizedUrl", value: "https://example.com/brand-new" }, // genuinely new
      { op: "addNormalizedUrl", value: "not a url" }, // invalid
    ],
  },
}, { opsOutcome: mixedOutcome });
assert.deepEqual(
  mixed.links,
  [
    "https://example.com/docs",
    "https://example.com/new",
    "https://human.example/note?keep=1#raw",
    "https://example.com/brand-new",
  ],
  "every pre-existing human-authored link is preserved byte-for-byte and only the genuinely new URL appends",
);
assert.deepEqual(
  mixedOutcome,
  {
    linkOps: [
      { requestedUrl: "https://example.com/docs#intro", normalizedUrl: "https://example.com/docs", outcome: "duplicate" },
      { requestedUrl: "https://example.com/brand-new", normalizedUrl: "https://example.com/brand-new", outcome: "added" },
      { requestedUrl: "not a url", normalizedUrl: null, outcome: "invalid" },
    ],
  },
  "the out-param reports each request's true outcome, resolved against the current card under the lock",
);

// Callers that don't ask for it are unaffected (default {} options, as every
// call above this block already exercises) — and a caller that DOES ask but
// sends no linkOps gets no linkOps key, not an empty array.
const noLinkOutcome = {};
await board.updateCard(card.id, { ops: { labelOps: [{ op: "add", value: "no-link-ops" }] } }, { opsOutcome: noLinkOutcome });
assert.deepEqual(noLinkOutcome, {}, "opsOutcome is left untouched when the patch carries no linkOps");

// A patch whose linkOps are ONLY ordinary add/remove (the board inspector's
// own link editor, no addNormalizedUrl request at all) resolves to an empty
// report from resolveLinkOpOutcomes — that must leave opsOutcome.linkOps
// undefined too, not a truthy-but-empty array. route.ts's response-shape
// decision reads this exact field, so a truthy `[]` here would make an
// unrelated ordinary-linkOps PATCH grow an `opsOutcome` key it never had.
const ordinaryOnlyOutcome = {};
await board.updateCard(
  card.id,
  { ops: { linkOps: [{ op: "add", value: "https://ordinary-only.example" }] } },
  { opsOutcome: ordinaryOnlyOutcome },
);
assert.deepEqual(
  ordinaryOnlyOutcome,
  {},
  "opsOutcome.linkOps stays undefined (not a truthy empty array) for ordinary-only add/remove linkOps",
);

// ── Concurrency-safe: two callers racing the same normalized URL ────────────
// withBoardLock serializes both, so whichever resolves first sees the URL as
// new and the other sees it as already present — never both "added" and
// never silently lost.
const raceCard = await board.createCard({ title: "Race for one URL", links: ["https://race.example/existing"] });
const raceOutcomeA = {};
const raceOutcomeB = {};
await Promise.all([
  board.updateCard(
    raceCard.id,
    { ops: { linkOps: [{ op: "addNormalizedUrl", value: "https://race.example/new" }] } },
    { opsOutcome: raceOutcomeA },
  ),
  board.updateCard(
    raceCard.id,
    { ops: { linkOps: [{ op: "addNormalizedUrl", value: "https://race.example/new#dup" }] } },
    { opsOutcome: raceOutcomeB },
  ),
]);
const raceOutcomes = [raceOutcomeA.linkOps[0].outcome, raceOutcomeB.linkOps[0].outcome].sort();
assert.deepEqual(raceOutcomes, ["added", "duplicate"], "exactly one racing request is added and the other reports the truthful duplicate");
const raceStored = (await board.loadBoard()).cards.find((c) => c.id === raceCard.id);
assert.deepEqual(
  raceStored.links,
  ["https://race.example/existing", "https://race.example/new"],
  "the canonical URL is written exactly once regardless of which racing request landed it",
);

// ── Ops and plain fields combine in one PATCH ─────────────────────────────────
const combo = await board.updateCard(card.id, {
  title: "Renamed via combo",
  ops: { stepOps: [{ op: "remove", id: s2.id }] },
});
assert.equal(combo.title, "Renamed via combo");
assert.equal(combo.steps.some((s) => s.id === s2.id), false, "op applied alongside the plain field");

// ── Back-compat: full-array patches still replace wholesale ───────────────────
const replaced = await board.updateCard(card.id, { steps: [] });
assert.deepEqual(replaced.steps, [], "legacy full-array patch replaces (enrich-steps relies on this)");

// ── Blank addNormalizedUrl requests get a truthful positional "invalid"
// outcome through updateCard, not just at the pure board-card-ops layer —
// and never mutate the stored links. ───────────────────────────────────────
const blankCard = await board.createCard({ title: "Blank addNormalizedUrl", links: ["https://blank.example/existing"] });
const blankOutcome = {};
const blankResult = await board.updateCard(
  blankCard.id,
  { ops: { linkOps: [{ op: "addNormalizedUrl", value: "   " }] } },
  { opsOutcome: blankOutcome },
);
assert.deepEqual(
  blankResult.links,
  ["https://blank.example/existing"],
  "a whitespace-only addNormalizedUrl request through updateCard never mutates stored links",
);
assert.deepEqual(
  blankOutcome,
  { linkOps: [{ requestedUrl: "   ", normalizedUrl: null, outcome: "invalid" }] },
  "updateCard reports the truthful invalid outcome for a blank addNormalizedUrl request instead of omitting it",
);

// ── Malformed linkOps (untrusted PATCH JSON) never throw, never mutate, and
// never populate opsOutcome — consistent with hasCardOps already ignoring
// non-array op collections. ────────────────────────────────────────────────
const malformedCard = await board.createCard({ title: "Malformed linkOps", links: ["https://malformed.example/existing"] });
for (const badLinkOps of ["not-an-array", { length: 1, 0: { op: "add", value: "https://sneaky.example" } }, null, []]) {
  const outcome = {};
  let result;
  try {
    result = await board.updateCard(malformedCard.id, { ops: { linkOps: badLinkOps } }, { opsOutcome: outcome });
  } catch (error) {
    assert.fail(`malformed linkOps (${JSON.stringify(badLinkOps)}) must not throw: ${error}`);
  }
  assert.deepEqual(
    result.links,
    ["https://malformed.example/existing"],
    `malformed linkOps (${JSON.stringify(badLinkOps)}) never mutate stored links`,
  );
  assert.deepEqual(
    outcome,
    {},
    `malformed linkOps (${JSON.stringify(badLinkOps)}) never populate opsOutcome`,
  );
}

// A mixed container — valid stepOps alongside malformed linkOps — still
// applies the valid ops and leaves the malformed linkOps inert rather than
// failing the whole PATCH.
const mixedContainerOutcome = {};
const mixedContainerResult = await board.updateCard(
  malformedCard.id,
  { ops: { stepOps: [{ op: "add", text: "survives malformed linkOps" }], linkOps: "not-an-array" } },
  { opsOutcome: mixedContainerOutcome },
);
assert.equal(
  mixedContainerResult.steps.some((s) => s.text === "survives malformed linkOps"),
  true,
  "a valid op kind still applies alongside a malformed linkOps container in the same patch",
);
assert.deepEqual(
  mixedContainerResult.links,
  ["https://malformed.example/existing"],
  "the malformed linkOps container in the mixed patch still never mutates links",
);
assert.deepEqual(mixedContainerOutcome, {}, "the malformed linkOps container in the mixed patch never populates opsOutcome");

await rm(tmpHome, { recursive: true, force: true });
console.log("cave-board-ops: ok");
