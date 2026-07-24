// @ts-nocheck
// Pure derivations for the new-chat dashboard's Open-work board.
import assert from "node:assert/strict";
import {
  openWorkPriorityLabel,
  openWorkRows,
  runningTimeoutBadge,
} from "./dashboard-open-work.ts";

const card = (over = {}) => ({
  id: "c1",
  title: "A card",
  status: "inbox",
  priority: "medium",
  lifecycle: "queued",
  updatedAt: "2026-07-24T00:00:00Z",
  ...over,
});

// ── openWorkRows: maps columns, drops done + untitled, orders by kind/priority
{
  const rows = openWorkRows([
    card({ id: "inbox", status: "inbox", priority: "low" }),
    card({ id: "running", status: "running", priority: "low" }),
    card({ id: "blocked", status: "blocked", priority: "high" }),
    card({ id: "done", status: "done" }),
    card({ id: "blank", status: "inbox", title: "   " }),
  ]);
  assert.deepEqual(
    rows.map((r) => r.id),
    ["running", "blocked", "inbox"],
    "done + untitled dropped; ordered running → blocked → inbox",
  );
  assert.equal(rows[0].kind, "running");
}

// Priority breaks ties within the same kind (urgent before high).
{
  const rows = openWorkRows([
    card({ id: "hi", status: "inbox", priority: "high" }),
    card({ id: "urg", status: "inbox", priority: "urgent" }),
  ]);
  assert.deepEqual(rows.map((r) => r.id), ["urg", "hi"], "urgent sorts before high");
}

// ── openWorkPriorityLabel: only high/urgent earn a label
assert.equal(openWorkPriorityLabel("urgent"), "urgent");
assert.equal(openWorkPriorityLabel("high"), "high");
assert.equal(openWorkPriorityLabel("medium"), null);
assert.equal(openWorkPriorityLabel("low"), null);

// ── runningTimeoutBadge: "running Nm of Nh", clock injected
{
  const since = "2026-07-24T00:00:00Z";
  const now = new Date("2026-07-24T00:47:00Z").getTime();
  assert.equal(runningTimeoutBadge(since, 2 * 60 * 60 * 1000, now), "running 47m of 2h");
  assert.equal(runningTimeoutBadge(undefined, 1000, now), null, "no runningSince → no badge");
  assert.equal(runningTimeoutBadge(since, 0, now), null, "no timeout → no badge");
  assert.equal(runningTimeoutBadge(since, 1000, new Date("2026-07-23T00:00:00Z").getTime()), null, "negative elapsed → no badge");
}

console.log("dashboard-open-work.test.ts: ok");
