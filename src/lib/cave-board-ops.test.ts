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

// ── Ops and plain fields combine in one PATCH ─────────────────────────────────
const combo = await board.updateCard(card.id, {
  title: "Renamed via combo",
  ops: { stepOps: [{ op: "remove", id: s2.id }] },
});
assert.equal(combo.title, "Renamed via combo");
assert.equal(combo.steps.some((s) => s.id === s2.id), false, "op applied alongside the plain field");

// ── Dependency ops: the Chart Room overlay import (#6258) ─────────────────────
// Each browser imports its own legacy overlay against the one shared board, so
// the import must merge into the CURRENT card: never drop an edge another
// writer added after this browser's snapshot, never duplicate an edge another
// device already imported.
const upstreamA = await board.createCard({ title: "Ship the schema" });
const upstreamB = await board.createCard({ title: "Write the migration" });
const downstream = await board.createCard({ title: "Retire the overlay" });
const humanEdge = {
  id: "human-edge",
  kind: "task",
  label: "Write the migration",
  taskId: upstreamB.id,
  state: "unresolved",
  origin: "human",
  createdAt: new Date().toISOString(),
};
// A human adds a dependency on another device after this browser loaded the board.
await board.updateCard(downstream.id, { dependencies: [humanEdge] });
const importOp = {
  op: "addTask",
  taskId: upstreamA.id,
  label: "Ship the schema",
  evidence: "Imported from the Chart Room dependency overlay",
};
// Two devices import the same overlay edge at once, then one imports it again.
await Promise.all([
  board.updateCard(downstream.id, { ops: { dependencyOps: [importOp] } }),
  board.updateCard(downstream.id, { ops: { dependencyOps: [importOp] } }),
]);
const reimported = await board.updateCard(downstream.id, { ops: { dependencyOps: [importOp] } });
const edges = reimported.dependencies.filter((dep) => dep.kind === "task");
assert.deepEqual(
  edges.map((dep) => dep.taskId).sort(),
  [upstreamA.id, upstreamB.id].sort(),
  "the import adds its edge exactly once and keeps the edge another writer added",
);
const human = reimported.dependencies.find((dep) => dep.id === "human-edge");
assert.deepEqual(human, humanEdge, "the human-authored edge is untouched");
const imported = reimported.dependencies.find((dep) => dep.taskId === upstreamA.id);
assert.equal(imported.origin, "system");
assert.equal(imported.state, "unresolved");
assert.equal(imported.evidence, "Imported from the Chart Room dependency overlay");
const selfEdge = await board.updateCard(downstream.id, {
  ops: { dependencyOps: [{ op: "addTask", taskId: downstream.id, label: "Itself" }] },
});
assert.equal(selfEdge.dependencies.length, 2, "a self-edge is never imported");

// ── Human dependency edits from a stale snapshot (#6286) ──────────────────────
// Two browsers show the same card. One links a new upstream; the other, which
// never saw that link, cuts a different edge and then undoes the cut. Every
// edit applies to the CURRENT card, so each survives the other.
const upC = await board.createCard({ title: "Review the plan" });
const humanCard = await board.createCard({ title: "Ship the plan" });
const cutEdge = {
  id: "cut-edge",
  kind: "task",
  label: "Write the migration",
  taskId: upstreamB.id,
  state: "unresolved",
  origin: "human",
  createdAt: new Date().toISOString(),
};
await board.updateCard(humanCard.id, {
  dependencies: [cutEdge],
  primaryBlockerId: "cut-edge",
  primaryBlockerPinned: true,
});
// Browser 1 links Review the plan as a human edge.
await board.updateCard(humanCard.id, {
  ops: { dependencyOps: [{ op: "addTask", id: "link-edge", taskId: upC.id, label: "Review the plan", origin: "human" }] },
});
// Browser 2, still showing only cut-edge, cuts it.
let afterCut = await board.updateCard(humanCard.id, {
  ops: { dependencyOps: [{ op: "removeTask", taskId: upstreamB.id }] },
});
assert.deepEqual(afterCut.dependencies.map((dep) => dep.id), ["link-edge"], "the cut keeps the link it never saw");
assert.equal(afterCut.dependencies[0].origin, "human", "a human link records human authorship");
assert.equal(afterCut.primaryBlockerId, "link-edge", "cutting the primary re-points it to the next unresolved edge");
assert.equal(afterCut.primaryBlockerPinned, false, "a re-pointed primary is not pinned");
// Browser 2 undoes its cut: the exact record and its pinned primary return.
afterCut = await board.updateCard(humanCard.id, {
  ops: { dependencyOps: [{ op: "restore", dependencies: [cutEdge], primaryBlockerId: "cut-edge", primaryBlockerPinned: true }] },
});
assert.deepEqual(afterCut.dependencies.map((dep) => dep.id).sort(), ["cut-edge", "link-edge"], "undoing the cut keeps the link");
assert.deepEqual(afterCut.dependencies.find((dep) => dep.id === "cut-edge"), cutEdge, "the restored record is exact");
assert.equal(afterCut.primaryBlockerId, "cut-edge");
assert.equal(afterCut.primaryBlockerPinned, true);
// Browser 1 undoes its link by id: only that edge goes.
afterCut = await board.updateCard(humanCard.id, { ops: { dependencyOps: [{ op: "remove", id: "link-edge" }] } });
assert.deepEqual(afterCut.dependencies.map((dep) => dep.id), ["cut-edge"], "undoing the link removes only its own edge");

// ── Back-compat: full-array patches still replace wholesale ───────────────────
const replaced = await board.updateCard(card.id, { steps: [] });
assert.deepEqual(replaced.steps, [], "legacy full-array patch replaces (enrich-steps relies on this)");

await rm(tmpHome, { recursive: true, force: true });
console.log("cave-board-ops: ok");
