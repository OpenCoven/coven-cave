// @ts-nocheck
// Wiring pins for useAutoExpandNewGroups (cave-mllp): the hook must baseline
// before expanding, expand exactly once per key, and both rail owners
// (ChatRouter, ChatList) must feed it RAW sessions so filter reveals never
// read as new chats. Behavior of the key-selection logic itself is covered in
// chat-project-selection.test.ts (autoExpandKeysForNewSessions).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const hook = readFileSync(new URL("./use-auto-expand-new-groups.ts", import.meta.url), "utf8");

// First hydrated run captures a baseline and bails — pre-existing collapsed
// groups (absent from persisted expanded-keys) must stay collapsed.
assert.match(
  hook,
  /if \(known === null\) \{[\s\S]*?sessionIds: new Set\(\[[\s\S]*?\.\.\.sessions\.map\(\(s\) => s\.id\)[\s\S]*?groupKeys: new Set\(projectSelectionKeys\(groups\)\)[\s\S]*?return;/,
  "hook baselines raw session ids + visible group keys on first hydrated run without expanding",
);

// Expansion decisions come from the tested pure helper, computed BEFORE the
// baselines grow — otherwise this run's fresh sessions would read as known.
assert.match(
  hook,
  /const expandKeys = autoExpandKeysForNewSessions\(\{[\s\S]*?\}\);[\s\S]*?known\.sessionIds\.add\(/,
  "hook computes expand keys via autoExpandKeysForNewSessions before growing the baseline",
);

// Functional setState with dedupe: never clobber concurrent expanded-keys
// updates, never push duplicate keys.
assert.match(
  hook,
  /setExpandedKeys\(\(prev\) => \{\s*const missing = expandKeys\.filter\(\(key\) => !prev\.includes\(key\)\);\s*return missing\.length \? \[\.\.\.prev, \.\.\.missing\] : prev;/,
  "hook merges new keys into prev expanded state with dedupe and a no-op bail",
);

// Both rail owners wire the hook with the raw sessions array (not the
// familiar-filtered rows) and their own active-session source.
const chatRouter = readFileSync(new URL("../components/chat-router.tsx", import.meta.url), "utf8");
assert.match(
  chatRouter,
  /useAutoExpandNewGroups\(\{\s*hydrated: sidebarHydrated,\s*sessions,\s*groups: sidebarGroups,\s*activeSessionId: view\.kind === "chat" \? view\.sessionId : null,\s*setExpandedKeys,\s*\}\)/,
  "ChatRouter auto-expands folders for new chats (raw sessions + view-derived active id)",
);
const chatList = readFileSync(new URL("../components/chat-list.tsx", import.meta.url), "utf8");
assert.match(
  chatList,
  /useAutoExpandNewGroups\(\{\s*hydrated: sidebarHydrated,\s*sessions,\s*groups: sidebarGroups,\s*activeSessionId: activeId,\s*setExpandedKeys,\s*\}\)/,
  "ChatList auto-expands folders for new chats (raw sessions + activeId)",
);

console.log("use-auto-expand-new-groups tests passed");
