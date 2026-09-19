// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (name) => readFileSync(new URL(name, import.meta.url), "utf8");
const workspace = read("./workspace.tsx");
const surface = read("./chat-surface.tsx");
const router = read("./chat-router.tsx");
const sidebar = read("./workspace-sidebar.tsx");
assert.match(workspace, /selection: selectedWorkspaceProjectId \?\? "all"/);
assert.match(workspace, /ready: workspaceContextHydrated &&/);
assert.match(workspace, /<ChatSurface[\s\S]*?browseScope=\{chatBrowseScope\}/);
assert.match(workspace, /composeProjectRoot=\{selectedWorkspaceProject\?\.root \?\? null\}/);
assert.match(surface, /<SidebarChatsSection[\s\S]*?sessions=\{browseSessions\}/);
assert.match(surface, /<ChatThreadsSheet[\s\S]*?sessions=\{browseSessions\}/,
  "mobile threads are project-scoped before the sheet receives them");
assert.match(surface, /<ChatRouter[\s\S]*?sessions=\{sessions\}[\s\S]*?browseScope=\{effectiveBrowseScope\}/,
  "Router retains full session identity while browse context is separate");
assert.match(surface, /<ChatRouter[\s\S]*?composeProjectRoot=\{composeProjectRoot\}/);
assert.match(router, /view\.sessionId === null && !view\.started\s*\? blankChatProjectRoot[\s\S]*?: view\.projectRoot/,
  "the workspace root only updates a sessionless compose");
const chatList = read("./chat-list.tsx");
assert.match(router, /<ChatList[\s\S]*?browseScope=\{browseScope\}/);
assert.match(chatList, /return scopeChatBrowseSessions\(visible, projects, projectOverrides, browseScope\)/,
  "independently fetched archived rows pass the same exact browse filter");
assert.match(chatList, /browseScope \? "all" : normalizeSelection/,
  "already filtered global scopes are not widened by mobile or stale local selection");
assert.match(router, /const activeSession = retainOpenChatSession\(retainedSessionRef\.current, sessions, activeSessionId\)/);
assert.match(router, /if \(browseScope !== undefined\) return;\s*const nextFamiliarId/,
  "async familiar hydration and restored project crew cannot navigate a workspace chat");
assert.match(router, /key=\{`chat-compose-\$\{composerDraftKey\}-\$\{composeInstance\}`\}/,
  "project browse changes are not part of ChatView's mount identity");
const paletteSwitch = workspace.slice(workspace.indexOf('if (intent.kind === "switch-familiar")'), workspace.indexOf('if (intent.kind === "open-session")'));
assert.match(paletteSwitch, /selectFamiliarScope\(intent\.familiarId\)/);
assert.doesNotMatch(paletteSwitch, /showFamiliarChatList|goToList/);
assert.match(workspace, /!opts\?\.multi && !opts\?\.preserveSurface[\s\S]*?routerRef\.current\?\.newChat\(undefined, undefined, id\)/);
assert.match(surface, /onSelectFamiliar=\{\(id\) => \{\s*if \(id\) onFamiliarScopeChange\(id\)/,
  "header and command palette use the same explicit-switch path");
assert.match(surface, /const onFamiliarSelect =[\s\S]*?routerRef\.current\?\.newChat\(undefined, undefined, d\.familiarId\)/,
  "inline familiar Switch also opens a blank compose, not the list");
assert.match(sidebar, /if \(selectMode\) return;\s*cancelHoverPrefetch\(\);\s*void prefetchConversation\(sessionId\)/);
assert.match(sidebar, /if \(!selectMode\) hoverPrefetchConversation\(sessionId\)/);
assert.match(sidebar, /onPointerLeave: cancelHoverPrefetch,[\s\S]*?onPointerDown: prefetch,[\s\S]*?onFocus: prefetch,[\s\S]*?onBlur: cancelHoverPrefetch/);
assert.match(sidebar, /if \(selectMode\) cancelHoverPrefetch\(\);\s*return cancelHoverPrefetch;/,
  "selection transitions and unmount cancel pending hover intent");
assert.equal((sidebar.match(/\{\.\.\.prefetchHandlers\}/g) ?? []).length, 2,
  "both actual thread buttons, including pinned rows, receive prefetch handlers");
assert.match(sidebar, /if \(selectMode\) return;\s*if \(e\.key === "Enter" && e\.altKey && onOpenInSplit\)/,
  "keyboard split navigation remains unchanged outside select mode");
console.log("chat-context-navigation.test.ts: ok");
