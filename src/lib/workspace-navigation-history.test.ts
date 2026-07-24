import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  canMoveWorkspaceNavigation,
  createWorkspaceNavigationHistory,
  moveWorkspaceNavigation,
  pushWorkspaceNavigation,
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
const directChatHistory = createWorkspaceNavigationHistory<string | null>("shared-chat");
assert.equal(canMoveWorkspaceNavigation(directChatHistory, -1), false, "a direct chat deep link has no browser-backed Back destination");

const workspace = readFileSync(new URL("../components/workspace.tsx", import.meta.url), "utf8");
const shell = readFileSync(new URL("../components/shell.tsx", import.meta.url), "utf8");
const chatRouter = readFileSync(new URL("../components/chat-router.tsx", import.meta.url), "utf8");
assert.match(workspace, /navigateWorkspaceHistory\(-1\)/, "workspace Back uses the app-owned stack");
assert.match(workspace, /pendingChatNavigationDirectionRef/, "workspace restores chat hashes without replaying a push on popstate");
assert.match(workspace, /restoreWorkspaceNavigation\(currentChatHistory, chatEntry, expectedDirection\)/, "browser popstate restores the matching chat entry");
assert.match(workspace, /suppressInitialChatHistoryPushRef/, "a direct chat deep link stays within app-owned history");
assert.match(chatRouter, /cave:chat-history-push/, "opening a chat records browser-backed chat history");
assert.match(shell, /disabled=\{!historyNavigation\?\.canGoBack\}/, "Back disables at the app-history boundary");
assert.match(shell, /disabled=\{!historyNavigation\?\.canGoForward\}/, "Forward disables at the app-history boundary");
