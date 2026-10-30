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

// Dependency ops merge an imported task edge into the current card (#6258).
const withDeps = {
  ...base,
  id: "card-1",
  dependencies: [{
    id: "d1", kind: "task", label: "Upstream", taskId: "card-2",
    state: "unresolved", origin: "human", createdAt: NOW,
  }],
};
out = applyCardOps(withDeps, {
  dependencyOps: [
    { op: "addTask", taskId: "card-2", label: "Upstream again" },
    { op: "addTask", taskId: "card-3", label: "  New upstream  ", id: "d2", evidence: "Imported" },
    { op: "addTask", taskId: "card-3", label: "Duplicate in the same batch" },
    { op: "addTask", taskId: "card-1", label: "Itself" },
    { op: "addTask", taskId: "", label: "No target" },
    { op: "remove", taskId: "card-2" },
  ],
}, NOW);
assert.deepEqual(out.dependencies, [
  withDeps.dependencies[0],
  {
    id: "d2", kind: "task", label: "New upstream", taskId: "card-3",
    state: "unresolved", origin: "system", createdAt: NOW, evidence: "Imported",
  },
], "an edge to an existing upstream, a self-edge, a target-less add and unknown ops change nothing");

// Human cut and undo resolve the primary blocker against the current card (#6286).
const blocked = {
  ...base,
  id: "card-9",
  dependencies: [
    { id: "a", kind: "task", label: "A", taskId: "card-a", state: "unresolved", origin: "human", createdAt: NOW },
    { id: "b", kind: "task", label: "B", taskId: "card-b", state: "resolved", origin: "human", createdAt: NOW },
    { id: "c", kind: "task", label: "C", taskId: "card-c", state: "unresolved", origin: "system", createdAt: NOW },
  ],
  primaryBlockerId: "a",
  primaryBlockerPinned: true,
};
out = applyCardOps(blocked, { dependencyOps: [{ op: "removeTask", taskId: "card-a" }] }, NOW);
assert.deepEqual(out.dependencies.map((dep) => dep.id), ["b", "c"]);
assert.equal(out.primaryBlockerId, "c", "a cut primary re-points to the next unresolved edge, skipping resolved ones");
assert.equal(out.primaryBlockerPinned, false);
out = applyCardOps(blocked, { dependencyOps: [{ op: "remove", id: "b" }] }, NOW);
assert.deepEqual(out.dependencies.map((dep) => dep.id), ["a", "c"]);
assert.equal("primaryBlockerId" in out, false, "removing a non-primary edge leaves the pointer alone");
out = applyCardOps({ ...blocked, primaryBlockerId: "c", primaryBlockerPinned: false }, {
  dependencyOps: [{ op: "removeTask", taskId: "card-c" }, { op: "removeTask", taskId: "card-a" }],
}, NOW);
assert.equal(out.primaryBlockerId, null, "with no unresolved edge left, the primary clears");
out = applyCardOps({ ...blocked, dependencies: blocked.dependencies.slice(1), primaryBlockerId: "c", primaryBlockerPinned: false }, {
  dependencyOps: [
    { op: "restore", dependencies: [blocked.dependencies[0], blocked.dependencies[2]], primaryBlockerId: "a", primaryBlockerPinned: true },
    { op: "restore", dependencies: "not a list" },
    { op: "remove", id: "" },
  ],
}, NOW);
assert.deepEqual(out.dependencies.map((dep) => dep.id), ["b", "c", "a"], "restore re-adds only absent records");
assert.equal(out.primaryBlockerId, "a", "the restored primary takes back the pointer");
assert.equal(out.primaryBlockerPinned, true);

console.log("board-card-ops: ok");
