// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const view = [
  await readFile(new URL("./grimoire-view.tsx", import.meta.url), "utf8"),
  await readFile(new URL("./grimoire-nav-state.ts", import.meta.url), "utf8"),
].join("\n");
const scanHook = await readFile(new URL("../lib/use-grimoire-graph-scan.ts", import.meta.url), "utf8");
const workspace = await readFile(new URL("./workspace.tsx", import.meta.url), "utf8");
const sidebar = await readFile(new URL("./sidebar-minimal.tsx", import.meta.url), "utf8");
const modeType = await readFile(new URL("../lib/workspace-mode.ts", import.meta.url), "utf8");
const navigation = await readFile(new URL("../lib/workspace-navigation.ts", import.meta.url), "utf8");
const pageRegistry = await readFile(new URL("../lib/workspace-page-registry.ts", import.meta.url), "utf8");
const warmupRegistry = await readFile(new URL("../lib/surface-warmup-registry.ts", import.meta.url), "utf8");
const grimoireCss = await readFile(new URL("../styles/grimoire-launcher.css", import.meta.url), "utf8");
const explorationCss = await readFile(new URL("../styles/memory-exploration.css", import.meta.url), "utf8");
const docReader = await readFile(new URL("./grimoire-doc-reader.tsx", import.meta.url), "utf8");
const readerMarkdown = await readFile(new URL("./document-reader-markdown.tsx", import.meta.url), "utf8");

// ── Surface registration: mode, title, render branch, sidebar row ────────────

