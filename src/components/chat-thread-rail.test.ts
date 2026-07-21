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
assert.match(source, /placeholder="Search chats…"/, "Rail offers inline chat search");
assert.doesNotMatch(source, /type ChatFilter =/, "Rail no longer owns filter tab state");
assert.doesNotMatch(source, /role="tablist"/, "All/Active/Tasks/Pinned tablist is removed");
assert.doesNotMatch(source, /s\.origin === "board"/, "Tasks filtering is gone from this simplified rail");

// ── Taller rail rows for scannable threads ──────────────────────────────────
assert.match(
  source,
  /min-h-\[36px\][\s\S]{0,120}py-2[\s\S]{0,160}text-\[length:var\(--text-sm\)\]/,
  "Flat thread rows should be taller than the old compact 28px treatment",
);
assert.match(
  source,
  /min-h-\[34px\][\s\S]{0,120}py-2[\s\S]{0,160}text-\[length:var\(--text-sm\)\]/,
  "Folder thread rows should be taller and readable inside expanded projects",
);
assert.match(
  source,
  /min-h-\[38px\][\s\S]{0,140}py-2[\s\S]{0,180}text-\[length:var\(--text-sm\)\]/,
  "Project folder headers should grow with the taller rail rhythm",
);
assert.match(
  source,
  /isSelected \? "text-\[var\(--accent-presence\)\]" : "text-\[var\(--text-primary\)\]"/,
  "The selected project name should use the primary accent color so it stands out in the rail",
);
assert.match(
  source,
  /min-w-0 flex-1 truncate font-bold/,
  "Project folder headers read as headers: the label is bold",
);

// ── Pin toggle is Cave-local (shared cross-surface store with the chat list) ─
assert.match(source, /usePinnedSessions\(\)/, "Rail pins read from the shared cross-surface pin store");
assert.match(source, /toggleStoredPinnedSession/, "Rail toggles pins through the shared store helper");

// ── Default floats pinned; once dragged, manual order wins (no tug-of-war) ───
assert.match(
  source,
  /if \(order\.length === 0\) rows = partitionPinnedFirst\(rows, pinnedIds\)/,
  "Pinned search-result rows float by default, but a manual drag order takes precedence afterward",
);

// ── Session context in visible titles ────────────────────────────────────────
assert.match(
  source,
  /import \{ sessionRailTitle \} from "@\/lib\/session-rail-title"/,
  "Rail uses the shared, unit-tested session title formatter (git/PR/worktree behavior lives in session-rail-title.test.ts)",
);
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
const railController = readFileSync(new URL("../lib/use-workspace-rail-controller.ts", import.meta.url), "utf8");
const chatRouter = readFileSync(new URL("./chat-router.tsx", import.meta.url), "utf8");
const chatList = readFileSync(new URL("./chat-list.tsx", import.meta.url), "utf8");
// The inspector right panel is retired: Git/Changes lands on the code rail's
// Changes tab, Inspect lands on the promoted Familiar chat tab, and Debug is
// owned by ChatView's modal (chat-view.tsx listens for cave:debug-open).
assert.match(
  railController,
  /const openChanges = useCallback\(\(\) => \{[\s\S]*?rail\.setActiveTab\("changes"\)/,
  "The shared rail controller maps changes-open to the code rail's Changes tab",
);
assert.match(
  railController,
  /addEventListener\("cave:changes-open", openChanges\)/,
  "The shared rail controller listens for cave:changes-open",
);
assert.match(
  chatSurface,
  /const onInspectorOpen = \(\) => setScope\("familiar"\)/,
  "ChatSurface maps inspector-open to the Familiar chat tab",
);
const chatView = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");
assert.match(
  chatView,
  /addEventListener\("cave:debug-open", onDebugOpen\)/,
  "ChatView owns the cave:debug-open bridge (debug modal)",
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
  /className=\{\[\s*\/\/[\s\S]*?"group relative flex w-full items-center border-b border-\[var\(--border-hairline\)\] transition-colors"/,
  "Project folder rows should span the rail's full width instead of reserving side gutters",
);
assert.match(
  source,
  /className="touch-always-visible focus-ring absolute right-1 grid h-5 w-5/,
  "Project folder plus buttons should overlay at the right edge instead of reducing the label row width",
);
// Collapsed rail (SurfaceRail, 56px): project identity tiles remain, and
// activating one re-expands the rail and opens that group.
assert.match(
  source,
  /\{!open && groups\.length > 0 \?[\s\S]{0,700}setOpen\(true\);\s*\n\s*onSelect\(key\);\s*\n\s*if \(!expandedKeys\.includes\(key\)\) onToggleExpanded\(key\);/,
  "Collapsed rail renders group tiles that expand the rail and open the group",
);
assert.match(
  source,
  /onClick=\{\(\) => onSelect\("all"\)\}\s*\n\s*aria-current=\{selection === "all" \? "true" : undefined\}/,
  "The All sessions unscope affordance survives the SurfaceRail migration",
);
assert.match(
  source,
  /search=\{\s*\n\s*<SearchInput/,
  "Search renders through SurfaceRail's under-header search slot",
);
// By project / Recent mini toggle: aria-pressed buttons (not a tablist),
// persisted under cave:chat:rail:mode via the pure normalize helper.
assert.match(
  source,
  /aria-pressed=\{railMode === "projects"\}[\s\S]{0,220}By project[\s\S]{0,700}aria-pressed=\{railMode === "recent"\}[\s\S]{0,220}Recent/,
  "The rail exposes the By project / Recent view toggle",
);
assert.match(
  source,
  /normalizeChatRailMode\(window\.localStorage\.getItem\(CHAT_RAIL_MODE_KEY\)\)/,
  "The rail mode hydrates from its persisted key",
);

// The open conversation row announces itself to assistive tech (was visual-only:
// a background tint + accent bar with no aria-current).
assert.match(
  chatList,
  /aria-current=\{!selectMode && isActive \? "true" : undefined\}/,
  "the active conversation row is aria-current (not just visually highlighted)",
);

console.log("chat-thread-rail.test.ts: ok");
