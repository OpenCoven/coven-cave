import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  canMoveWorkspaceNavigation,
  createWorkspaceNavigationHistory,
  moveWorkspaceNavigation,
  pushWorkspaceNavigation,
  replaceWorkspaceNavigation,
  restoreWorkspaceNavigation,
} from "./workspace-navigation-history.ts";

let history = createWorkspaceNavigationHistory<string>("home");
history = pushWorkspaceNavigation(history, "board");
history = pushWorkspaceNavigation(history, "inbox");
assert.deepEqual(history, { entries: ["home", "board", "inbox"], index: 2 }, "ordinary workspace destinations are recorded");
assert.equal(canMoveWorkspaceNavigation(history, -1), true, "Back is available away from the first destination");
assert.equal(canMoveWorkspaceNavigation(history, 1), false, "Forward is unavailable at the newest destination");

history = moveWorkspaceNavigation(history, -1);
assert.equal(history.entries[history.index], "board", "Back restores the previous workspace destination");
assert.equal(canMoveWorkspaceNavigation(history, 1), true, "Forward becomes available after Back");

history = pushWorkspaceNavigation(history, "chat");
assert.deepEqual(history, { entries: ["home", "board", "chat"], index: 2 }, "a new navigation truncates the forward stack");
assert.equal(moveWorkspaceNavigation(history, 1), history, "Forward cannot leave the app-owned history boundary");
assert.equal(moveWorkspaceNavigation(createWorkspaceNavigationHistory("home"), -1).index, 0, "Back cannot leave the first app-owned destination");

let tabHistory = createWorkspaceNavigationHistory<string>("home");
tabHistory = pushWorkspaceNavigation(tabHistory, "chat");
tabHistory = pushWorkspaceNavigation(tabHistory, "groupchat");
tabHistory = pushWorkspaceNavigation(tabHistory, "board");
tabHistory = moveWorkspaceNavigation(tabHistory, -1);
assert.equal(tabHistory.entries[tabHistory.index], "groupchat", "Back retains the tab-selection destination instead of only its Chat surface");
tabHistory = moveWorkspaceNavigation(tabHistory, -1);
assert.equal(tabHistory.entries[tabHistory.index], "chat", "Back distinguishes the normal Chat destination from its Group tab");

let chatHistory = createWorkspaceNavigationHistory<string | null>(null);
chatHistory = pushWorkspaceNavigation(chatHistory, "chat-a");
chatHistory = pushWorkspaceNavigation(chatHistory, "chat-b");
chatHistory = moveWorkspaceNavigation(chatHistory, -1);
assert.equal(chatHistory.entries[chatHistory.index], "chat-a", "Back restores the previous chat hash");
assert.equal(canMoveWorkspaceNavigation(chatHistory, 1), true, "Forward remains available after returning to an earlier chat");
chatHistory = restoreWorkspaceNavigation(chatHistory, "chat-b", 1);
assert.equal(chatHistory.entries[chatHistory.index], "chat-b", "Forward restores the later chat hash without pushing another entry");
chatHistory = restoreWorkspaceNavigation(chatHistory, "chat-a", null);
assert.equal(chatHistory.entries[chatHistory.index], "chat-a", "browser Back restores a known chat hash without replaying navigation");
chatHistory = pushWorkspaceNavigation(chatHistory, "chat-c");
assert.deepEqual(chatHistory, { entries: [null, "chat-a", "chat-c"], index: 2 }, "opening a chat after Back truncates its browser-backed forward stack");
let returnToListHistory = createWorkspaceNavigationHistory<string | null>(null);
returnToListHistory = pushWorkspaceNavigation(returnToListHistory, "chat-a");
returnToListHistory = pushWorkspaceNavigation(returnToListHistory, "chat-b");
returnToListHistory = moveWorkspaceNavigation(returnToListHistory, -1);
returnToListHistory = replaceWorkspaceNavigation(returnToListHistory, null);
assert.equal(canMoveWorkspaceNavigation(returnToListHistory, -1), false, "returning to the list does not offer a duplicate Back destination");
assert.equal(canMoveWorkspaceNavigation(returnToListHistory, 1), true, "returning to the list preserves a later chat for Forward");
returnToListHistory = restoreWorkspaceNavigation(returnToListHistory, "chat-b", 1);
assert.equal(returnToListHistory.entries[returnToListHistory.index], "chat-b", "Forward restores the later chat after returning to the list");
let duplicateListHistory = createWorkspaceNavigationHistory<string | null>(null);
duplicateListHistory = pushWorkspaceNavigation(duplicateListHistory, "chat-a");
duplicateListHistory = pushWorkspaceNavigation(duplicateListHistory, "chat-b");
duplicateListHistory = replaceWorkspaceNavigation(moveWorkspaceNavigation(duplicateListHistory, -1), null);
duplicateListHistory = restoreWorkspaceNavigation(duplicateListHistory, null, -1);
assert.equal(moveWorkspaceNavigation(duplicateListHistory, 1).index, 2, "Forward skips an adjacent duplicate chat-list browser entry");
const directChatHistory = createWorkspaceNavigationHistory<string | null>("shared-chat");
assert.equal(canMoveWorkspaceNavigation(directChatHistory, -1), false, "a direct chat deep link has no browser-backed Back destination");

const workspace = readFileSync(new URL("../components/workspace.tsx", import.meta.url), "utf8");
const shell = readFileSync(new URL("../components/shell.tsx", import.meta.url), "utf8");
const chatRouter = readFileSync(new URL("../components/chat-router.tsx", import.meta.url), "utf8");
const chatSurface = readFileSync(new URL("../components/chat-surface.tsx", import.meta.url), "utf8");
assert.match(workspace, /navigateWorkspaceHistory\(-1\)/, "workspace Back uses the app-owned stack");
assert.match(workspace, /commitMode\("chat", "groupchat"\)/, "workspace history retains the Group Chat tab destination");
assert.match(workspace, /commitMode\("grimoire", "journal"\)/, "workspace history retains the Journal tab destination");
assert.match(workspace, /onViewChange=\{selectGrimoireView\}/, "Journal tab selection records the workspace destination");
assert.match(chatSurface, /mode: "groupchat"/, "the Group tab records its workspace navigation destination");
assert.match(workspace, /pendingChatNavigationDirectionRef/, "workspace restores chat hashes without replaying a push on popstate");
assert.match(workspace, /restoreWorkspaceNavigation\(currentChatHistory, chatEntry, expectedDirection\)/, "browser popstate restores the matching chat entry");
assert.match(workspace, /chatHashRestoredForCurrentModeRef/, "workspace Back to Chat restores its addressable chat hash after remounting");
assert.match(workspace, /suppressInitialChatHistoryPushRef/, "a direct chat deep link stays within app-owned history");
assert.match(workspace, /cave:chat-history-replace/, "workspace tracks a list replace without leaving stale chat controls");
assert.match(chatRouter, /cave:chat-history-push/, "opening a chat records browser-backed chat history");
assert.match(chatRouter, /cave:chat-history-replace/, "returning to the chat list updates browser-backed chat history");
assert.match(shell, /disabled=\{!historyNavigation\?\.canGoBack\}/, "Back disables at the app-history boundary");
assert.match(shell, /disabled=\{!historyNavigation\?\.canGoForward\}/, "Forward disables at the app-history boundary");
