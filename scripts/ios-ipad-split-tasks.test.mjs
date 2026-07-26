import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// On iPad the Tasks tab should be a two-column NavigationSplitView (list + detail)
// rather than the iPhone single-column stack. NavigationSplitView collapses to a
// stack automatically on compact width, so iPhone is unchanged. This locks the
// conversion: a split view driven by a `selection`, with a detail column and a
// placeholder when nothing is selected.

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");
const src = await read("apps/ios/CovenCave/CovenCave/Views/TasksView.swift");

assert.match(
  src,
  /NavigationSplitView \{[\s\S]*\} detail: \{/,
  "TasksView should use NavigationSplitView with a detail column",
);
assert.doesNotMatch(
  src,
  /NavigationStack\(path: \$path\)/,
  "the old path-based NavigationStack should be gone",
);
// Selection drives the detail (and the collapsed-stack push on iPhone).
assert.match(
  src,
  /@State private var selection: BoardCard\?/,
  "TasksView should track the selected card",
);
assert.match(
  src,
  /List\(selection: \$selection\)/,
  "the task list should be selection-driven so it adapts across iPad/iPhone",
);
assert.match(
  src,
  /TaskRow\(card: card\)\s*\n\s*\.tag\(card\)/,
  "rows should be tagged with their card for selection",
);
// Detail shows the selected task, or a placeholder on iPad when none is picked.
assert.match(
  src,
  /\} detail: \{[\s\S]*TaskDetailView\(card: selection\)[\s\S]*ContentUnavailableView/,
  "the detail column should show the selected task or a 'Select a task' placeholder",
);
// Keep the list visible beside the detail on iPad.
assert.match(
  src,
  /\.navigationSplitViewStyle\(\.balanced\)/,
  "the split view should use the balanced style so the list stays visible on iPad",
);
// The chat→task deep link now targets the selection, not a nav path.
assert.match(
  src,
  /func openRequestedCard\(\)[\s\S]*selection = card/,
  "opening a task from a chat should set the selection",
);

console.log("ios-ipad-split-tasks: OK");
