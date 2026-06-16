// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./chat-project-sidebar.tsx", import.meta.url), "utf8");

// ── Search-backed flat session results ───────────────────────────────────────
assert.match(
  source,
  /const allSessions = useMemo\(\(\) => \{[\s\S]*groups\.flatMap\(\(g\) => g\.sessions\)/,
  "Rail can flatten every project group for search results and order pruning",
);
assert.match(
  source,
  /\.sort\(\(a, b\) =>[\s\S]*updated_at[\s\S]*created_at/,
  "Flat search results stay globally recency-sorted",
);
assert.match(
  source,
  /const q = search\.trim\(\)\.toLowerCase\(\);[\s\S]*if \(!q\) return \[\];/,
  "The permanent all-sessions list is gone; flat rows render only for a real search",
);

// ── Drag-and-drop reorder via @dnd-kit, persisted ────────────────────────────
assert.match(source, /from "@dnd-kit\/core"/, "Rail uses @dnd-kit for drag reorder");
assert.match(source, /SortableContext/, "Rail wraps the flat list in a SortableContext");
assert.match(source, /useSortable\(\{\s*id: session\.id/, "Each thread row is sortable by session id");
assert.match(
  source,
  /activationConstraint: \{ distance: 5 \}/,
  "PointerSensor activation distance keeps a quick click an 'open', not a drag",
);
assert.match(
  source,
  /writeSessionOrder\(/,
  "A drag must persist the new manual order so it survives reloads",
);
assert.match(
  source,
  /const live = new Set\(allSessions\.map\(\(s\) => s\.id\)\)[\s\S]*merged\.filter\(\(id\) => live\.has\(id\)\)/,
  "Persisted order must be pruned against live sessions so it can't grow unbounded across deletes",
);

// ── Search only; no mode filters (All / Active / Tasks / Pinned) ─────────────
assert.match(source, /placeholder="Search sessions…"/, "Rail offers inline session search");
assert.doesNotMatch(source, /type ChatFilter =/, "Rail no longer owns filter tab state");
assert.doesNotMatch(source, /role="tablist"/, "All/Active/Tasks/Pinned tablist is removed");
assert.doesNotMatch(source, /s\.origin === "board"/, "Tasks filtering is gone from this simplified rail");

// ── Taller rail rows for scannable threads ──────────────────────────────────
assert.match(
  source,
  /min-h-\[36px\][\s\S]{0,120}py-2[\s\S]{0,120}text-\[12px\]/,
  "Flat thread rows should be taller than the old compact 28px treatment",
);
assert.match(
  source,
  /min-h-\[34px\][\s\S]{0,120}py-2[\s\S]{0,120}text-\[12px\]/,
  "Folder thread rows should be taller and readable inside expanded projects",
);
assert.match(
  source,
  /min-h-\[38px\][\s\S]{0,140}py-2[\s\S]{0,140}text-\[12px\]/,
  "Project folder headers should grow with the taller rail rhythm",
);
assert.match(
  source,
  /isSelected \? "font-semibold text-\[var\(--accent-presence\)\]" : ""/,
  "The selected project name should use the primary accent color so it stands out in the rail",
);

// ── Pin toggle is Cave-local (shared localStorage key with the chat list) ────
assert.match(source, /PINNED_SESSIONS_KEY/, "Rail pins share the chat list's localStorage key");
assert.match(source, /togglePinnedSession/, "Rail toggles pins through the shared helper");

// ── Default floats pinned; once dragged, manual order wins (no tug-of-war) ───
assert.match(
  source,
  /if \(order\.length === 0\) rows = partitionPinnedFirst\(rows, pinnedIds\)/,
  "Pinned search-result rows float by default, but a manual drag order takes precedence afterward",
);

// ── Session context in visible titles ────────────────────────────────────────
assert.match(source, /function sessionRailTitle\(session: SessionRow\): string/, "Rail owns a single formatter for thread titles");
assert.match(source, /session\.pullRequest\?\.number/, "Thread titles can include the linked pull request number");
assert.match(source, /session\.pullRequest\?\.state/, "Thread titles can include the linked pull request state");
assert.match(source, /session\.pullRequest\?\.branch \?\? session\.git\?\.branch/, "Thread titles can fall back to git branch context");
assert.match(source, /session\.git\?\.isWorktree/, "Thread titles can mark worktree-backed chats");
assert.match(source, /const title = sessionRailTitle\(session\)/, "Flat search rows use the shared session title formatter");

// ── Advanced operations: Git / Inspector / Debug launchers ───────────────────
assert.match(
  source,
  /event: "cave:changes-open", label: "Git"/,
  "Rail footer launches git mode (working-tree diff) via the changes-open bridge",
);
assert.match(
  source,
  /event: "cave:inspector-open"[\s\S]*event: "cave:debug-open"/,
  "Rail footer also launches the Inspector and Debug advanced panels",
);
assert.match(
  source,
  /window\.dispatchEvent\(new CustomEvent\(op\.event\)\)/,
  "Advanced-op buttons dispatch their window event to the chat surface",
);

const chatSurface = readFileSync(new URL("./chat-surface.tsx", import.meta.url), "utf8");
const chatRouter = readFileSync(new URL("./chat-router.tsx", import.meta.url), "utf8");
const chatList = readFileSync(new URL("./chat-list.tsx", import.meta.url), "utf8");
assert.match(
  chatSurface,
  /onChangesOpen = \(\) => onSetRightPanel\("changes"\)/,
  "ChatSurface maps changes-open to the git Changes panel",
);
assert.match(
  chatSurface,
  /addEventListener\("cave:changes-open", onChangesOpen\)/,
  "ChatSurface listens for the rail's cave:changes-open event",
);
assert.match(
  chatSurface,
  /onInspectorOpen = \(\) => onSetRightPanel\("inspector"\)/,
  "ChatSurface maps inspector-open to the Inspector panel",
);
assert.match(
  chatRouter,
  /readPersisted<unknown>\(PROJECT_SIDEBAR_KEYS\.expanded, null\)[\s\S]*projectSelectionKeys\(sidebarGroups\)/,
  "ChatRouter defaults project folders open when there is no persisted expanded-state value",
);
assert.match(
  chatRouter,
  /function selectionForProjectRoot\([\s\S]*normalizeChatProjectRoot\(projectRoot\)[\s\S]*selectionKey\(group\.projectId, group\.projectRoot\)/,
  "ChatRouter can map the active chat project root to the matching rail folder selection",
);
assert.match(
  chatRouter,
  /const syncSidebarProjectRoot = useCallback\([\s\S]*setSelection\(nextSelection\)[\s\S]*setExpandedKeys/,
  "ChatRouter keeps the selected rail folder aligned with the ChatView project dropdown root",
);
assert.match(
  chatRouter,
  /onProjectRootChange=\{syncSidebarProjectRoot\}/,
  "ChatView must report project-root changes back to the rail owner",
);
assert.match(
  chatList,
  /readPersisted<unknown>\(PROJECT_SIDEBAR_KEYS\.expanded, null\)[\s\S]*projectSelectionKeys\(sidebarGroups\)/,
  "ChatList defaults project folders open when there is no persisted expanded-state value",
);

// ── Preserved contracts other suites rely on ─────────────────────────────────
assert.match(
  source,
  /onClick=\{\(\) => \{[\s\S]*onSelect\(key\);[\s\S]*onToggleExpanded\(key\);[\s\S]*\}\}[\s\S]*aria-expanded=\{expanded\}/,
  "Project folder rows must keep the label/count collapse trigger contract",
);
assert.match(
  source,
  /className=\{\[\s*"group relative flex w-full items-center transition-colors"/,
  "Project folder rows should span the rail's full width instead of reserving side gutters",
);
assert.match(
  source,
  /className="touch-always-visible focus-ring absolute right-1 grid h-5 w-5/,
  "Project folder plus buttons should overlay at the right edge instead of reducing the label row width",
);
assert.match(
  source,
  /edge-rail-chip[\s\S]{0,120}ph:sidebar-simple/,
  "Collapsed rail keeps the pressable reopen chip",
);
assert.match(
  source,
  /aria-label="Chat projects header"[\s\S]*onSelect\("all"\)[\s\S]*aria-label="Hide sessions"/,
  "Projects header keeps All sessions and the collapse toggle in one compact top row",
);
assert.match(
  source,
  /className="px-2 pb-2 pt-0 border-b border-\[var\(--border-hairline\)\]"/,
  "Search sits directly under the header and separates the project tree with a hairline",
);

console.log("chat-thread-rail.test.ts: ok");
