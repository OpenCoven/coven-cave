// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const bookmarks = await readFile(new URL("./library-bookmarks-list.tsx", import.meta.url), "utf8");
const reading   = await readFile(new URL("./library-reading-list.tsx",   import.meta.url), "utf8");
const github    = await readFile(new URL("./library-github-list.tsx",    import.meta.url), "utf8");
const libraryRoute = await readFile(new URL("../app/api/library/route.ts", import.meta.url), "utf8");
const bookmarksRoute = await readFile(new URL("../app/api/library/bookmarks/route.ts", import.meta.url), "utf8");

// ───────── Task 1: localeCompare null-guards ─────────
// bookmarks — title, domain, savedAt
assert.match(bookmarks, /\(a\.title \?\? ""\)\.localeCompare\(b\.title \?\? ""\)/,    "bookmarks title null-guard");
assert.match(bookmarks, /\(a\.domain \?\? ""\)\.localeCompare\(b\.domain \?\? ""\)/,  "bookmarks domain null-guard");
assert.match(bookmarks, /\(a\.savedAt \?\? ""\)\.localeCompare\(b\.savedAt \?\? ""\)/,"bookmarks savedAt null-guard");
assert.match(bookmarks, /function bookmarkTags\(item: LibraryBookmark\): string\[\]/, "bookmarks normalize tag arrays before grouping/searching");
assert.match(bookmarks, /const domain = displayDomain\(item\);[\s\S]{0,120}const keys = by === "domain" \? \[domain\] : \(tags\.length > 0 \? tags : \["\(untagged\)"\]\);/, "bookmarks group by a display-safe domain");
assert.match(
  bookmarks,
  /const BOOKMARK_GROUP_OPTIONS: Array<\{[\s\S]*?icon: IconName/,
  "Bookmark grouping selector should define icon-backed options",
);
assert.match(
  bookmarks,
  /<Popover[\s\S]*?className="library-bookmark-selector__popover"/,
  "Bookmark grouping selector should use a popover selector",
);
assert.match(
  bookmarks,
  /<PopoverItem[\s\S]*?icon=\{option\.icon\}[\s\S]*?active=\{option\.id === groupBy\}/,
  "Bookmark grouping options should render icons and selected state",
);
assert.doesNotMatch(
  bookmarks,
  /<select[\s\S]*?setGroupBy/,
  "Bookmark grouping should not use a native select",
);
assert.doesNotMatch(
  bookmarks,
  /google\.com\/s2\/favicons|faviconV2|<img[\s\S]*?className="library-favicon"|onError=\{[\s\S]*?setFailed/,
  "Bookmark rows should use deterministic local favicon initials instead of remote favicon images",
);
assert.match(
  bookmarks,
  /className="library-favicon-initial"[\s\S]*?style=\{\{ background: initialColor\(title \|\| url\) \}\}/,
  "Bookmark rows should keep a stable local leading mark",
);
assert.match(bookmarksRoute, /function normalizeBookmark\(item: Partial<LibraryBookmark>\): LibraryBookmark/, "bookmarks API normalizes legacy bookmark records");
assert.match(bookmarksRoute, /const domain = cleanString\(item\.domain\) \|\| \(url \? domainFrom\(url\) : "\(unknown\)"\);/, "bookmarks API backfills missing domains");
assert.match(
  bookmarks,
  /const loadRequestRef = useRef\(0\);/,
  "Bookmarks list should track in-flight loads so stale responses cannot overwrite newer items",
);
assert.match(
  bookmarks,
  /const requestId = \+\+loadRequestRef\.current;[\s\S]*?if \(requestId !== loadRequestRef\.current \|\| signal\?\.aborted\) return;/,
  "Bookmarks load should drop stale or aborted responses before writing state",
);
assert.match(
  bookmarks,
  /fetch\("\/api\/library\/bookmarks", \{ cache: "no-store", signal \}\)/,
  "Bookmarks fetch should pass an AbortSignal so unmounts cancel obsolete requests",
);
assert.match(
  bookmarks,
  /useEffect\(\(\) => \{[\s\S]*?const ctrl = new AbortController\(\);[\s\S]*?void load\(ctrl\.signal\);[\s\S]*?return \(\) => ctrl\.abort\(\);[\s\S]*?\}, \[load\]\);/,
  "Bookmarks effect should abort the previous request on unmount",
);

// reading — title, addedAt, label
assert.match(reading, /\(a\.title \?\? ""\)\.localeCompare\(b\.title \?\? ""\)/,     "reading title null-guard");
assert.match(reading, /\(a\.addedAt \?\? ""\)\.localeCompare\(b\.addedAt \?\? ""\)/, "reading addedAt null-guard");
assert.match(reading, /\(a\.label \?\? ""\)\.localeCompare\(b\.label \?\? ""\)/,     "reading label null-guard");

const libraryCss = await readFile(new URL("../styles/library.css", import.meta.url), "utf8");
const mobileLibraryCssStart = libraryCss.indexOf("@media (max-width: 767px) {");
const mobileLibraryCssEnd = libraryCss.indexOf("/* ── Undo delete toast", mobileLibraryCssStart);
assert.ok(mobileLibraryCssStart >= 0 && mobileLibraryCssEnd > mobileLibraryCssStart, "Library CSS should expose a mobile override block");
const mobileLibraryCss = libraryCss.slice(mobileLibraryCssStart, mobileLibraryCssEnd);
const readingPreview = await readFile(new URL("./library-doc-preview.tsx", import.meta.url), "utf8");
assert.match(
  reading,
  /className="board-table-title library-reading-title"/,
  "reading titles should opt into library-specific wrapping instead of the shared one-line board title style",
);
assert.doesNotMatch(
  reading,
  /library-reading-col-added|relTime\(item\.addedAt\)|function relTime/,
  "Reading list should not render the relative Added/day column",
);
assert.match(
  libraryCss,
  /\.library-reading-title\s*\{[\s\S]*?-webkit-line-clamp:\s*2[\s\S]*?white-space:\s*normal/,
  "reading titles should wrap and clamp at two visible lines",
);
assert.match(
  libraryCss,
  /\.library-bookmark-selector__trigger\s*\{[\s\S]*?display:\s*inline-flex/,
  "Bookmark selector trigger should have compact dedicated styles",
);
assert.match(
  reading,
  /className="library-reading-add-form"/,
  "Reading add form should use a dedicated polished layout instead of the shared saved-list strip",
);
assert.match(
  reading,
  /aria-label="Reading title"[\s\S]{0,180}className="library-reading-add-input"/,
  "Reading add form title input should keep a precise accessible label",
);
assert.match(
  reading,
  /className="library-reading-add-button library-reading-add-button--primary"[\s\S]{0,120}<Icon name="ph:check"/,
  "Reading add form save action should use the compact primary icon button treatment",
);
assert.match(
  reading,
  /className="library-reading-add-button"[\s\S]{0,140}<Icon name="ph:x"/,
  "Reading add form cancel action should use the compact secondary icon button treatment",
);
assert.match(
  libraryCss,
  /\.library-reading-add-form\s*\{[\s\S]*?display:\s*grid;[\s\S]*?grid-template-columns:\s*minmax\(142px,\s*1\.15fr\)\s*minmax\(116px,\s*\.8fr\)\s*minmax\(104px,\s*auto\)\s*minmax\(126px,\s*auto\)\s*auto;/,
  "Reading add form should use a compact responsive grid for side-panel fit",
);
assert.match(
  libraryCss,
  /@container \(max-width: 640px\) \{[\s\S]*?\.library-reading-add-form\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)\s*minmax\(0,\s*1fr\);/,
  "Reading add form should wrap cleanly in narrow library containers",
);
assert.match(
  libraryCss,
  /@container \(max-width: 430px\) \{[\s\S]*?\.library-reading-add-form\s*\{[\s\S]*?grid-template-columns:\s*1fr;/,
  "Reading add form should collapse to one column in the narrowest side-panel view",
);
assert.doesNotMatch(
  readingPreview,
  /if \(item\.url\) \{[\s\S]*?<LibraryLinkViewer/,
  "URL-backed reading items should render native reading details instead of a blank-prone embedded web viewer",
);
assert.match(
  readingPreview,
  /className="library-reading-detail"/,
  "Reading detail preview should expose a dedicated full-width native detail surface",
);
assert.match(
  readingPreview,
  /<TranslateButton source=\{\{ kind: "url", title: item\.title, url: item\.url \}\}/,
  "URL-backed reading details should keep the translate action",
);
assert.match(
  readingPreview,
  /<CopyButton text=\{item\.url\} label="Copy URL"/,
  "URL-backed reading details should keep the copy URL action",
);
assert.match(
  libraryCss,
  /\.library-reading-detail\s*\{[\s\S]*?display:\s*grid;[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1\.1fr\)\s*minmax\(260px,\s*\.9fr\);/,
  "Reading detail should use a responsive native two-column layout on wide canvases",
);
assert.match(
  libraryCss,
  /@media \(max-width: 767px\) \{[\s\S]*?\.library-reading-detail\s*\{[\s\S]*?grid-template-columns:\s*1fr;/,
  "Reading detail should collapse to one column on phones",
);
assert.doesNotMatch(
  readingPreview,
  /unavailable \? \([\s\S]*?<iframe[\s\S]*?className="library-link-viewer-frame"/,
  "Bookmark and GitHub previews should not fall back to a blank-prone iframe in non-native browsers",
);
assert.match(
  readingPreview,
  /className="library-link-viewer-fallback"/,
  "Bookmark and GitHub previews should render a native fallback card when the embedded browser is unavailable",
);
assert.match(
  libraryCss,
  /\.library-link-viewer-fallback\s*\{[\s\S]*?display:\s*grid;[\s\S]*?place-items:\s*center;/,
  "Native link fallback should be centered inside the viewer viewport",
);

// github — title, repo, savedAt
assert.match(github, /\(a\.title \?\? ""\)\.localeCompare\(b\.title \?\? ""\)/,   "github title null-guard");
assert.match(github, /\(a\.repo \?\? ""\)\.localeCompare\(b\.repo \?\? ""\)/,     "github repo null-guard");
assert.match(github, /\(a\.savedAt \?\? ""\)\.localeCompare\(b\.savedAt \?\? ""\)/,"github savedAt null-guard");

// ───────── Task 2: Timeline placeholder shortened ─────────
const timeline = await readFile(new URL("./library-timeline.tsx", import.meta.url), "utf8");
const docsList = await readFile(new URL("./library-doc-list.tsx", import.meta.url), "utf8");
assert.match(timeline, /placeholder="Search links…"/, "Timeline placeholder must be 'Search links…'");
assert.match(timeline, /title="Search links — try chat: github: sage:"/, "Verbose hint must live in title=");
assert.doesNotMatch(timeline, /placeholder="Search links — try chat: github: sage:"/, "Old long placeholder must be removed");
assert.match(timeline, /title="Timeline"/, "Unified Library view header should match the Timeline rail label");
assert.doesNotMatch(timeline, /title="All"/, "Unified Library view should not keep the old ambiguous All header");
assert.match(
  timeline,
  /const loadRequestRef = useRef\(0\);/,
  "Timeline should track in-flight loads so stale filter responses cannot overwrite newer entries",
);
assert.match(
  timeline,
  /const requestId = \+\+loadRequestRef\.current;[\s\S]*?if \(requestId !== loadRequestRef\.current \|\| signal\?\.aborted\) return;/,
  "Timeline load should drop stale or aborted responses before writing state",
);
assert.match(
  timeline,
  /fetch\(`\/api\/library\/all\$\{qs\.toString\(\) \? "\?" \+ qs\.toString\(\) : ""\}`, \{ cache: "no-store", signal \}\)/,
  "Timeline fetch should pass an AbortSignal so filter changes cancel obsolete requests",
);
assert.match(
  timeline,
  /useEffect\(\(\) => \{[\s\S]*?const ctrl = new AbortController\(\);[\s\S]*?void load\(ctrl\.signal\);[\s\S]*?return \(\) => ctrl\.abort\(\);[\s\S]*?\}, \[load\]\);/,
  "Timeline effect should abort the previous request on unmount or filter changes",
);
assert.match(docsList, /import \{ relativeTime \} from "@\/lib\/relative-time";/, "Document list should use the shared compact modified-date formatter");
assert.match(docsList, /return relativeTime\(iso\);/, "Recent document modified dates should use the compact relative-time formatter");

// ───────── Task 3: Lists "All" renamed to "Timeline" ─────────
const rail = await readFile(new URL("./library-collection-rail.tsx", import.meta.url), "utf8");
assert.match(rail, /\{ id: "all",\s+label: "Timeline",\s+icon: "ph:link" \}/, "STATIC_LIST_SECTIONS first row label must be 'Timeline'");
assert.match(
  rail,
  /function collectionDisplayLabel\(collection: LibraryCollection\): string \{[\s\S]*?collection\.id === "projects"[\s\S]*?return "Project docs";/,
  "Document collection named Projects should display as Project docs to avoid colliding with the Projects workspace section",
);
assert.match(
  rail,
  /const label = collectionDisplayLabel\(col\);[\s\S]*?<span className="library-rail-label">\{label\}<\/span>/,
  "Collection rail should render the disambiguated collection display label",
);
assert.match(
  rail,
  /className="library-rail-list library-rail-list--collections"/,
  "Document collection rail list should expose the mobile ordering hook",
);
assert.match(
  rail,
  /className="library-rail-list library-rail-list--sections"/,
  "Primary Library mode rail list should expose the mobile ordering hook",
);
assert.match(
  rail,
  /className="library-rail-header library-rail-header--skills"/,
  "Skills rail header should expose the mobile ordering hook",
);
assert.match(
  rail,
  /className="library-rail-list library-rail-list--skills"/,
  "Expanded Skills rail list should expose the mobile ordering hook",
);
assert.doesNotMatch(
  rail,
  /useEffect\(\(\) => \{ void loadSkills\(\); \}, \[loadSkills\]\);/,
  "Library rail should not fetch skills on initial mount before the Skills section is opened",
);
assert.match(
  rail,
  /\{\/\* ── Skills \(lazy-loaded on open\) ────── \*\/\}/,
  "Skills rail section should stay discoverable while deferring its API fetch",
);
assert.match(
  rail,
  /if \(next\) \{[\s\S]{0,160}void loadSkills\(\);[\s\S]{0,160}onSelectSection\("skills"\);[\s\S]{0,160}\}/,
  "Opening the Skills rail section should fetch skills on demand",
);
assert.match(
  rail,
  /if \(activeSection === "skills" \|\| skillsOpen \|\| skillsStatus === "loaded"\) void loadSkills\(\);/,
  "Refresh should only re-fetch Skills after the section is active, open, or already loaded",
);
assert.match(
  rail,
  /aria-expanded=\{skillsOpen \|\| activeSection === "skills"\}/,
  "Skills rail toggle should expose its expanded state",
);
assert.match(
  libraryCss,
  /\.library-rail-action\s*\{[\s\S]*?width:\s*28px;[\s\S]*?height:\s*28px;[\s\S]*?border-radius:\s*7px;/,
  "Library rail header actions should not collapse back to 22px icon targets",
);
assert.match(
  libraryCss,
  /\.library-rail-section-toggle\s*\{[\s\S]*?min-height:\s*28px;[\s\S]*?padding:\s*0 2px;[\s\S]*?border-radius:\s*6px;/,
  "Library Skills toggle should have a real desktop hit area",
);
assert.match(
  mobileLibraryCss,
  /\.library-rail-list--sections\s*\{[\s\S]*?order:\s*1;[\s\S]*?\.library-rail-header--skills\s*\{[\s\S]*?order:\s*2;[\s\S]*?\.library-rail-list--collections\s*\{[\s\S]*?order:\s*3;/,
  "Mobile Library rail should show list sections first, then Skills, before document collections",
);
assert.match(
  mobileLibraryCss,
  /\.library-rail-header--skills\s*\{[\s\S]*?display:\s*flex;/,
  "Mobile Library rail should re-enable the Skills toggle after generic headers are hidden",
);
assert.match(
  mobileLibraryCss,
  /\.library-timeline-header\.ui-view-header\s*\{[\s\S]*?padding:\s*12px 16px 10px;[\s\S]*?\.library-timeline-filters\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)\s*minmax\(0,\s*1fr\)\s*minmax\(128px,\s*0\.8fr\);/,
  "Mobile Timeline should compact filters into one three-column command row instead of stacking every control",
);
assert.match(
  mobileLibraryCss,
  /\.library-timeline-group-toggle\s*\{[\s\S]*?grid-column:\s*auto;[\s\S]*?height:\s*var\(--touch-target\);/,
  "Mobile Timeline group toggle should share the compact filter row",
);
assert.match(
  mobileLibraryCss,
  /\.library-timeline-filters > \.library-timeline-dropdown:first-child\s*\{[\s\S]*?order:\s*1;[\s\S]*?\.library-timeline-filters > \.library-timeline-dropdown:last-child\s*\{[\s\S]*?order:\s*2;[\s\S]*?\.library-timeline-group-toggle\s*\{[\s\S]*?order:\s*3;/,
  "Mobile Timeline should place Familiar and List filters side by side before the Date/Source toggle",
);

// ───────── Task 4: Section-aware preview empty state ─────────
const preview = await readFile(new URL("./library-doc-preview.tsx", import.meta.url), "utf8");
const view    = await readFile(new URL("./library-view.tsx",        import.meta.url), "utf8");
const projectsHook = await readFile(new URL("../lib/use-projects.ts", import.meta.url), "utf8");

assert.match(preview, /LibrarySectionKind[\s\S]{0,200}?from "@\/lib\/library-types"/, "LibrarySectionKind must be imported from library-types");
assert.match(preview, /const EMPTY_TEXT: Record<LibrarySectionKind, string> = \{/, "EMPTY_TEXT typed Record<LibrarySectionKind, string>");
for (const section of ["all", "docs", "bookmarks", "reading", "github", "projects", "skills"]) {
  assert.ok(new RegExp(`${section}:\\s*"Select`).test(preview), `EMPTY_TEXT entry for ${section}`);
}
assert.match(preview, /activeSection \? EMPTY_TEXT\[activeSection\] : "Select an item to preview"/, "Empty render uses EMPTY_TEXT[activeSection]");
assert.match(view, /<LibraryDocPreview\s+selected=\{selectedItem\}\s+loading=\{previewLoading\}\s+activeSection=\{activeSection\}/, "library-view passes activeSection");

// ───────── Task 5: [ shortcut toggles list panel ─────────
const view2 = await readFile(new URL("./library-view.tsx", import.meta.url), "utf8");
assert.match(view2, /if \(e\.key !== "\["\) return;/, "library-view must filter keydown events for '['");
assert.match(view2, /setListPinned\(\(v\) => !v\)/, "library-view must call setListPinned((v) => !v)");
assert.match(view2, /\["input", "textarea", "select"\]\.includes\(tag\)/, "library-view must skip when focus is in an input");
assert.match(
  view2,
  /const listExpanded = listPinned;/,
  "Library list panel should expand only from the pinned/toggled state",
);
assert.doesNotMatch(
  view2,
  /listHover|setListHover|hoverTimerRef|onMouseEnter=\{\(\) =>|onMouseLeave=\{\(\) =>/,
  "Library list panel should not expand on hover or keep hover timers",
);
assert.match(
  view2,
  /useProjects\(\{ enabled: boardDraft !== null \}\)/,
  "LibraryView should defer project loading until the Add-to-Board modal needs project options",
);
assert.match(
  projectsHook,
  /export type UseProjectsOptions = \{[\s\S]*?enabled\?: boolean;[\s\S]*?\};/,
  "useProjects should expose an enabled option for callers that can defer project loading",
);
assert.match(
  projectsHook,
  /if \(!enabled\) \{[\s\S]*?abortRef\.current\?\.abort\(\);[\s\S]*?setLoading\(false\);[\s\S]*?return;/,
  "useProjects should skip and cancel the initial fetch while disabled",
);

console.log("library-polish.test.ts: ok");

// ── Reading list fit (narrow panel) ──
assert.match(
  reading,
  /className="board-table library-reading-table"/,
  "Reading table carries its own class so narrow-container rules can scope to it",
);
assert.match(
  libraryCss,
  /overflow-wrap: break-word;/,
  "Reading titles wrap at word boundaries instead of shattering mid-word",
);
assert.match(
  libraryCss,
  /\.library-list-shell \{\s*container-type: inline-size;/,
  "List shell is a size container so the table adapts to the panel, not the viewport",
);
assert.match(
  libraryCss,
  /@container \(max-width: 560px\) \{[\s\S]*?\.library-reading-row\s*\{[\s\S]*?display:\s*grid;[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)\s*minmax\(132px,\s*176px\);/,
  "Narrow reading panels should render rows as a compact grid with title and a readable status control",
);
assert.match(
  libraryCss,
  /\.library-list-shell \.library-doclist-search\s*\{[\s\S]*?position:\s*sticky;[\s\S]*?height:\s*48px;[\s\S]*?backdrop-filter:\s*blur\(12px\);/,
  "Reading search should stay compact and sticky at the top of the side-panel list",
);
assert.match(
  libraryCss,
  /\.library-reading-row\.selected\s*\{[\s\S]*?linear-gradient\(90deg,[\s\S]*?box-shadow:\s*inset 3px 0 0 var\(--accent-presence\);/,
  "Selected reading rows should use a left accent and soft fill instead of a heavy block",
);
assert.match(
  reading,
  /className=\{`library-reading-row\$\{item\.id === selectedId \? " selected" : ""\}\$\{selectMode && selectedIds\.has\(item\.id\) \? " is-selected" : ""\}`\}/,
  "Reading rows should expose a stable class for responsive side-panel layout (+ bulk-select state)",
);
assert.match(
  reading,
  /className="library-reading-col-status"[\s\S]{0,200}className="library-status-toggle"[\s\S]{0,120}role="radiogroup"/,
  "Reading status should be a 3-way segmented toggle living in a targetable column",
);
assert.match(
  libraryCss,
  /@container \(max-width: 560px\) \{[\s\S]*?\.library-reading-table \.library-reading-col-source,[\s\S]*?\.library-reading-table \.library-reading-col-progress,[\s\S]*?\.library-reading-table \.library-reading-col-actions\s*\{[\s\S]*?display:\s*none;/,
  "Narrow reading panels should drop Type, Progress, and row actions from the primary row layout",
);
assert.match(
  libraryCss,
  /@container \(max-width: 560px\) \{[\s\S]*?\.library-reading-table \.library-status-select\s*\{[\s\S]*?width:\s*100%;/,
  "Reading status selects should use the full status column instead of clipping label text",
);
assert.match(
  reading,
  /className="board-table-muted library-source-type" aria-label=\{`Type: \$\{item\.sourceType\}`\}[\s\S]*?className="library-source-type__label"/,
  "Reading type cells should wrap source type text in a truncating label",
);
assert.match(
  libraryCss,
  /\.library-source-type\s*\{[\s\S]*?display:\s*inline-flex;[\s\S]*?white-space:\s*nowrap;/,
  "Reading type badges should keep icon and label on one line",
);
assert.match(
  libraryCss,
  /\.library-reading-table \.library-reading-col-source\s*\{[\s\S]*?width:\s*92px;[\s\S]*?max-width:\s*92px;/,
  "Reading type column should have a stable compact width",
);

// ── Projects section owns the full canvas (was: ComuxView crushed into the
//    narrow list panel while an empty doc preview hogged the width) ──
assert.match(
  view,
  /activeSection === "projects" \? \([\s\S]{0,200}<ComuxView/,
  "Projects renders in the dominant full-canvas branch, not the list panel",
);
assert.match(
  view,
  /activeSection !== "skills" && activeSection !== "projects" &&/,
  "List panel is hidden while Projects is active",
);

// ── Browse-first empty canvas ──
assert.match(
  view,
  /const showBrowseCanvas = selectedItem === null && activeSection !== "skills" && activeSection !== "projects"/,
  "When no library item is selected, the dominant center canvas should become the browse list instead of an empty placeholder",
);
assert.match(
  view,
  /showBrowseCanvas \? \([\s\S]{0,160}<div className="library-browse-canvas">[\s\S]{0,160}renderLibraryListContent\(\)/,
  "Browse canvas should render the active list content in the center pane",
);
assert.match(
  view,
  /activeSection !== "skills" && activeSection !== "projects" && !showBrowseCanvas &&/,
  "Right list panel should be hidden while the center browse canvas is active",
);
assert.match(
  libraryRoute,
  /const includeDocs = req\.nextUrl\.searchParams\.get\("docs"\) !== "0";[\s\S]*?if \(!includeDocs\) \{[\s\S]*?docs:\s*\[\],[\s\S]*?collections,/,
  "Library API should expose a metadata-only docs=0 path for first-load rail data",
);
assert.match(
  view,
  /const loadCollectionsRequestRef = useRef\(0\);[\s\S]*?fetch\("\/api\/library\?collection=all&docs=0", \{ cache: "no-store" \}\)/,
  "LibraryView should load collection metadata without reading all document bodies on first mount",
);
assert.match(
  view,
  /useEffect\(\(\) => \{[\s\S]*?if \(activeSection !== "docs"\) return;[\s\S]*?void loadDocs\(activeCollection\);[\s\S]*?\}, \[activeCollection, activeSection, loadDocs\]\);/,
  "LibraryView should defer full document loading until the Docs section is active",
);
assert.match(
  view,
  /if \(activeSection === "docs"\) void loadDocs\(activeCollection\);[\s\S]*?else void loadCollections\(\);/,
  "Library refresh should not force hidden document reads from non-Docs tabs",
);
assert.match(
  libraryCss,
  /\.library-browse-canvas\s*\{[\s\S]*?flex:\s*1;[\s\S]*?overflow:\s*hidden;/,
  "Center browse canvas should own the available library width without overflowing",
);
assert.match(
  libraryCss,
  /\.library-browse-content\s*\{[\s\S]*?width:\s*100%;[\s\S]*?border-inline:\s*0;/,
  "Browse list content should fill the full center pane instead of being capped to a narrow column",
);
assert.doesNotMatch(
  libraryCss,
  /\.library-browse-content\s*\{[\s\S]*?width:\s*min\(920px,\s*100%\)/,
  "Browse list content should not be constrained to the old centered 920px column",
);

// ── Vertical overflow boundaries ──
assert.match(
  libraryCss,
  /\.library-browse-canvas\s*\{[\s\S]*?min-height:\s*0;[\s\S]*?overflow:\s*hidden;/,
  "Browse canvas should be height-bounded so its list content can scroll vertically",
);
assert.match(
  libraryCss,
  /\.library-browse-content\s*\{[\s\S]*?display:\s*flex;[\s\S]*?flex-direction:\s*column;[\s\S]*?min-height:\s*0;/,
  "Browse content should preserve a min-height-zero flex chain for timeline and table lists",
);
assert.match(
  libraryCss,
  /\.library-list-shell\s*\{[\s\S]*?flex:\s*1;[\s\S]*?min-height:\s*0;[\s\S]*?overflow:\s*hidden;/,
  "Saved-list shells should stay bounded inside the library and delegate scrolling to their body",
);
assert.match(
  libraryCss,
  /\.library-list-shell \.board-table-wrap\s*\{[\s\S]*?flex:\s*1;[\s\S]*?min-height:\s*0;[\s\S]*?overflow:\s*auto;/,
  "Library table wrappers should own vertical overflow without relying on board.css import order",
);
assert.match(
  libraryCss,
  /\.library-list-panel--open\s*\{\s*width:\s*clamp\(380px,\s*34vw,\s*520px\);/,
  "Open Library side panel should be wide enough for saved-list controls and row content",
);
assert.match(
  libraryCss,
  /\.library-doclist-item-excerpt\s*\{[\s\S]*?display:\s*-webkit-box;[\s\S]*?white-space:\s*normal;[\s\S]*?-webkit-line-clamp:\s*2;/,
  "Document excerpts should use a controlled two-line clamp instead of a single overflowing line",
);
assert.match(
  libraryCss,
  /\.library-doclist-item-meta\s*\{[\s\S]*?align-items:\s*flex-start;/,
  "Document metadata rows should align wrapped excerpts from the top",
);
assert.match(
  libraryCss,
  /\.library-doclist-file-action\s*\{[\s\S]*?width:\s*28px;[\s\S]*?height:\s*28px;/,
  "Document row edit controls should not collapse back to 24px desktop targets",
);
assert.match(
  libraryCss,
  /\.library-doclist-move select\s*\{[\s\S]*?height:\s*100%;[\s\S]*?min-height:\s*100%;/,
  "Document row move selects should fill their visible control height",
);
assert.match(
  libraryCss,
  /@media \(max-width: 767px\) \{[\s\S]*?\.library-doclist-file-action\s*\{[\s\S]*?width:\s*var\(--touch-target\);[\s\S]*?height:\s*var\(--touch-target\);[\s\S]*?\.library-doclist-move\s*\{[\s\S]*?width:\s*var\(--touch-target\);[\s\S]*?min-width:\s*var\(--touch-target\);[\s\S]*?height:\s*var\(--touch-target\);/,
  "Mobile document row edit and move controls should be real tap targets without a wide folder select",
);
assert.match(
  libraryCss,
  /@media \(max-width: 767px\) \{[\s\S]*?\.library-doclist-move select\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?inset:\s*0;[\s\S]*?width:\s*100%;[\s\S]*?opacity:\s*0;/,
  "Mobile document row move select should keep the native picker target while rendering as an icon-only control",
);
assert.match(
  libraryCss,
  /@container \(max-width: 460px\) \{[\s\S]*?\.library-list-header\s*\{[\s\S]*?flex-wrap:\s*nowrap;[\s\S]*?\.library-list-header-controls\s*\{[\s\S]*?width:\s*auto;/,
  "Narrow saved-list headers should keep compact command controls in one stable row",
);
assert.match(
  libraryCss,
  /@container \(max-width: 460px\) \{[\s\S]*?\.library-list-header-controls \.board-toolbar-btn\s*\{[\s\S]*?flex:\s*0 0 auto;[\s\S]*?min-width:\s*36px;[\s\S]*?\.library-list-header-controls \.library-list-add-btn__label\s*\{[\s\S]*?display:\s*none;/,
  "Narrow saved-list Add buttons should override board mobile full-width buttons and collapse the label",
);
for (const [source, label] of [
  [bookmarks, "Add bookmark"],
  [reading, "Add reading"],
  [github, "Add GitHub item"],
] as const) {
  assert.ok(source.includes('className="board-toolbar-btn library-list-add-btn"'), `${label} button should expose the compact Library Add control hook`);
  assert.ok(source.includes(`aria-label="${label}"`), `${label} button should expose an accessible label`);
  assert.ok(source.includes('className="library-list-add-btn__label"'), `${label} button should wrap its visible label for compact mobile layout`);
}
assert.match(
  libraryCss,
  /\.library-list-header-title\s*\{[\s\S]*?flex:\s*1 1 auto;[\s\S]*?flex-basis:\s*auto;/,
  "Narrow saved-list title cells should stay in the same row as compact controls",
);
assert.match(
  libraryCss,
  /@container \(max-width: 520px\) \{[\s\S]*?\.library-bookmarks-table th:nth-child\(3\)[\s\S]*?\.library-github-table thead\s*\{[\s\S]*?display:\s*none;/,
  "Saved-list side-panel tables should drop low-value table chrome before horizontal overflow appears",
);
assert.match(
  libraryCss,
  /@container \(max-width: 460px\) \{[\s\S]*?\.library-bookmarks-table th:nth-child\(2\),[\s\S]*?\.library-bookmarks-table td:nth-child\(2\)\s*\{[\s\S]*?display:\s*none;/,
  "Very narrow bookmark tables should prioritize title/action columns over metadata",
);
assert.match(
  libraryCss,
  /\.library-list-shell \.board-table\s*\{[\s\S]*?table-layout:\s*fixed;/,
  "Side-panel saved-list tables should use fixed layout so long titles cannot widen the panel",
);
assert.match(
  libraryCss,
  /\.library-title-cell\s*\{[\s\S]*?min-width:\s*0;/,
  "Bookmark title cells should be allowed to shrink inside the side panel",
);
// Title must stay the priority column: the bookmarks table uses auto layout
// with a fluid (max-width:0 + width:100%) first column so the Title absorbs
// leftover space and truncates LAST — even when Saved/Tags columns are hidden.
// (Fixed-layout left the Title unable to re-claim hidden columns' width, so it
// collapsed to an indistinguishable "DeepWi…".)
assert.match(
  libraryCss,
  /\.library-list-shell \.library-bookmarks-table\s*\{[\s\S]*?table-layout:\s*auto;/,
  "Bookmarks table should use auto layout so the Title can claim freed column width",
);
assert.match(
  libraryCss,
  /\.library-list-shell \.library-bookmarks-table[\s\S]*?td:first-child\s*\{[\s\S]*?width:\s*100%;[\s\S]*?max-width:\s*0;/,
  "Bookmarks Title cell should be the fluid clipping column (width:100%; max-width:0)",
);
// The repetitive Domain must be able to truncate rather than hold fixed width.
assert.match(
  libraryCss,
  /\.library-domain-cell\s*\{[\s\S]*?text-overflow:\s*ellipsis;/,
  "Bookmark domain cell should ellipsize so it yields width to the Title",
);
assert.doesNotMatch(
  github,
  /gh-row-action-strip-row/,
  "GitHub saved rows should not render a second full-width action strip row",
);
assert.doesNotMatch(
  github,
  /gh-col-labels|>Labels<|item\.labels\.slice/,
  "GitHub saved rows should not render visible label columns or chips",
);
assert.match(
  github,
  /className="gh-title-cell"[\s\S]*?className="gh-open-link"[\s\S]*?className="gh-col-actions"[\s\S]*?className="gh-row-actions"/,
  "GitHub saved rows should expose title/open-link and inline action cells",
);
assert.match(
  libraryCss,
  /\.gh-row-actions\s*\{[\s\S]*?display:\s*inline-flex;[\s\S]*?justify-content:\s*flex-end;/,
  "GitHub row actions should render as compact inline icon controls",
);
assert.match(
  libraryCss,
  /@container \(max-width: 520px\) \{[\s\S]*?\.library-github-table \.gh-row-main\s*\{[\s\S]*?display:\s*grid;[\s\S]*?grid-template-areas:/,
  "Narrow GitHub saved rows should become compact card-style grids",
);
assert.doesNotMatch(
  libraryCss,
  /gh-col-labels|labels labels actions/,
  "Library GitHub compact grid should not reserve a visible labels row",
);
assert.match(
  libraryCss,
  /\.library-timeline\s*\{[\s\S]*?min-height:\s*0;[\s\S]*?overflow:\s*hidden;/,
  "Timeline shell should clamp overflow so only the timeline scroll pane moves",
);
assert.match(
  libraryCss,
  /\.library-timeline-scroll\s*\{[\s\S]*?min-height:\s*0;[\s\S]*?overflow-y:\s*auto;/,
  "Timeline scroll pane should be the vertical scroll owner",
);
assert.match(
  libraryCss,
  /\.library-preview-body\s*\{[\s\S]*?flex:\s*1;[\s\S]*?min-height:\s*0;[\s\S]*?overflow-y:\s*auto;/,
  "Document preview body should be height-bounded and vertically scrollable",
);
assert.match(
  libraryCss,
  /\.library-reader-body\s*\{[\s\S]*?flex:\s*1;[\s\S]*?min-height:\s*0;[\s\S]*?overflow-y:\s*auto;/,
  "Reader modal body should keep long documents inside the modal scrollport",
);

assert.match(
  libraryCss,
  /\.library-rail-item\s*\{[\s\S]*?border:\s*1px solid transparent;[\s\S]*?border-radius:\s*6px;/,
  "Library rail tabs should use compact Vercel-style radius at the base level",
);
assert.match(
  libraryCss,
  /\.library-rail-item--active\s*\{[\s\S]*?border-color:\s*var\(--border-hairline\);[\s\S]*?box-shadow:\s*inset 0 -2px 0 var\(--text-primary\);/,
  "Active Library rail tabs should use a subtle border and bottom indicator at the base level",
);
assert.match(
  libraryCss,
  /@media \(max-width: 767px\) \{[\s\S]*?\.library-rail-item\s*\{[\s\S]*?border-radius:\s*6px;/,
  "Mobile Library tabs should use compact Vercel-style radius instead of oversized pills",
);
assert.match(
  libraryCss,
  /@media \(max-width: 767px\) \{[\s\S]*?\.library-rail-item--active\s*\{[\s\S]*?box-shadow:\s*inset 0 -2px 0/,
  "Active mobile Library tab should use a Vercel-style bottom indicator",
);
assert.doesNotMatch(
  libraryCss,
  /@media \(max-width: 767px\) \{[\s\S]*?\.library-rail-item\s*\{[^}]*border-radius:\s*999px;/,
  "Mobile Library tabs must not render as oversized pill tabs",
);

// Long doc lists virtualize off-screen rows via content-visibility (perf).
assert.match(
  libraryCss,
  /\.library-doclist-item \{[\s\S]*?content-visibility:\s*auto;[\s\S]*?contain-intrinsic-size:/,
  "library doc rows skip off-screen rendering via content-visibility",
);

// Bulk-select: remove several reading items at once.
assert.match(reading, /const \[selectMode, setSelectMode\] = useState\(false\)/, "reading list has a select mode");
assert.match(reading, /const \[selectedIds, setSelectedIds\] = useState<Set<string>>/, "selected reading ids live in a Set");
assert.match(reading, /aria-label=\{selectMode \? "Exit select mode" : "Select multiple reading items"\}/, "a header Select toggle exists");
assert.match(reading, /onClick=\{\(\) => \{ if \(selectMode\) \{ toggleSelect\(item\.id\); return; \} onSelect\(item\); \}\}/, "a row selects in select mode, otherwise opens");
assert.match(reading, /function bulkDelete\(\)/, "bulk remove handler exists");
assert.match(reading, /Promise\.all\(\s*ids\.map\(\(id\) =>\s*fetch\(`\/api\/library\/reading\?id=/, "bulk remove fires the per-item deletes in parallel");
assert.match(reading, /\{allSelected \? "Clear" : "Select all"\}/, "the bulk bar offers select-all / clear");
assert.match(libraryCss, /\.library-bulk-bar \{/, "the bulk toolbar is styled");
assert.match(libraryCss, /\.library-bulk-check\[data-checked="true"\]/, "the row checkbox has a checked state");

// Bulk-select extends to the bookmarks + GitHub lists (same pattern, same CSS).
for (const [name, src, api] of [["bookmarks", bookmarks, "bookmarks"], ["github", github, "github"]]) {
  assert.match(src, /const \[selectMode, setSelectMode\] = useState\(false\)/, `${name} list has a select mode`);
  assert.match(src, /const \[selectedIds, setSelectedIds\] = useState<Set<string>>/, `${name} selected ids live in a Set`);
  assert.match(src, /if \(selectMode\) \{ toggleSelect\(item\.id\); return; \}/, `${name} row selects in select mode, otherwise opens`);
  assert.match(src, /function bulkDelete\(\)/, `${name} has a bulk remove handler`);
  assert.match(src, new RegExp(`fetch\\(\`/api/library/${api}\\?id=`), `${name} bulk remove hits its delete endpoint`);
  assert.match(src, /\{allSelected \? "Clear" : "Select all"\}/, `${name} bulk bar offers select-all / clear`);
  assert.match(src, /className="library-bulk-check"/, `${name} rows show a checkbox in select mode`);
}

// Bulk delete is undoable across all three lists: it routes through the delayed
// scheduleDelete (not an immediate Promise.all), and undo restores the batch.
for (const [name, src] of [["reading", reading], ["bookmarks", bookmarks], ["github", github]]) {
  assert.match(src, /useUndoDelete<\w+ \| \w+\[\]>\(\)/, `${name} undo entry holds a single item or a bulk batch`);
  assert.match(src, /scheduleDelete\(\s*removed,/, `${name} bulk delete schedules the batch through the undo window`);
  assert.doesNotMatch(src, /function bulkDelete\(\)[\s\S]*?void Promise\.all/, `${name} bulk delete no longer fires deletes immediately`);
  assert.match(src, /\[\.\.\.\(Array\.isArray\(restored\) \? restored : \[restored\]\), \.\.\.prev\]/, `${name} undo restores both single and bulk deletes`);
}

// ── Keyboard-navigable list rows (normal browse mode) ───────────────────────
// The hand-rolled board-table lists had mouse-only rows for preview-selection
// (a prior pass only covered bulk-SELECT mode). They now share
// useTableRowKeyboardNav (↑/↓ + Home/End rove a tab stop, Enter/Space activate),
// keyed on row count so it binds once the table mounts after the fetch, and
// disabled in select mode where the rows are independent keyboard checkboxes.
for (const [name, src] of [["reading", reading], ["bookmarks", bookmarks], ["github", github]]) {
  assert.match(src, /import \{ useTableRowKeyboardNav \} from "@\/lib\/use-table-row-keynav"/, `${name} imports the shared row-keynav hook`);
  assert.match(src, /useTableRowKeyboardNav\(tbodyRef, sorted\.length, \{ disabled: selectMode \}\)/, `${name} wires keyboard nav (off in select mode)`);
  assert.match(src, /<tbody ref=\{tbodyRef\}>/, `${name} binds the hook to its tbody`);
  assert.match(src, /data-row="true"/, `${name} tags item rows for the roving selector`);
}
