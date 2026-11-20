import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../apps/ios/CovenCave/CovenCave/", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

test("the iOS shell mounts chat without an ambient project gate or remount", () => {
  const source = read("Views/RootView.swift");
  assert.ok(!source.includes("ProjectContextGateView()"), "project access must not hide readable chats or settings");
  assert.ok(!source.includes(".id(app.projectContext"), "a project refresh must not destroy the conversation");
  assert.ok(!source.includes("TasksView()"), "Tasks is not an iOS destination");
  assert.ok(!source.includes("GlobalSearchView("), "search must stay inside chat");
});

test("the drawer contains chat navigation without global workspace controls", () => {
  const source = read("Views/NavigationDrawer.swift");
  for (const retired of ["ProjectContextButton", "openProjectSwitcher", "openFamiliars", 'label: "Tasks"', 'sectionLabel("Workspace")']) {
    assert.ok(!source.includes(retired), `${retired} must not return to the chat-only drawer`);
  }
  assert.ok(source.includes('accessibilityLabel("Search chats")'));
});

test("Chats lists global conversations without scanning transcripts to organize rows", () => {
  const source = read("Views/ChatsHomeView.swift");
  assert.ok(source.includes("chatListSnapshotCache.resolve("), "the home must use one shared conversation projection");
  assert.ok(!source.includes("handleProjectContextChange"), "unrelated access changes must not reset selection");
  assert.ok(!source.includes("app.projectFamiliars"), "the conversation list must not be globally project-filtered");
  assert.ok(source.includes("setThreadArchived"), "archived history must remain reachable");
  assert.ok(source.includes("setThreadPinned"), "conversation pinning must remain available");
});

test("settings stays focused on chat configuration rather than a content hub", () => {
  const source = read("Views/SettingsView.swift");
  assert.ok(!source.includes("communitySection"), "promotional navigation is outside the chat-only settings surface");
  for (const retained of ["PermissionsView()", "securitySection", "chatsSection", "appearanceSection", "ConnectionSettingsView()"]) {
    assert.ok(source.includes(retained), `${retained} must remain reachable`);
  }
});

