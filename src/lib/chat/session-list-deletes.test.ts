// @ts-nocheck
import assert from "node:assert/strict";
import { deriveChatProjectGroups, filterVisibleChatSessions } from "./chat-projects.ts";
import { sortPinnedFirst } from "./chat-session-prefs.ts";
import {
  filterDeletedSessions,
  recordDeletedSessionIds,
  successfulSessionIds,
} from "./session-list-deletes.ts";

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

const enrichedRows = [
  {
    id: "keep",
    title: "Keep",
    familiarId: "familiar-1",
    project_root: "/repo",
    status: "active",
    created_at: "2026-07-17T12:00:00.000Z",
    updated_at: "2026-07-17T12:00:00.000Z",
    githubTask: { number: 1 },
  },
  {
    id: "deleted-enriched",
    title: "Deleted",
    familiarId: "familiar-1",
    project_root: "/repo",
    status: "active",
    created_at: "2026-07-17T12:01:00.000Z",
    updated_at: "2026-07-17T12:01:00.000Z",
    githubTask: { number: 2 },
  },
];

const tombstones = new Set<string>();
assert.deepEqual(
  recordDeletedSessionIds(tombstones, ["deleted-enriched", "deleted-enriched", ""]),
  ["deleted-enriched"],
  "confirmed ids are recorded once before a reload",
);
assert.deepEqual(
  recordDeletedSessionIds(tombstones, ["deleted-enriched"]),
  [],
  "a duplicate confirmation does not schedule redundant reconciliation",
);

// Simulate both a cached payload and an older request resolving after the
// confirmed delete. The Workspace-owned tombstone filters either response.
const cachedBeforeDelete = enrichedRows;
const olderInFlight = Promise.resolve(enrichedRows);
const cachedVisible = filterDeletedSessions(cachedBeforeDelete, tombstones);
const inFlightVisible = filterDeletedSessions(await olderInFlight, tombstones);
assert.deepEqual(cachedVisible.map((row) => row.id), ["keep"]);
assert.deepEqual(inFlightVisible.map((row) => row.id), ["keep"]);

// Downstream chat/search, project, pinned, and GitHub-enriched consumers all
// derive from the same filtered shared rows, so none can retain the tombstone.
const chatVisible = filterVisibleChatSessions(inFlightVisible, null);
const projectGroups = sortPinnedFirst(
  deriveChatProjectGroups(chatVisible, []),
  ["deleted-enriched", "keep"],
);
assert.deepEqual(projectGroups.flatMap((group) => group.sessions.map((row) => row.id)), ["keep"]);
assert.deepEqual(chatVisible[0]?.githubTask, { number: 1 }, "unrelated enriched rows remain intact");

assert.deepEqual(
  successfulSessionIds(["ok-1", "failed", "ok-2"], [true, false, true]),
  ["ok-1", "ok-2"],
  "partial bulk deletion reports only server-confirmed ids",
);

console.log("session-list-deletes.test.ts passed");
