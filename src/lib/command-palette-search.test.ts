import assert from "node:assert/strict";
import { test } from "node:test";

import {
  PALETTE_CATEGORIES,
  filterPaletteRows,
  paletteCategoryForKind,
  paletteResultCounts,
  paletteResultSummary,
} from "./command-palette-search.ts";

const rows = [
  { id: "f:1", kind: "familiar" },
  { id: "s:1", kind: "session" },
  { id: "conv:1", kind: "conversation-hit" },
  { id: "card:1", kind: "card" },
  { id: "cm:1", kind: "coven-memory" },
  { id: "fm:1", kind: "fs-memory" },
  { id: "setting:1", kind: "setting" },
  { id: "surface:1", kind: "command" },
  { id: "shortcut:1", kind: "shortcut" },
  { id: "create:1", kind: "create-task" },
  { id: "salem:1", kind: "salem-answer" },
] as const;

test("palette categories are stable and user-facing", () => {
  assert.deepEqual(PALETTE_CATEGORIES, ["all", "chats", "tasks", "memory", "settings", "actions"]);
  assert.equal(paletteCategoryForKind("familiar"), "chats");
  assert.equal(paletteCategoryForKind("conversation-hit"), "chats");
  assert.equal(paletteCategoryForKind("card"), "tasks");
  assert.equal(paletteCategoryForKind("coven-memory"), "memory");
  assert.equal(paletteCategoryForKind("setting"), "settings");
  assert.equal(paletteCategoryForKind("salem-answer"), "actions");
});

test("scope filtering keeps only the requested result family", () => {
  assert.deepEqual(filterPaletteRows(rows, "all"), rows);
  assert.deepEqual(filterPaletteRows(rows, "chats").map((row) => row.id), ["f:1", "s:1", "conv:1"]);
  assert.deepEqual(filterPaletteRows(rows, "memory").map((row) => row.id), ["cm:1", "fm:1"]);
  assert.deepEqual(filterPaletteRows(rows, "actions").map((row) => row.id), [
    "surface:1", "shortcut:1", "create:1", "salem:1",
  ]);
});

test("counts and announcements exclude the Salem fallback from local-result totals", () => {
  assert.deepEqual(paletteResultCounts(rows), {
    all: 10,
    chats: 3,
    tasks: 1,
    memory: 2,
    settings: 1,
    actions: 3,
  });
  assert.equal(paletteResultSummary(rows, "all", "nova"), "10 local results for nova across all categories.");
  assert.equal(paletteResultSummary([], "tasks", "missing"), "No task results for missing.");
});

