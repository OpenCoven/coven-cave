// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./github-view.tsx", import.meta.url),
  "utf8",
);

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

console.log("github-view-polish.test.ts OK");
