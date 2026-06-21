// @ts-nocheck
import assert from "node:assert/strict";
import {
  paneRects,
  directionalNeighbor,
  cycleVisibleSession,
  paneNumberMap,
  sessionAtPaneNumber,
} from "./terminal-nav.ts";

const leaf = (id) => ({ kind: "leaf", sessionId: id });
const hsplit = (...kids) => ({ kind: "horizontal", children: kids.map((node) => ({ size: 100 / kids.length, node })) });
const vsplit = (...kids) => ({ kind: "vertical", children: kids.map((node) => ({ size: 100 / kids.length, node })) });
const state = (root, active) => ({ version: 1, sessions: [], activeSessionId: active ?? null, root });
const rectOf = (root, id) => paneRects(state(root)).find((r) => r.sessionId === id);

// ── paneRects geometry ──────────────────────────────────────────────────────
{
  // Single pane fills the viewport.
  const r = paneRects(state(leaf("a")));
  assert.deepEqual(r, [{ sessionId: "a", x: 0, y: 0, w: 100, h: 100 }]);
}
{
  // Horizontal split → left/right halves.
  const r = paneRects(state(hsplit(leaf("a"), leaf("b"))));
  const a = r.find((x) => x.sessionId === "a");
  const b = r.find((x) => x.sessionId === "b");
  assert.deepEqual([a.x, a.w], [0, 50]);
  assert.deepEqual([b.x, b.w], [50, 50]);
  assert.equal(a.h, 100); assert.equal(b.h, 100);
}
{
  // Vertical split → top/bottom halves.
  const r = paneRects(state(vsplit(leaf("a"), leaf("b"))));
  assert.deepEqual([rectOf(vsplit(leaf("a"), leaf("b")), "a").y, rectOf(vsplit(leaf("a"), leaf("b")), "a").h], [0, 50]);
  assert.deepEqual([r.find((x) => x.sessionId === "b").y, r.find((x) => x.sessionId === "b").h], [50, 50]);
}
{
  // Weighted children honor sizes (70/30).
  const root = { kind: "horizontal", children: [{ size: 70, node: leaf("a") }, { size: 30, node: leaf("b") }] };
  assert.equal(rectOf(root, "a").w, 70);
  assert.equal(rectOf(root, "b").x, 70);
  assert.equal(rectOf(root, "b").w, 30);
}

// ── directionalNeighbor: 2-pane horizontal ──────────────────────────────────
{
  const s = state(hsplit(leaf("a"), leaf("b")), "a");
  assert.equal(directionalNeighbor(s, "a", "right"), "b");
  assert.equal(directionalNeighbor(s, "b", "left"), "a");
  assert.equal(directionalNeighbor(s, "a", "left"), null, "nothing left of leftmost");
  assert.equal(directionalNeighbor(s, "a", "up"), null, "no vertical neighbor in a horizontal split");
  assert.equal(directionalNeighbor(s, "b", "right"), null);
}

// ── directionalNeighbor: 2-pane vertical ────────────────────────────────────
{
  const s = state(vsplit(leaf("top"), leaf("bot")), "top");
  assert.equal(directionalNeighbor(s, "top", "down"), "bot");
  assert.equal(directionalNeighbor(s, "bot", "up"), "top");
  assert.equal(directionalNeighbor(s, "top", "up"), null);
  assert.equal(directionalNeighbor(s, "top", "left"), null);
}

// ── directionalNeighbor: 2×2 grid (rows of columns) ─────────────────────────
{
  //  TL TR
  //  BL BR
  const grid = vsplit(hsplit(leaf("TL"), leaf("TR")), hsplit(leaf("BL"), leaf("BR")));
  const s = state(grid, "TL");
  assert.equal(directionalNeighbor(s, "TL", "right"), "TR");
  assert.equal(directionalNeighbor(s, "TL", "down"), "BL");
  assert.equal(directionalNeighbor(s, "BR", "left"), "BL");
  assert.equal(directionalNeighbor(s, "BR", "up"), "TR");
  assert.equal(directionalNeighbor(s, "TR", "down"), "BR");
  assert.equal(directionalNeighbor(s, "BL", "right"), "BR");
  assert.equal(directionalNeighbor(s, "TL", "left"), null);
  assert.equal(directionalNeighbor(s, "TL", "up"), null);
}

