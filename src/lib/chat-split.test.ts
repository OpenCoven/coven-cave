import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CHAT_SPLIT_PRIMARY,
  MAX_CHAT_SPLIT_PANES,
  chatDropPreviewRect,
  chatDropZoneLabel,
  chatSplitAxisForZone,
  chatSplitSessionIds,
  dropSessionIntoChatSplit,
  emptyChatSplitLayout,
  hasChatSplit,
  removeChatSplitPane,
  resolveChatDropZone,
} from "./chat-split.ts";

// ── resolveChatDropZone — closest-edge snap ──────────────────────────────────

test("resolveChatDropZone snaps to the nearest edge", () => {
  assert.equal(resolveChatDropZone(1000, 600, 50, 300), "left");
  assert.equal(resolveChatDropZone(1000, 600, 950, 300), "right");
  assert.equal(resolveChatDropZone(1000, 600, 500, 30), "top");
  assert.equal(resolveChatDropZone(1000, 600, 500, 570), "bottom");
});

test("resolveChatDropZone uses normalized distance, not pixels", () => {
  // 100px from the left of a 1000px-wide area (10%) vs 100px from the top of a
  // 600px-tall area (~17%) — the left edge is nearer proportionally.
  assert.equal(resolveChatDropZone(1000, 600, 100, 100), "left");
  // Mirror on a tall narrow area: top wins.
  assert.equal(resolveChatDropZone(600, 1000, 100, 100), "top");
});

test("resolveChatDropZone breaks dead-center ties horizontal-first", () => {
  assert.equal(resolveChatDropZone(1000, 1000, 500, 500), "left");
});

test("resolveChatDropZone rejects points outside the rect and bad rects", () => {
  assert.equal(resolveChatDropZone(1000, 600, -5, 300), null);
  assert.equal(resolveChatDropZone(1000, 600, 500, 700), null);
  assert.equal(resolveChatDropZone(0, 0, 0, 0), null);
  assert.equal(resolveChatDropZone(Number.NaN, 600, 10, 10), null);
});

// ── Preview + labels ─────────────────────────────────────────────────────────

test("chatDropPreviewRect highlights the half the pane will occupy", () => {
  assert.deepEqual(chatDropPreviewRect("left"), { left: 0, top: 0, width: 50, height: 100 });
  assert.deepEqual(chatDropPreviewRect("right"), { left: 50, top: 0, width: 50, height: 100 });
  assert.deepEqual(chatDropPreviewRect("top"), { left: 0, top: 0, width: 100, height: 50 });
  assert.deepEqual(chatDropPreviewRect("bottom"), { left: 0, top: 50, width: 100, height: 50 });
});

test("chatDropZoneLabel words vertical zones as above/below", () => {
  assert.equal(chatDropZoneLabel("top"), "above");
  assert.equal(chatDropZoneLabel("bottom"), "below");
  assert.equal(chatDropZoneLabel("left"), "left");
  assert.equal(chatDropZoneLabel("right"), "right");
});

// ── Layout state ─────────────────────────────────────────────────────────────

test("the empty layout is a lone primary pane with no split", () => {
  const layout = emptyChatSplitLayout();
  assert.deepEqual(layout.panes, [CHAT_SPLIT_PRIMARY]);
  assert.equal(hasChatSplit(layout), false);
  assert.deepEqual(chatSplitSessionIds(layout), []);
});

test("the first drop sets the axis from the zone and lands on the drop edge", () => {
  const right = dropSessionIntoChatSplit(emptyChatSplitLayout(), "s1", "right");
  assert.deepEqual(right, { axis: "row", panes: [CHAT_SPLIT_PRIMARY, "s1"] });
  assert.equal(hasChatSplit(right), true);

  const left = dropSessionIntoChatSplit(emptyChatSplitLayout(), "s1", "left");
  assert.deepEqual(left.panes, ["s1", CHAT_SPLIT_PRIMARY]);

  const top = dropSessionIntoChatSplit(emptyChatSplitLayout(), "s1", "top");
  assert.deepEqual(top, { axis: "column", panes: ["s1", CHAT_SPLIT_PRIMARY] });

  const bottom = dropSessionIntoChatSplit(emptyChatSplitLayout(), "s1", "bottom");
  assert.deepEqual(bottom, { axis: "column", panes: [CHAT_SPLIT_PRIMARY, "s1"] });
});