test("the largest type sizes keep conversation titles and counts readable", () => {
  const home = read("Views/ChatsHomeView.swift");
  const rows = read("Views/FamiliarThreadsView.swift");
  assert.match(home, /if dynamicTypeSize\.isAccessibilitySize \|\| sizeClass == \.regular,\s*let detail = visibleConversationLabel/,
    "the count must have its own full-width line instead of a truncated header badge");
  assert.match(home, /\.lineLimit\(dynamicTypeSize\.isAccessibilitySize \? 2 : 1\)/);
  assert.match(rows, /\.lineLimit\(dynamicTypeSize\.isAccessibilitySize \? 2 : 1\)/,
    "server-only chat titles must also wrap at accessibility sizes");
  assert.match(home, /isSelected \? chrome\.accentForeground : chrome\.textPrimary/,
    "selected iPad rows use the accent's contrasting foreground");
  assert.match(home, /private func filterRow[\s\S]*?ScrollView\(\.horizontal, showsIndicators: false\)[\s\S]*?HStack\(spacing: 8\)/,
    "status, project and familiar menus share one scrolling filter row at every text size");
  assert.match(home, /projectFilterMenu\(choices\)/);
  assert.match(home, /familiarFilterPicker\(snapshot\)/);

  assert.match(home, /if dynamicTypeSize\.isAccessibilitySize \{[^}]*?\n\s*ViewThatFits\(in: \.horizontal\) \{\s*HStack\(spacing: 12\) \{\s*navigationButton\s*accessibilityTitle\(oneLine: true\)\s*\.fixedSize\(\)/,
    "at accessibility sizes the header title stays inline only where it fits, else drops to its own line instead of wrapping mid-word");
  assert.match(home, /VStack\(alignment: \.leading, spacing: 8\) \{\s*HStack\(spacing: 12\) \{\s*navigationButton\s*Spacer\(minLength: 0\)\s*\}\s*accessibilityTitle\(oneLine: false\)/,
    "the fallback keeps navigation reachable with the title underneath");
  assert.doesNotMatch(home, /minimumScaleFactor/, "the header never shrinks the reader's chosen text size");
});

test("the native guide describes chat-only navigation without weakening pairing", () => {
  const guide = readFileSync(new URL("../apps/ios/CovenCave/README.md", import.meta.url), "utf8");
  assert.match(guide, /native, chat-only SwiftUI client/);
  assert.match(guide, /no Tasks, Projects, Automations/);
  assert.match(guide, /global project filter/);
  assert.match(guide, /paired Cave access credential/);
  assert.match(guide, /sending requires current grants/);
  assert.doesNotMatch(guide, /no token, no password|gate relaxed|serve the mobile API tokenlessly/);
});

test("conversation identity and compact search navigation are explicit", () => {
  const home = read("Views/ChatsHomeView.swift");
  const mounts = [...home.matchAll(/ChatView\(thread: thread\)/g)];
  assert.ok(mounts.length > 0);
  for (const mount of mounts) {
    assert.match(home.slice(mount.index, mount.index + 100), /ChatView\(thread: thread\)\s*\.id\(thread\.id\)/,
      "switching conversations must recreate only that conversation's draft and attachment state");
  }
  assert.match(home, /NavigationSplitView\(preferredCompactColumn: \$preferredCompactColumn\)/);
  assert.match(home, /private func revealChatSearch\(\) \{\s*if sizeClass == \.compact \{\s*detailPath = \[\]\s*selection = nil\s*preferredCompactColumn = \.sidebar[\s\S]*searchFocused = true/,
    "drawer search clears only compact selection to reveal the sidebar before focusing its field");
  assert.match(home, /private func consumeThreadRequest\([\s\S]*?preferredCompactColumn = \.detail\s*app\.threadToOpen = nil/,
    "an explicit open must reveal even the already-selected conversation after search");
});

test("shared presentation navigation respects dismissal, parent guards and modal accessibility", () => {
  const navigation = read("Views/NavigationDrawer.swift");
  assert.match(navigation, /environment\(\\\.caveNavigationRoute, performNavigation\)/,
    "the root rechecks route admission after top-level presentation dismissal");
  assert.match(navigation, /let availableWidth = geometry\.size\.width \+ geometry\.safeAreaInsets\.leading \+ geometry\.safeAreaInsets\.trailing/,
    "keyboard height never decides whether compact portrait uses a rail");
  assert.match(navigation, /private func performNavigation[\s\S]*?guard canNavigate else \{ return \}/,
    "route admission rechecks the current exit guard beyond disabled buttons");
  assert.match(navigation, /private func guardedRoute[\s\S]*?guard inheritedNavigationAllowed && !exitBlocked else \{ return \}/,
    "a child dismissal cannot bypass a parent form's protected operation");
  assert.match(navigation, /\.onAppear \{ presentationVisible = true \}/,
    "only an actually presented view latches chrome through its dismissal animation");
  assert.doesNotMatch(navigation, /onChange\(of: (?:isPresented|item\?\.id)/,
    "a cancelled unpresented request must not leave chrome latched off");
  assert.match(navigation, /private func finishDismissal\(\)[\s\S]*?onDismiss\?\(\)[\s\S]*?parentRoute\(navigation\)/,
    "existing dismissal cleanup runs before a nested root navigation request");
  assert.match(navigation, /Color\.clear\.preference\(key: CaveNavigationPresentationActiveKey\.self, value: isPresented \|\| presentationVisible\)/,
    "boolean presentations emit a concrete child-presentation preference");
  assert.match(navigation, /Color\.clear\.preference\(key: CaveNavigationPresentationActiveKey\.self, value: item != nil \|\| presentationVisible\)/,
    "item presentations emit a concrete child-presentation preference");
  assert.match(navigation, /accessibilityHidden\(app\.navigationDrawerOpen \|\| presentedChild\)/,
    "only the active presentation exposes its navigation rail");
  for (const [file, guard] of [
    ["NewChatView", "isLaunching"], ["ScheduledChatSheet", "saving"],
    ["PermissionsView", "!busyKeys.isEmpty"], ["Voice/LiveVoiceCallView", "!model.state.phase.isTerminal"],
  ]) {
    assert.ok(read(`Views/${file}.swift`).includes(`.caveNavigationExitBlocked(${guard})`),
      `${file} preserves its protected operation through rail navigation`);
  }
});
