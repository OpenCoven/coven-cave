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
  assert.ok(source.includes("ChatListSnapshot("), "the home must use one shared conversation projection");
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
