import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// On iPad the Chats tab should be a two-column NavigationSplitView: the home list
// (familiars + groups + search results) in the sidebar, and the selected
// familiar's threads / a conversation in the detail column. NavigationSplitView
// collapses to a single stack on iPhone, so the familiars→threads→chat drill is
// unchanged there. This locks the conversion.

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");
const src = await read("apps/ios/CovenCave/CovenCave/Views/ChatsHomeView.swift");

assert.match(
  src,
  /NavigationSplitView \{[\s\S]*\} detail: \{[\s\S]*detailColumn/,
  "ChatsHomeView should use NavigationSplitView with a detail column",
);
assert.doesNotMatch(
  src,
  /NavigationStack\(path: \$path\)/,
  "the old shared-path NavigationStack should be gone from the home view",
);
// Sidebar selection (familiar or thread) + a separate detail navigation path.
assert.match(src, /@State private var selection: ChatRoute\?/, "should track a sidebar selection");
assert.match(src, /@State private var detailPath: \[ChatRoute\] = \[\]/, "should track detail-column navigation");
assert.match(src, /List\(selection: \$selection\)/, "the home list should be selection-driven");
assert.match(src, /\.tag\(ChatRoute\.familiar\(familiar\)\)/, "familiar rows should be tagged for selection");
assert.match(src, /\.tag\(ChatRoute\.thread\(thread\)\)/, "thread/group rows should be tagged for selection");

// Detail column: familiar → its thread list (pushing onto detailPath), a thread →
// the chat, nothing → a placeholder.
assert.match(
  src,
  /private var detailColumn: some View \{[\s\S]*NavigationStack\(path: \$detailPath\)/,
  "the detail column should own a NavigationStack on detailPath",
);
assert.match(
  src,
  /case \.familiar\(let familiar\):\s*\n\s*FamiliarThreadsView\(familiar: familiar, path: \$detailPath\)/,
  "selecting a familiar should show its threads in the detail column",
);
assert.match(
  src,
  /case nil:\s*\n\s*ContentUnavailableView/,
  "an unselected detail column should show a placeholder",
);
// New selection resets the detail navigation.
assert.match(
  src,
  /\.onChange\(of: selection\) \{ _, _ in detailPath = \[\] \}/,
  "changing the sidebar selection should reset the detail navigation",
);
// Balanced style keeps the list visible on iPad.
assert.match(src, /\.navigationSplitViewStyle\(\.balanced\)/, "should use the balanced split style");

console.log("ios-ipad-split-chats: OK");
