// @ts-nocheck
// The new-session launcher's Queue group (Chat.dc.html 2b, cave-3lonn) offers
// parked follow-ups. It must never offer another familiar's work, and never
// offer work that is already moving.
import assert from "node:assert/strict";
import { test } from "node:test";

import { issueOwner, parkedFollowUps, queueFollowUpLabel } from "./chat-queue-followups.ts";

const issue = (over = {}) => ({
  id: "cave-1",
  title: "Re-run SHA256SUMS verification",
  priority: 2,
  status: "open",
  labels: [],
  updated_at: "2026-07-28T10:00:00.000Z",
  ...over,
});

test("ownership prefers the familiar: label, then the assignee", () => {
  assert.equal(issueOwner(issue({ labels: ["familiar:kitty"], assignee: "Val" })), "kitty");
  assert.equal(issueOwner(issue({ assignee: "Cody" })), "cody");
  assert.equal(issueOwner(issue()), null);
});

test("unassigned work is fair game; another familiar's work is never offered", () => {
  const issues = [
    issue({ id: "cave-mine", labels: ["familiar:kitty"] }),
    issue({ id: "cave-free" }),
    issue({ id: "cave-theirs", labels: ["familiar:cody"] }),
    issue({ id: "cave-explicit-unassigned", assignee: "unassigned" }),
  ];
  const ids = parkedFollowUps(issues, { familiarId: "kitty" }).map((r) => r.id);
  assert.deepEqual(ids.sort(), ["cave-explicit-unassigned", "cave-free", "cave-mine"]);
});

test("a familiar-less caller still gets the unclaimed work", () => {
  const issues = [issue({ id: "cave-free" }), issue({ id: "cave-theirs", labels: ["familiar:cody"] })];
  assert.deepEqual(parkedFollowUps(issues, { familiarId: null }).map((r) => r.id), ["cave-free"]);
});

test("work already moving or finished is not 'parked'", () => {
  const issues = [
    issue({ id: "cave-open", status: "open" }),
    issue({ id: "cave-running", status: "in_progress" }),
    issue({ id: "cave-hyphen", status: "in-progress" }),
    issue({ id: "cave-done", status: "closed" }),
  ];
  assert.deepEqual(parkedFollowUps(issues, { familiarId: "kitty" }).map((r) => r.id), ["cave-open"]);
});

test("rows sort by priority, then by recency, and cap without reordering", () => {
  const issues = [
    issue({ id: "cave-p3-old", priority: 3, updated_at: "2026-07-20T10:00:00.000Z" }),
    issue({ id: "cave-p1", priority: 1, updated_at: "2026-07-01T10:00:00.000Z" }),
    issue({ id: "cave-p3-new", priority: 3, updated_at: "2026-07-27T10:00:00.000Z" }),
  ];
  const rows = parkedFollowUps(issues, { familiarId: "kitty" });
  assert.deepEqual(rows.map((r) => r.id), ["cave-p1", "cave-p3-new", "cave-p3-old"]);
  assert.deepEqual(
    parkedFollowUps(issues, { familiarId: "kitty", cap: 2 }).map((r) => r.id),
    ["cave-p1", "cave-p3-new"],
  );
});

test("an issue with no title falls back to its id rather than rendering blank", () => {
  const [row] = parkedFollowUps([issue({ title: "   " })], { familiarId: "kitty" });
  assert.equal(row.title, "cave-1");
});

test("the accessible name carries the id and the parked state", () => {
  const [row] = parkedFollowUps([issue()], { familiarId: "kitty" });
  assert.equal(queueFollowUpLabel(row), "Start 'Re-run SHA256SUMS verification' — cave-1, queued");
});
