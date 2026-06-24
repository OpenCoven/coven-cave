import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// On iPad the Developer → GitHub view should be a two-column NavigationSplitView
// (PR/issue list + detail) rather than the iPhone single-column push. It collapses
// to a stack on iPhone, so the list→detail behaviour there is unchanged. External
// (numberless) notification rows stay plain Links; only numbered PRs/issues are
// selection-driven into the detail column.

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");
const src = await read("apps/ios/CovenCave/CovenCave/Views/GitHubView.swift");

assert.match(
  src,
  /NavigationSplitView \{[\s\S]*\} detail: \{/,
  "GitHubView should use NavigationSplitView with a detail column",
);
assert.doesNotMatch(
  src,
  /NavigationStack \{[\s\S]*navigationDestination\(for: GitHubItem\.self\)/,
  "the old push-based NavigationStack + navigationDestination should be gone",
);
assert.match(src, /@State private var selection: GitHubItem\?/, "should track the selected item");
assert.match(src, /List\(selection: \$selection\)/, "the list should be selection-driven");
// Numbered PRs/issues become selectable rows; the external-Link branch stays.
assert.match(
  src,
  /if item\.number != nil \{\s*\n\s*GitHubItemRow\(item: item\)\.tag\(item\)/,
  "numbered items should be selection-tagged rows",
);
assert.match(src, /Link\(destination: url\)/, "numberless items should remain external Links");
// Detail shows the selected item, or a placeholder on iPad when none is picked.
assert.match(
  src,
  /\} detail: \{[\s\S]*GitHubItemDetailView\(item: selection\)[\s\S]*ContentUnavailableView/,
  "the detail column should show the selected item or a placeholder",
);
assert.match(src, /\.navigationSplitViewStyle\(\.balanced\)/, "should use the balanced split style");

console.log("ios-ipad-split-github: OK");
