// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./github-view.tsx", import.meta.url),
  "utf8",
);
const boardCss = readFileSync(new URL("../styles/board.css", import.meta.url), "utf8");

// Inner GitHub <h2> and logo removed — the workspace breadcrumb already names the surface.
assert.doesNotMatch(
  source,
  /<h2 className="text-\[15px\] font-semibold">GitHub<\/h2>/,
  "inner GitHub h2 removed",
);
assert.doesNotMatch(
  source,
  /<Icon name="ph:github-logo" width=\{16\}/,
  "inner GitHub logo (header) removed (kept only inside the empty-state CTA)",
);

// Refresh button tooltip names the new shortcut.
assert.match(
  source,
  /title="Refresh \(⌘R\)"/,
  "refresh button tooltip includes ⌘R",
);

// Footer hint bar retired (§8 chrome diet): the keyboard bindings are
// documented in the ⌘/ Shortcuts sheet; only the low-rate warning still
// summons a footer.
assert.doesNotMatch(
  source,
  /\{activity && \(\s*<footer/,
  "footer is no longer conditionally rendered on `activity`",
);
assert.doesNotMatch(
  source,
  /↑↓ navigate · Enter opens on GitHub · ⌘R refresh/,
  "the permanent keyboard-hints footer is retired",
);
{
  const shortcuts = readFileSync(new URL("../lib/keyboard-shortcuts.ts", import.meta.url), "utf8");
  assert.match(shortcuts, /GitHub: open the selected item/, "the Shortcuts sheet documents Enter-to-open");
  assert.match(shortcuts, /GitHub: refresh activity/, "the Shortcuts sheet documents ⌘R refresh");
}

// ⌘R keydown handler wired.
assert.match(
  source,
  /e\.metaKey \|\| e\.ctrlKey/,
  "keydown handler checks meta or ctrl modifier",
);
assert.match(
  source,
  /e\.key !== "r" && e\.key !== "R"/,
  "keydown handler gates on the R key",
);
assert.match(
  source,
  /void fetchActivity\(\)/,
  "keydown handler triggers fetchActivity",
);
assert.match(
  source,
  /tag === "INPUT" \|\| tag === "TEXTAREA"/,
  "keydown handler skips when an input/textarea is focused",
);

// PAT chrome (§8): while unconnected, a visible "Add PAT" setup CTA renders;
// once connected, PAT management is an occasional verb and lives in the
// header overflow menu.
assert.doesNotMatch(
  source,
  /PAT connected</,
  "Connected PAT button drops its text label (icon only)",
);
assert.match(
  source,
  /\{!patStatus\?\.hasPat \? \(\s*<Button[\s\S]{0,300}?Add PAT/,
  "disconnected state keeps the visible Add PAT setup CTA",
);
assert.match(
  source,
  /\{patStatus\?\.hasPat \? \(\s*<>\s*<PopoverSeparator \/>\s*<PopoverItem icon="ph:key" onSelect=\{\(\) => setShowPatModal\(true\)\}>/,
  "connected state moves PAT management into the overflow menu",
);

assert.match(
  source,
  /function GitHubItemGlassPanel/,
  "selected GitHub item detail panel is present",
);
assert.match(
  source,
  /<span>PRs<\/span>[\s\S]*<span>Reviews<\/span>[\s\S]*<span>Issues<\/span>/,
  "detail panel summarizes PRs, Reviews, and Issues",
);
assert.match(
  source,
  /className=\{`gh-row reveal-scope\$\{selectedItem\?\.id === item\.id \? " is-selected" : ""\}`\}/,
  "GitHub rows expose selected state (and act as the reveal scope for row actions)",
);
assert.match(
  source,
  /onClick=\{\(\) => setSelectedItemId\(item\.id\)\}/,
  "clicking a GitHub row selects it for inspection",
);
assert.match(
  source,
  /className="gh-glass-panel"/,
  "detail panel uses the glass panel styling hook",
);
assert.match(
  source,
  /<div className="gh-glass-panel-scroll">[\s\S]*?<\/div>\s*<\/aside>/,
  "GitHub detail sidepanel keeps scrolling inside an inner body, not on the glass shell",
);
assert.doesNotMatch(
  source,
  /gh-issue-labels|gh-issue-label|gh-issue-label-dot|No labels on this item\.|gh-badge--label|item\.labels\?\.slice/,
  "GitHub view should not render visible GitHub labels in rows or the detail panel",
);
assert.doesNotMatch(
  boardCss,
  /gh-issue-labels|gh-issue-label|gh-issue-label-dot|gh-badge--label|gh-glass-labels/,
  "GitHub label chip styles should be removed with the visible label UI",
);
assert.match(
  boardCss,
  /\.gh-glass-panel-scroll \{[\s\S]*?overflow-y:auto;[\s\S]*?scrollbar-width:none;[\s\S]*?-ms-overflow-style:none;/,
  "GitHub detail sidepanel scrolls inside an inner body without the hover-only scrollbar rail",
);
assert.match(
  boardCss,
  /\.gh-glass-panel-scroll::(?:-webkit-scrollbar) \{ width:0; height:0; \}/,
  "GitHub detail sidepanel inner body hides WebKit scrollbar chrome on hover",
);
assert.match(
  boardCss,
  /\.gh-glass-panel \{[\s\S]*?overflow:hidden;/,
  "GitHub detail sidepanel shell clips glass effects instead of becoming the scrollport",
);
assert.match(
  boardCss,
  /\.gh-workspace \{[\s\S]*?height:100%;[\s\S]*?min-height:0;[\s\S]*?overflow:hidden;/,
  "GitHub workspace height is container-bound so the detail sidepanel does not make the parent scroll on hover",
);
assert.match(
  source,
  /className="github-surface-body min-h-0 flex-1 overflow-hidden"/,
  "GitHub surface body should not be a parent scrollport that exposes hover-only scroll chrome over the sidepanel",
);
assert.doesNotMatch(
  source,
  /github-surface[\s\S]{0,2600}<div className="min-h-0 flex-1 overflow-y-auto">/,
  "GitHub surface body should leave scrolling to the list panel and detail panel internals",
);
assert.match(
  boardCss,
  /\.gh-workspace--split \.gh-detail-holder \{ height:100%; \}[\s\S]*?\.gh-workspace--split \.gh-glass-panel \{[\s\S]*?flex:1 1 auto;/,
  "GitHub detail sidepanel keeps a stable container height while async detail content loads (fills its split pane)",
);
assert.match(
  boardCss,
  /\.gh-workspace--stacked \.gh-glass-panel:not\(\.gh-glass-panel--empty\) \{[\s\S]*?height:min\(460px,52dvh\);/,
  "GitHub detail sidepanel stays height-constrained in the stacked layout so hover cannot scroll-jump it",
);
assert.doesNotMatch(
  source,
  /<div className="gh-glass-section-title">Labels<\/div>/,
  "detail panel removes the Labels section entirely",
);

// Selecting a repo pins the org to that repo's org and locks the Org select.
assert.match(
  source,
  /if \(repoFilter === "all"\) return;[\s\S]*?const org = orgOf\(repoFilter\);[\s\S]*?setOrgFilter\(org\)/,
  "a selected repo pins the Org filter to that repo's org",
);
assert.match(
  source,
  /disabled=\{orgOptions\.length === 0 \|\| repoFilter !== "all"\}/,
  "the Org select is disabled (locked) while a repo is selected",
);
// Grouping is a none/org/repo segmented toggle, not a dropdown.
assert.match(
  source,
  /\(\["none", "org", "repo"\] as GroupBy\[\]\)\.map/,
  "grouping renders as a none/org/repo toggle",
);
// Grouping moved into the overflow menu (§8): PopoverItem's checked prop
// renders menuitemradio semantics (aria-checked + trailing check glyph).
assert.match(
  source,
  /<PopoverItem key=\{g\} checked=\{groupBy === g\} onSelect=\{\(\) => setGroupBy\(g\)\}>/,
  "grouping options are exclusive menu radios in the overflow",
);
assert.doesNotMatch(
  source,
  /<option value="none">No grouping<\/option>/,
  "the old grouping dropdown is gone",
);

// The side-panel toggle moved up into the top menu bar, so it no longer overlays
// the header's right edge — the 44px (pr-11) gutter that used to clear it is
// gone and the header uses a symmetric pr-5.
assert.doesNotMatch(
  source,
  /github-surface-header[^"]*\bpr-11\b/,
  "GitHub header no longer reserves a gutter for the retired floating panel toggle",
);

// Setup Save accepts a username-only submission (public data, no PAT) — the
// disabled gate must mirror save()'s "PAT OR username" rule, not require a PAT.
assert.match(
  source,
  /disabled=\{\(!pat\.trim\(\) && !usernameInput\.trim\(\)\) \|\| saving\}/,
  "Save is enabled when either a PAT or a username is entered (not PAT-only)",
);
// The filter row is the shared segment Tabs, labelled for assistive tech.
assert.match(
  source,
  /<Tabs[\s\S]{0,200}ariaLabel="Filter GitHub activity"/,
  "the filter row renders through the shared Tabs with an accessible label",
);
assert.match(
  source,
  /variant="segment"/,
  "the filter row uses the segment tab variant",
);
assert.match(
  source,
  /<header className="github-surface-header gh-compact-header">[\s\S]*?<Tabs[\s\S]*?className="gh-compact-tabs"[\s\S]*?<\/header>/,
  "GitHub header should be one compact band containing identity, tabs, filters, grouping, and actions",
);
assert.doesNotMatch(
  source,
  /github-surface-controls/,
  "GitHub header should not use a second stacked controls strip",
);
assert.match(
  boardCss,
  /\.gh-compact-header \{[\s\S]*?min-height:40px;[\s\S]*?flex-wrap:wrap;/,
  "compact GitHub header should stay shallow and wrap instead of adding a second bar",
);
assert.doesNotMatch(
  boardCss,
  /\.github-surface::before/,
  "GitHub surface should not paint an extra decorative overlay behind the header",
);

// Sortable table headers are keyboard-operable (a real <button>) and expose
// sort state to assistive tech via aria-sort.
assert.match(
  source,
  /aria-sort=\{[\s\S]{0,400}?"ascending"[\s\S]{0,120}?"descending"[\s\S]{0,120}?"none"/,
  "sortable column headers expose aria-sort (ascending/descending/none)",
);
assert.match(
  source,
  /<button[\s\S]{0,250}?onClick=\{\(\) => handleSortClick\(col\.key!\)\}/,
  "the sort control is a real keyboard-operable button",
);

// Rows are keyboard-navigable: ↑/↓ + Home/End rove a tab stop tied to the
// selected row, selection follows focus, and Enter opens the item in Cave's Browser.
assert.match(source, /case "ArrowDown": e\.preventDefault\(\); focusRow/, "ArrowDown roves to the next row");
assert.match(source, /case "ArrowUp": e\.preventDefault\(\); focusRow/, "ArrowUp roves to the previous row");
assert.match(source, /data-gh-row="true"[\s\S]{0,160}?data-item-id=\{item\.id\}/, "item rows carry the roving + id hooks");
assert.match(source, /tabIndex=\{selectedItem\?\.id === item\.id \? 0 : -1\}/, "the selected row is the roving tab stop");
assert.match(source, /role="grid" aria-label="GitHub activity/, "the table is a labelled grid");
assert.match(source, /setSelectedItemId\(row\.dataset\.itemId\)/, "selection follows keyboard focus");
assert.match(source, /openExternalUrl\(url\)/, "Enter opens the focused row through the in-app Browser handoff");
assert.match(source, /\}, \[sorted\.length\]\);/, "row-nav listeners rebind when the table mounts after the async fetch");

// Polling pauses while the tab is hidden (saves the visible rate limit) and
// the manual/⌘R refresh keeps the linked-task chips in sync.
assert.match(source, /function schedulePoll\(ms: number\)[\s\S]{0,160}?document\.hidden\) return/, "polling is skipped while the tab is hidden");
assert.match(source, /addEventListener\("visibilitychange", onVis\)/, "polling resumes when the tab returns to the foreground");
assert.match(source, /refreshActivity\(\);\s*\n\s*reloadCards\(\);/, "⌘R refreshes activity (via refreshActivity) AND reloads the linked-task cards");

// Memoised so a re-render doesn't re-filter the (potentially large) item set.
assert.match(source, /const filtered = useMemo\(/, "the kind-filtered set is memoised");
assert.match(source, /const counts: Record<Filter, number> = useMemo\(/, "the per-filter counts are memoised");
// In-flight fetch can't setState after unmount.
assert.match(source, /if \(!mountedRef\.current\) return;/, "fetchActivity guards against setState after unmount");

// GitHub timestamps use the app-canonical relative time via the shared
// <RelativeTime> component (semantic <time>, preference-aware exact-time hover,
// self-updating) — not a local relTime helper with a manually-appended " ago"
// that disagreed between call sites, and not a raw ISO string in the title.
assert.ok(source.includes('import { RelativeTime } from "@/components/ui/relative-time"'), "uses the shared RelativeTime component");
assert.ok(!source.includes("relTime"), "local relTime helper and its call sites are gone");

// PR rows expose a maintainer-safe merge path that prefers an issue/PR worktree
// over working directly from the shared branch checkout.
assert.match(
  source,
  /function SafeMergeAction/,
  "GitHub rows should expose a dedicated safe-merge action",
);
assert.match(
  source,
  /if \(item\.kind !== "pr" && item\.kind !== "review_request"\) return null/,
  "safe merge action should only render for pull requests and review requests",
);
assert.match(
  source,
  /fetch\("\/api\/github\/worktree"/,
  "safe merge action should provision or reuse a worktree before opening chat",
);
assert.match(
  source,
  /Safely merge this PR/,
  "safe merge chat context should clearly ask for the safe merge workflow",
);
assert.match(
  source,
  /Prefer the worktree path over switching branches in the shared checkout/,
  "safe merge prompt should prefer worktrees over branch switching",
);
assert.match(
  source,
  /let safeMergeRoot: string \| null = linkedCard\?\.cwd \?\? null;/,
  "safe merge tracks the chat root and defaults to the linked card cwd",
);
assert.match(
  source,
  /safeMergeRoot = typeof json\.worktree === "string" && json\.worktree \? json\.worktree : linkedCard\.cwd;/,
  "safe merge roots the chat in the provisioned worktree when available",
);
assert.match(
  source,
  /detail: \{ familiarId, projectRoot: safeMergeRoot \?\? undefined, initialPrompt \}/,
  "safe merge opens chat with the initial prompt and worktree root",
);
assert.match(
  source,
  /<SafeMergeAction[\s\S]{0,500}?onJumpToSession=\{onJumpToSession\}/,
  "safe merge action should be wired into each GitHub row",
);
assert.match(
  source,
  /<div className="gh-glass-actions">[\s\S]{0,900}<SafeMergeAction[\s\S]{0,500}?onJumpToSession=\{onJumpToSession\}/,
  "safe merge action should be wired into the selected-item panel actions",
);

// Copy buttons must use the context-safe copyText (via useCopy), not raw
// navigator.clipboard — the latter silently no-ops in the Tauri webview and
// over non-secure Tailscale Serve.
assert.doesNotMatch(
  source,
  /navigator\.clipboard/,
  "GitHub copy buttons go through the context-safe copyText (useCopy), not raw navigator.clipboard",
);
assert.match(source, /useCopy/, "GitHub view copies via the shared useCopy hook");

// ── Free-text search over the activity list ──
assert.match(source, /import \{ githubItemMatchesQuery \} from "@\/lib\/github-search"/, "uses the pure search matcher");
assert.match(source, /const \[query, setQuery\] = useState\(""\)/, "tracks a search query");
assert.match(source, /githubItemMatchesQuery\(i, query\)/, "the scoped list filters by the query");
assert.match(source, /\[filtered, orgFilter, repoFilter, query\]/, "query is a dependency of the scoped memo");
assert.match(source, /aria-label="Search GitHub items by title, repo, or number"/, "the search input is labelled");
assert.match(source, /No items match/, "a no-match query gets its own empty state");
assert.match(boardCss, /\.gh-search \{/, "the search box is styled to match the toolbar controls");

assert.match(
  source,
  /import \{ openExternalUrl \} from "@\/lib\/open-external"/,
  "PAT setup imports the system-browser opener",
);
assert.match(
  source,
  /onClick=\{\(\) => void openExternalUrl\(GITHUB_PAT_URL\)\}/,
  "PAT setup opens token creation on github.com outside the local app surface",
);
assert.doesNotMatch(
  source,
  /href="https:\/\/github\.com\/settings\/tokens\/new/,
  "PAT setup no longer relies on a plain anchor that can stay inside localhost",
);

// ── 2026-07-03 GitHub audit fixes ─────────────────────────────────────────────
// The activity poll is content-guarded — an unchanged response keeps the prior
// reference so the whole table + detail panel don't re-render every 90s.
assert.match(source, /setActivity\(\(prev\) =>[\s\S]*?arrayContentEqual\(prev\.items, nextActivity\.items\)[\s\S]*?\? prev/, "the activity poll guards setActivity with arrayContentEqual");
// A manual refresh with data already on screen keeps the list mounted (so an
// open composer draft isn't destroyed) — skeleton is initial-load only.
assert.match(source, /if \(!silent && !activity\) setLoading\(true\)/, "non-silent refresh only skeletons the initial load, preserving the composer");
// One refresh helper cancels the pending poll first, so Retry can't leak a
// second timer chain.
assert.match(source, /function refreshActivity\(\) \{[\s\S]*?clearTimeout\(timerRef\.current\)[\s\S]*?void fetchActivity\(\)/, "refreshActivity cancels the scheduled poll before refetching");
assert.doesNotMatch(source, /onClick=\{\(\) => void fetchActivity\(\)\}/, "no manual site refetches without cancelling the pending poll (Retry leak fixed)");
// CI status shows passing/pending, not only failing (a green PR was invisible).
assert.match(source, /item\.checkStatus === "passing"/, "CI passing state renders a badge");
assert.match(source, /item\.checkStatus === "pending"/, "CI pending state renders a badge");
assert.match(boardCss, /\.gh-badge--success \{/, "the success badge has a style");
// ── 2026-07-03 GitHub a11y batch ──────────────────────────────────────────────
assert.match(source, /const \{ announce \} = useAnnouncer\(\)/, "the GitHub surface consumes the shared announcer");
assert.match(source, /announce\("Comment posted\."\)/, "posting a comment announces");
assert.match(source, /announce\(next \? "Thread resolved\." : "Thread unresolved\."\)/, "resolving a thread announces");
assert.match(source, /announce\(`Worktree \$\{json\.created \? "created" : "reused"\} for the safe merge\.`\)/, "the safe-merge worktree announces");
assert.match(source, /aria-label="Reply to this thread"/, "the comment composer textarea is labelled");
assert.match(source, /className="gh-composer-error" role="alert"/, "a failed post is announced via role=alert");

// ── cave-4op CSS patch guards ──────────────────────────────────────────────────

assert.doesNotMatch(
  source,
  /className="gh-action-btn"/,
  "raw gh-action-btn className removed — use Button size=sm",
);
assert.doesNotMatch(
  source,
  /className=\{`gh-action-btn/,
  "raw gh-action-btn template literal className removed",
);
assert.doesNotMatch(
  source,
  /className="gh-compact-icon-button/,
  "raw gh-compact-icon-button className removed — use IconButton",
);
assert.doesNotMatch(
  source,
  /className=\{`gh-compact-icon-button/,
  "raw gh-compact-icon-button template literal className removed",
);
assert.doesNotMatch(
  source,
  /className="gh-composer-submit"/,
  "raw gh-composer-submit className removed — use Button size=sm variant=primary",
);
assert.doesNotMatch(
  source,
  /className=\{`gh-composer-submit/,
  "raw gh-composer-submit template literal className removed",
);
assert.match(
  source,
  /import \{ IconButton \}/,
  "IconButton is imported",
);
assert.doesNotMatch(
  source,
  /rounded-xl border border-\[var\(--border-hairline\)\] bg-\[var\(--bg-elevated\)\]/,
  "PAT modal wrapper uses .gh-pat-dialog class, not inline Tailwind",
);
assert.doesNotMatch(
  source,
  /w-full rounded-lg border border-\[var\(--border-hairline\)\] bg-\[var\(--bg-base\)\]/,
  "PAT modal inputs use .gh-input class, not inline Tailwind",
);

// ── Workspace split: resizable + collapsible + measured-width responsive ──────
// The detail sidepanel is a react-resizable-panels Panel behind a drag
// separator; its width persists per-group and its collapse is its own pref.
assert.match(
  source,
  /const GH_WORKSPACE_GROUP_ID = "cave\.github\.workspace\.v1";/,
  "workspace split widths persist under a versioned group id",
);
assert.match(
  source,
  /useDefaultLayout\(\{\s*id: GH_WORKSPACE_GROUP_ID,\s*panelIds: \["gh-list", "gh-detail"\],\s*storage: ghWorkspaceStorage,/,
  "split layout restores through the guarded storage wrapper (shell.tsx pattern)",
);
assert.match(
  source,
  /const anyCollapsed = values\.some\(\(v\) => v >= 0 && v <= 6\);/,
  "storage guard drops rail-width saves so a stale collapse can't restore as a crushed panel",
);
assert.match(
  source,
  /collapsible\s+collapsedSize=\{GH_DETAIL_RAIL_PX\}/,
  "detail panel collapses to the expand rail, not to nothing",
);
assert.match(
  source,
  /<Separator className="shell-separator gh-workspace-separator">\s*<SeparatorHandle orientation="col" \/>/,
  "list ⇄ detail separator uses the shared drag handle (role=separator a11y)",
);
assert.match(
  source,
  /const GH_DETAIL_COLLAPSED_KEY = "cave:github:details-collapsed:v1";/,
  "collapse state persists in its own pref, independent of saved widths",
);
assert.match(
  source,
  /aria-label="Collapse details panel"[\s\S]{0,200}aria-expanded/,
  "collapse control is a labelled disclosure button",
);
assert.match(
  source,
  /aria-label="Expand details panel"/,
  "collapsed rail keeps a labelled expand control on-screen",
);
assert.match(
  source,
  /new ResizeObserver\(\(entries\) => \{\s*const next = entries\[0\]\?\.contentRect\.width/,
  "split-vs-stacked tracks the workspace's own measured width (drag-to-split panes), not the viewport",
);
assert.match(
  source,
  /width === null \? !isMobile : width >= GH_SPLIT_MIN_PX/,
  "first paint falls back to the viewport heuristic until the ResizeObserver lands",
);
assert.match(
  source,
  /if \(!collapsedRef\.current\) onLayoutChanged\(/,
  "collapsed rail widths are never persisted as the saved layout",
);
assert.match(
  boardCss,
  /\.gh-detail-toggle-bar \{[\s\S]*?border:1px dashed /,
  "stacked collapsed state renders the dashed show-details invitation",
);
assert.match(
  boardCss,
  /\.gh-detail-rail \{[\s\S]*?height:100%;/,
  "collapsed split state renders the full-height expand rail",
);
assert.doesNotMatch(
  boardCss,
  /grid-template-columns:minmax\(0,1fr\) minmax\(340px,420px\)/,
  "fixed-width detail column is gone — the split is user-resizable",
);

// ── Fetch + optimistic-state hygiene (cave-b8ba) ─────────────────────────────
// Detail/profile/comments/checks loads carry real AbortControllers (arrowing
// through the list cancels the left-behind request instead of burning rate
// limit); optimistic thread-resolves survive the post-comment refetch during
// GitHub's read-after-write lag; the PAT modal can't be dismissed mid-save.
{
  const aborts = (source.match(/return \(\) => ctl\.abort\(\);/g) ?? []).length;
  if (aborts < 4) throw new Error(`expected >=4 aborted fetch effects, found ${aborts}`);
}
assert.match(source, /const pendingResolveRef = useRef\(new Map<string, boolean>\(\)\)/, "optimistic resolves are tracked for override");
assert.match(source, /pending\.delete\(t\.id\); \/\/ API caught up — stop overriding/, "overrides drop once the API confirms");
assert.match(source, /const closeUnlessSaving = \(\) => \{\s*\n\s*if \(!savingRef\.current\) onClose\(\);/, "the PAT modal defers dismissal while saving");
assert.match(source, /onClick=\{closeUnlessSaving\}/, "the backdrop uses the saving-aware close");

console.log("github-view-polish.test.ts OK");
