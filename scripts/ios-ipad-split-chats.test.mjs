import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// On iPad the Chats tab should be a two-column NavigationSplitView: the home list
// of conversations in the sidebar, and the selected conversation in the
// detail column. NavigationSplitView collapses to a single stack on iPhone, so
// list-to-chat drill stays native there.

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");
const src = await read("apps/ios/CovenCave/CovenCave/Views/ChatsHomeView.swift");

assert.match(
  src,
  /NavigationSplitView\(preferredCompactColumn: \$preferredCompactColumn\) \{[\s\S]*\} detail: \{[\s\S]*detailColumn/,
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
// A tapped familiar row drives selection through its List tag; programmatic
// opens (deep links, the new-chat sheet, the launch intent) go through open(_:),
// which clears the detail navigation before selecting.
assert.match(
  src,
  /private func open\(_ route: ChatRoute\) \{\s*\n\s*detailPath = \[\]\s*\n\s*selection = route/,
  "programmatic opens should drive the selection",
);
assert.match(src, /\.tag\(ChatRoute\.thread\(thread\)\)/, "conversation rows should be tagged for selection");

// Detail column: familiar → its chat (its other sessions are reachable from
// ChatView's config card, which pushes onto detailPath), a thread → the chat,
// nothing → a placeholder.
assert.match(
  src,
  /private var detailColumn: some View \{[\s\S]*NavigationStack\(path: \$detailPath\)/,
  "the detail column should own a NavigationStack on detailPath",
);
assert.match(
  src,
  /case \.familiar\(let familiar\):\s*\n\s*familiarChat\(familiar\)/,
  "selecting a familiar should show its chat in the detail column",
);
assert.match(
  src,
  /case nil:\s*\n\s*ContentUnavailableView/,
  "an unselected detail column should show a placeholder",
);
// New selection resets the detail navigation.
assert.match(
  src,
  /\.onChange\(of: selection\) \{ _, selected in\s*detailPath = \[\]\s*preferredCompactColumn = selected == nil \? \.sidebar : \.detail/,
  "changing the sidebar selection should reset the detail navigation",
);
// Balanced style keeps the list visible on iPad.
assert.match(src, /\.navigationSplitViewStyle\(\.balanced\)/, "should use the balanced split style");

// cave-bgmg: wide-but-compact windows (non-Max iPhone landscape) promote to a
// regular size class so the splits engage instead of one sparse full-width
// column. #6193: narrower windows the system calls regular (iPhone Duo's inner
// display upright, 669pt) are demoted to compact so they stack instead of
// floating the list over an empty detail; compact windows stay as they are.
const appRoot = await read("apps/ios/CovenCave/CovenCave/CovenCaveApp.swift");
assert.match(appRoot, /struct WideSplitEnabler<Content: View>: View/, "the app root defines the wide-window size-class promoter");
assert.match(
  appRoot,
  /SplitWidth\.sizeClass\(forWidth: geo\.size\.width, inherited: inherited\)/,
  "the promoter sizes the class from the window width",
);
assert.match(appRoot, /static let minimum: CGFloat = 700/, "two real columns need 700pt");
assert.match(appRoot, /if width >= minimum \{ return \.regular \}/, "≥700pt promotes to regular");
assert.match(
  appRoot,
  /return inherited == \.regular \? \.compact : inherited/,
  "narrower regular windows stack; narrower compact windows keep the inherited class",
);
assert.match(
  appRoot,
  /WideSplitEnabler \{[\s\S]*ZStack \{[\s\S]*RootView\(\)/,
  "the lock/privacy root still keeps RootView inside the promoter so every tab's split engages",
);

console.log("ios-ipad-split-chats: OK");
