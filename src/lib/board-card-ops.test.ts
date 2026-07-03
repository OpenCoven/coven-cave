// @ts-nocheck
import assert from "node:assert/strict";
import { applyCardOps, hasCardOps } from "./board-card-ops.ts";

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

console.log("board-card-ops: ok");
