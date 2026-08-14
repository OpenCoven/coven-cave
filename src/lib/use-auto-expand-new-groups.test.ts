// @ts-nocheck
// Wiring pins for useAutoExpandNewGroups (cave-mllp): the hook must baseline
// before expanding and expand exactly once per key. ChatRouter is the sole
// disclosure-state owner and supplies the raw rows within the server-provided
// familiar scope; scope changes rebaseline instead of treating revealed chats
// as new. ChatList only consumes Router-owned state. Behavior of the
// key-selection logic itself is covered in chat-project-selection.test.ts
// (autoExpandKeysForNewSessions).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { act, create } from "react-test-renderer";
import { useAutoExpandNewGroups } from "./use-auto-expand-new-groups.ts";

const hook = readFileSync(new URL("./use-auto-expand-new-groups.ts", import.meta.url), "utf8");

// First hydrated run or a scope change captures a baseline and bails —
// pre-existing collapsed groups (absent from persisted expanded-keys) must
// stay collapsed. The capture records the scope, scoped raw session ids,
// visible group keys, AND the capture instant (recency anchor for cave-a9w9).
assert.match(
  hook,
  /if \(known === null \|\| known\.scopeKey !== scopeKey\) \{[\s\S]*?scopeKey,[\s\S]*?sessionIds: new Set\(\[[\s\S]*?\.\.\.sessions\.map\(\(s\) => s\.id\)[\s\S]*?groupKeys: new Set\(projectSelectionKeys\(groups\)\)[\s\S]*?capturedAtMs: Date\.now\(\)[\s\S]*?return;/,
  "hook baselines scope, scoped raw session ids, visible group keys, and capture time on first run or scope change",
);
assert.match(
  hook,
  /scopeKey: string;/,
  "hook requires callers to identify the current server-provided scope",
);
assert.match(
  hook,
  /\[[^\]]*scopeKey[^\]]*\]\);/,
  "scope changes rerun the baseline effect",
);

// The new-folder path only fires for chats created after baseline capture
// (minus skew): a failed first load poisons the baseline, and recovery,
// backfill, or familiar-scope reveals then deliver OLD chats under unseen
// keys — those must never mass-expand (cave-a9w9). A genuine first chat
// after an empty start is recent, so it still expands (cave-mllp preserved).
assert.match(
  hook,
  /newSinceMs: known\.capturedAtMs - BASELINE_SKEW_MS/,
  "expansion is gated on session recency relative to the baseline capture time",
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

// The sole rail-state owner wires the hook with the raw sessions array within
// the current server-provided scope, a stable familiar scope key, and its
// view-derived active-session source.
const chatRouter = readFileSync(new URL("../components/chat-router.tsx", import.meta.url), "utf8");
assert.match(
  chatRouter,
  /useAutoExpandNewGroups\(\{\s*hydrated: sidebarHydrated,\s*scopeKey: familiar\?\.id \?\? "all",\s*sessions,\s*groups: sidebarGroups,\s*activeSessionId: view\.kind === "chat" \? view\.sessionId : null,\s*setExpandedKeys,\s*\}\)/,
  "ChatRouter auto-expands folders for new chats within a stable familiar scope",
);
const chatList = readFileSync(new URL("../components/chat-list.tsx", import.meta.url), "utf8");
assert.doesNotMatch(
  chatList,
  /useAutoExpandNewGroups/,
  "ChatList does not call the Router-owned auto-expansion hook",
);
assert.doesNotMatch(
  chatList,
  /PROJECT_SIDEBAR_KEYS|migrateOrganizationExpansionKeys|localStorage\.setItem\([^)]*project-sidebar-expanded/,
  "ChatList does not own expanded-state hydration, migration, or persistence",
);

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const session = (id, createdAt = new Date().toISOString()) => ({
  id,
  created_at: createdAt,
});
const group = (projectId, sessions) => ({
  projectId,
  projectRoot: `/${projectId}`,
  organization: { key: "opencoven", label: "OpenCoven", source: "github" },
  sessions,
  defaultFamiliarId: null,
  updatedAt: new Date().toISOString(),
});

let expandedKeys = [];
const setExpandedKeys = (next) => {
  expandedKeys = typeof next === "function" ? next(expandedKeys) : next;
};
const HookHarness = ({ scopeKey, sessions, groups }) => {
  useAutoExpandNewGroups({
    hydrated: true,
    scopeKey,
    sessions,
    groups,
    activeSessionId: null,
    setExpandedKeys,
  });
  return null;
};

let renderer;
const originalConsoleError = console.error;
console.error = (...args) => {
  if (args[0] === "react-test-renderer is deprecated. See https://react.dev/warnings/react-test-renderer") {
    return;
  }
  originalConsoleError(...args);
};
try {
  await act(async () => {
    renderer = create(
      React.createElement(HookHarness, {
        scopeKey: "familiar:alpha",
        sessions: [session("alpha-0")],
        groups: [group("alpha", [session("alpha-0")])],
      }),
    );
  });
} finally {
  console.error = originalConsoleError;
}
await act(async () => {
  renderer.update(
    React.createElement(HookHarness, {
      scopeKey: "familiar:beta",
      sessions: [session("beta-0")],
      groups: [group("beta", [session("beta-0")])],
    }),
  );
});
assert.deepEqual(
  expandedKeys,
  [],
  "switching familiar scope rebaselines without expanding recently revealed groups",
);

await act(async () => {
  renderer.update(
    React.createElement(HookHarness, {
      scopeKey: "familiar:beta",
      sessions: [session("beta-0"), session("gamma-0")],
      groups: [
        group("beta", [session("beta-0")]),
        group("gamma", [session("gamma-0")]),
      ],
    }),
  );
});
assert.deepEqual(
  expandedKeys,
  ["org:opencoven", "gamma"],
  "a genuinely new session still expands its group within the stable scope",
);

await act(async () => {
  renderer.unmount();
});

console.log("use-auto-expand-new-groups tests passed");
