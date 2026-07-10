// @ts-nocheck
// Journal lives in the Familiar Studio (Settings → Familiars → Journal).
// Source-scan invariants for the tab wiring and the redirect from the old
// top-level Journal surface.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

const ctx = read("../lib/familiar-studio-context.tsx");

// ── Studio context knows the journal tab ─────────────────────────────────────
assert.match(ctx, /"journal"/, "FamiliarStudioTab union includes journal");
assert.match(
  ctx,
  /STUDIO_TABS: readonly FamiliarStudioTab\[\][\s\S]*?"journal"/,
  "the canonical tab list includes journal",
);
assert.match(
  ctx,
  /\(STUDIO_TABS as readonly string\[\]\)\.includes\(stored \?\? ""\)/,
  "the persisted-tab restore guard checks against STUDIO_TABS",
);
// One shared redirect helper: workspace surfaces and the redirecting provider
// both route through it, so the tab/familiar handoff keys can't drift.
assert.match(
  ctx,
  /export function openFamiliarStudioSettingsTab\(/,
  "context exports the settings-redirect helper",
);
assert.match(
  ctx,
  /openFamiliarStudioSettingsTab\(tab, id\)/,
  "the redirecting provider reuses the helper",
);

const wrapper = read("./familiar-studio-journal-tab.tsx");
const inline = read("./familiar-studio-inline.tsx");
const sections = read("./settings-sections.ts");
const css = read("../styles/journal.css");

// ── Wrapper: reuse JournalEntries pinned to the studio's familiar ────────────
assert.match(wrapper, /import "@\/styles\/journal\.css"/, "wrapper carries the journal styles");
assert.match(wrapper, /<JournalEntries/, "wrapper renders the existing JournalEntries surface");
assert.match(
  wrapper,
  /useMemo\(\(\) => new Set\(\[familiar\.id\]\), \[familiar\.id\]\)/,
  "the multiselect scope is pinned to the one familiar being edited",
);
assert.match(wrapper, /activeFamiliarId=\{familiar\.id\}/, "generation targets the studio familiar");

// ── Inline panel: the tab is registered and rendered ─────────────────────────
assert.match(
  inline,
  /\{ id: "journal", label: "Journal", icon: "ph:book-open" \}/,
  "the studio tab bar includes Journal",
);
assert.match(
  inline,
  /activeTab === "journal" \? <FamiliarStudioJournalTab familiar=\{familiar\} allFamiliars=\{resolved\} \/> : null/,
  "the journal tab body renders the wrapper",
);

// ── Settings search reaches the tab ──────────────────────────────────────────
assert.match(sections, /familiarTab: "journal"/, "the journal studio tab is indexed for settings search");

// ── Studio host gives the master-detail journal a bounded height ─────────────
assert.match(
  css,
  /\.familiar-studio-journal \.journal-list \{[\s\S]*?height:/,
  "journal-list gets an explicit height inside the studio body",
);

const entriesSrc = read("./journal/journal-entries.tsx");

// ── Scope also gates the detail pane (not just the day rail) ─────────────────
assert.match(
  entriesSrc,
  /const dayInScope = !day\?\.entry\.reflectedBy \|\| familiarInScope\(scopeFamiliarIds \?\? EMPTY_SCOPE, day\.entry\.reflectedBy\)/,
  "an out-of-scope reflection reads as no-entry in the detail pane",
);
assert.match(
  entriesSrc,
  /&& dayInScope/,
  "hasEntry honors the familiar scope",
);

const ws = read("./workspace.tsx");
const sidebar = read("./sidebar-minimal.tsx");
const pageDrag = read("../lib/page-drag.ts");
const slash = read("../lib/slash-commands.ts");

// ── Workspace: "journal" is a redirect-only mode (like groupchat) ────────────
// It now opens the Grimoire surface on its Journal tab; per-familiar journals
// still live in Settings → Familiars → Journal via FamiliarStudioJournalTab.
assert.match(
  ws,
  /if \(next === "journal"\) \{[\s\S]{0,400}?setGrimoireView\("journal"\);\s*\n\s*setModeRaw\("grimoire"\)/,
  "setMode routes journal into the Grimoire Journal tab",
);
assert.doesNotMatch(ws, /import \{ JournalView \}/, "workspace no longer imports JournalView");
assert.doesNotMatch(ws, /mode === "journal" \?/, "no journal surface branch remains");
assert.doesNotMatch(ws, /cave:journal-set-tab/, "the journal tab event plumbing is gone");
assert.match(ws, /case "\/journal":\s*\n\s*setMode\("journal"\)/, "/journal routes through the redirect");

// ── Sidebar: the Journal row stays (redirects on click), minus sketches ─────
assert.match(sidebar, /id: "journal", label: "Journal", iconName: "ph:book-open"/, "sidebar keeps the Journal row");
assert.doesNotMatch(sidebar, /generated sketches/, "sidebar description no longer promises the canvas");

// ── A redirect is not a page: journal can't be dragged into a split ─────────
assert.match(pageDrag, /NON_SPLITTABLE = new Set\(\["terminal", "journal"\]\)/, "journal is excluded from drag-to-split");

// ── Slash palette copy matches the new home ───────────────────────────────────
assert.match(slash, /name: "\/journal"[^}]*Settings/, "/journal description points at Settings");
assert.doesNotMatch(slash, /Journal's Canvas tab/, "/canvas no longer advertises the Canvas page");

const artifactViewer = read("./chat-artifact-viewer.tsx");

// ── No surviving navigation into the retired Canvas page ─────────────────────
assert.doesNotMatch(artifactViewer, /cave:journal/, "artifact viewer no longer deep-links the Canvas page");
assert.match(artifactViewer, /Saved to Canvas/, "save-to-canvas confirms inline instead of navigating");
// A persisted last-surface of "journal" now restores safely: setMode remaps
// it to Grimoire's Journal tab, so the old skip-branch (which guarded against
// a hard-navigate to Settings that no longer exists) was removed (cave-nwi8).
assert.match(
  ws,
  /"journal" restores fine: setMode remaps it/,
  "journal restore relies on the setMode remap instead of a stale skip-branch",
);
assert.match(
  ws,
  /if \(next === "journal"\) \{/,
  "setMode still owns the journal→grimoire remap the restore path depends on",
);

const ghReview = read("./gh-review-actions.tsx");
assert.doesNotMatch(ghReview, /cave:canvas:layer|mode: "canvas"/, "PR review export no longer jumps to the retired Canvas page");
assert.match(ghReview, /openArtifactHtml\(artifact\.code\)/, "exported review artifacts open directly in a browser tab");

// ── Settings host: dead workspace events are avoided ─────────────────────────
assert.match(wrapper, /standalone/, "the studio tab renders JournalEntries in standalone mode");
assert.match(
  entriesSrc,
  /AUTOMATIONS\.filter\(\(a\) => a\.action !== "run"\)/,
  "standalone mode hides the chat-handoff automation",
);
assert.match(
  entriesSrc,
  /window\.location\.assign\(`\/\?mode=\$\{encodeURIComponent\(notice\.action!\.mode\)\}`\)/,
  "standalone toast actions deep-link back into the workspace",
);

// ── One-entry-per-day store: no silent cross-familiar overwrite ──────────────
assert.match(entriesSrc, /const outOfScopeBy =/, "derives the out-of-scope author");
assert.match(entriesSrc, /if \(outOfScopeBy\) return;/, "generate refuses to overwrite an out-of-scope entry");
assert.match(entriesSrc, /written by \$\{outOfScopeBy\}/, "the empty state names the actual author instead of inviting an overwrite");

console.log("familiar-studio-journal-tab.test.ts: ok");
