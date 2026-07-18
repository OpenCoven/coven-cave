// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Grimoire launcher ("Memories Prototype" redesign) — source pins for the
// React wiring; the pure derivations behind the tiles are behaviorally
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
assert.match(view, /graph=\{graph\}/, "the launcher sees the same scan-or-local graph as the canvas");

// ── Header: centered segmented tabs + contextual dashed New stitch pill ─────

assert.match(view, /className="focus-ring grimoire-tab"[\s\S]{0,60}>\s*Knowledge/, "the docs tab is labeled Knowledge");
assert.match(view, /className="focus-ring grimoire-tab"[\s\S]{0,60}>\s*Relations/, "the graph tab is labeled Relations");
assert.match(
  view,
  /\{view === "docs" \? \(\s*<>\s*<button[\s\S]{0,220}grimoire-newstitch/,
  "the New stitch pill is contextual to the Knowledge tab",
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
assert.match(launcher, /detectLauncherCapture\(query\)/, "the search field doubles as a URL capture intake");
assert.match(launcher, /onNewStitch\(\{ pinUrl: capture\.url \}\)/, "a detected URL pins into a new stitch");
assert.match(launcher, /STITCH_PATTERNS\.map\(/, "the new-stitch row offers the shared stitch patterns");
assert.match(launcher, /onNewStitch\(\{ patternId: p\.id \}\)/, "template tiles preselect their pattern");
assert.match(launcher, /journalStreakDays\(journal\.map\(\(j\) => j\.date\)/, "the journal tile shows the reflection streak");
assert.match(launcher, /launcherGraphCounts\(graph\)/, "the graph tiles count nodes/edges/detached from the doc graph");
assert.match(launcher, /aria-label="Search all documents or paste a URL"/, "the big search is labelled");
assert.match(launcher, /suppressHydrationWarning/, "the client-clock date line is hydration-safe");
assert.ok(!/\bfetch\(/.test(launcher), "the launcher fetches nothing — it renders what the view loaded");

console.log("grimoire-launcher.test: ok");
