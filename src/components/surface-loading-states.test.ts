// @ts-nocheck
// First-fetch loading skeletons: surfaces must not flash their empty states
// while the initial data fetch is still in flight.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

const inbox = read("./inbox-escalations-view.tsx");
assert.match(
  inbox,
  /initialLoadDone[\s\S]*?finally \{\s*setInitialLoadDone\(true\);/,
  "Inbox tracks first-fetch settlement (success or failure)",
);
assert.match(
  inbox,
  /\{!initialLoadDone \? \([\s\S]*?animate-pulse[\s\S]*?\) : visible\.length === 0 \? \(/,
  "Inbox shows a skeleton before first load, ahead of the empty state",
);

const chatList = read("./chat-list.tsx");
assert.match(
  chatList,
  /sessionsLoaded = true/,
  "ChatList defaults sessionsLoaded true so other callers keep current behavior",
);
assert.match(
  chatList,
  /\{!sessionsLoaded && !hasAny \? \([\s\S]*?animate-pulse[\s\S]*?\) : !hasAny \? \(/,
  "ChatList shows skeleton rows instead of flashing the no-chats empty state on boot",
);

const workspace = read("./workspace.tsx");
assert.match(
  workspace,
  /const \[sessionsLoaded, setSessionsLoaded\] = useState\(false\)[\s\S]*?finally \{\s*setSessionsLoaded\(true\);/,
  "Workspace flips sessionsLoaded after the first /api/sessions/list fetch settles",
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
assert.match(
  settings,
  /\{loading \? \([\s\S]{0,200}animate-pulse/,
  "Settings integrations shows skeleton rows while the daemon status loads",
);

console.log("surface-loading-states.test.ts: ok");
