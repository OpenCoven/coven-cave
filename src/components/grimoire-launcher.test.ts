// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Threaded Memories launcher — source pins for the React wiring; pure
// recency/search/capture derivations are behaviorally
// tested in src/lib/grimoire-launcher-data.test.ts.

const launcher = await readFile(new URL("./grimoire-launcher.tsx", import.meta.url), "utf8");
const view = await readFile(new URL("./grimoire-view.tsx", import.meta.url), "utf8");

// ── The launcher replaces the old empty state ────────────────────────────────

assert.match(
  view,
  /openTabs\.length === 0 \? \(\s*(?:\/\/[^\n]*\n\s*)*<GrimoireLauncher/,
  "no open tabs shows the Knowledge launcher instead of a bare empty state",
);
assert.match(view, /onOpen=\{openDoc\}/, "launcher rows open documents through the shared tab model");
assert.match(view, /onNewStitch=\{openStitchNew\}/, "launcher capture/templates route into the stitch intake");
assert.match(
  view,
  /onShowJournal=\{\(\) => setView\("journal"\)\}[\s\S]{0,80}onShowGraph=\{\(\) => setView\("graph"\)\}/,
  "the journal and graph tiles switch tabs",
);
assert.match(
  view,
  /graph=\{scopedGraph\}/,
  "the launcher sees the same scan-or-local graph as the canvas, narrowed by the same familiar scope",
);

// ── Header: Library / Journal / Relations with a bounded action budget ──────

assert.match(
  view,
  /const GRIMOIRE_VIEW_TABS:[\s\S]{0,320}\{ id: "docs", label: "Library"[\s\S]{0,160}\{ id: "graph", label: "Relations"/,
  "the shared Memories tabs keep the Library and Relations labels",
);
assert.match(
  view,
  /<Tabs<GrimoireViewKind>[\s\S]{0,360}ariaLabel="Memories view"[\s\S]{0,220}size="sm"[\s\S]{0,100}bordered=\{false\}/,
  "Memories uses the same compact underline tabs as the Research Desk",
);
assert.match(
  view,
  /\{view === "docs" \? \(\s*<button[\s\S]{0,260}grimoire-newstitch/,
  "the New stitch control is contextual to the Library tab",
);
assert.match(view, /<OverflowMenu[\s\S]*?ariaLabel="More Memories actions"/, "Weaves and Blank entry move to overflow");
assert.match(
  view,
  /<Link\s+href="\/weaves"\s+role="menuitem"[\s\S]*?>\s*<span>Weaves<\/span>\s*<\/Link>/,
  "Weaves remains a real route link inside overflow",
);
assert.match(view, /<PopoverItem[\s\S]*?>\s*Blank entry\s*</, "Blank entry remains reachable in overflow");
assert.doesNotMatch(
  view,
  /ariaLabel="Journal"/,
  "Library navigator no longer duplicates the top-level Journal destination",
);

// Both header verbs stay on one line and share the Search documents input's
// control radius — no pill-vs-control mismatch, no two-line labels when the
// band gets cramped (cave-w3hu).
const launcherCss = await readFile(
  new URL("../styles/grimoire-launcher.css", import.meta.url),
  "utf8",
);
assert.match(
  launcherCss,
  /\.grimoire-header \{[^}]*min-height: var\(--space-10\);[^}]*padding: 0 var\(--space-3\);/,
  "Memories aligns its header content to the Research Desk's 40px command band",
);
assert.match(
  launcherCss,
  /\.grimoire-tabs \{[^}]*align-self: stretch;[^}]*overflow-x: auto;/,
  "the tab underline sits on the header baseline and the tabs stay reachable in narrow panes",
);
assert.doesNotMatch(
  launcherCss,
  /\.grimoire-tabs \{[^}]*background:/,
  "the Memories destinations are not enclosed in a competing pill surface",
);
assert.match(
  launcherCss,
  /\.grimoire-newstitch \{[^}]*flex: none;[^}]*border-radius: var\(--radius-control\);[^}]*white-space: nowrap;/,
  "New stitch keeps control radius (matching the search input) and never wraps",
);

// ── Stitch prefill: capture/template opens re-key the intake mount ──────────

assert.match(
  view,
  /if \(opts\?\.patternId \|\| opts\?\.pinUrl\) \{\s*\n\s*setStitchPrefill/,
  "only prefilled opens bump the prefill nonce (plain refocus keeps pinned sources)",
);
assert.match(
  view,
  /<StitchIntake\s*\n\s*key=\{`stitch-new-\$\{stitchPrefill\.nonce\}`\}\s*\n\s*initialRef=\{stitchPrefill\.pinUrl\}\s*\n\s*initialPatternId=\{stitchPrefill\.patternId \?\? null\}/,
  "the intake mounts with the launcher's prefill",
);

// ── Launcher internals ───────────────────────────────────────────────────────

assert.match(launcher, /buildLauncherItems\(\{ knowledge, memory, journal \}\)/, "the recency pool derives from the loaded corpora");
assert.match(launcher, /detectLauncherCapture\(captureValue\)/, "URL capture has its own explicit Weave field");
assert.match(launcher, /onNewStitch\(\{ pinUrl: capture\.url \}\)/, "a detected URL pins into a new stitch");
assert.match(launcher, /STITCH_PATTERNS\.map\(/, "the new-stitch row offers the shared stitch patterns");
assert.match(launcher, /onNewStitch\(\{ patternId: pattern\.id \}\)/, "template tiles preselect their pattern");
assert.match(launcher, /launcherGraphCounts\(graph\)/, "the graph tiles count nodes/edges/detached from the doc graph");
assert.match(launcher, /aria-labelledby="memories-continue"/);
assert.match(launcher, /aria-labelledby="memories-recall"/);
assert.match(launcher, /aria-labelledby="memories-weave"/);
assert.match(launcher, /className="gl-thread"/, "the functional memory thread connects all three sections");
assert.doesNotMatch(launcher, /gl-banner|gl-bento|gl-week/, "aurora and bento dashboard are removed");

assert.match(
  launcher,
  /scopeLabel\?: string \| null/,
  "the launcher knows whether a familiar scope is active",
);
assert.doesNotMatch(launcher, /detached docs/, "the home no longer shows a statistic that cannot open its exact set");
assert.match(launcher, /aria-label="Search memories"/, "Recall owns the visible search");
assert.match(launcher, /aria-label="URL to capture"/, "Weave owns a separate URL input");
assert.ok(!/\bfetch\(/.test(launcher), "the launcher fetches nothing — it renders what the view loaded");

console.log("grimoire-launcher.test: ok");
