// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";
import { sameSessionList } from "./session-list-equal.ts";

const row = (over = {}) => ({
  id: "s1", title: "Chat", status: "completed", origin: "chat",
  project_root: "/repo", harness: "codex", familiarId: "nova",
  exit_code: null, archived_at: null, created_at: "t", updated_at: "t",
  ...over,
});

test("same reference is equal", () => {
  const a = [row()];
  assert.equal(sameSessionList(a, a), true);
});

test("equal content in new arrays is equal (the poll's no-op case)", () => {
  assert.equal(sameSessionList([row()], [row()]), true);
  assert.equal(sameSessionList([], []), true);
});

test("differing length is not equal", () => {
  assert.equal(sameSessionList([row()], [row(), row({ id: "s2" })]), false);
});

test("any changed field is not equal", () => {
  assert.equal(sameSessionList([row()], [row({ status: "running" })]), false);
  assert.equal(sameSessionList([row()], [row({ updated_at: "t2" })]), false);
  assert.equal(sameSessionList([row()], [row({ title: "Renamed" })]), false);
});

test("order matters", () => {
  const a = [row({ id: "s1" }), row({ id: "s2" })];
  const b = [row({ id: "s2" }), row({ id: "s1" })];
  assert.equal(sameSessionList(a, b), false);
});

console.log("session-list-equal.test.ts: ok");
