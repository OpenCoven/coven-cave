// @ts-nocheck
// The new-session launcher's Queue group (Chat.dc.html 2b, cave-3lonn) offers
// parked follow-ups. It must never offer another familiar's work, and never
// offer work that is already moving.
import assert from "node:assert/strict";
import { test } from "node:test";

import { beadOwner, parkedFollowUps, queueFollowUpLabel } from "./chat-queue-followups.ts";

const bead = (over = {}) => ({
  id: "cave-1",
  title: "Re-run SHA256SUMS verification",
  priority: 2,
  status: "open",
  labels: [],
  updated_at: "2026-07-28T10:00:00.000Z",
  ...over,
});

test("ownership prefers the familiar: label, then the assignee", () => {
  assert.equal(beadOwner(bead({ labels: ["familiar:kitty"], assignee: "Val" })), "kitty");
  assert.equal(beadOwner(bead({ assignee: "Cody" })), "cody");
  assert.equal(beadOwner(bead()), null);
});

test("unassigned work is fair game; another familiar's work is never offered", () => {
  const beads = [
    bead({ id: "cave-mine", labels: ["familiar:kitty"] }),
    bead({ id: "cave-free" }),
    bead({ id: "cave-theirs", labels: ["familiar:cody"] }),
    bead({ id: "cave-explicit-unassigned", assignee: "unassigned" }),
  ];
  const ids = parkedFollowUps(beads, { familiarId: "kitty" }).map((r) => r.id);
  assert.deepEqual(ids.sort(), ["cave-explicit-unassigned", "cave-free", "cave-mine"]);
});

test("a familiar-less caller still gets the unclaimed work", () => {
  const beads = [bead({ id: "cave-free" }), bead({ id: "cave-theirs", labels: ["familiar:cody"] })];
  assert.deepEqual(parkedFollowUps(beads, { familiarId: null }).map((r) => r.id), ["cave-free"]);
});

test("work already moving or finished is not 'parked'", () => {
  const beads = [
    bead({ id: "cave-open", status: "open" }),
    bead({ id: "cave-running", status: "in_progress" }),
    bead({ id: "cave-hyphen", status: "in-progress" }),
    bead({ id: "cave-done", status: "closed" }),
  ];
  assert.deepEqual(parkedFollowUps(beads, { familiarId: "kitty" }).map((r) => r.id), ["cave-open"]);
});

test("rows sort by priority, then by recency, and cap without reordering", () => {
  const beads = [
    bead({ id: "cave-p3-old", priority: 3, updated_at: "2026-07-20T10:00:00.000Z" }),
    bead({ id: "cave-p1", priority: 1, updated_at: "2026-07-01T10:00:00.000Z" }),
    bead({ id: "cave-p3-new", priority: 3, updated_at: "2026-07-27T10:00:00.000Z" }),
  ];
  const rows = parkedFollowUps(beads, { familiarId: "kitty" });
  assert.deepEqual(rows.map((r) => r.id), ["cave-p1", "cave-p3-new", "cave-p3-old"]);
  assert.deepEqual(
    parkedFollowUps(beads, { familiarId: "kitty", cap: 2 }).map((r) => r.id),
    ["cave-p1", "cave-p3-new"],
  );
});

test("a bead with no title falls back to its id rather than rendering blank", () => {
  const [row] = parkedFollowUps([bead({ title: "   " })], { familiarId: "kitty" });
  assert.equal(row.title, "cave-1");
});

test("the accessible name carries the id and the parked state", () => {
  const [row] = parkedFollowUps([bead()], { familiarId: "kitty" });
  assert.equal(queueFollowUpLabel(row), "Start 'Re-run SHA256SUMS verification' — cave-1, queued");
});
