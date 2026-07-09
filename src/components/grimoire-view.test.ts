// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const view = await readFile(new URL("./grimoire-view.tsx", import.meta.url), "utf8");
const workspace = await readFile(new URL("./workspace.tsx", import.meta.url), "utf8");
const sidebar = await readFile(new URL("./sidebar-minimal.tsx", import.meta.url), "utf8");
const modeType = await readFile(new URL("../lib/workspace-mode.ts", import.meta.url), "utf8");

// ── Surface registration: mode, title, render branch, sidebar row ────────────

assert.match(modeType, /\| "grimoire"/, "grimoire is a WorkspaceMode");
assert.match(workspace, /grimoire: "Grimoire"/, "grimoire has a page title (sr-only h1)");
assert.match(workspace, /mode === "grimoire" \? \(\s*<GrimoireView \/>/, "grimoire mode renders GrimoireView");
assert.match(sidebar, /\| "grimoire"/, "grimoire is a FolderMode");
assert.match(sidebar, /id: "grimoire", label: "Grimoire"/, "grimoire has a sidebar row (and ⌘K palette entry via FOLDER_MODES)");

// ── Navigator: three sources, searchable, new-entry affordance ───────────────

assert.match(view, /export function GrimoireView\(/, "GrimoireView must be exported");
assert.match(view, /fetch\("\/api\/knowledge"/, "navigator lists the knowledge vault");
assert.match(view, /fetch\("\/api\/memory"/, "navigator lists memory files");
assert.match(view, /fetch\("\/api\/journal"/, "navigator lists journal days");
assert.match(view, /aria-label="Search grimoire documents"/, "navigator search is labelled");
assert.match(view, /New entry/, "knowledge entries can be created here");
assert.match(
  view,
  /ariaLabel="Knowledge vault"[\s\S]*ariaLabel="Memory files"[\s\S]*ariaLabel="Journal"/,
  "sections are labelled landmarks (RailSection renders section[aria-label])",
);
assert.match(view, /<section aria-label=\{ariaLabel\}>/, "RailSection emits the section landmark");

// ── Navigator sections collapse (persisted), search overrides collapse ──────
assert.match(view, /"cave:grimoire:rail-collapsed"/, "section collapse persists to localStorage");
assert.match(view, /aria-expanded=\{!collapsed\}/, "section headers expose their expanded state");
assert.match(
  view,
  /collapsed=\{!q && collapsedSections\.knowledge\}/,
  "an active search auto-expands sections so matches stay reachable",
);
assert.match(view, /ariaLabel="Knowledge vault"\s+icon="ph:book-open"/, "knowledge carries its kind icon");
assert.match(view, /ariaLabel="Memory files"\s+icon="ph:brain"/, "memory carries its kind icon");
assert.match(view, /ariaLabel="Journal"\s+icon="ph:calendar-blank"/, "journal carries its kind icon");

// ── Detail: the right transport per source ───────────────────────────────────

assert.match(view, /<MemoryMdEditor/, "memory docs edit through the mtime-guarded memory editor");
assert.match(view, /method: "POST",[\s\S]*?\/api\/knowledge|\/api\/knowledge",\s*\{\s*method: "POST"/, "knowledge saves POST the vault API");
assert.match(view, /rawToKnowledgePayload/, "knowledge title/tags round-trip through frontmatter mapping");
assert.match(view, /showHeader=\{false\}/, "journal reflections edit without a frontmatter header");
assert.match(view, /reflectedBy: state\?\.reflectedBy \?\? null/, "journal saves preserve the reflecting familiar");

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
  /selection \|\| showGraph \? "hidden @min-\[880px\]\/grimoire:flex" : ""/,
  "the rail yields to the graph on narrow widths",
);
assert.match(
  view,
  /onClick=\{\(\) => setShowGraph\(false\)\}\s*\n\s*aria-label="Back to document list"/,
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
// cave-0rx0: journal dates honor the user's datetime prefs everywhere (rail
// rows, tab labels, editor footer, delete confirm) instead of raw ISO.
assert.match(view, /function journalDayLabel\(date: string, prefs: DateTimePrefs\)/, "there is a shared journal date label helper");
assert.match(view, /new Date\(`\$\{date\}T00:00:00`\)/, "date-only strings anchor to local midnight (no UTC day shift)");
assert.match(view, /title=\{journalDayLabel\(day\.date, dateTimePrefs\)\}/, "rail journal rows format through prefs");
assert.match(view, /return journalDayLabel\(sel\.date, dateTimePrefs\)/, "journal tab labels format through prefs");
assert.match(view, /Journal · \$\{journalDayLabel\(date, dateTimePrefs\)\}/, "the editor footer source label formats through prefs");
assert.match(view, /journalDayLabel\(selection\.date, readDateTimePrefs\(\)\)/, "the delete confirm formats through prefs");
// cave-ezxb: the over-cap tab eviction announces instead of silently closing.
assert.match(view, /evictedRef\.current = tabs\[evictIndex\] \?\? null/, "openDoc records what it evicted");
assert.match(view, /announce\(`Closed \$\{tabTitle\(evictedRef\.current\)\} — \$\{MAX_OPEN_TABS\}-tab limit reached`/, "evictions are announced post-commit");
// cave-gsvf: search results are announced to screen readers (debounced).
assert.match(view, /No documents match/, "an empty result set announces");
assert.match(view, /knowledge, \$\{visibleMemory\.length\} memory, \$\{visibleJournal\.length\} journal/, "match counts announce per section");
// cave-bkpj: unresolved wiki-link chips are actionable on touch — tapping
// shows a visible hint (and announces it) instead of a hover-only title.
assert.match(view, /const \[unresolvedHint, setUnresolvedHint\] = useState<string \| null>/, "unresolved chips have a tap-visible hint");
assert.match(view, /has no matching doc yet — create a knowledge entry/, "the hint says how to resolve the link");
assert.match(view, /aria-expanded=\{unresolvedHint === display\}/, "the unresolved chip exposes its hint state");

// ── Delete/trash actions (cave-kv3) ──────────────────────────────────────────

assert.match(view, /useConfirm\(\)/, "destructive actions confirm through the shared dialog");
assert.match(view, /\/api\/memory\/delete/, "memory files archive through the trash API");
assert.match(view, /\/api\/knowledge\?id=\$\{encodeURIComponent\(selection\.id\)\}/, "knowledge entries delete through their API");
assert.match(view, /\/api\/journal\?date=\$\{encodeURIComponent\(selection\.date\)\}/, "journal reflections delete through their API");
assert.match(view, /Move to trash/, "memory delete is labelled as restorable trash");
assert.match(view, /danger: true/, "the confirm renders its destructive style");
assert.match(view, /closeTab\(selectionKey\(selection\)\);\s*void load\(\)/, "a successful delete closes the doc's tab and reloads the navigator");
assert.match(view, /deleteError \? \(\s*<span role="alert"/, "delete failures are announced");
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
assert.match(view, /replaceTab\(key, \{ kind: "knowledge", id: saved\.id \}\)/, "saving a new entry swaps its draft tab for the real doc");
assert.match(view, /const evictIndex = tabs\.findIndex/, "over-cap opens evict the oldest non-active tab");
assert.match(view, /fromHash/, "a #grimoire: deep link merges into (and activates within) the restored tab set");

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
assert.match(view, /title="No matching Grimoire doc"[\s\S]{0,600}border-dashed/, "an unresolved link renders dashed with a hint (tap shows why — cave-bkpj)");
assert.match(view, /<GrimoireDocLinks\b[\s\S]{0,280}onOpen=\{openDoc\}/, "the chip row is wired to openDoc for the active doc");

// ── Backlinks: incoming mentions from the doc graph (cave-hand) ──────────────
// The active doc's incoming link/mention edges surface as a second chip row
// ("Mentions"); mention-sourced chips render dashed to read as inferred.
assert.match(view, /backlinks = useMemo<GrimoireBacklink\[\]>/, "backlinks derive from the doc graph");
assert.match(view, /e\.target !== activeKey \|\| e\.type === "tag"/, "backlinks keep link+mention edges targeting the active doc (tags excluded)");
assert.match(view, /<GrimoireDocLinks\b[\s\S]{0,280}backlinks=\{backlinks\}/, "the chip row receives the backlinks");
assert.match(view, /b\.type === "mention" \? "Mentions this doc \(unlinked\)" : "Links to this doc"/, "chips distinguish inferred mentions from explicit links");

// ── The doc graph (cave-hand): full-corpus scan + Obsidian-style canvas ──────
// GET /api/grimoire/graph scans knowledge+memory+journal server-side; until it
// lands (or if it fails) the client-built knowledge graph stands in, so the
// graph is never blank while docs exist. A segmented Docs|Graph header control
// swaps the detail pane for the lazy-loaded canvas; clicking a node opens it.
assert.match(view, /from "@\/lib\/grimoire-graph"/, "grimoire-view builds the fallback graph via the graph lib");
assert.match(view, /import\("@\/components\/grimoire-graph-view"\)/, "the canvas graph is lazy-loaded (dynamic import)");
assert.match(view, /ssr: false/, "the graph view is client-only (no SSR)");
assert.match(view, /fetch\("\/api\/grimoire\/graph"/, "the full-corpus graph comes from the server scan");
assert.match(view, /const localGraph = useMemo\([\s\S]{0,200}buildDocGraph\(/, "the fallback graph is memoized from buildDocGraph");
assert.match(view, /markdown: k\.body/, "the fallback graph reads each knowledge body (already loaded)");
assert.match(view, /const graph = scan\?\.graph \?\? localGraph/, "the server scan wins, the local graph stands in — never blank");
assert.match(view, /if \(firstLoadDoneRef\.current\) refreshGraph\(\)/, "saves/deletes rescan the graph (mount already fetched)");
assert.match(view, /aria-label="Grimoire view"/, "the Docs|Graph switch is a labelled control group");
assert.match(view, /aria-pressed=\{!showGraph\}[\s\S]{0,1000}aria-pressed=\{showGraph\}/, "the segmented control exposes pressed state");
assert.match(
  view,
  /showGraph \? \([\s\S]{0,1200}<GrimoireGraphView[\s\S]{0,400}onOpen=\{\(ref\) => \{[\s\S]{0,80}openDoc\(ref\)/,
  "the graph replaces the detail pane and opens the clicked doc",
);
assert.match(view, /scanning=\{scanning\}/, "the graph view knows a scan is in flight");
assert.match(view, /scanError=\{scan \? null : scanError\}/, "a failed scan is only surfaced when there is no scan to show");

// ── Graph reachable on narrow / mobile (cave-quct) ───────────────────────────
// On a narrow container the rail and main pane both go full-width, so the rail
// must hide when the graph is up (not only when a doc is selected) or the graph
// is pushed off-screen; and the graph gets a narrow-only back affordance since
// the rail is then hidden.
assert.match(
  view,
  /selection \|\| showGraph \? "hidden @min-\[880px\]\/grimoire:flex" : ""/,
  "the rail hides on narrow when a doc is open OR the graph is up",
);
assert.match(
  view,
  /onClick=\{\(\) => setShowGraph\(false\)\}[\s\S]{0,120}aria-label="Back to document list"/,
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

console.log("grimoire-view.test: ok");
