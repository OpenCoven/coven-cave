import assert from "node:assert/strict";
import {
  emptyEnrichTasksTally,
  enrichTasksSummary,
  tallyEnrichTasksEvent,
} from "./enrich-tasks-summary.ts";

function run(events: Record<string, unknown>[]) {
  return events.reduce(tallyEnrichTasksEvent, emptyEnrichTasksTally());
}

// Every task the run considered is accounted for: updated, closed, left
// unassigned, or skipped (#5629).
{
  const tally = run([
    { kind: "start", total: 5 },
    { kind: "progress", cardId: "a" },
    { kind: "done", cardId: "a", count: 3, closed: false },
    { kind: "done", cardId: "b", count: 0, closed: true },
    { kind: "skip", cardId: "c", reason: "unassigned" },
    { kind: "skip", cardId: "d", reason: "harness:openclaw" },
    { kind: "orchestration", cardId: "a" },
    { kind: "skip", cardId: "e", reason: "no_task_metadata_parsed" },
    { kind: "complete" },
  ]);
  assert.deepEqual(tally, { total: 5, updated: 2, closed: 1, unassigned: 1, skipped: 2 });
  assert.equal(
    enrichTasksSummary(tally),
    "Reviewed 5 open tasks: 2 updated (1 closed), 1 unassigned, 2 skipped. Open Tasks to review.",
  );
}

assert.equal(
  enrichTasksSummary(run([{ kind: "start", total: 0 }, { kind: "complete" }])),
  "No open tasks to enhance right now.",
);

// A run where nothing was written names why instead of implying success.
assert.equal(
  enrichTasksSummary(run([
    { kind: "start", total: 2 },
    { kind: "skip", cardId: "a", reason: "unassigned" },
    { kind: "skip", cardId: "b", reason: "harness:openclaw" },
  ])),
  "Reviewed 2 open tasks: 1 unassigned, 1 skipped.",
);

// A stream cut short reports the tasks it never reached.
assert.equal(
  enrichTasksSummary(run([
    { kind: "start", total: 3 },
    { kind: "done", cardId: "a", count: 2, closed: false },
  ])),
  "Reviewed 3 open tasks: 1 updated, 2 not reached. Open Tasks to review.",
);

assert.equal(
  enrichTasksSummary(run([{ kind: "start", total: 1 }, { kind: "done", cardId: "a", closed: true }])),
  "Reviewed 1 open task: 1 updated (1 closed). Open Tasks to review.",
);
