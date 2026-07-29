import assert from "node:assert/strict";
import {
  closeTerminalPane,
  createTerminalLayout,
  splitTerminalPane,
  terminalPaneCount,
  terminalPaneIds,
  terminalThreadId,
} from "./code-terminal-layout.ts";

const initial = createTerminalLayout();
assert.deepEqual(terminalPaneIds(initial.root), ["terminal-1"], "the workspace starts with one primary terminal");
assert.equal(terminalThreadId("session-a", "terminal-1"), "cave.rail.session-a", "the primary terminal reuses Chat's PTY");

const splitRight = splitTerminalPane(initial, "terminal-1", "horizontal");
assert.equal(splitRight.root.kind, "split");
assert.equal(splitRight.root.kind === "split" ? splitRight.root.direction : null, "horizontal");
assert.deepEqual(terminalPaneIds(splitRight.root), ["terminal-1", "terminal-2"], "split right adds a sibling after the focused pane");
assert.equal(terminalThreadId("session-a", "terminal-2"), "cave.code.session-a.terminal-2");

const splitDown = splitTerminalPane(splitRight, "terminal-2", "vertical");
assert.equal(terminalPaneCount(splitDown.root), 3);
assert.deepEqual(
  terminalPaneIds(splitDown.root),
  ["terminal-1", "terminal-2", "terminal-3"],
  "nested split order stays stable for keyboard focus traversal",
);

const four = splitTerminalPane(splitDown, "terminal-1", "vertical");
assert.equal(terminalPaneCount(four.root), 4);
assert.strictEqual(
  splitTerminalPane(four, "terminal-4", "horizontal"),
  four,
  "the fifth split is rejected without replacing the current layout",
);

const closedNested = closeTerminalPane(splitDown, "terminal-2");
assert.deepEqual(
  terminalPaneIds(closedNested.root),
  ["terminal-1", "terminal-3"],
  "closing a nested pane collapses its parent to the surviving sibling",
);
const splitAfterClose = splitTerminalPane(closedNested, "terminal-3", "horizontal");
assert.deepEqual(
  terminalPaneIds(splitAfterClose.root),
  ["terminal-1", "terminal-3", "terminal-4"],
  "new panes never reuse a closed pane's PTY identity",
);
assert.strictEqual(
  closeTerminalPane(initial, "terminal-1"),
  initial,
  "the last terminal cannot be closed",
);

console.log("code-terminal-layout.test.ts: ok");
