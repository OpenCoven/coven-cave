// @ts-nocheck
// First-fetch loading skeletons: surfaces must not flash their empty states
// while the initial data fetch is still in flight.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

const inbox = read("./automations-view.tsx");
assert.match(
  inbox,
  /initialLoadDone[\s\S]*?finally \{\s*(?:if \((?:mountedRef\.current|live\(\))\) )?setInitialLoadDone\(true\);/,
  "Inbox/automations tracks first-fetch settlement (success or failure)",
);
assert.match(
  inbox,
  // The Calendar tab branch may precede this (calendarSlot is rendered first),
  // so the skeleton ternary need not be the very first child of the list box.
  /!initialLoadDone \? \([\s\S]*?ui-skeleton[\s\S]*?\) : activeTab === "crons" && automationsEmpty \? \(/,
  "Schedules shows a shimmer skeleton before first load, ahead of the Crons empty state",
);

const chatList = read("./chat-list.tsx");
assert.match(
  chatList,
  /sessionsLoaded = true/,
  "ChatList defaults sessionsLoaded true so other callers keep current behavior",
);
assert.match(
  chatList,
  /\{!sessionsLoaded && !hasAny \? \([\s\S]*?ui-skeleton[\s\S]*?\) : !hasAny \? \(/,
  "ChatList shows shimmer skeleton rows instead of flashing the no-chats empty state on boot",
);

const workspace = read("./workspace.tsx");
assert.match(
  workspace,
  /const \[sessionsLoaded, setSessionsLoaded\] = useState\(false\)/,
  "Workspace flips sessionsLoaded after the first /api/sessions/list fetch settles",
);
// The session list is scoped to the active familiar and reloads on every scope
// change, so loadSessions is sequence-guarded by a monotonic request id: a stale
// in-flight load must not paint the previous familiar's sessions (cave-jibj).
assert.match(
  workspace,
  /const loadSessionsReqRef = useRef\(0\)/,
  "Workspace sequence-guards session-list loads with a request id",
);
assert.match(
  workspace,
  /const reqId = \+\+loadSessionsReqRef\.current;/,
  "each session-list load bumps the request id",
);
assert.match(
  workspace,
  /if \(!isCurrent\(\)\) return; \/\/ superseded/,
  "a superseded (scope-changed) session-list load drops its writes",
);
assert.doesNotMatch(
  workspace,
  /Promise\.allSettled\(\[[\s\S]{0,600}\/api\/sessions\/list[\s\S]{0,600}\/api\/github\/tasks/,
  "Workspace does not block the first visible chat sessions on optional GitHub task enrichment",
);
assert.match(
  workspace,
  /setSessions\([\s\S]{0,120}baseSessions[\s\S]{0,40}\);[\s\S]{0,260}setSessionsLoaded\(true\);[\s\S]{0,600}githubTasksPromise/,
  "Workspace renders base chat sessions before applying optional GitHub task context",
);
assert.match(
  workspace,
  /sessionsLoaded=\{sessionsLoaded\}/,
  "Workspace threads sessionsLoaded into ChatSurface",
);

const surface = read("./chat-surface.tsx");
assert.match(surface, /sessionsLoaded=\{sessionsLoaded\}/, "ChatSurface threads sessionsLoaded into ChatRouter");

const router = read("./chat-router.tsx");
assert.match(router, /sessionsLoaded=\{sessionsLoaded\}/, "ChatRouter threads sessionsLoaded into ChatList");

const settings = read("./settings-shell.tsx");
assert.doesNotMatch(
  settings,
  />Loading…</,
  "Settings integrations no longer shows a bare Loading… line",
);
assert.doesNotMatch(
  settings,
  /loading \? skeleton\(|const skeleton = [\s\S]{0,160}animate-pulse/,
  "Settings no longer keeps Add-ons skeleton rows after removing the section",
);

const vault = read("./vault-panel.tsx");
assert.doesNotMatch(
  vault,
  />Loading…</,
  "Vault panel no longer shows a bare Loading… line",
);
assert.match(
  vault,
  /\{loading \? \(\s*<SkeletonRows/,
  "Vault panel shows skeleton rows while the first /api/vault fetch is in flight",
);

// More surfaces converted from a bare "Loading…" string to the shared skeleton.
for (const [file, label] of [
  ["./github-view.tsx", "GitHub activity"],
  ["./board-inspector.tsx", "Board inspector linked context"],
  ["./project-tree.tsx", "Project tree"],
  ["./journal/journal-entries.tsx", "Journal entries pane"],
]) {
  const src = read(file);
  assert.doesNotMatch(src, />Loading…</, `${label} no longer shows a bare Loading… line`);
  assert.match(src, /<SkeletonRows/, `${label} shows shared skeleton rows on first load`);
}

// Thread switch must not show the previous thread's messages: ChatView blanks
// the transcript synchronously (skeleton state) while the new thread's history
// fetch is in flight, and only for actual switches — same-session reloads
// (settle refetch / retry) revalidate behind the visible transcript.
const chatView = read("./chat-view.tsx");
assert.match(
  chatView,
  /const isThreadSwitch = currentSessionRef\.current !== sessionId;\s*\n\s*currentSessionRef\.current = sessionId;/,
  "ChatView detects a real thread switch before adopting the new session id",
);
assert.match(
  chatView,
  /if \(isThreadSwitch\) \{[\s\S]{0,600}?setTurns\(\[\]\);\s*\n\s*turnsRef\.current = \[\];\s*\n\s*setActiveLeafId\(""\);/,
  "ChatView blanks turns/turnsRef synchronously on thread switch so the skeleton shows instead of stale messages",
);
assert.match(
  chatView,
  /historyState === "loading" \? \(\s*<ChatHistorySkeleton \/>/,
  "The blanked transcript renders ChatHistorySkeleton while history loads",
);
console.log("surface-loading-states.test.ts: ok");
