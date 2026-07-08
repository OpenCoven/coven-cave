// @ts-nocheck
// Source pins for the inbox state-hygiene pass (cave-bzch): SSE echo and
// reconnect guards in workspace, and the dashboard widget actually hearing
// the cockpit's refetches. (The prefs write lock the same audit found is
// covered by cave-inbox-prefs.test.ts.)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workspace = readFileSync(new URL("../components/workspace.tsx", import.meta.url), "utf8");
const actionInbox = readFileSync(new URL("../components/dashboard/action-inbox.tsx", import.meta.url), "utf8");

// ── SSE guards in workspace ──────────────────────────────────────────────────
assert.match(
  workspace,
  /setInboxItems\(\(prev\) => \(arrayContentEqual\(prev, e\.items\) \? prev : e\.items\)\);/,
  "reconnect snapshots keep the previous reference when content-identical",
);
assert.match(
  workspace,
  /const existing = prev\.find\(\(it\) => it\.id === e\.item\.id\);\s*\n\s*if \(existing && JSON\.stringify\(existing\) === JSON\.stringify\(e\.item\)\) return prev;/,
  "content-identical update echoes (our own optimistic writes bounced back) don't mint a new array",
);

// ── ActionInbox hears the cockpit refetch ────────────────────────────────────
assert.match(
  actionInbox,
  /useEffect\(\(\) => \{\s*\n\s*setItems\(\(prev\) => \(arrayContentEqual\(prev, initialItems\) \? prev : initialItems\)\);\s*\n\s*\}, \[initialItems\]\);/,
  "the widget reconciles with fresh initialItems (useState read the prop exactly once before) — content-guarded so in-flight optimistic removals survive no-op re-renders",
);

console.log("inbox-hygiene.test.ts: ok");