assert.match(modeType, /\| "grimoire"/, "grimoire is a WorkspaceMode");
assert.match(
  pageRegistry,
  /grimoire: \{\s*id: "grimoire",\s*title: "Memories",/,
  "grimoire has a page-registry title reading Memories",
);
assert.match(
  workspace,
  /mode === "grimoire" \? \(\s*<GrimoireView\s+view=\{variant === "journal" \? "journal" : grimoireView\}/,
  "grimoire mode renders the controlled view while preserving Journal page variants",
);
// Journal is now a tab inside Grimoire: the nav/deep-link `journal` mode opens
// Grimoire on its Journal tab instead of redirecting to Settings.
assert.match(workspace, /if \(next === "journal"\) \{[\s\S]{0,400}setGrimoireView\("journal"\);\s*\n\s*commitMode\("grimoire", "journal"\);/, "the journal mode routes into the Grimoire Journal tab and preserves that destination in history");
assert.match(navigation, /export type WorkspaceNavMode = WorkspaceMode/, "the shared registry uses the WorkspaceMode union (no drifting copy)");
assert.match(navigation, /id: "grimoire", label: "Memories"/, "grimoire has a navigation row labeled Memories (and a ⌘K palette entry)");
assert.match(
  sidebar,
  /sidebarDestinations\(\)/,
  "the sidebar renders rows from the shared destination policy",
);
assert.match(
  view,
  /<Link\s+href="\/weaves"\s+role="menuitem"/,
  "Memories exposes its nested protected-memory Weaves destination",
);
assert.match(view, /<span>Weaves<\/span>/, "the protected-memory destination has a visible overflow label");
assert.match(view, /docModeTriggerRef\.current\?\.focus\(\)/, "leaving focus reading restores focus to the stable Edit/Done control");
assert.match(view, /<PopoverItem icon="ph:push-pin" onSelect=\{\(\) => openStitchNew\(\)\}>\s*New stitch/, "New stitch remains reachable from overflow when narrow chrome hides its direct control");

// ── Library navigator: stitches + familiar memory ────────────────────────────

assert.match(view, /export function GrimoireView\(/, "GrimoireView must be exported");
assert.match(view, /readSurfaceResource<[^>]+>\("grimoire:knowledge", force\)/, "navigator consumes the shared knowledge cache");
assert.match(view, /readSurfaceResource<[^>]+>\("memory:list", force\)/, "navigator consumes the shared memory cache");
assert.match(view, /readSurfaceResource<[^>]+>\("grimoire:journal", force\)/, "navigator consumes the shared journal cache");
assert.match(warmupRegistry, /defineResource\("grimoire:knowledge",[^\n]+"\/api\/knowledge"/, "knowledge cache loads the vault endpoint");
assert.match(warmupRegistry, /defineResource\("memory:list",[^\n]+"\/api\/memory"/, "memory cache loads memory files");
assert.match(warmupRegistry, /defineResource\("grimoire:journal",[^\n]+"\/api\/journal"/, "journal cache loads journal days");
assert.match(view, /aria-label="Search grimoire documents"/, "doc search is labelled");
assert.match(view, /openTabs\.length > 0 \? "contents" : "memories-mobile-search"/, "the narrow navigator retains search before any document is opened");
assert.match(explorationCss, /@container grimoire \(max-width: 879px\)\s*\{\s*\.memories-mobile-search \{ display: contents;/, "navigator search is exposed where the wide Recall landing is hidden");
assert.match(view, /shellScope\.size === 0 \|\| shellScope\.has\(localFamiliarId\)/, "local familiar filtering cannot widen the shell scope");
assert.match(view, /<JournalEntries[^>]+scopeFamiliarIds=\{memoryScope\}/, "Journal shares the Library and Relations familiar filter");
assert.match(explorationCss, /\.grimoire-journal-tab \.journal-list \{ flex-direction: column;/, "narrow Journal panes stack the entry rail above the reader");
// cave-zqhr: the doc search moved OUT of the navigator rail into the compact
// header beside the Library/Journal/Relations tabs. It must be the shared
// SearchInput in the actions cluster, and the rail must not grow a second
// input back.
assert.match(
  view,
  /surface-compact-actions[\s\S]{0,2300}<SearchInput\s[\s\S]{0,300}containerClassName="surface-compact-search"/,
  "the doc search is a shared SearchInput in the header actions cluster, not in the rail",
);
assert.doesNotMatch(
  view,
  /<aside[\s\S]*?type="search"/,
  "the navigator rail carries no search input of its own (header owns it — cave-zqhr)",
);
assert.match(view, /New stitch/, "stitches can be sewn from pinned sources here");
assert.match(view, /Blank entry/, "hand-written entries can still be created");
assert.match(
  view,
  /ariaLabel="Stitches"[\s\S]*ariaLabel="Memory files"/,
  "sections are labelled landmarks (RailSection renders section[aria-label])",
);
assert.doesNotMatch(view, /ariaLabel="Journal"/, "Journal is not duplicated inside Library");
assert.match(view, /<section aria-label=\{ariaLabel\}>/, "RailSection emits the section landmark");

// ── Navigator sections collapse (persisted), search overrides collapse ──────
assert.match(view, /"cave:grimoire:rail-collapsed"/, "section collapse persists to localStorage");
assert.match(view, /aria-expanded=\{!collapsed\}/, "section headers expose their expanded state");
assert.match(
  view,
  /collapsed=\{!q && collapsedSections\.knowledge\}/,
  "an active search auto-expands sections so matches stay reachable",
);
assert.match(view, /ariaLabel="Stitches"\s+icon="ph:book-open"/, "stitches carry their kind icon");
assert.match(view, /ariaLabel="Memory files"\s+icon="ph:brain"/, "memory carries its kind icon");

// ── Whole navigator collapse (persisted compact rail) ───────────────────────
assert.match(
  view,
  /NAVIGATOR_COLLAPSED_STORAGE_KEY = "cave:grimoire:navigator-collapsed:v1"/,
  "whole navigator collapse persists locally",
);
assert.match(
  view,
  /aria-label=\{navigatorCollapsed \? "Expand Memories sidebar" : "Collapse Memories sidebar"\}/,
  "navigator toggle exposes its resulting action",
);
assert.match(
  view,
  /navigatorCollapsedForDisplay \? "@min-\[880px\]\/grimoire:w-\[44px\]" : "@min-\[880px\]\/grimoire:w-\[264px\]"/,
  "collapsed navigator becomes a compact rail instead of disappearing",
);
assert.match(view, /aria-label="Open Stitches navigator"/, "compact rail keeps Stitches reachable");
assert.match(view, /aria-label="Open Memory files navigator"/, "compact rail keeps memory files reachable");
assert.doesNotMatch(view, /aria-label="Open Journal navigator"/, "compact Library rail does not duplicate Journal");
assert.match(
  view,
  /const navigatorCollapsedForDisplay = navigatorCollapsed && !q;/,
  "an active document search forces the whole navigator open without changing its persisted preference",
);
assert.match(
  view,
  /navigatorCollapsedForDisplay \? "@min-\[880px\]\/grimoire:w-\[44px\]" : "@min-\[880px\]\/grimoire:w-\[264px\]"/,
  "the rail width uses the search-aware display state",
);
assert.match(
  view,
  /\{navigatorCollapsedForDisplay \? \(/,
  "the compact navigator branch is suppressed while searching",
);
// Span widened from 240 to 800: the toggle row now carries a Navigator title
// before the button, so onClick sits further from the opening <div>.
assert.match(
  view,
  /\{!q \? \(\s*<div[\s\S]{0,800}onClick=\{toggleNavigator\}/,
  "the collapse toggle is hidden while search forces the navigator open",
);

// The expanded rail's toggle row is titled — a bare right-aligned button gave
// the sidebar no visible name of its own.
assert.match(
  view,
  /navigatorCollapsed \? null : \(\s*<h2[\s\S]{0,240}>\s*Navigator\s*<\/h2>\s*\)\}\s*<button[\s\S]{0,200}onClick=\{toggleNavigator\}/,
  "the expanded navigator's toggle row shows a Navigator title to the left of the collapse toggle",
);
assert.match(
  view,
  /navigatorCollapsed \? "justify-center p-1" : "justify-between gap-2 p-1\.5"/,
  "the toggle row splits title-left / toggle-right when expanded and centers the toggle when collapsed",
);

// ── Memory is scoped to the shell's familiar multiselect ────────────────────
// The Memories surface used to list every familiar's memory files regardless
// of the sidebar selection. Empty selection is still "All" (familiarInScope).
assert.match(view, /scopeFamiliarIds\?: ReadonlySet<string>/, "GrimoireView accepts the familiar scope");
assert.match(
  view,
  /const shellScope = scopeFamiliarIds \?\? EMPTY_FAMILIAR_SCOPE/,
  "an absent scope falls back to the canonical empty (All) selection",
);
assert.match(
  view,
  /const scopedMemory = useMemo\(\s*\(\) => \(memory \?\? \[\]\)\.filter\(\(e\) => familiarInScope\(memoryScope, e\.familiarId\)\)/,
  "memory files are filtered by the selected familiars before search",
);
assert.match(view, /memory=\{scopedMemory\}/, "the launcher's Recall rows use the same scoped list as the rail");
assert.match(
  view,
  /No memory for \$\{memoryScopeLabel\} yet/,
  "a scoped-but-empty Memory section says which familiars it is narrowed to",
);
assert.match(
  workspace,
  /<GrimoireView[\s\S]{0,240}scopeFamiliarIds=\{scopeIds\}/,
  "the Workspace hands Memories the same familiar scope as Tasks and Schedules",
);

// ── …and so is the Relations graph ──────────────────────────────────────────
// The graph reads the SAME multiselect as the rail, so Relations can never
// show a familiar's memory that the navigator beside it is hiding.
assert.match(
  view,
  /const memoryOwnerByNodeId = useMemo\(\(\) => buildMemoryOwnerIndex\(memory \?\? \[\]\), \[memory\]\)/,
  "ownership is indexed from the UNSCOPED inventory — the graph itself carries only paths",
);
assert.match(
  view,
  /const scopedGraph = useMemo\(\s*\(\) => scopeDocGraph\(graph, memoryScope, memoryOwnerByNodeId\)/,
  "the graph is narrowed by the same memoryScope the Memory rail uses",
);
assert.match(view, /graph=\{scopedGraph\}/, "the launcher's graph stats reflect the scope, like its memory stats");
assert.match(
  view,
  /<GrimoireGraphView\s*\n\s*graph=\{scopedGraph\}[\s\S]{0,400}scopeLabel=\{memoryScopeLabel\}/,
  "the Relations canvas renders the scoped graph and is told who it is scoped to",
);
// Backlinks and [[wiki-link]] resolution stay on the UNSCOPED graph: a
// document's own connections are an integrity signal, not a corpus browse.
assert.match(
  view,
  /const backlinks = useMemo<GrimoireBacklink\[\]>\(\(\) => \{[\s\S]{0,400}new Map\(graph\.nodes\.map/,
  "backlinks keep reading the unscoped graph so link integrity survives a UI filter",
);

// ── Detail: the right transport per source ───────────────────────────────────

assert.match(view, /<MemoryMdEditor/, "memory docs edit through the mtime-guarded memory editor");
assert.match(view, /method: "POST",[\s\S]*?\/api\/knowledge|\/api\/knowledge",\s*\{\s*method: "POST"/, "knowledge saves POST the vault API");
assert.match(view, /rawToKnowledgePayload/, "knowledge title/tags round-trip through frontmatter mapping");
assert.match(view, /showHeader=\{false\}/, "journal reflections edit without a frontmatter header");
assert.match(view, /reflectedBy: state\?\.reflectedBy \?\? familiar \?\? null/, "journal saves preserve the reflecting familiar and keep a familiar's own entry theirs");

// ── Deep link + responsive master-detail ─────────────────────────────────────

assert.match(view, /#grimoire:/, "selection is deep-linkable via #grimoire:<kind>:<id>");
assert.match(view, /GRIMOIRE_HASH_PREFIX/, "hash prefix is shared with cross-surface links (grimoire-link.ts)");
assert.match(view, /decodeURIComponent/, "hash ids are URL-decoded");
assert.match(view, /aria-label="Back to document list"/, "compact widths get a back affordance");
assert.match(view, /@container\/grimoire/, "layout adapts via container queries");
// (grimoire-audit cave-quct) Graph mode must own the narrow viewport: the rail
// hides when the graph is showing, and the graph pane gets its own back row.
assert.match(
  view,
  /view !== "docs"\s*\n\s*\? "grimoire-navigator--hidden"\s*\n\s*: selection\s*\n\s*\? "grimoire-navigator--detail"/,
  "Journal and Relations hide the Library navigator at every width; a narrow open doc hides it too",
);
assert.match(
  grimoireCss,
  /\.grimoire-navigator--hidden \{\s*display: none;\s*\}/,
  "the hidden navigator gives Journal and Relations the whole surface",
);
assert.match(
  view,
  /onClick=\{\(\) => setView\("docs"\)\}\s*\n\s*aria-label="Back to document list"/,
  "the graph pane has its own narrow-width back affordance",
);

// ── (grimoire-audit cave-eg6f) rail keyboard navigation ─────────────────────
// One roving tab stop across the whole navigator: section headers, memory
// group toggles, rows, and show-more — reaching Journal never means tabbing
// through hundreds of memory rows.
assert.match(
  view,
  /useRovingTabIndex\(\{\s*\n\s*containerRef: railListRef,\s*\n\s*itemSelector: "\[data-rail-item\]",\s*\n\s*orientation: "vertical",/,
  "the rail roves focus vertically",
);
assert.match(view, /ref=\{railListRef\}/, "the rail scroll container carries the roving scope");
const railItemCount = (view.match(/data-rail-item/g) ?? []).length;
assert.ok(railItemCount >= 4, `NavRow, section headers, group toggles, and show-more are all roving items (found ${railItemCount})`);

// ── (grimoire-audit cave-v1j0) memory grouped by source root ────────────────
// Runtime roots write thousands of timestamp-named files; grouping by
// rootLabel with big groups collapsed keeps Knowledge and Journal visible.
assert.match(view, /"cave:grimoire:memory-groups-collapsed"/, "memory group collapse overrides persist");
assert.match(view, /const grouped = memoryGroups\.length > 1/, "a lone memory root renders flat (no redundant header)");
assert.match(view, /defaultCollapsed = grouped && group\.entries\.length > 20/, "big memory groups start collapsed");
assert.match(
  view,
  /grouped && !q && \(collapsedMemoryGroups\[group\.label\] \?\? defaultCollapsed\)/,
  "an active search expands memory groups so matches stay reachable",
);
assert.match(view, /Show more \(\{group\.entries\.length - limit\} remaining\)/, "each group pages independently");

// ── (grimoire-audit Batch A quick wins) ──────────────────────────────────────
// cave-0rx0: journal dates honor the user's datetime prefs everywhere they
// remain visible (Continue, tabs, editor footer, delete confirm).
assert.match(view, /function journalDayLabel\(date: string, prefs: DateTimePrefs\)/, "there is a shared journal date label helper");
assert.match(view, /new Date\(`\$\{date\}T00:00:00`\)/, "date-only strings anchor to local midnight (no UTC day shift)");
assert.match(view, /journalTitle=\{\(date, familiar\) =>\s*\n\s*familiar \? `\$\{journalDayLabel\(date, dateTimePrefs\)\} · \$\{familiarLabel\(familiar\)\}` : journalDayLabel\(date, dateTimePrefs\)/, "Continue journal rows format through prefs and name the reflecting familiar");
assert.match(view, /return journalDayLabel\(sel\.date, dateTimePrefs\)/, "journal tab labels format through prefs");
assert.match(view, /Journal · \$\{journalDayLabel\(date, dateTimePrefs\)\}/, "the editor footer source label formats through prefs");
assert.match(view, /journalDayLabel\(selection\.date, readDateTimePrefs\(\)\)/, "the delete confirm formats through prefs");
// cave-ezxb: the over-cap tab eviction announces instead of silently closing.
assert.match(view, /evictedRef\.current = tabs\[evictIndex\] \?\? null/, "openDoc records what it evicted");
assert.match(view, /announce\(`Closed \$\{tabTitle\(evictedRef\.current\)\} — \$\{MAX_OPEN_TABS\}-tab limit reached`/, "evictions are announced post-commit");
// cave-gsvf: search results are announced to screen readers (debounced).
assert.match(view, /No documents match/, "an empty result set announces");
assert.match(view, /stitches, \$\{visibleMemory\.length\} memory/, "Library search announces stitches and memory counts");
assert.doesNotMatch(view, /visibleJournal\.length\} journal/, "Library search does not report a hidden Journal group");
// cave-bkpj: unresolved wiki-link chips are actionable on touch — tapping
// shows a visible hint (and announces it) instead of a hover-only title.
assert.match(view, /const \[unresolvedHint, setUnresolvedHint\] = useState<string \| null>/, "unresolved chips have a tap-visible hint");
assert.match(view, /has no matching doc yet — create a stitch/, "the hint says how to resolve the link");
assert.match(view, /aria-expanded=\{unresolvedHint === display\}/, "the unresolved chip exposes its hint state");

// ── Delete/trash actions (cave-kv3) ──────────────────────────────────────────

assert.match(view, /useConfirm\(\)/, "destructive actions confirm through the shared dialog");
assert.match(view, /\/api\/memory\/delete/, "memory files archive through the trash API");
assert.match(view, /\/api\/knowledge\?id=\$\{encodeURIComponent\(selection\.id\)\}/, "knowledge entries delete through their API");
assert.match(view, /\/api\/journal\?\$\{journalEntryQuery\(selection\.date, selection\.familiar\)\}`, \{ method: "DELETE" \}/, "journal reflections delete through their API, scoped to the owning familiar");
assert.match(view, /Move to trash/, "memory delete is labelled as restorable trash");
assert.match(view, /danger: true/, "the confirm renders its destructive style");
assert.match(
  view,
  /function invalidateGrimoireLanding\(\): void \{\s*invalidateSurfaceResources\("grimoire:knowledge", "grimoire:collections", "memory:list", "grimoire:journal"\);/,
  "the shared landing cache has one invalidation boundary",
);
assert.match(
  view,
  /closeTab\(selectionKey\(selection\)\);\s*invalidateGrimoireLanding\(\);\s*void load\(true\)/,
  "a successful delete invalidates and reloads the navigator",
);
assert.match(view, /deleteError \? \(\s*<div role="alert"/, "delete failures are announced in a persistent desktop-visible row");
// (cave-mglw) successful deletes are announced too — the row vanishing was the
// only confirmation, silent to screen readers.
assert.match(view, /announce\(\s*\n\s*selection\.kind === "memory"\s*\n\s*\? "Memory file moved to trash"/, "successful deletes announce per document kind");

// ── Tabs: persisted multi-doc editing (cave-90u) ─────────────────────────────

assert.match(view, /"cave:grimoire:tabs"/, "open tabs persist to localStorage (recent docs across sessions)");
assert.match(view, /"cave:grimoire:active-tab"/, "the active tab persists too");
assert.match(view, /export const MAX_OPEN_TABS = 8/, "open-tab count is capped");
assert.match(view, /role="tablist"[\s\S]*?aria-label="Open documents"/, "tab strip is an accessible tablist");
assert.match(view, /role="tab"[\s\S]*?aria-selected=\{active\}/, "tabs expose selection state");
assert.match(view, /aria-label=\{`Close \$\{tabTitle\(tab\)\}/, "each tab has a labelled close button");
// (cave-mglw) full tabs pattern: one roving tab stop (←/→ between tabs) and
// tab ↔ tabpanel wiring. The strip stays hand-rolled because the shared
// ui/tabs primitive has no per-tab close button.
assert.match(view, /useRovingTabIndex\(\{\s*\n\s*containerRef: tabStripRef,\s*\n\s*itemSelector: '\[role="tab"\]',/, "the tab strip roves focus");
assert.match(view, /if \(selectedTabIndex >= 0\) setTabStopIndex\(selectedTabIndex\)/, "the tab stop follows the selected tab");
assert.match(view, /aria-controls=\{`grimoire-tabpanel-\$\{i\}`\}/, "tabs point at their panels");
assert.match(view, /role="tabpanel"\s*\n\s*id=\{`grimoire-tabpanel-\$\{i\}`\}\s*\n\s*aria-labelledby=\{`grimoire-tab-\$\{i\}`\}/, "panels are labelled by their tabs");
// The core multi-tab behavior: every open tab's editor stays mounted so
// unsaved drafts survive switching tabs (inactive tabs are display:none).
assert.match(view, /key === selectedKey \? "h-full min-h-0" : "hidden"/, "inactive tab editors stay mounted, just hidden");
assert.match(view, /kind !== "knowledge-new"/, "unsaved new-entry drafts are not restored across reloads");
assert.match(view, /replaceTab\(key, \{ kind: "knowledge", id: saved\.id,[\s\S]{0,120}saved\.collection/, "saving a new entry swaps its draft tab for the real doc, preserving collection");
assert.match(view, /const evictIndex = tabs\.findIndex/, "over-cap opens evict the oldest non-active tab");
assert.match(view, /fromHash/, "a #grimoire: deep link merges into (and activates within) the restored tab set");

// ── Reader-first documents ──────────────────────────────────────────────────
// Every persisted doc opens in the shared DocumentReader; editing is an
// explicit per-tab step (Edit / E) that Done, Cancel, or Esc ends.
assert.match(view, /const \[editingTabs, setEditingTabs\] = useState<Record<string, true>>\(\{\}\)/, "editing is explicit per-tab state; reading is the default");
assert.match(view, /tab\.kind === "knowledge-new" \|\| editingTabs\[selectionKey\(tab\)\] === true/, "only a blank entry opens straight into the editor");
assert.match(view, /selectedKnowledgeEntry[\s\S]{0,600}readerEligible[\s\S]{0,300}selection\.kind !== "knowledge-new"[\s\S]{0,160}selection\.kind !== "knowledge" \|\| selectedKnowledgeEntry !== null/, "reading, Edit/Done, and focus are limited to loaded persisted documents");
assert.match(view, /<GrimoireDocReader\b/, "stitches read in the Library reader");
assert.match(view, /<MemoryDocReader\b/, "memory files read in the Library reader");
assert.match(view, /<JournalDocReader\b/, "journal reflections read in the Library reader");
assert.match(view, /const editorMounted = editing \|\| dirtyTabs\[key\] === true/, "an editor holding unsaved changes stays mounted while its tab reads");
assert.match(view, /className=\{editing \? "min-h-0 flex-1 outline-none" : "hidden"\}/, "a dirty editor is hidden, not unmounted, while reading");
assert.match(view, /This document has unsaved changes\.[\s\S]{0,200}Resume editing/, "the reader says when a draft is waiting and offers the way back");
assert.match(view, /\(editorMounted \? knowledgeDrafts\[key\] : undefined\) \?\? knowledgeEntryToRaw\(entry\)/, "a stitch reads its live draft while an editor holds one");
assert.match(view, /onKeyDownCapture=\{editing \? \(event\) => onEditorKeyDown\(event, tab\) : undefined\}/, "Esc inside the editor is seen before the visual editor consumes it");
assert.match(view, /event\.key !== "Escape" \|\| event\.defaultPrevented \|\| tab\.kind === "knowledge-new"/, "Esc returns to reading (a blank entry has nothing to read yet)");
assert.match(view, /\.milkdown-slash-menu\[data-show="true"\]/, "Esc still closes the visual editor's own menus first");
assert.match(view, /event\.target !== document\.body[\s\S]{0,120}stopEditing\(selectedKey\)/, "Esc with nothing focused still ends editing");
assert.match(view, /onCancel=\{\(\) => \(tab\.kind === "knowledge-new" \? closeTab\(key\) : stopEditing\(key\)\)\}/, "Cancel returns to reading; only a blank entry's Cancel closes it");
assert.match(view, /onCancel=\{\(\) => stopEditing\(key\)\}\s*\n\s*onSaved=\{\(\) => bumpReader\(key\)\}/, "a saved memory file re-reads in the reader");
assert.match(view, /selectedEditing \? stopEditing\(selectedKey\) : startEditing\(selectedKey\)/, "one stable header control toggles the open document between reading and editing");
assert.match(view, /\{selectedEditing \? "Done" : "Edit"\}/, "the toggle names the next action");
assert.match(view, /ref=\{docModeTriggerRef\}/, "the Edit/Done control is the stable focus target");
assert.match(view, /data-grimoire-editor=\{key\}/, "editors are addressable so Edit can hand them the keyboard");
assert.match(view, /\.ProseMirror\[contenteditable='true'\], \.cm-content/, "starting an edit focuses the visual or markdown surface once it mounts");
assert.match(view, /requestReaderFocus\(key\);\s*\n\s*announce\("Reading", "polite"\)/, "returning to reading hands focus back to the document and announces it");
assert.match(view, /<PopoverItem icon="ph:copy" onSelect=\{\(\) => void copySelectionMarkdown\(\)\}>\s*Copy markdown/, "the open document's markdown is one overflow action away");
assert.doesNotMatch(view, /readerMode=\{/, "editors no longer double as a read-only renderer");

// Focus reading (formerly Reader mode): the open document alone.
assert.match(view, /const \[focusMode, setFocusMode\] = useState\(false\)/, "focus reading is explicit surface state");
assert.match(view, /const focusEligible = readerEligible && !selectedEditing/, "focus reading applies to a document being read");
assert.match(view, /onSelect=\{\(\) => setFocusMode\(true\)\}>\s*Focus reading/, "focus reading is reachable from overflow");
assert.match(view, /event\.key !== "Escape" \|\| event\.defaultPrevented\) return;\s*\n\s*event\.preventDefault\(\);\s*\n\s*leaveFocus\(\)/, "Escape exits focus reading through the focus-restoring path");
assert.match(view, /className="grimoire-reader-header"/, "focus reading replaces the surface chrome with a compact document bar");
assert.match(view, /Esc to exit focus/, "the focus bar names its exit");
assert.match(view, /aria-label="Exit focus reading"/, "the focus bar has an explicit exit control");
assert.match(view, /const readerTitle =[\s\S]{0,500}knowledgeDrafts/, "focus reading derives its label from the live knowledge draft");
assert.match(view, /<h1[^>]*>[\s\S]{0,120}\{readerTitle\}[\s\S]{0,40}<\/h1>/, "focus reading retains a live level-one document heading");
assert.match(view, /if \(focusMode && selectedKey\) requestReaderFocus\(selectedKey\)/, "focus reading hands the keyboard to the document, including after link navigation");
assert.match(view, /<Icon name="ph:pencil-simple"[\s\S]{0,80}Edit/, "the edit action is visibly labelled Edit");
assert.match(view, /visualLifecycleQueuesRef[\s\S]{0,900}visualLifecycleQueueFor/, "each persistent Grimoire tab owns a stable visual lifecycle queue");
assert.match(view, /visualLifecycleQueuesRef\.current\.set\(nextKey, queue\)/, "draft-to-saved tab replacement preserves its lifecycle queue");
assert.match(view, /openTabKeysRef\.current\.has\(key\)[\s\S]{0,500}visualLifecycleQueuesRef\.current\.delete\(key\)/, "closed and evicted tabs release settled visual lifecycle queues");
assert.match(view, /visualLifecycleQueuesRef\.current\.get\(key\) !== queue/, "queue cleanup cannot delete a replacement queue for a reopened tab");
assert.match(view, /setKnowledgeDrafts[\s\S]{0,500}openTabKeys\.has\(key\)/, "closed and evicted tabs discard their live knowledge drafts");
assert.match(view, /const draft = previous\[fromKey\][\s\S]{0,300}\[nextKey\]: draft/, "draft-to-saved tab replacement preserves its live markdown");
assert.match(view, /const wasEditing = fromKey === "knowledge-new" \|\| previous\[fromKey\] === true/, "a blank entry keeps editing after its first save; a sewn stitch opens to read");
assert.match(view, /focusMode \? "hidden" : "flex shrink-0 items-center/, "the open-document tab strip is suppressed in focus reading");
assert.match(view, /selection && selection\.kind !== "knowledge-new" && selection\.kind !== "stitch-new"/, "document links remain reachable beneath the reading canvas");
assert.match(view, /liveMarkdown=\{selection\.kind === "knowledge"[\s\S]{0,180}knowledgeDrafts\[selectedKey\]/, "doc links resolve from the active live knowledge draft");
assert.match(view, /liveMarkdown \?\? knowledge\.find/, "persisted knowledge remains the outgoing-link fallback");
assert.match(view, /@min-\[480px\]\/grimoire:inline/, "focus keyboard guidance follows the Grimoire container instead of the viewport");
assert.match(view, /!focusMode \? \(\s*<div className="grimoire-mobile-back/, "narrow persisted and new-document views retain an explicit way back to the document list");
assert.match(grimoireCss, /@container grimoire \(max-width: 760px\)[\s\S]{0,700}grimoire-tabs[\s\S]{0,300}overflow-x: auto[\s\S]{0,700}@container grimoire \(max-width: 480px\)[\s\S]{0,160}grimoire-newstitch/, "narrow document chrome scrolls its tabs so primary and overflow actions remain reachable");

// The Library reader itself.
assert.match(docReader, /parseMarkdownReaderDocument\(doc\.body, title\)/, "the reader parses the body so a document's own H1 wins over its vault title");
assert.match(docReader, /const navigation = namedSections >= 2 \? "rail" : "none"/, "the contents rail renders for documents with two or more headings");
assert.match(docReader, /collapsibleSections=\{false\}/, "headings read as headings, not toggles");
assert.match(docReader, /scrollLabel="Document reader"/, "the reading column is a focusable, labelled region");
assert.match(docReader, /formatReadingMeta\(parsed\.stats\)/, "reading mode shows reading time and words (chars and tokens stay in the editor footer)");
assert.match(docReader, /event\.key !== "e" && event\.key !== "E"[\s\S]{0,200}isEditableTarget\(event\.target\)[\s\S]{0,300}onEdit\(\)/, "E starts editing while the reader has focus");
assert.match(docReader, /<ReaderWikiLinkContext\.Provider value=\{wikiLinks\}>/, "wiki-links in the prose resolve against the Library index");
assert.match(docReader, /resolveWikiLinkTarget\(target, docIndex\)/, "prose wiki-links use the same resolver as the chip row");
assert.match(docReader, /onScrollProgress=\{onScrollProgress\}/, "the reader drives a scroll progress bar");
assert.match(docReader, /readerScrollMemory\.set\(docKey, progress\)/, "reading position survives tab switches and edit sessions");
assert.match(docReader, /LIVE_FOLLOW_INTERVAL_MS/, "an open memory file follows agent writes while it is read");
assert.match(readerMarkdown, /export const ReaderWikiLinkContext = createContext<ReaderWikiLinks \| null>\(null\)/, "wiki-link handling is opt-in for other readers");
assert.match(grimoireCss, /--document-reader-prose-measure: var\(--cave-reading-width, 68ch\)/, "the Library reader keeps a ~70-character measure unless the reading width preference says otherwise");
assert.match(grimoireCss, /\.grimoire-reader \.document-reader__list--ordered \{\s*list-style: decimal;/, "numbered lists keep their numbers in the reader");
assert.match(grimoireCss, /--document-reader-accent: var\(--accent-presence\)/, "the reader's active contents entry and links use the presence accent");

// ── Navigator readability: clean titles, quiet tags, mission groups ─────────
assert.match(view, /from "@\/lib\/grimoire-library"/, "the navigator uses the shared Library presentation helpers");
assert.match(view, /const tags = stitchTagView\(entry\.tags\)/, "rows split human tags from machine bookkeeping");
assert.match(view, /hint=\{!child && tags\.research \? "Research" : undefined\}/, "a mission tag becomes a Research provenance hint");
assert.match(view, /stitchDisplayTitle\(entry, missionTitles\)/, "rows, tabs, and the launcher show cleaned, disambiguated titles");
assert.match(view, /groupMissionStitches\(entries, missionTitles\)/, "consecutive mission artifacts fold into one group");
assert.match(view, /"cave:grimoire:mission-groups-expanded"/, "mission group expansion persists");
assert.match(view, /Boolean\(q\) \|\| \(expandedMissionGroups\[group\.missionId\] \?\? holdsSelection\)/, "groups start folded, unfold around the open doc, and unfold for search");
assert.match(view, /<button\s*\n\s*type="button"\s*\n\s*data-rail-item\s*\n\s*aria-expanded=\{expanded\}/, "mission group headers are roving rail items with expanded state");
assert.match(view, /missionId \? missionTitles\.get\(missionId\) : null/, "searching a mission's question finds all of its artifacts");
assert.match(view, /knowledge=\{launcherKnowledge\}/, "the launcher reads the same disambiguated titles");

// ── cave-xr0 slice 2: outgoing [[wiki-link]] chips ──────────────────────────
// The open doc's resolved wiki-links render as a chip row below the editor,
// resolved against the loaded doc lists (no server index); resolved chips
// navigate via openDoc, unresolved ones render dashed + inert.
assert.match(view, /from "@\/lib\/wiki-link-resolve"/, "grimoire-view uses the wiki-link resolver engine");
assert.match(view, /function GrimoireDocLinks\(/, "there is a doc-links chip component");
assert.match(view, /resolveOutgoingLinks\(markdown, docIndex\)/, "chips come from resolving the open doc's markdown against the index");
assert.match(
  view,
  /docIndex = useMemo<WikiDocIndex>\([\s\S]{0,220}memory:[\s\S]{0,40}m\.fullPath/,
  "the doc index maps memory entries by fullPath (the same path openDoc navigates to)",
);
assert.match(view, /onClick=\{\(\) => onOpen\(ref\)\}/, "a resolved chip navigates to its doc");
assert.match(view, /title="No matching Memories doc"[\s\S]{0,600}border-dashed/, "an unresolved link renders dashed with a hint (tap shows why — cave-bkpj)");
assert.match(view, /<GrimoireDocLinks\b[\s\S]{0,500}onOpen=\{openDoc\}/, "the chip row is wired to openDoc for the active doc");

// ── Knowledge collections + continuity flags ────────────────────────────────
assert.match(view, /"cave:grimoire:stitch-groups-collapsed"/, "stitch collection collapse overrides persist");
assert.match(view, /readSurfaceResource<[^>]+>\("grimoire:collections", force\)/, "collection metadata consumes the shared cache");
assert.match(warmupRegistry, /defineResource\("grimoire:collections",[^\n]+"\/api\/knowledge\/collections"/, "collection metadata cache loads alongside knowledge");
assert.match(view, /groupKnowledgeByCollection\(visibleKnowledge, collections \?\? \[\]\)/, "stitches group by collection metadata");
assert.match(view, /knowledgeDocKey\(entry\.id, entry\.collection\)/, "knowledge row keys include collection identity");
assert.match(view, /knowledgeEntryFlags\(entry\)/, "continuity flags are surfaced for open and rail entries");
assert.match(view, /Continuity flags — resolve by editing the <code className="font-mono">flags:<\/code> list in frontmatter/, "open flagged entries show a frontmatter-resolution banner");
assert.match(view, /buildStubPayload\(display, collection, sourceTitle\)/, "unresolved wiki chips build one-click stub payloads");
assert.match(view, /Create in \$\{collection\.meta\?\.name \?\? collection\.id\}/, "unresolved wiki chips offer collection stub buttons");

// ── Backlinks: incoming mentions from the doc graph (cave-hand) ──────────────
// The active doc's incoming link/mention edges surface as a second chip row
// ("Mentions"); mention-sourced chips render dashed to read as inferred.
assert.match(view, /backlinks = useMemo<GrimoireBacklink\[\]>/, "backlinks derive from the doc graph");
assert.match(view, /e\.target !== activeKey \|\| e\.type === "tag"/, "backlinks keep link+mention edges targeting the active doc (tags excluded)");
assert.match(view, /<GrimoireDocLinks\b[\s\S]{0,500}backlinks=\{backlinks\}/, "the chip row receives the backlinks");
assert.match(view, /b\.type === "mention" \? "Mentions this doc \(unlinked\)" : "Links to this doc"/, "chips distinguish inferred mentions from explicit links");

// ── The doc graph (cave-hand): full-corpus scan + Obsidian-style canvas ──────
// GET /api/grimoire/graph scans knowledge+memory+journal server-side; until it
// lands (or if it fails) the client-built knowledge graph stands in, so the
// graph is never blank while docs exist. A segmented Docs|Graph header control
// swaps the detail pane for the lazy-loaded canvas; clicking a node opens it.
assert.match(view, /from "@\/lib\/grimoire-graph"/, "grimoire-view builds the fallback graph via the graph lib");
assert.match(view, /import\("@\/components\/grimoire-graph-view"\)/, "the canvas graph is lazy-loaded (dynamic import)");
assert.match(view, /ssr: false/, "the graph view is client-only (no SSR)");
assert.match(scanHook, /fetch\(`\/api\/grimoire\/graph\$\{params\}`/, "the graph comes from the server scan");
// cave-z6xvd: the familiar scope rides the request so the scan's cap applies to
// the scoped set. Scoping only on the client meant a familiar saw their (F/T)
// slice of the coven's most-recent N, never all of their own files.
assert.match(
  scanHook,
  /familiarId=\$\{encodeURIComponent\(id\)\}/,
  "the scan request carries the familiar scope",
);
assert.match(
  scanHook,
  /\}, \[scanTick, scopeKey\]\)/,
  "the scan refetches when the scope changes, keyed by value so a new Set identity alone does not",
);
assert.match(view, /const localGraph = useMemo\([\s\S]{0,200}buildDocGraph\(/, "the fallback graph is memoized from buildDocGraph");
assert.match(view, /markdown: k\.body/, "the fallback graph reads each knowledge body (already loaded)");
assert.match(view, /const graph = scan\?\.graph \?\? localGraph/, "the server scan wins, the local graph stands in — never blank");
assert.match(view, /if \(firstLoadDoneRef\.current\) refreshGraph\(\)/, "saves/deletes rescan the graph (mount already fetched)");
assert.match(view, /aria-label="Memories view"/, "the Docs|Journal|Graph switch is a labelled control group");
assert.match(
  view,
  /aria-pressed=\{view === "docs"\}[\s\S]{0,900}aria-pressed=\{view === "journal"\}[\s\S]{0,900}aria-pressed=\{view === "graph"\}/,
  "the three-way segmented control exposes pressed state for docs, journal, and graph",
);
assert.match(
  view,
  /view === "graph" \? \([\s\S]{0,1200}<GrimoireGraphView[\s\S]{0,750}onOpen=\{\(ref\) => \{[\s\S]{0,80}openDoc\(ref\)/,
  "the graph replaces the detail pane and opens the clicked doc",
);
// Journal tab renders the full daily-reflection surface inside Grimoire (cave).
assert.match(
  view,
  /view === "journal" \? \([\s\S]{0,600}<JournalEntries familiars=\{familiars\} activeFamiliarId=\{activeFamiliarId\} scopeFamiliarIds=\{memoryScope\}/,
  "the Journal tab mounts the JournalEntries surface, scoped by the shell's familiar multiselect",
);
assert.match(
  view,
  /import \{ JournalEntries \} from "@\/components\/journal\/journal-entries"/,
  "grimoire-view imports the shared journal surface",
);
assert.match(view, /scanning=\{scanning\}/, "the graph view knows a scan is in flight");
assert.match(view, /scanError=\{scanError\}/, "a failed refresh stays visible even while previous connections remain on screen");

// ── Graph reachable on narrow / mobile (cave-quct) ───────────────────────────
// On a narrow container the rail and main pane both go full-width, so the rail
// must hide when the graph is up (not only when a doc is selected) or the graph
// is pushed off-screen; and the graph gets a narrow-only back affordance since
// the rail is then hidden.
assert.match(
  view,
  /focusMode[\s\S]{0,120}"grimoire-navigator--reader"[\s\S]{0,200}"grimoire-navigator--detail"/,
  "the rail hides in focus reading, for non-Library tabs, and on narrow when a doc is open",
);
assert.match(
  view,
  /onClick=\{\(\) => setView\("docs"\)\}[\s\S]{0,120}aria-label="Back to document list"/,
  "the graph view offers a back-to-documents affordance (rail is hidden on narrow)",
);

// ── Journal autosave conflict guard (cave-9f2e) ──────────────────────────────
// The Grimoire journal editor sends the mtime it loaded as an optimistic-
// concurrency baseline so its debounced autosave can't silently clobber a
// concurrent generation/edit; it refreshes that baseline from each successful
// save (so it never self-conflicts) and surfaces a 409 instead of overwriting.
assert.match(view, /const modifiedRef = useRef<string \| null>\(null\)/, "the journal editor tracks the loaded mtime baseline");
assert.match(view, /modifiedRef\.current = json\.modified \?\? null;/, "the baseline is captured on load");
assert.match(view, /expectedModified: modifiedRef\.current,/, "the autosave sends the mtime baseline");
assert.match(view, /if \(res\.status === 409\)/, "a journal write conflict is surfaced, not silently overwritten");
assert.match(view, /modifiedRef\.current = json\.modified \?\? modifiedRef\.current;/, "the baseline advances after a successful save so autosave can't self-conflict");

// ── Per-familiar journal entries ─────────────────────────────────────────────
// A date can carry one entry per familiar (`journal/familiars/<id>/<date>.md`)
// beside legacy coven-wide day files, so the familiar is part of a journal
// doc's identity everywhere the Library reads, writes, or links one.
assert.match(view, /fetch\(`\/api\/journal\?\$\{journalEntryQuery\(date, familiar\)\}`/, "the journal editor loads the owning familiar's entry");
assert.match(view, /fetch\(`\/api\/journal\?\$\{journalEntryQuery\(selection\.date, selection\.familiar\)\}`, \{ cache: "no-store" \}\)/, "doc links read the owning familiar's entry");
assert.match(view, /const familiar = journalRowFamiliar\(j\);\s*\n\s*return \{ date: j\.date, \.\.\.\(familiar \? \{ familiar \} : \{\}\) \}/, "the wiki doc index keys per-familiar entries by owner");
assert.match(view, /familiar=\{tab\.familiar\}/, "journal tabs hand their owner to the reader and editor");
assert.match(docReader, /journalEntryQuery\(date, familiar\)/, "the journal reader loads the owning familiar's entry");

// ── Dirty tabs: unsaved dot + confirm on close (cave-vv2h) ───────────────────
// Each editor reports dirty transitions up via onDirtyChange; the tab strip
// shows a dot and closing a dirty tab confirms instead of silently dropping
// unsaved edits (autosave mitigates, but conflict-paused docs stay dirty).
assert.match(view, /const \[dirtyTabs, setDirtyTabs\] = useState<Record<string, boolean>>\(\{\}\)/, "per-tab dirty flags are lifted into GrimoireView");
assert.match(view, /onDirtyChange=\{\(dirty\) => setTabDirty\(key, dirty\)\}/, "editors report dirty state keyed by tab");
assert.match(view, /\{dirtyTabs\[key\] \? \(\s*<span\s*\n?\s*title="Unsaved changes"/, "dirty tabs show an unsaved-changes dot");
assert.match(view, /aria-label=\{`Close \$\{tabTitle\(tab\)\}\$\{dirtyTabs\[key\] \? " \(unsaved changes\)" : ""\}`\}/, "the close button's label says when edits are unsaved");
assert.match(view, /if \(dirtyTabs\[key\]\) \{\s*\n\s*const ok = await confirm\(/, "closing a dirty tab confirms first");
assert.match(view, /onClick=\{\(\) => void requestCloseTab\(key, tabTitle\(tab\)\)\}/, "the tab strip close goes through the confirm path");

// ── Legibility floor (cave-zhk6) ─────────────────────────────────────────────
// 10px (--text-2xs) is reserved for uppercase eyebrow labels and count chips.
// Prose hints, alerts, and rail-row meta were bumped and must not creep back
// down: sentences read at 12px (--text-sm), secondary UI text at 11px.
assert.doesNotMatch(view, /Tip: type/, "documents without links no longer lose reading space to a persistent syntax tip");
assert.match(
  view,
  /text-\[length:var\(--text-sm\)\] text-\[var\(--text-muted\)\]">\s*\n\s*“\{unresolvedHint\}”/,
  "the unresolved-link hint sentence reads at --text-sm",
);
assert.match(
  view,
  /role="alert" className="shrink-0 border-b[^\"]+text-\[length:var\(--text-sm\)\]/,
  "the persistent delete-error alert reads at --text-sm",
);
assert.match(
  view,
  /mt-0\.5 flex items-center gap-1\.5 text-\[length:var\(--text-xs\)\]/,
  "rail-row meta (subtitle · date) reads at --text-xs, not 10px",
);

console.log("grimoire-view.test: ok");
