// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const bookmarks = await readFile(new URL("./library-bookmarks-list.tsx", import.meta.url), "utf8");
const reading   = await readFile(new URL("./library-reading-list.tsx",   import.meta.url), "utf8");
const github    = await readFile(new URL("./library-github-list.tsx",    import.meta.url), "utf8");
const bookmarksRoute = await readFile(new URL("../app/api/library/bookmarks/route.ts", import.meta.url), "utf8");

// ───────── Task 1: localeCompare null-guards ─────────
// bookmarks — title, domain, savedAt
assert.match(bookmarks, /\(a\.title \?\? ""\)\.localeCompare\(b\.title \?\? ""\)/,    "bookmarks title null-guard");
assert.match(bookmarks, /\(a\.domain \?\? ""\)\.localeCompare\(b\.domain \?\? ""\)/,  "bookmarks domain null-guard");
assert.match(bookmarks, /\(a\.savedAt \?\? ""\)\.localeCompare\(b\.savedAt \?\? ""\)/,"bookmarks savedAt null-guard");
assert.match(bookmarks, /function bookmarkTags\(item: LibraryBookmark\): string\[\]/, "bookmarks normalize tag arrays before grouping/searching");
assert.match(bookmarks, /const domain = displayDomain\(item\);[\s\S]{0,120}const keys = by === "domain" \? \[domain\] : \(tags\.length > 0 \? tags : \["\(untagged\)"\]\);/, "bookmarks group by a display-safe domain");
assert.match(bookmarksRoute, /function normalizeBookmark\(item: Partial<LibraryBookmark>\): LibraryBookmark/, "bookmarks API normalizes legacy bookmark records");
assert.match(bookmarksRoute, /const domain = cleanString\(item\.domain\) \|\| \(url \? domainFrom\(url\) : "\(unknown\)"\);/, "bookmarks API backfills missing domains");

// reading — title, addedAt, label
assert.match(reading, /\(a\.title \?\? ""\)\.localeCompare\(b\.title \?\? ""\)/,     "reading title null-guard");
assert.match(reading, /\(a\.addedAt \?\? ""\)\.localeCompare\(b\.addedAt \?\? ""\)/, "reading addedAt null-guard");
assert.match(reading, /\(a\.label \?\? ""\)\.localeCompare\(b\.label \?\? ""\)/,     "reading label null-guard");

const libraryCss = await readFile(new URL("../styles/library.css", import.meta.url), "utf8");
assert.match(
  reading,
  /className="board-table-title library-reading-title"/,
  "reading titles should opt into library-specific wrapping instead of the shared one-line board title style",
);
assert.match(
  libraryCss,
  /\.library-reading-title\s*\{[\s\S]*?-webkit-line-clamp:\s*2[\s\S]*?white-space:\s*normal/,
  "reading titles should wrap and clamp at two visible lines",
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

// github — title, repo, savedAt
assert.match(github, /\(a\.title \?\? ""\)\.localeCompare\(b\.title \?\? ""\)/,   "github title null-guard");
assert.match(github, /\(a\.repo \?\? ""\)\.localeCompare\(b\.repo \?\? ""\)/,     "github repo null-guard");
assert.match(github, /\(a\.savedAt \?\? ""\)\.localeCompare\(b\.savedAt \?\? ""\)/,"github savedAt null-guard");

// ───────── Task 2: Timeline placeholder shortened ─────────
const timeline = await readFile(new URL("./library-timeline.tsx", import.meta.url), "utf8");
assert.match(timeline, /placeholder="Search links…"/, "Timeline placeholder must be 'Search links…'");
assert.match(timeline, /title="Search links — try chat: github: sage:"/, "Verbose hint must live in title=");
assert.doesNotMatch(timeline, /placeholder="Search links — try chat: github: sage:"/, "Old long placeholder must be removed");

// ───────── Task 3: Lists "All" renamed to "Timeline" ─────────
const rail = await readFile(new URL("./library-collection-rail.tsx", import.meta.url), "utf8");
assert.match(rail, /\{ id: "all",\s+label: "Timeline",\s+icon: "ph:link" \}/, "STATIC_LIST_SECTIONS first row label must be 'Timeline'");

// ───────── Task 4: Section-aware preview empty state ─────────
const preview = await readFile(new URL("./library-doc-preview.tsx", import.meta.url), "utf8");
const view    = await readFile(new URL("./library-view.tsx",        import.meta.url), "utf8");

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
  /@container \(max-width: 560px\) \{[\s\S]*?\.library-reading-row\s*\{[\s\S]*?display:\s*grid;[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)\s*minmax\(132px,\s*176px\)\s*42px;/,
  "Narrow reading panels should render rows as a compact grid with a readable status control",
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
  /className=\{`library-reading-row\$\{item\.id === selectedId \? " selected" : ""\}`\}/,
  "Reading rows should expose a stable class for responsive side-panel layout",
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
  /@container \(max-width: 460px\) \{[\s\S]*?\.library-list-header\s*\{[\s\S]*?align-items:\s*stretch;[\s\S]*?\.library-list-header-controls\s*\{[\s\S]*?width:\s*100%;/,
  "Narrow side-panel headers should wrap controls below the title instead of overlapping it",
);
assert.match(
  libraryCss,
  /@container \(max-width: 520px\) \{[\s\S]*?\.library-bookmarks-table th:nth-child\(3\)[\s\S]*?\.library-github-table thead\s*\{[\s\S]*?display:\s*none;/,
  "Saved-list side-panel tables should drop low-value table chrome before horizontal overflow appears",
);
assert.match(
  libraryCss,
  /@container \(max-width: 460px\) \{[\s\S]*?\.library-bookmarks-table th:nth-child\(2\)[\s\S]*?\.library-github-table \.gh-col-labels\s*\{[\s\S]*?display:\s*none;/,
  "Very narrow saved-list side-panel tables should prioritize title/action columns over metadata",
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
