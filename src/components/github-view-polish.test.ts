// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = [
  readFileSync(new URL("./github-view.tsx", import.meta.url), "utf8"),
  readFileSync(new URL("./github-view-data.ts", import.meta.url), "utf8"),
].join("\n");
// The sectioned triage list lives in its own module; its markup pins belong
// here with the rest of the surface's contract.
const stream = readFileSync(new URL("./github-stream.tsx", import.meta.url), "utf8");
const stage = readFileSync(new URL("../lib/github-stage.ts", import.meta.url), "utf8");
const boardCss = [
  "chrome-table.css",
  "kanban-inspector.css",
  "github-list.css",
  "github-detail.css",
  "mobile-card-stack.css",
  "gantt-fallbacks.css",
].map((name) => readFileSync(new URL(`../styles/board/${name}`, import.meta.url), "utf8")).join("\n");

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
assert.doesNotMatch(
  source,
  /activity\?\.authed === true|>\s*authenticated\s*</,
  "authenticated state does not render a persistent status chip",
);
assert.doesNotMatch(
  boardCss,
  /\.gh-compact-auth--authed/,
  "the retired authenticated status chip leaves no dead modifier styles",
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
  stream,
  /gh-stream-row reveal-scope gh-tone--\$\{stage\.tone\}\$\{selected \? " is-selected" : ""\}/,
  "stream rows expose selected state and act as the reveal scope for row verbs",
);
assert.match(
  source,
  /onSelect=\{selectRow\}/,
  "clicking a stream row selects it for inspection (and clears any deep link)",
);
assert.match(
  source,
  /className=\{`gh-glass-panel gh-detail\$\{focused \? " is-focused" : ""\}`\}/,
  "detail panel keeps the glass panel styling hook and adds the focused-read modifier",
);
// Three bands: the masthead and the body scroll independently and the
// what-to-do-next drawer is pinned, so the shell itself is never the scrollport.
assert.match(source, /<div className="gh-detail-mast">/, "detail masthead is its own band");
assert.match(source, /<div className="gh-detail-body" ref=\{bodyRef\}>/, "detail body is its own scrollport");
assert.match(
  boardCss,
  /\.gh-detail \{[\s\S]*?overflow:hidden;/,
  "the detail shell clips rather than becoming the scrollport",
);
assert.match(
  boardCss,
  /\.gh-detail-body \{[\s\S]*?overflow-y:auto;/,
  "detail scrolling happens in the body band",
);
// Labels: the coloured chip UI stays retired (dots, per-label tints, a Labels
// section of its own). Plain label TEXT is back in two places, because the
// triage stream made it load-bearing: `untriaged` is *defined* as "no labels",
// so a row that carries that badge has to let you see what is missing, and the
// row's muted meta line plus the collapsed Facts grid are where it says so.
// If the owner wants labels gone again, delete metaFor()'s labels branch in
// github-stream.tsx and the labels fact row in github-view.tsx.
assert.doesNotMatch(
  source,
  /gh-issue-labels|gh-issue-label-dot|No labels on this item\.|gh-badge--label/,
  "GitHub view should not bring back the coloured label-chip UI",
);
assert.doesNotMatch(
  boardCss,
  /gh-issue-labels|gh-issue-label-dot|gh-badge--label|gh-glass-labels/,
  "GitHub label chip styles stay removed",
);
assert.doesNotMatch(
  source,
  /<div className="gh-glass-section-title">Labels<\/div>/,
  "labels do not get a section of their own",
);
assert.match(stream, /const labels = entry\.row\.labels \?\? \[\];/, "the row's meta line can show label text");
assert.match(source, /\{ key: "labels", value: labels\.map\(\(l\) => l\.name\)\.join\(", "\) \|\| "none" \}/, "the Facts grid carries labels as plain text");
assert.doesNotMatch(
  boardCss,
  /\.gh-glass-panel-scroll/,
  "the single-scrollport glass body is retired with the three-band detail panel",
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

// ── Stage-sectioned triage stream ─────────────────────────────────────────────
// The list groups by what a row is asking of you, and the facet chips ARE those
// sections — same key, same count — so a chip can never advertise a total the
// rows beneath the heading it names do not contain.
assert.match(stage, /export function facetsFor<T>\(sections: GhStreamSection<T>\[\]\): GhFacet\[\]/, "facets are derived from the sections themselves");
assert.match(source, /const facets = useMemo\(\(\) => facetsFor\(allSections\), \[allSections\]\)/, "the facet bar reads the same sections the stream renders");
assert.match(source, /allSections\.filter\(\(s\) => pickedFacets\.includes\(s\.key\)\)/, "picking a facet narrows to exactly that section");
assert.match(source, /const live = picked\.filter\(\(key\) => allSections\.some\(\(s\) => s\.key === key\)\)/, "a facet whose section disappeared is dropped rather than silently emptying the list");
assert.match(stage, /return defs[\s\S]{0,200}?\.filter\(\(s\) => s\.entries\.length > 0\)/, "empty sections are dropped, not rendered as bare headings");
assert.match(stream, /GH_NEXT_STEP\[stage\.key\]/, "peek names the next step for the row's stage");

// ── The stream never names or defaults a familiar ────────────────────────────
// Handing work off means choosing WHICH familiar, from the user's own roster.
// The stream takes a slot; the host fills it with the picker. A callback here
// would have invited a hardcoded default, and the earlier `onHandOff` prop was
// never wired at all, so the row verb silently did not render.
assert.doesNotMatch(stream, /onHandOff|handOffLabel/, "the dead hand-off callback is gone");
assert.match(stream, /renderHandOff\?: \(item: GitHubItem\) => ReactNode;/, "hand-off is a host-rendered slot");
assert.match(
  source,
  /renderHandOff=\{\(item\) => \(\s*<OpenChatAction/,
  "the host fills the hand-off slot with the familiar picker",
);
for (const [name, src] of [["stream", stream], ["stage", stage]]) {
  assert.doesNotMatch(src, /\bCody\b/i, `${name} names no specific familiar`);
}
assert.match(boardCss, /\.gh-tone--ok\s+\{ --gh-tone:var\(--color-success\); \}/, "one custom property carries a row's tone to every part that paints it");

// ── Landing gates ─────────────────────────────────────────────────────────────
// Checks, review and mergeability, read before the title's ink is dry. A gate
// whose data never arrived says so in the muted tone rather than borrowing a
// sibling's green.
assert.match(source, /function landingGates\(item: GitHubItem, detail: ItemDetail \| null, checks: ChecksState\)/, "the landing gates derive from the item, its detail and its checks");
assert.match(source, /value: "not reported", tone: "mute"/, "an unreported gate reports mute, never green");
assert.match(source, /&pull=1`/, "the detail fetch asks for mergeability and the review tally");
assert.match(source, /width < 300/, "the gate strip collapses to rows on a narrow split");
assert.match(source, /new ResizeObserver\(\(entries\) => \{\s*const width = Math\.round\(entries\[0\]\.contentRect\.width\)/, "the gate strip measures itself, not the viewport");

// ── Focused read ──────────────────────────────────────────────────────────────
// Portalled: an ancestor with backdrop-filter would otherwise become the
// containing block for position:fixed and strand the modal inside the split.
assert.match(source, /if \(!focused\) return panel;\s*\n\s*return createPortal\(/, "the focused read escapes the split through a portal");
assert.match(source, /if \(e\.key === "Escape"\) \{ e\.preventDefault\(\); setFocused\(false\); \}/, "Esc leaves the focused read");
assert.match(source, /const FILTER_BACK_LABEL: Record<Filter, string>/, "the way out of the focused read is named per tab");

// ── Freshness + budget ────────────────────────────────────────────────────────
assert.match(source, /function GhSyncPill/, "the header states how stale the list is");
assert.match(source, /function GhBudgetMeter/, "the header states the hour's shared API budget");
assert.match(source, /setLastSyncedAt\(Date\.now\(\)\)/, "freshness is stamped only on a successful fetch");
assert.match(boardCss, /\.gh-budget-track \{/, "the budget meter draws a spend bar, not just a number");

// ── Review-feedback guards (PR #4198, copilot-pull-request-reviewer) ─────────
// Rows are role="button", where aria-selected is not a valid state and some
// assistive tech drops it — aria-current is the codebase's marker, and the
// roving-index logic has to read the same attribute it writes.
assert.doesNotMatch(stream, /aria-selected/, "stream rows do not use aria-selected on a role=button");
assert.match(stream, /aria-current=\{selected \? "true" : undefined\}/, "the inspected row is marked with aria-current");
assert.match(stream, /r\.getAttribute\("aria-current"\) === "true"/, "roving-index recovery reads the same attribute the row writes");

// Raised over the list behind a scrim, the detail panel IS a modal: it says so,
// traps the tab ring, and returns focus on close.
assert.match(source, /role=\{focused \? "dialog" : undefined\}/, "the focused read carries dialog semantics");
assert.match(source, /aria-modal=\{focused \? true : undefined\}/, "the focused read is announced as modal");
assert.match(source, /useFocusTrap\(focused, panelRef, \{ onEscape: onUnfocus \}\)/, "the focused read traps focus and returns it");

// The freshness ticker only runs when there is a label on screen to age.
assert.match(source, /const ticking = syncedAt !== null;/, "the sync pill gates its ticker on having something to age");
assert.match(source, /if \(!ticking\) return;/, "no interval is created for a pill that renders nothing");

// A notification has a url but no number — gating the copy control on the
// number made its link uncopyable.
assert.doesNotMatch(
  source,
  /\{item\.number != null \? \(\s*<CopyButton/,
  "the copy-link control is not gated on a number the item may not have",
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
// Org/repo grouping is retired: the stream groups by stage, and a second
// grouping axis on top of that only competes with it. The overflow keeps the
// bulk section controls instead.
assert.doesNotMatch(source, /as GroupBy\[\]/, "the none/org/repo grouping toggle is gone");
assert.doesNotMatch(source, /<option value="none">No grouping<\/option>/, "the old grouping dropdown is gone");
assert.match(source, /Expand every section/, "the overflow can expand every section at once");
assert.match(source, /Collapse every section/, "the overflow can collapse every section at once");

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

// Sort columns are retired with the table. Sections answer "what is asking
// something of me"; the only ordering left inside one is recency, which needs
// no control.
assert.doesNotMatch(source, /handleSortClick/, "the column sort control is gone");
assert.doesNotMatch(source, /role="grid" aria-label="GitHub activity/, "the row table is gone");
assert.match(
  source,
  /\[\.\.\.scoped\]\.sort\(\(a, b\) => \(b\.updatedAt \?\? ""\)\.localeCompare\(a\.updatedAt \?\? ""\)\)/,
  "rows inside a section are ordered most-recent-first",
);

// Rows stay keyboard-navigable: ↑/↓ + Home/End rove a tab stop tied to the
// selected row, selection follows focus, and Enter raises the focused read.
assert.match(stream, /case "ArrowDown": e\.preventDefault\(\); focusAt/, "ArrowDown roves to the next row");
assert.match(stream, /case "ArrowUp": e\.preventDefault\(\); focusAt/, "ArrowUp roves to the previous row");
assert.match(stream, /case "Home": e\.preventDefault\(\); focusAt\(0\)/, "Home roves to the first row");
assert.match(stream, /data-gh-stream-row="true"[\s\S]{0,120}?data-item-id=\{row\.id\}/, "rows carry the roving + id hooks");
assert.match(stream, /tabIndex=\{selected \? 0 : -1\}/, "the selected row is the roving tab stop");
assert.match(stream, /if \(row\.dataset\.itemId\) onSelect\(row\.dataset\.itemId\)/, "selection follows keyboard focus");
assert.match(stream, /onOpen\(row\.id\)/, "Enter raises the focused read for the selected row");
assert.match(stream, /\}, \[visibleCount, onSelect\]\);/, "row-nav listeners rebind when the visible row set changes");

// Polling pauses while the tab is hidden (saves the visible rate limit) and
// the manual/⌘R refresh keeps the linked-task chips in sync.
assert.match(source, /function schedulePoll\(ms: number\)[\s\S]{0,160}?document\.hidden\) return/, "polling is skipped while the tab is hidden");
assert.match(source, /addEventListener\("visibilitychange", onVis\)/, "polling resumes when the tab returns to the foreground");
assert.match(source, /refreshActivity\(\);\s*\n\s*refreshLinkedWork\(\);/, "⌘R refreshes activity and linked work together");
assert.match(source, /const refreshLinkedWork = useCallback\([\s\S]{0,180}reloadCards\(\);[\s\S]{0,80}onTasksRefresh\?\.\(\)/, "linked-work refresh updates both cards and shell task context");
assert.match(source, /onClose=\{close\}\s*\n\s*onComplete=\{onAfterLink\}/, "closing the task popover without a change does not force-refresh linked work");

// Memoised so a re-render doesn't re-filter the (potentially large) item set.
assert.match(source, /const filtered = useMemo\(/, "the kind-filtered set is memoised");
assert.match(source, /const counts: Record<Filter, number> = useMemo\(/, "the per-filter counts are memoised");
// In-flight fetch can't setState after unmount.
assert.match(source, /if \(!mountedRef\.current\) return;/, "fetchActivity guards against setState after unmount");
assert.match(source, /if \(!data\.ok\) \{[\s\S]{0,180}?data\.error === "no_user"[\s\S]{0,120}?setError\("no_user"\)/, "the no-user setup state survives the shared cache");

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
assert.doesNotMatch(
  source,
  /function SafeMergeAction\(\{[\s\S]{0,160}?onJumpToSession/,
  "safe merge should not retain an unused session-jump callback",
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
assert.match(
  source,
  /onSaved=\{\(\) => \{[\s\S]*?invalidateSurfaceResources\("github:pat", "github:activity"\);[\s\S]*?void fetchPatStatus\(\);[\s\S]*?setShowPatModal\(false\);/,
  "saving or removing a Cave PAT re-reads status so a remaining launcher credential stays connected",
);

// ── 2026-07-03 GitHub audit fixes ─────────────────────────────────────────────
// The activity poll is content-guarded — an unchanged response keeps the prior
// reference so the whole table + detail panel don't re-render every 90s.
assert.match(source, /setActivity\(\(prev\) =>[\s\S]*?arrayContentEqual\(prev\.items, mergedActivity\.items\)[\s\S]*?\? prev/, "the activity poll guards setActivity with arrayContentEqual");
// A manual refresh with data already on screen keeps the list mounted (so an
// open composer draft isn't destroyed) — skeleton is initial-load only.
assert.match(source, /if \(!silent && !activity\) setLoading\(true\)/, "non-silent refresh only skeletons the initial load, preserving the composer");
// One refresh helper cancels the pending poll first, so Retry can't leak a
// second timer chain.
assert.match(source, /function refreshActivity\(\) \{[\s\S]*?clearTimeout\(timerRef\.current\)[\s\S]*?void fetchActivity\(false, true\)/, "refreshActivity cancels the scheduled poll before forcing a refetch");
assert.doesNotMatch(source, /onClick=\{\(\) => void fetchActivity\(\)\}/, "no manual site refetches without cancelling the pending poll (Retry leak fixed)");
// CI status shows passing/pending, not only failing (a green PR was invisible).
assert.match(stream, /item\.checkStatus === "passing"/, "CI passing state renders a row chip");
assert.match(stream, /item\.checkStatus === "pending"/, "CI pending state renders a row chip");
assert.match(boardCss, /\.gh-stream-chip \{/, "the row chips have a style");
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
