import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveActivePath,
  siblingsOf,
  childLeaf,
  linearizeLegacy,
  type TreeTurn,
} from "./conversation-tree.ts";

function t(id: string, parentId: string | null, seconds: number): TreeTurn {
  return { id, parentId, createdAt: `2026-06-23T00:00:${String(seconds).padStart(2, "0")}.000Z` };
}

test("resolveActivePath walks from activeLeafId to root, root-first", () => {
  const turns = [t("u1", null, 1), t("a1", "u1", 2), t("u2", "a1", 3), t("a2", "u2", 4)];
  const path = resolveActivePath(turns, "a2");
  assert.deepEqual(path.map((x) => x.id), ["u1", "a1", "u2", "a2"]);
});

test("resolveActivePath picks only the active branch", () => {
  const turns = [t("u1", null, 1), t("a1", "u1", 2), t("a1b", "u1", 3)];
  assert.deepEqual(resolveActivePath(turns, "a1").map((x) => x.id), ["u1", "a1"]);
  assert.deepEqual(resolveActivePath(turns, "a1b").map((x) => x.id), ["u1", "a1b"]);
});

test("resolveActivePath falls back to createdAt linearization on a bad leaf", () => {
  const turns = [t("u1", null, 1), t("a1", "u1", 2)];
  assert.deepEqual(resolveActivePath(turns, "missing").map((x) => x.id), ["u1", "a1"]);
});

test("resolveActivePath defends against a parent cycle", () => {
  const turns = [
    { id: "x", parentId: "y", createdAt: "2026-06-23T00:00:01.000Z" },
    { id: "y", parentId: "x", createdAt: "2026-06-23T00:00:02.000Z" },
  ];
  const path = resolveActivePath(turns, "x");
  assert.ok(path.length >= 1);
});

test("siblingsOf returns ordered siblings and the 0-based index", () => {
  const turns = [t("u1", null, 1), t("a", "u1", 2), t("b", "u1", 3), t("c", "u1", 4)];
  const r = siblingsOf(turns, "b");
  assert.deepEqual(r.siblings.map((x) => x.id), ["a", "b", "c"]);
  assert.equal(r.index, 1);
});

test("siblingsOf for a turn with no siblings is index 0 of 1", () => {
  const turns = [t("u1", null, 1), t("a", "u1", 2)];
  const r = siblingsOf(turns, "a");
  assert.deepEqual(r.siblings.map((x) => x.id), ["a"]);
  assert.equal(r.index, 0);
});

test("childLeaf descends to the newest descendant of a sibling", () => {
  const turns = [t("u1", null, 1), t("s", "u1", 2), t("s2", "s", 3), t("s3", "s2", 4)];
  assert.equal(childLeaf(turns, "s"), "s3");
});

test("childLeaf of a leaf sibling is itself", () => {
  const turns = [t("u1", null, 1), t("s", "u1", 2)];
  assert.equal(childLeaf(turns, "s"), "s");
});

test("linearizeLegacy assigns parents by createdAt and points the leaf at the last turn", () => {
  const turns = [
    { id: "a", createdAt: "2026-06-23T00:00:02.000Z" },
    { id: "b", createdAt: "2026-06-23T00:00:01.000Z" },
    { id: "c", createdAt: "2026-06-23T00:00:03.000Z" },
  ];
  const r = linearizeLegacy(turns);
  assert.equal(r.activeLeafId, "c");
  const byId = new Map(r.turns.map((x) => [x.id, x.parentId]));
  assert.equal(byId.get("b"), null);
  assert.equal(byId.get("a"), "b");
  assert.equal(byId.get("c"), "a");
});

test("linearizeLegacy is idempotent on already-linked turns", () => {
  const turns = [t("u1", null, 1), t("a1", "u1", 2)];
  const r = linearizeLegacy(turns);
  assert.equal(r.activeLeafId, "a1");
  assert.equal(r.turns.find((x) => x.id === "a1")?.parentId, "u1");
});

test("linearizeLegacy on an empty array yields an empty path", () => {
  const r = linearizeLegacy([]);
  assert.deepEqual(r.turns, []);
  assert.equal(r.activeLeafId, "");
});
