// @ts-nocheck
import assert from "node:assert/strict";
import { filterDeletedSessions } from "./session-list-deletes.ts";

const rows = [
  { id: "keep-1", updated_at: "2026-07-17T12:00:00.000Z" },
  { id: "deleted", updated_at: "2026-07-17T12:01:00.000Z" },
  { id: "keep-2", updated_at: "2026-07-17T12:02:00.000Z" },
];

assert.equal(
  filterDeletedSessions(rows, new Set()),
  rows,
  "empty delete tombstones should keep the existing list reference",
);

assert.deepEqual(
  filterDeletedSessions(rows, new Set(["deleted"])).map((row) => row.id),
  ["keep-1", "keep-2"],
  "deleted session ids should be removed without disturbing unrelated order",
);

assert.deepEqual(
  filterDeletedSessions(rows, new Set(["missing"])).map((row) => row.id),
  ["keep-1", "deleted", "keep-2"],
  "unknown tombstones should not change visible rows",
);

console.log("session-list-deletes.test.ts passed");
