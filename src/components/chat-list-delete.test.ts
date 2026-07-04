// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PINNED_SESSIONS_KEY,
  readPinnedSessions,
  togglePinnedSession,
  sortPinnedFirst,
} from "../lib/chat-session-prefs.ts";

const source = readFileSync(new URL("./chat-list.tsx", import.meta.url), "utf8");

assert.doesNotMatch(
  source,
  /busyTuiId|openInTui|tui\s*→|Open in Coven Code TUI/,
  "ChatList should replace the old TUI row action with deletion",
);

assert.match(
  source,
  /const \[confirmDeleteId, setConfirmDeleteId\] = useState<string \| null>\(null\)/,
  "ChatList should keep an explicit per-row delete confirmation state",
);

assert.match(
  source,
  /fetch\(`\/api\/chat\/conversation\/\$\{encodeURIComponent\(sessionId\)\}`,[\s\S]*method: "DELETE"/,
  "ChatList should delete through the conversation endpoint for the selected session",
);

assert.match(
  source,
  /onSessionsChanged\?\.\(\)/,
  "ChatList should ask the shell to refresh sessions after deleting a chat",
);

assert.match(
  source,
  /<Icon name="ph:trash"/,
  "ChatList delete action should use the trash icon",
);

// ── Pin & archive (CHAT-D9-03) ───────────────────────────────────────────────

// Pin store: Cave-local localStorage set with SSR-safe reads.
assert.equal(
  PINNED_SESSIONS_KEY,
  "cave:chat:pinned-sessions",
  "pinned sessions persist under a cave-scoped localStorage key",
);
assert.deepEqual(
  readPinnedSessions(),
  [],
  "readPinnedSessions degrades to empty without a window (SSR)",
);
assert.deepEqual(togglePinnedSession([], "s1"), ["s1"], "toggle adds a missing id");
assert.deepEqual(togglePinnedSession(["s1", "s2"], "s1"), ["s2"], "toggle removes a present id");

// Pinned rows sort first within their project group; recency order is
// preserved inside both partitions and pin-free groups keep their reference.
const row = (id) => ({ id });
const groups = [
  {
    projectRoot: "/repo",
    sessions: [row("a"), row("b"), row("c"), row("d")],
    defaultFamiliarId: null,
    updatedAt: null,
  },
  {
    projectRoot: null,
    sessions: [row("e")],
    defaultFamiliarId: null,
    updatedAt: null,
  },
];
const sorted = sortPinnedFirst(groups, ["d", "b"]);
assert.deepEqual(
  sorted[0].sessions.map((s) => s.id),
  ["b", "d", "a", "c"],
  "pinned rows float to the top of their group, keeping recency order within partitions",
);
assert.equal(sorted[1], groups[1], "groups without pins keep their reference");
assert.equal(sortPinnedFirst(groups, []), groups, "no pins → groups returned untouched");

// ChatList wiring: persisted pin state drives a pinned-first ordering.
assert.match(
  source,
  /setPinnedIds\(readPinnedSessions\(\)\)/,
  "ChatList should hydrate pinned ids from the localStorage store after mount",
);
assert.match(
  source,
  /window\.localStorage\.setItem\(PINNED_SESSIONS_KEY, JSON\.stringify\(pinnedIds\)\)/,
  "ChatList should persist pin toggles back to the localStorage store",
);
assert.match(
  source,
  /sortPinnedFirst\(scopedGroups, pinnedIds\)/,
  "ChatList should float pinned rows to the top of their project group",
);
assert.match(
  source,
  /togglePinnedSession\(prev, sessionId\)/,
  "ChatList pin action should toggle through the shared store helper",
);
assert.match(
  source,
  /aria-label=\{`\$\{pinned \? "Unpin" : "Pin"\} chat \$\{rowName\}`\}/,
  "Pin toggle should be a real button with a state-aware aria-label",
);

// Full ChatList drag reorder mirrors the thread rail: @dnd-kit handles the
// gesture, the shared Cave-local order store persists the result, and stale ids
// are pruned against live familiar-scoped sessions.
assert.match(source, /from "@dnd-kit\/core"/, "ChatList should use @dnd-kit for drag reorder");
assert.match(source, /const displayIds = useMemo\([\s\S]*displayGroups\.flatMap\(\(group\) => group\.sessions\.map\(\(session\) => session\.id\)\)/, "ChatList should derive one flat list of visible sortable ids");
assert.match(source, /<DndContext[\s\S]*onDragEnd=\{\(event\) => handleDragEnd\(event, displayIds\)\}/, "The visible chat list should wire drag end with all displayed ids");
assert.match(source, /<SortableContext items=\{displayIds\} strategy=\{verticalListSortingStrategy\}/, "All visible chat rows should share one SortableContext");
assert.match(source, /useSortable\(\{ id \}\)/, "ChatList rows should be individually sortable by session id");
assert.match(source, /setSessionOrder\(readSessionOrder\(\)\)/, "ChatList should hydrate the persisted manual order after mount");
assert.match(source, /if \(effectiveSelection === "all"\) \{[\s\S]*scopedGroups\.flatMap\(\(group\) => group\.sessions\)/, "All chats should flatten groups so cross-project drag order can stick");
assert.match(source, /partitionPinnedFirst\(sortByRecency\(rows\), pinnedIds\)/, "Pinned rows still float, over a recency-sorted rest, in the flat All chats view until manual drag order exists");
assert.match(source, /applyManualOrder\(group\.sessions, sessionOrder\)/, "ChatList should apply the manual order inside visible project groups");
assert.match(source, /mergeVisibleOrder\(prev\.length > 0 \? prev : fallbackOrderIds, nextVisible\)/, "ChatList should merge dragged visible rows back into the full saved order");
assert.match(source, /const pruned = merged\.filter\(\(id\) => liveSessionIds\.has\(id\)\)/, "ChatList should prune stale session ids before persisting drag order");
assert.match(source, /writeSessionOrder\(pruned\)/, "ChatList should persist drag order to the shared session-order store");
assert.match(source, /activationConstraint: \{ distance: 5 \}/, "Pointer drag should require movement so normal clicks still open chats");
assert.match(source, /aria-label=\{`Reorder chat \$\{rowName\}`\}/, "Drag handle should be accessible and scoped to the row");

// Archive rides the existing sessions PATCH endpoint (Cave-local archived_at)
// and archived rows stay hidden until the Show archived filter opts in.
assert.match(
  source,
  /fetch\(`\/api\/sessions\/\$\{encodeURIComponent\(sessionId\)\}`, \{\s*method: "PATCH",[\s\S]*?JSON\.stringify\(\{ archived \}\)/,
  "Archive action should persist through the sessions PATCH endpoint",
);
assert.match(
  source,
  /aria-label=\{`\$\{s\.archived_at \? "Unarchive" : "Archive"\} chat \$\{rowName\}`\}/,
  "Archive toggle should be a real button with a state-aware aria-label",
);
assert.match(
  source,
  /disabled=\{archivingId !== null\}/,
  "All archive controls should stay disabled while any archive request is in flight",
);
assert.match(
  source,
  /if \(!showArchived\) \{\s*setArchivedRows\(\[\]\);/,
  "Archived rows should be dropped whenever the Show archived toggle is off",
);
assert.match(
  source,
  /\/api\/sessions\/list\?includeArchived=1/,
  "Archived rows should load only via the opt-in includeArchived list query",
);
assert.match(
  source,
  /aria-pressed=\{showArchived\}[\s\S]*?aria-label=\{showArchived \? "Hide archived sessions" : "Show archived sessions"\}/,
  "Show archived filter should be an aria-labeled toggle alongside the existing filters",
);

// ── Content search (CHAT-D9-02) ──────────────────────────────────────────────

// The search box also fires a content search against /api/chat/search for
// queries of length ≥2 — debounced ~300ms with an abortable fetch.
assert.match(
  source,
  /fetch\(`\/api\/chat\/search\?q=\$\{encodeURIComponent\(q\)\}`,\s*\{\s*cache: "no-store",\s*signal: controller\.signal,/,
  "ChatList should query the content-search endpoint with an abortable fetch",
);
assert.match(
  source,
  /const timer = window\.setTimeout\([\s\S]{0,900}?\}, 300\);/,
  "Content search should debounce ~300ms behind the keystroke",
);
assert.match(
  source,
  /window\.clearTimeout\(timer\);\s*\n\s*controller\.abort\(\);/,
  "A retype must clear the pending debounce and abort the in-flight fetch",
);
assert.match(
  source,
  /if \(q\.length < 2\) \{\s*\n\s*setContentHits\(\[\]\);\s*\n\s*setContentLoading\(false\);/,
  "Queries under 2 chars must clear content hits instead of fetching",
);
assert.match(
  source,
  /const controller = new AbortController\(\);\s*\n\s*setContentHits\(\[\]\);\s*\n\s*setContentLoading\(true\);/,
  "Starting a new content-search request must clear prior hits during debounce",
);
assert.match(
  source,
  /if \(!controller\.signal\.aborted\) \{\s*\n\s*setContentHits\(\[\]\);\s*\n\s*setContentLoading\(false\);\s*\n\s*\}/,
  "Non-abort content-search failures must clear stale hits",
);

// Title-filtered rows stay primary: sessions already visible by title match
// are deduped out of the content section, and hits resolve against the
// familiar-scoped rows so other familiars' chats never leak in.
assert.match(
  source,
  /if \(shown\.has\(hit\.sessionId\)\) continue;/,
  "Content hits already shown by the title filter must be deduped",
);
assert.match(
  source,
  /const byId = new Map\(mine\.map\(\(s\) => \[s\.id, s\]\)\);/,
  "Content hits must resolve against the familiar-scoped session rows",
);

// Render: secondary "In conversations" section with highlighted snippet,
// loading shimmer, and the existing onOpen path for clicks.
assert.match(
  source,
  /In conversations/,
  "Content matches render under an 'In conversations' section header",
);
assert.match(
  source,
  /contentLoading && contentMatches\.length === 0 \?[\s\S]{0,200}?animate-pulse/,
  "Content search shows the shimmer idiom while the first fetch is in flight",
);
assert.match(
  source,
  /<mark className=/,
  "The matched substring inside the snippet is highlighted with <mark>",
);
assert.match(
  source,
  /HighlightedSnippet snippet=\{hit\.snippet\} query=\{search\.trim\(\)\}/,
  "Snippets render through the highlight helper with the live query",
);
assert.match(
  source,
  /onClick=\{\(\) => \{ setActiveId\(hit\.sessionId\); onOpen\(hit\.sessionId, row\.familiarId, search\.trim\(\)\); \}\}/,
  "Clicking a content hit opens the session via onOpen, passing the query so it jumps to the match",
);

// ── CHAT-D13-02: micro-type legibility ─────────────────────────────────────
// 9px uppercase stat/meta labels sat under AA contrast at the old 40%-alpha
// muted ink. Labels are lifted to 10px (hierarchy preserved via uppercase +
// tracking) and the token itself is raised: 55% mix in dark, 62% in light.
assert.doesNotMatch(
  source,
  /text-\[9px\]/,
  "ChatList must not render 9px micro-type (CHAT-D13-02 — lifted to 10px)",
);
assert.match(
  source,
  /text-\[10px\] font-medium uppercase tracking-\[0\.08em\] text-\[var\(--text-muted\)\]/,
  "Stat labels keep the uppercase/tracking hierarchy at the lifted 10px size",
);

const globals = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
assert.match(
  globals,
  /--text-muted: color-mix\(in oklch, var\(--foreground\) 72%, transparent\);/,
  "Dark-mode --text-muted mixes at 72% — 55% passed AA only on Coven; 72% clears 4.5:1 on every premade palette (theme-contrast-audit.test.ts)",
);
assert.match(
  globals,
  /--text-muted: color-mix\(in oklch, var\(--foreground\) 76%, transparent\);/,
  "Light-mode --text-muted overrides to 76% (dark ink needs a higher mix for the same contrast)",
);
assert.doesNotMatch(
  globals,
  /--text-muted: color-mix\(in oklch, var\(--foreground\) 40%, transparent\);/,
  "The old 40% muted-ink mix (~3:1 on dark, ~2.5:1 on light) must not return",
);

assert.match(
  source,
  /<SessionInitiatorChip initiator=\{s\.initiator\} \/>/,
  "Chat rows should render the session initiator attribution pill",
);
assert.doesNotMatch(
  globals,
  /\.ui-initiator-chip\[data-initiator="familiar"\]\s*\{[\s\S]*?color:\s*var\(--accent\);/,
  "Familiar initiator attribution text must not use the low-contrast accent token",
);
assert.match(
  globals,
  /\.ui-initiator-chip\[data-initiator="familiar"\]\s*\{[\s\S]*?color:\s*var\(--text-secondary\);/,
  "Familiar initiator attribution text should use a readable text token",
);

// ── Row chrome consistency (origin + initiator pills, action buttons) ─────────
// Both pills must share one base rule so adjacent pills read as siblings.
assert.match(
  globals,
  /\.ui-origin-chip,\s*\.ui-initiator-chip\s*\{[\s\S]*?border-radius:\s*999px;[\s\S]*?\}/,
  "Origin and initiator pills must share a single base chrome rule",
);
// The three row action buttons (pin/archive/delete) must be uniform squares.
{
  const squares = source.match(/touch-always-visible inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md/g) ?? [];
  assert.equal(squares.length, 4, "pin/archive/debug/delete must be uniform h-6 w-6 square icon buttons");
}
assert.match(
  source,
  /aria-label=\{`Debug chat \$\{rowName\}`\}[\s\S]*?<Icon name="ph:bug-bold"/,
  "Chat rows should expose a bug-icon Debug action next to delete",
);
assert.match(
  source,
  /window\.dispatchEvent\(new CustomEvent\("cave:debug-open"\)\)/,
  "Chat row Debug action should reuse the existing debug panel event bridge",
);
assert.doesNotMatch(
  source,
  /touch-always-visible shrink-0 rounded border border-\[var\(--border-hairline\)\] px-1\.5 py-0\.5/,
  "Old non-uniform px-1.5 py-0.5 action-button chrome must be gone",
);

// The flat "All" view sorts by recency (most-recent-first), restoring the
// global order the per-project flatMap drops — while still honoring an explicit
// manual drag order and floating pinned sessions first.
assert.match(source, /function sortByRecency\(rows: SessionRow\[\]\)/, "a recency sorter exists");
assert.match(
  source,
  /sessionOrder\.length === 0\s*\?\s*partitionPinnedFirst\(sortByRecency\(rows\), pinnedIds\)\s*:\s*applyManualOrder\(rows, sessionOrder\)/,
  "the All view sorts by recency by default, defers to manual order when the user has dragged, and keeps pinned-first",
);

// ── Bulk-select: pick several chats and delete/archive them at once ─────────
assert.match(source, /const \[selectMode, setSelectMode\] = useState\(false\)/, "a select mode toggles bulk-select");
assert.match(source, /const \[selectedIds, setSelectedIds\] = useState<Set<string>>/, "selected chat ids live in a Set");
assert.match(source, /setSelectMode\(\(v\) => !v\); setSelectedIds\(new Set\(\)\)/, "the header Select toggle clears any selection");
assert.match(source, /useEffect\(\(\) => \{ setSelectMode\(false\); setSelectedIds\(new Set\(\)\); \}, \[familiar\?\.id\]\)/, "selection resets when the active familiar changes");
assert.match(source, /role=\{selectMode \? "checkbox" : "button"\}/, "rows are checkboxes in select mode");
assert.match(source, /if \(selectMode\) \{ toggleSelect\(s\.id\); return; \} setActiveId\(s\.id\); onOpen/, "a row click selects in select mode, otherwise opens");
assert.match(source, /const bulkDelete = \(\) =>/, "bulk delete handler exists (deferred/undoable)");
assert.match(source, /const bulkArchive = async \(archived: boolean\)/, "bulk archive/unarchive handler exists");
assert.match(source, /Promise\.all\([\s\S]{0,80}fetch\(`\/api\/chat\/conversation\//, "bulk delete runs the per-chat deletes in parallel");
// Bulk delete is deferred + undoable via the shared undo toast.
assert.match(source, /useUndoDelete<SessionRow\[\]>\(\)/, "bulk delete routes through useUndoDelete");
assert.match(source, /scheduleBulkDelete\(\s*removed,/, "bulk delete schedules the batch through the undo window");
assert.match(source, /const hidden = new Set\(\(deletePending\?\.item \?\? \[\]\)\.map\(\(s\) => s\.id\)\)/, "pending-deleted rows are hidden from the list until commit");
assert.match(source, /<UndoToast[\s\S]{0,160}onUndo=\{undoBulkDelete\}[\s\S]{0,40}onDismiss=\{commitBulkDelete\}/, "an undo toast offers to restore the batch");
assert.match(source, /const allVisibleSelected = displayIds\.length > 0 && displayIds\.every\(\(id\) => selectedIds\.has\(id\)\)/, "select-all is visible-aware");
assert.match(source, /\{allVisibleSelected \? "Clear" : "Select all"\}/, "toolbar offers select-all / clear");

console.log("chat-list-delete.test.ts: ok");
