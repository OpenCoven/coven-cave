// @ts-nocheck
// The new-session "Start from" launcher (Chat.dc.html 2b) counts honestly:
// "3 of 12" only when 12 really exist, and a tile badge says one thing.
import assert from "node:assert/strict";
import { test } from "node:test";

import { startFromCount, startFromGroup, startFromSub, taskTileBadge } from "./chat-start-from.ts";

test("counts read '3 of 12' only when the strip is actually capped", () => {
  assert.equal(startFromCount(3, 12), "3 of 12");
  assert.equal(startFromCount(3, 3), "3");
  assert.equal(startFromCount(0, 0), "0");
  // A total that lags the shown count (stale snapshot) never reads backwards.
  assert.equal(startFromCount(4, 2), "4");
});

test("group headers name the source of the work", () => {
  const chats = startFromGroup("chats", 3, 12);
  assert.equal(chats.label, "Chats");
  assert.equal(chats.count, "3 of 12");
  assert.match(chats.note, /12 threads/);
  const tasks = startFromGroup("tasks", 1, 1);
  assert.equal(tasks.label, "Tasks");
  assert.equal(tasks.count, "1");
  assert.equal(tasks.note, "1 open on the board");
});

test("group notes use the same normalized total as their displayed count", () => {
  assert.equal(startFromGroup("chats", 1, 1.9).count, "1");
  assert.equal(startFromGroup("chats", 1, 1.9).note, "1 thread to resume");
  assert.equal(startFromGroup("tasks", 1, 1.9).note, "1 open on the board");
  assert.equal(startFromGroup("chats", 0, -3).note, "0 threads to resume");
});

test("the tile badge is the loud priority, else the status — never both", () => {
  assert.equal(taskTileBadge({ status: "running", priority: "urgent" }), "urgent");
  assert.equal(taskTileBadge({ status: "review", priority: "high" }), "high");
  assert.equal(taskTileBadge({ status: "review", priority: "medium" }), "review");
});

test("sub-lines drop empty segments instead of rendering stray separators", () => {
  assert.equal(startFromSub(["coven-cave", null, "11m"]), "coven-cave · 11m");
  assert.equal(startFromSub([undefined, "  ", ""]), "");
});
