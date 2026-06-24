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

// Footer is no longer gated on `activity` — it always renders.
assert.doesNotMatch(
  source,
  /\{activity && \(\s*<footer/,
  "footer is no longer conditionally rendered on `activity`",
);
assert.match(
  source,
  /⌘R refresh · click a row to inspect · open icon launches GitHub/,
  "footer carries the inspect/open row hint",
);

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

// When a PAT is connected the button is icon-only (no text label); it keeps an
// aria-label for accessibility and only shows "Add PAT" text when not connected.
assert.doesNotMatch(
  source,
  /PAT connected</,
  "Connected PAT button drops its text label (icon only)",
);
assert.match(
  source,
  /aria-label=\{patStatus\?\.hasPat \? "GitHub PAT connected/,
  "Icon-only connected PAT button keeps an aria-label",
);
assert.match(
  source,
  /\{patStatus\?\.hasPat \? null : "Add PAT"\}/,
  "Disconnected state still shows the 'Add PAT' call to action",
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
  /className=\{`gh-row\$\{selectedItem\?\.id === item\.id \? " is-selected" : ""\}`\}/,
  "GitHub rows expose selected state",
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
  /@media \(min-width: 1041px\) \{[\s\S]*?\.gh-glass-panel:not\(\.gh-glass-panel--empty\) \{[\s\S]*?height:100%;/,
  "GitHub detail sidepanel keeps a stable container height while async detail content loads",
);
assert.match(
  boardCss,
  /@media \(max-width: 1040px\) \{[\s\S]*?\.gh-glass-panel:not\(\.gh-glass-panel--empty\) \{[\s\S]*?height:min\(460px,52dvh\);/,
  "GitHub detail sidepanel stays height-constrained in the single-column layout so hover cannot scroll-jump it",
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
assert.match(
  source,
  /aria-pressed=\{isActive\}/,
  "grouping toggle buttons expose pressed state",
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

// GitHub timestamps use the app-canonical relativeTime (which formats "2m ago"
// / "Jun 12" itself), not a local relTime helper with a manually-appended " ago"
// that disagreed between call sites.
assert.ok(source.includes('import { relativeTime } from "@/lib/relative-time"'), "imports shared relativeTime");
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

console.log("github-view-polish.test.ts OK");
