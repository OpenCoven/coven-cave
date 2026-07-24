// @ts-nocheck
// Pure derivations for the Home dashboard's Open-work board (launcher 3a).
import assert from "node:assert/strict";
import {
  filterOpenWork,
  openWorkCounts,
  openWorkPriorityLabel,
  openWorkRows,
  runningTimeoutBadge,
  OPEN_WORK_FILTERS,
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

// ── filterOpenWork: "all" passes through; kind tabs match one-to-one, and the
//    generic signature preserves caller-attached fields (e.g. onOpen).
{
  const rows = openWorkRows([
    card({ id: "r", status: "running" }),
    card({ id: "b", status: "blocked" }),
    card({ id: "i", status: "inbox" }),
  ]).map((r) => ({ ...r, onOpen: () => r.id }));
  assert.equal(filterOpenWork(rows, "all").length, 3);
  assert.deepEqual(filterOpenWork(rows, "running").map((r) => r.id), ["r"]);
  assert.deepEqual(filterOpenWork(rows, "blocked").map((r) => r.id), ["b"]);
  assert.equal(typeof filterOpenWork(rows, "running")[0].onOpen, "function", "onOpen survives filtering");
}

// ── openWorkCounts: per-tab totals
{
  const rows = openWorkRows([
    card({ id: "r1", status: "running" }),
    card({ id: "r2", status: "running" }),
    card({ id: "b", status: "blocked" }),
    card({ id: "i", status: "inbox" }),
    card({ id: "bk", status: "backlog" }),
  ]);
  assert.deepEqual(openWorkCounts(rows), { all: 5, running: 2, blocked: 1, inbox: 1 });
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

// The tab order the UI relies on.
assert.deepEqual(OPEN_WORK_FILTERS, ["all", "running", "blocked", "inbox"]);

console.log("dashboard-open-work.test.ts: ok");
