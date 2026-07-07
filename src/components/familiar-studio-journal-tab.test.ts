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

console.log("familiar-studio-journal-tab.test.ts: ok");