test("chatSplitAxisForZone maps sides to row and top/bottom to column", () => {
  assert.equal(chatSplitAxisForZone("left"), "row");
  assert.equal(chatSplitAxisForZone("right"), "row");
  assert.equal(chatSplitAxisForZone("top"), "column");
  assert.equal(chatSplitAxisForZone("bottom"), "column");
});

test("re-dropping an open pane moves it to the drop edge, never duplicates", () => {
  let layout = dropSessionIntoChatSplit(emptyChatSplitLayout(), "s1", "right");
  layout = dropSessionIntoChatSplit(layout, "s2", "right");
  assert.deepEqual(layout.panes, [CHAT_SPLIT_PRIMARY, "s1", "s2"]);
  layout = dropSessionIntoChatSplit(layout, "s1", "left");
  assert.deepEqual(layout.panes, ["s1", CHAT_SPLIT_PRIMARY, "s2"]);
});

test("a perpendicular drop reorients the whole strip", () => {
  let layout = dropSessionIntoChatSplit(emptyChatSplitLayout(), "s1", "right");
  assert.equal(layout.axis, "row");
  layout = dropSessionIntoChatSplit(layout, "s2", "bottom");
  assert.equal(layout.axis, "column");
  assert.deepEqual(layout.panes, [CHAT_SPLIT_PRIMARY, "s1", "s2"]);
});

test("at the pane cap, the endmost secondary on the far edge is evicted", () => {
  let layout = emptyChatSplitLayout();
  layout = dropSessionIntoChatSplit(layout, "s1", "right");
  layout = dropSessionIntoChatSplit(layout, "s2", "right");
  layout = dropSessionIntoChatSplit(layout, "s3", "right");
  assert.equal(layout.panes.length, MAX_CHAT_SPLIT_PANES);

  // Drop at the end → the first secondary (nearest the start) is evicted.
  const atEnd = dropSessionIntoChatSplit(layout, "s4", "right");
  assert.deepEqual(atEnd.panes, [CHAT_SPLIT_PRIMARY, "s2", "s3", "s4"]);

  // Drop at the start → the last secondary is evicted; primary survives.
  const atStart = dropSessionIntoChatSplit(layout, "s4", "left");
  assert.deepEqual(atStart.panes, ["s4", CHAT_SPLIT_PRIMARY, "s1", "s2"]);
});

test("the primary pane is never evicted even when it sits at the far edge", () => {
  let layout = emptyChatSplitLayout();
  layout = dropSessionIntoChatSplit(layout, "s1", "left");
  layout = dropSessionIntoChatSplit(layout, "s2", "left");
  layout = dropSessionIntoChatSplit(layout, "s3", "left");
  assert.deepEqual(layout.panes, ["s3", "s2", "s1", CHAT_SPLIT_PRIMARY]);
  const next = dropSessionIntoChatSplit(layout, "s4", "left");
  assert.deepEqual(next.panes, ["s4", "s3", "s2", CHAT_SPLIT_PRIMARY]);
});

test("blank ids and the primary sentinel are rejected as drops", () => {
  const layout = dropSessionIntoChatSplit(emptyChatSplitLayout(), "s1", "right");
  assert.equal(dropSessionIntoChatSplit(layout, "  ", "right"), layout);
  assert.equal(dropSessionIntoChatSplit(layout, CHAT_SPLIT_PRIMARY, "right"), layout);
});

test("removeChatSplitPane closes a pane and collapses back to solo", () => {
  let layout = dropSessionIntoChatSplit(emptyChatSplitLayout(), "s1", "right");
  layout = dropSessionIntoChatSplit(layout, "s2", "right");
  layout = removeChatSplitPane(layout, "s1");
  assert.deepEqual(layout.panes, [CHAT_SPLIT_PRIMARY, "s2"]);
  layout = removeChatSplitPane(layout, "s2");
  assert.equal(hasChatSplit(layout), false);
});

test("removeChatSplitPane never removes the primary and no-ops on unknown ids", () => {
  const layout = dropSessionIntoChatSplit(emptyChatSplitLayout(), "s1", "right");
  assert.equal(removeChatSplitPane(layout, CHAT_SPLIT_PRIMARY), layout);
  assert.equal(removeChatSplitPane(layout, "nope"), layout);
});

test("chatSplitSessionIds lists dropped panes in layout order", () => {
  let layout = dropSessionIntoChatSplit(emptyChatSplitLayout(), "s1", "right");
  layout = dropSessionIntoChatSplit(layout, "s2", "left");
  assert.deepEqual(chatSplitSessionIds(layout), ["s2", "s1"]);
});
