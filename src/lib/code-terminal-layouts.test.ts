// @ts-nocheck
import assert from "node:assert/strict";

const tree = await import("./code-terminal-tree.ts");
const { readTerminalLayout, writeTerminalLayout, terminalStarted, markTerminalStarted } = await import("./code-terminal-layouts.ts");
const { createTerminalLayout, splitTerminalPane, isTerminalLayoutNode, PRIMARY_TERMINAL_PANE_ID, MAX_TERMINAL_PANES } = tree;

const memoryStorage = () => {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    map,
  };
};

// New pane ids carry a per-load prefix (#5745): a reload's first split can
// never reuse the previous load's `pane-1` and adopt its orphaned shell.
{
  const { layout, createdPaneId } = splitTerminalPane(createTerminalLayout(), PRIMARY_TERMINAL_PANE_ID, "horizontal");
  assert.match(createdPaneId, /^pane-[a-z0-9]+-\d+$/);
  assert.notEqual(createdPaneId, "pane-1");
  assert.ok(isTerminalLayoutNode(layout));
}

// The validator accepts what the tree builds and refuses anything else.
{
  assert.ok(isTerminalLayoutNode(createTerminalLayout()));
  assert.equal(isTerminalLayoutNode(null), false);
  assert.equal(isTerminalLayoutNode({ kind: "pane", id: "pane-x" }), false, "the primary pane is required");
  assert.equal(isTerminalLayoutNode({ kind: "split", id: "s", direction: "diagonal", first: { kind: "pane", id: "primary" }, second: { kind: "pane", id: "b" } }), false);
  assert.equal(isTerminalLayoutNode({ kind: "split", id: "s", direction: "horizontal", first: { kind: "pane", id: "primary" }, second: { kind: "pane", id: "primary" } }), false, "duplicate pane ids");
  let big = createTerminalLayout();
  for (let i = 0; i < MAX_TERMINAL_PANES - 1; i += 1) big = splitTerminalPane(big, PRIMARY_TERMINAL_PANE_ID, "vertical", () => `extra-${i}`).layout;
  assert.ok(isTerminalLayoutNode(big), "the cap itself is fine");
  const over = { kind: "split", id: "over", direction: "horizontal", first: big, second: { kind: "pane", id: "one-too-many" } };
  assert.equal(isTerminalLayoutNode(over), false, "over the pane cap");
}

// A session's layout survives the drawer: written on change, read on mount.
{
  const storage = memoryStorage();
  const { layout, createdPaneId } = splitTerminalPane(createTerminalLayout(), PRIMARY_TERMINAL_PANE_ID, "horizontal");
  writeTerminalLayout("s-1", { layout, focusedPaneId: createdPaneId }, storage);
  const back = readTerminalLayout("s-1", storage);
  assert.deepEqual(back.layout, layout);
  assert.equal(back.focusedPaneId, createdPaneId);
  // Another session starts fresh.
  assert.deepEqual(readTerminalLayout("s-2", storage).layout, createTerminalLayout());
}

// A reload reads sessionStorage, validated; a single pane is not stored.
{
  const storage = memoryStorage();
  const { layout } = splitTerminalPane(createTerminalLayout(), PRIMARY_TERMINAL_PANE_ID, "vertical", () => "pane-kept");
  storage.setItem("cave.code.terminal-layout.reloaded", JSON.stringify({ layout, focusedPaneId: "gone" }));
  const restored = readTerminalLayout("reloaded", storage);
  assert.deepEqual(restored.layout, layout);
  assert.equal(restored.focusedPaneId, PRIMARY_TERMINAL_PANE_ID, "a missing focus falls back to a real pane");
  storage.setItem("cave.code.terminal-layout.broken", "{not json");
  assert.deepEqual(readTerminalLayout("broken", storage).layout, createTerminalLayout());
  writeTerminalLayout("single", { layout: createTerminalLayout(), focusedPaneId: PRIMARY_TERMINAL_PANE_ID }, storage);
  assert.equal(storage.getItem("cave.code.terminal-layout.single"), null);
}

// A session's shell starts on the drawer's first open, not on the visit (#5756).
assert.equal(terminalStarted("visited"), false);
markTerminalStarted("visited");
assert.equal(terminalStarted("visited"), true);
assert.equal(terminalStarted("another"), false, "per session");

console.log("code-terminal-layouts: ok");