// ── directionalNeighbor: cross-axis overlap preference ──────────────────────
{
  // Left column is one tall pane "L"; right column is two stacked "RT"/"RB".
  // Moving right from L should land on whichever right pane shares more height —
  // they're equal here, so it picks the closer-gap/closer-center one (RT, the
  // top, has center nearer L's center=50? both equidistant) — accept either of
  // the two right panes, but moving right must NOT return null and must be a
  // right-column pane.
  const root = hsplit(leaf("L"), vsplit(leaf("RT"), leaf("RB")));
  const s = state(root, "L");
  const right = directionalNeighbor(s, "L", "right");
  assert.ok(right === "RT" || right === "RB", `right of L is a right-column pane, got ${right}`);
  // From RT, left is unambiguously L; up is null (top of its column).
  assert.equal(directionalNeighbor(s, "RT", "left"), "L");
  assert.equal(directionalNeighbor(s, "RT", "down"), "RB");
  assert.equal(directionalNeighbor(s, "RT", "up"), null);
}
{
  // Overlap tie-break: a wide bottom pane under two top panes — moving down from
  // the top-LEFT pane should reach the bottom pane (full overlap), not null.
  const root = vsplit(hsplit(leaf("TL"), leaf("TR")), leaf("B"));
  const s = state(root, "TL");
  assert.equal(directionalNeighbor(s, "TL", "down"), "B");
  assert.equal(directionalNeighbor(s, "TR", "down"), "B");
  assert.equal(directionalNeighbor(s, "B", "up"), "TL", "from wide bottom, up picks the most-overlapping top (TL spans 0–50, TR 50–100; ties → closest center → TL by sort stability)");
}

// ── unknown source id → null ────────────────────────────────────────────────
{
  const s = state(hsplit(leaf("a"), leaf("b")), "a");
  assert.equal(directionalNeighbor(s, "ghost", "right"), null);
  assert.equal(directionalNeighbor(state(null), "a", "right"), null);
}

// ── cycleVisibleSession ─────────────────────────────────────────────────────
{
  const s = state(hsplit(leaf("a"), leaf("b"), leaf("c")), "a");
  assert.equal(cycleVisibleSession(s, "a", 1), "b");
  assert.equal(cycleVisibleSession(s, "b", 1), "c");
  assert.equal(cycleVisibleSession(s, "c", 1), "a", "next wraps to first");
  assert.equal(cycleVisibleSession(s, "a", -1), "c", "prev wraps to last");
  assert.equal(cycleVisibleSession(s, "b", -1), "a");
  assert.equal(cycleVisibleSession(s, null, 1), "a", "null start → first going forward");
  assert.equal(cycleVisibleSession(s, null, -1), "c", "null start → last going backward");
  assert.equal(cycleVisibleSession(s, "ghost", 1), "a", "unknown start → first");
}
{
  assert.equal(cycleVisibleSession(state(leaf("solo"), "solo"), "solo", 1), "solo", "single pane → itself");
  assert.equal(cycleVisibleSession(state(null), null, 1), null, "no panes → null");
}

// ── pane numbers + quick jump ───────────────────────────────────────────────
{
  const s = state(hsplit(leaf("a"), leaf("b"), leaf("c")), "a");
  const map = paneNumberMap(s);
  assert.equal(map.get("a"), 1);
  assert.equal(map.get("b"), 2);
  assert.equal(map.get("c"), 3);
  assert.equal(sessionAtPaneNumber(s, 1), "a");
  assert.equal(sessionAtPaneNumber(s, 3), "c");
  assert.equal(sessionAtPaneNumber(s, 4), null, "out of range → null");
  assert.equal(sessionAtPaneNumber(s, 0), null);
  assert.equal(sessionAtPaneNumber(s, 1.5), null, "non-integer → null");
}

console.log("terminal-nav.test.ts passed");
