// @ts-nocheck
// First-fetch loading skeletons: surfaces must not flash their empty states
// while the initial data fetch is still in flight.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

const inbox = read("./automations-view.tsx");
assert.match(
  inbox,
  /initialLoadDone[\s\S]*?finally \{\s*setInitialLoadDone\(true\);/,
  "Inbox/automations tracks first-fetch settlement (success or failure)",
);
assert.match(
  inbox,
  /\{!initialLoadDone \? \([\s\S]*?animate-pulse[\s\S]*?\) : activeTab === "reminders" && remindersEmpty \? \(/,
  "Schedules shows a skeleton before first load, ahead of the Reminders empty state",
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
  /const \[sessionsLoaded, setSessionsLoaded\] = useState\(false\)/,
  "Workspace flips sessionsLoaded after the first /api/sessions/list fetch settles",
);
assert.match(
  workspace,
  /const loadSessionsInFlightRef = useRef<Promise<void> \| null>\(null\)/,
  "Workspace deduplicates overlapping session-list refreshes",
);
assert.match(
  workspace,
  /if \(loadSessionsInFlightRef\.current\) return loadSessionsInFlightRef\.current;/,
  "Workspace reuses an in-flight session-list request instead of stacking pollers",
);
assert.doesNotMatch(
  workspace,
  /Promise\.allSettled\(\[[\s\S]{0,600}\/api\/sessions\/list[\s\S]{0,600}\/api\/github\/tasks/,
  "Workspace does not block the first visible chat sessions on optional GitHub task enrichment",
);
assert.match(
  workspace,
  /setSessions\(baseSessions\);[\s\S]{0,220}setSessionsLoaded\(true\);[\s\S]{0,500}githubTasksPromise/,
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
assert.match(
  settings,
  /\{loading \? \([\s\S]{0,200}animate-pulse/,
  "Settings integrations shows skeleton rows while the daemon status loads",
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

const retro = read("./retro-runs-view.tsx");
assert.match(
  retro,
  /\{loading \? \(\s*<SkeletonRows/,
  "Retro runs shows shared skeleton rows on first load instead of hand-rolled divs",
);
assert.doesNotMatch(
  retro,
  /className="retro-skeleton"/,
  "Retro runs no longer hand-rolls retro-skeleton placeholder divs",
);

// More surfaces converted from a bare "Loading…" string to the shared skeleton.
for (const [file, label] of [
  ["./github-view.tsx", "GitHub activity"],
  ["./board-inspector.tsx", "Board inspector linked context"],
  ["./project-tree.tsx", "Project tree"],
  ["./journal/journal-entries.tsx", "Journal entries pane"],
  ["./workflows/workflow-library.tsx", "Workflow library"],
]) {
  const src = read(file);
  assert.doesNotMatch(src, />Loading…</, `${label} no longer shows a bare Loading… line`);
  assert.match(src, /<SkeletonRows/, `${label} shows shared skeleton rows on first load`);
}
// Workflow library: a bare "Loading workflow manifests..." string is gone, and
// the in-list "no search match" case uses the shared EmptyState (not bare text).
const workflowLib = read("./workflows/workflow-library.tsx");
assert.doesNotMatch(workflowLib, /Loading workflow manifests/, "Workflow library no longer shows a bare loading line");
assert.match(workflowLib, /headline="No workflows match"/, "Workflow library search-no-results uses EmptyState");
const docPreview = read("./library-doc-preview.tsx");
assert.doesNotMatch(docPreview, /library-preview-empty-text">Loading…</, "Library doc preview no longer shows a bare Loading… line");
assert.match(docPreview, /<SkeletonGroup[\s\S]{0,200}<Skeleton variant="text"/, "Library doc preview shows a document-shaped skeleton on first load");

console.log("surface-loading-states.test.ts: ok");
