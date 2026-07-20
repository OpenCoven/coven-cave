import assert from "node:assert/strict";
import test from "node:test";
import { chatListCandidates, filterChatListRows, sortChatRowsByRecency } from "./chat-list-model.ts";
import type { SessionRow } from "./types.ts";

const rows = [
  { id: "a", status: "completed", title: "Alpha", project_root: "/one", created_at: "2026-01-01", updated_at: "2026-01-02" },
  { id: "b", status: "running", title: "Beta", project_root: "/two", created_at: "2026-01-03", updated_at: "2026-01-04" },
] as SessionRow[];

test("chat-list model merges archive rows once and hides deferred deletes", () => {
  const archive = { ...rows[0], id: "old", archived_at: "2026-01-01" };
  assert.deepEqual(chatListCandidates(rows, [rows[1], archive], true, new Set(["a"])).map((row) => row.id), ["b", "old"]);
});

test("chat-list model filters and restores recent order without changing input", () => {
  assert.deepEqual(filterChatListRows(rows, "two", false).map((row) => row.id), ["b"]);
  assert.deepEqual(filterChatListRows(rows, "", true).map((row) => row.id), ["b"]);
  assert.deepEqual(sortChatRowsByRecency(rows).map((row) => row.id), ["b", "a"]);
  assert.deepEqual(rows.map((row) => row.id), ["a", "b"]);
});
