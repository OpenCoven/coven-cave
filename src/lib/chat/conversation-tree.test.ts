import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveActivePath,
  siblingsOf,
  buildSiblingIndex,
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

test("resolveActivePath weaves chain-less system echoes into the path by createdAt (cave-7ft)", () => {
  // /help output appended while a reply streams: no parentId, so a pure
  // ancestor walk from the streaming leaf would hide it.
  const turns = [
    t("u1", null, 1),
    t("a1", "u1", 2),
    { id: "sys1", role: "system", createdAt: "2026-06-23T00:00:03.000Z" },
    t("u2", "a1", 4),
    t("a2", "u2", 5),
    { id: "sys2", role: "system", createdAt: "2026-06-23T00:00:06.000Z" },
  ];
  const path = resolveActivePath(turns, "a2");
  assert.deepEqual(path.map((x) => x.id), ["u1", "a1", "sys1", "u2", "a2", "sys2"]);
});

test("resolveActivePath keeps same-timestamp user/assistant pair order when weaving echoes", () => {
  // sendRaw stamps the user turn and its pending assistant with the same
  // createdAt; weaving must not re-sort the chain (id tie-breaks are random).
  const now = "2026-06-23T00:00:02.000Z";
  const turns = [
    { id: "z-user", parentId: null, role: "user", createdAt: now },
    { id: "a-assistant", parentId: "z-user", role: "assistant", createdAt: now },
    { id: "sys", role: "system", createdAt: "2026-06-23T00:00:03.000Z" },
  ];
  const path = resolveActivePath(turns, "a-assistant");
  assert.deepEqual(path.map((x) => x.id), ["z-user", "a-assistant", "sys"]);
});

test("resolveActivePath excludes system turns that ARE in the ancestor chain from weaving", () => {
  // A parented system turn is a normal chain member — it must appear exactly
  // once, in chain position.
  const turns = [
    t("u1", null, 1),
    { id: "sys", parentId: "u1", role: "system", createdAt: "2026-06-23T00:00:02.000Z" },
    { id: "a1", parentId: "sys", role: "assistant", createdAt: "2026-06-23T00:00:03.000Z" },
  ];
  const path = resolveActivePath(turns, "a1");
  assert.deepEqual(path.map((x) => x.id), ["u1", "sys", "a1"]);
});

test("resolveActivePath does not weave parentless USER turns (root branch siblings stay hidden)", () => {
  // A second root user turn is an alternative branch, not an echo — weaving it
  // into the active path would render both branches at once.
  const turns = [t("u1", null, 1), t("a1", "u1", 2), t("u1b", null, 3), t("a1b", "u1b", 4)];
  assert.deepEqual(resolveActivePath(turns, "a1").map((x) => x.id), ["u1", "a1"]);
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

test("siblingsOf treats multiple root turns (null parent) as siblings", () => {
  // Branching the first exchange creates a second ROOT user turn; both must be
  // siblings so the navigator appears at the root. Regression guard for the
  // root-turn branch fix (undefined-vs-null parent sentinel).
  const turns = [t("u1", null, 1), t("a1", "u1", 2), t("u1b", null, 3), t("a1b", "u1b", 4)];
  const r = siblingsOf(turns, "u1");
  assert.deepEqual(r.siblings.map((x) => x.id), ["u1", "u1b"]);
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

test("buildSiblingIndex agrees with siblingsOf for every turn (one pass)", () => {
  const turns = [
    t("u1", null, 1), t("a", "u1", 2), t("b", "u1", 3), t("c", "u1", 4),
    t("u1b", null, 5), t("x", "u1b", 6),
  ];
  const index = buildSiblingIndex(turns);
  for (const turn of turns) {
    const viaScan = siblingsOf(turns, turn.id);
    const viaIndex = index.get(turn.id);
    assert.ok(viaIndex, `index has ${turn.id}`);
    assert.deepEqual(viaIndex.siblings.map((s) => s.id), viaScan.siblings.map((s) => s.id), turn.id);
    assert.equal(viaIndex.index, viaScan.index, turn.id);
  }
});
