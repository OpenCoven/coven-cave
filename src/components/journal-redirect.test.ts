// @ts-nocheck
// The Journal lives in the Grimoire (Memories → Journal tab). Both prior homes
// — the top-level Journal page and the Settings → Familiars studio tab — are
// retired. These pins hold the redirect seams (mode remap, palette
// reachability, restore path) and the invariant that neither retired surface
// creeps back.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

const ctx = read("../lib/familiar-studio-context.tsx");

// ── Studio context: journal is no longer a studio tab ────────────────────────
assert.doesNotMatch(ctx, /"journal"/, "FamiliarStudioTab union no longer includes journal");
assert.match(
  ctx,
  /\(STUDIO_TABS as readonly string\[\]\)\.includes\(stored \?\? ""\)/,
  "the persisted-tab restore guard checks against STUDIO_TABS (a stale stored \"journal\" falls back to the default tab)",
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

const inline = read("./familiar-studio-inline.tsx");
const sections = read("./settings-sections.ts");

// ── Inline panel + settings search: no journal tab wiring remains ────────────
assert.doesNotMatch(inline, /"journal"/, "the studio tab bar no longer includes Journal");
assert.doesNotMatch(inline, /FamiliarStudioJournalTab/, "the journal tab wrapper is gone");
assert.doesNotMatch(sections, /familiarTab: "journal"/, "settings search no longer indexes a journal studio tab");

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

// The Settings host is gone, and its `standalone` fork went with it — the
// Grimoire (workspace) is the only journal host, so the workspace event bus is
// always available.
assert.doesNotMatch(entriesSrc, /standalone/, "journal-entries no longer carries the settings-host fork");

const ws = read("./workspace.tsx");
const sidebar = read("./sidebar-minimal.tsx");
const pageDrag = read("../lib/page-drag.ts");
const slash = read("../lib/slash-commands.ts");

// ── Workspace: "journal" is a redirect-only mode (like groupchat) ────────────
// It opens the Grimoire surface on its Journal tab.
assert.match(
  ws,
  /if \(next === "journal"\) \{[\s\S]{0,400}?setGrimoireView\("journal"\);\s*\n\s*commitMode\("grimoire"\)/,
  "setMode routes journal into the Grimoire Journal tab",
);
assert.doesNotMatch(ws, /import \{ JournalView \}/, "workspace no longer imports JournalView");
assert.doesNotMatch(ws, /mode === "journal" \?/, "no journal surface branch remains");
assert.doesNotMatch(ws, /cave:journal-set-tab/, "the journal tab event plumbing is gone");
assert.match(ws, /case "\/journal":\s*\n\s*setMode\("journal"\)/, "/journal routes through the redirect");

// ── Sidebar: the Journal mode stays reachable (⌘K palette + deep links via
// navHidden) even though its dedicated row is retired — it's a tab inside
// Memories now. ─────
assert.match(sidebar, /id: "journal", label: "Journal", iconName: "ph:book-open"/, "sidebar keeps the Journal FOLDER_MODES entry for the palette");
assert.doesNotMatch(sidebar, /generated sketches/, "sidebar description no longer promises the canvas");

// ── A redirect is not a page: journal can't be dragged into a split ─────────
assert.match(pageDrag, /NON_SPLITTABLE = new Set\(\["terminal", "journal"\]\)/, "journal is excluded from drag-to-split");

// ── Slash palette copy matches the new home ───────────────────────────────────
assert.match(slash, /name: "\/journal"/, "the /journal slash command survives the redirect");
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
  /if \(last && \(isWorkspaceMode\(last\) \|\| isRoleSurfaceMode\(last\)\)\) setMode\(last as CaveMode\)/,
  "journal restore relies on the setMode remap instead of a stale skip-branch",
);
assert.doesNotMatch(ws, /last === "journal"/, "no journal skip-branch remains in the restore path");
assert.match(
  ws,
  /if \(next === "journal"\) \{/,
  "setMode still owns the journal→grimoire remap the restore path depends on",
);

const ghReview = read("./gh-review-actions.tsx");
assert.doesNotMatch(ghReview, /cave:canvas:layer|mode: "canvas"/, "PR review export no longer jumps to the retired Canvas page");
assert.match(ghReview, /openArtifactHtml\(artifact\.code\)/, "exported review artifacts open directly in a browser tab");

// ── One-entry-per-day store: no silent cross-familiar overwrite ──────────────
assert.match(entriesSrc, /const outOfScopeBy =/, "derives the out-of-scope author");
assert.match(entriesSrc, /if \(outOfScopeBy\) return;/, "generate refuses to overwrite an out-of-scope entry");
assert.match(entriesSrc, /written by \$\{outOfScopeBy\}/, "the empty state names the actual author instead of inviting an overwrite");

console.log("journal-redirect.test.ts: ok");
