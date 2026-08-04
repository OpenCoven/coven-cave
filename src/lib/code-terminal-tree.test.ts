// @ts-nocheck
import assert from "node:assert/strict";
import {
  MAX_TERMINAL_PANES,
  PRIMARY_TERMINAL_PANE_ID,
  canSplitTerminalPane,
  closeTerminalPane,
  countTerminalPanes,
  createTerminalLayout,
  listTerminalPanes,
  resolveFocusedPane,
  splitTerminalPane,
  terminalBroadcastTargets,
  terminalPaneThreadId,
} from "./code-terminal-tree.ts";

/** Deterministic pane ids so assertions read as layouts, not uuids. */
function idFactory() {
  let n = 0;
  return () => {
    n += 1;
    return `p${n}`;
  };
}

// ── A fresh layout is one primary pane ────────────────────────────────────────
const fresh = createTerminalLayout();
assert.equal(fresh.kind, "pane");
assert.equal(countTerminalPanes(fresh), 1);
assert.deepEqual(listTerminalPanes(fresh), [
  { id: PRIMARY_TERMINAL_PANE_ID, index: 1, label: "Terminal 1", isPrimary: true },
]);

// ── Splitting replaces the focused leaf with a split node ─────────────────────
{
  const next = idFactory();
  const { layout, createdPaneId } = splitTerminalPane(fresh, PRIMARY_TERMINAL_PANE_ID, "horizontal", next);
  assert.equal(createdPaneId, "p1");
  assert.equal(layout.kind, "split");
  assert.equal(layout.direction, "horizontal");
  assert.equal(layout.first.id, PRIMARY_TERMINAL_PANE_ID, "the split pane stays first");
  assert.equal(layout.second.id, "p1", "the new pane lands second");
  assert.equal(countTerminalPanes(layout), 2);
  assert.equal(fresh.kind, "pane", "the source layout is not mutated");
}

// ── Labels are derived from reading order, not creation order ─────────────────
{
  const next = idFactory();
  const a = splitTerminalPane(fresh, PRIMARY_TERMINAL_PANE_ID, "horizontal", next).layout;
  const b = splitTerminalPane(a, "p1", "vertical", next).layout;
  assert.deepEqual(
    listTerminalPanes(b).map((pane) => [pane.id, pane.label]),
    [
      [PRIMARY_TERMINAL_PANE_ID, "Terminal 1"],
      ["p1", "Terminal 2"],
      ["p2", "Terminal 3"],
    ],
  );
  // Close the middle one: the survivor renumbers rather than leaving a gap.
  const closed = closeTerminalPane(b, "p1");
  assert.equal(closed.closed, true);
  assert.deepEqual(
    listTerminalPanes(closed.layout).map((pane) => [pane.id, pane.label]),
    [
      [PRIMARY_TERMINAL_PANE_ID, "Terminal 1"],
      ["p2", "Terminal 2"],
    ],
  );
  assert.equal(closed.nextFocusPaneId, "p2", "focus lands on the surviving sibling");
}

// ── The four-leaf cap ─────────────────────────────────────────────────────────
{
  const next = idFactory();
  let layout = fresh;
  for (let i = 0; i < MAX_TERMINAL_PANES - 1; i += 1) {
    const result = splitTerminalPane(layout, listTerminalPanes(layout).at(-1).id, "horizontal", next);
    assert.notEqual(result.createdPaneId, null);
    layout = result.layout;
  }
  assert.equal(countTerminalPanes(layout), MAX_TERMINAL_PANES);
  assert.equal(canSplitTerminalPane(layout), false);
  const overflow = splitTerminalPane(layout, PRIMARY_TERMINAL_PANE_ID, "vertical", next);
  assert.equal(overflow.createdPaneId, null, "the cap refuses a fifth pane");
  assert.equal(overflow.layout, layout, "and returns the layout untouched");
}

// ── Unknown panes are inert ───────────────────────────────────────────────────
{
  const result = splitTerminalPane(fresh, "nope", "horizontal", idFactory());
  assert.equal(result.createdPaneId, null);
  assert.equal(result.layout, fresh);
  const closedUnknown = closeTerminalPane(fresh, "nope");
  assert.equal(closedUnknown.closed, false);
}

// ── The primary pane is never closable ────────────────────────────────────────
{
  const next = idFactory();
  const split = splitTerminalPane(fresh, PRIMARY_TERMINAL_PANE_ID, "horizontal", next).layout;
  const attempt = closeTerminalPane(split, PRIMARY_TERMINAL_PANE_ID);
  assert.equal(attempt.closed, false, "closing the primary would orphan the session's rail shell");
  assert.equal(attempt.layout, split);
  // A single-pane layout has nothing to collapse onto either.
  assert.equal(closeTerminalPane(fresh, PRIMARY_TERMINAL_PANE_ID).closed, false);
}

// ── Closing collapses nested parents, not just the top split ──────────────────
{
  const next = idFactory();
  const a = splitTerminalPane(fresh, PRIMARY_TERMINAL_PANE_ID, "horizontal", next).layout;
  const b = splitTerminalPane(a, "p1", "vertical", next).layout;
  const closed = closeTerminalPane(b, "p2");
  assert.equal(closed.layout.kind, "split");
  assert.equal(closed.layout.second.kind, "pane", "the nested split collapsed onto its survivor");
  assert.equal(closed.layout.second.id, "p1");
  assert.equal(closed.nextFocusPaneId, "p1");
}

// ── PTY thread ids ────────────────────────────────────────────────────────────
assert.equal(
  terminalPaneThreadId("s1", PRIMARY_TERMINAL_PANE_ID),
  "cave.rail.s1",
  "the primary reuses the session's rail shell so Chat and the Room share it",
);
assert.equal(terminalPaneThreadId("s1", "p1"), "cave.code.s1.p1");
assert.notEqual(
  terminalPaneThreadId("s1", "p1"),
  terminalPaneThreadId("s2", "p1"),
  "two sessions' second panes must not collide",
);

// ── Broadcast excludes the source pane ────────────────────────────────────────
{
  const next = idFactory();
  const a = splitTerminalPane(fresh, PRIMARY_TERMINAL_PANE_ID, "horizontal", next).layout;
  const b = splitTerminalPane(a, "p1", "vertical", next).layout;
  assert.deepEqual(terminalBroadcastTargets(b, "p1"), [PRIMARY_TERMINAL_PANE_ID, "p2"]);
  assert.deepEqual(terminalBroadcastTargets(fresh, PRIMARY_TERMINAL_PANE_ID), [], "nothing to broadcast to alone");
}

// ── Focus resolution survives a stale id ──────────────────────────────────────
{
  const next = idFactory();
  const split = splitTerminalPane(fresh, PRIMARY_TERMINAL_PANE_ID, "horizontal", next).layout;
  assert.equal(resolveFocusedPane(split, "p1"), "p1");
  assert.equal(resolveFocusedPane(split, "gone"), PRIMARY_TERMINAL_PANE_ID);
  assert.equal(resolveFocusedPane(split, null), PRIMARY_TERMINAL_PANE_ID);
}

console.log("code-terminal-tree.test.ts ok");
