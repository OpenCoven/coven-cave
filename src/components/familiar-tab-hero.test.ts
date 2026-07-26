// @ts-nocheck
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Familiar tab identity hero + section band (cave-5p3y → cave-moig skills-page
// handoff).
//
// The chat surface's Familiar tab is a first-class identity surface: it opens
// on WHO the familiar is (avatar, serif display name, role line, presence)
// before WHAT it can do, the hero's Runtime/Model/Voice selects edit the live
// binding in place, and everything below the hero hangs off one five-tab band
// (Identity · Skills · MCP · Analytics · Memory).

const src = readFileSync(new URL("./chat-familiar-capabilities.tsx", import.meta.url), "utf8");
const chatSurface = readFileSync(new URL("./chat-surface.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles/familiar-tab.css", import.meta.url), "utf8");

test("identity hero leads the Familiar tab and never waits on the capability fetches", () => {
  assert.match(src, /function FamiliarIdentityHero\(/, "hero component declared");
  // The panel renders the hero unconditionally; only the SECTION body swaps to
  // a skeleton while the snapshot loads.
  assert.match(
    src,
    /<FamiliarIdentityHero[\s\S]{0,300}?\/>[\s\S]*?sectionNeedsSnapshot && snapshot\.loading \? \([\s\S]*?<SkeletonRows/,
    "hero paints above the section skeleton while capabilities load",
  );
});

test("hero identity contract: resolved avatar, serif name, role line, presence", () => {
  // Avatar resolution rides the same pipeline as every other identity surface
  // (Cave-local overrides, workspace avatar → upload fallback → glyph).
  assert.match(src, /useResolvedFamiliars\(heroList, \{ includeArchived: true \}\)/, "hero resolves the familiar");
  assert.match(src, /<FamiliarAvatar familiar=\{resolved\} size="xl" expandable \/>/, "expandable xl avatar");
  assert.match(src, /<h2 className="familiar-tab__name">/, "display name is the tab's h2");
  assert.match(
    css,
    /\.familiar-tab__name \{[^}]*font-family: var\(--font-serif/,
    "name uses the serif identity face",
  );
  assert.match(src, /\{daemonRunning \? "online" : "offline"\}/, "presence line from daemon reachability");
  assert.match(src, /className="familiar-tab__presence" data-online=\{daemonRunning \? "true" : "false"\}/, "presence chip carries the online state");
  assert.match(
    css,
    /\.familiar-tab__presence\[data-online="true"\] \{[^}]*color: var\(--accent-presence\)/,
    "online chip tints with the presence accent",
  );
  assert.match(
    src,
    /activeSessions > 0 \? \([\s\S]*?bg-\[var\(--accent-presence\)\]\/15/,
    "active-session chip is the accent moment, adjacent to the online chip",
  );
});

test("hero selects edit the live binding through the canonical /api/config writer", () => {
  assert.match(src, /async function saveFamiliarBinding\(/, "one shared binding writer");
  assert.match(
    src,
    /fetch\("\/api\/config", \{\s*method: "PATCH",[\s\S]*?familiars: \{ \[familiarId\]: patch \}/,
    "PATCH /api/config with a per-familiar patch — same contract as the Studio Brain tab",
  );
  assert.match(
    src,
    /window\.dispatchEvent\(new Event\("cave:familiars-refresh"\)\)/,
    "successful saves catch the roster up immediately",
  );
  // The three live selects, sourced from canonical catalogs — no second mapping.
  assert.match(src, /label="Runtime"[\s\S]{0,150}?options=\{runtimeOptions\}/, "Runtime select");
  assert.match(src, /label="Model"[\s\S]{0,150}?options=\{modelOptions\}/, "Model select");
  assert.match(src, /label="Voice"[\s\S]{0,150}?options=\{voiceOptions\}/, "Voice select");
  assert.match(src, /catalogForRuntime\(effectiveHarness\)/, "models come from the shared runtime→model catalog");
  assert.match(src, /listVoiceProviders\(\)/, "voice providers come from the canonical voice registry");
  // Save failures surface honestly instead of silently reverting.
  assert.match(src, /\{saveError \? \(\s*<p role="status"/, "failed saves report inline");
});

test("the five-tab band hangs every section off one Tabs control", () => {
  for (const id of ["identity", "skills", "mcp", "analytics", "memory"]) {
    assert.match(src, new RegExp(`\\{ id: "${id}", label: "`), `${id} tab declared`);
  }
  assert.match(src, /idPrefix="familiar-section"/, "stable tab ids");
  assert.match(src, /\{ id: "skills", label: "Skills", count: snapshot\.loading \? undefined : data\.skillCount \}/, "skills tab counts real unique skills");
  assert.match(src, /useState<FamiliarSectionId>\("skills"\)/, "the handoff's namesake section opens first");
  // One derivation feeds every section — provenance math can't drift per tab.
  assert.match(src, /deriveFamiliarSectionData\(\{/, "sections share one derived model");
  for (const mount of [
    "<FamiliarIdentitySection data={data} />",
    "<FamiliarSkillsSection data={data} />",
    "<FamiliarMcpSection data={data} />",
    "<FamiliarAnalyticsSection familiar={familiar} />",
    "<FamiliarMemorySection familiar={familiar} />",
  ]) {
    assert.ok(src.includes(mount), `${mount} mounted`);
  }
});

test("header stays put; the section owns the scrolling", () => {
  assert.match(
    src,
    /className="chat-familiar-view familiar-tab flex h-full min-h-0 flex-row"[\s\S]{0,80}?aria-label="Familiar profile"/,
    "the section remains the labelled landmark, hosting rail + detail",
  );
  assert.match(css, /\.familiar-tab__main \{[^}]*container-type: inline-size/, "detail pane measures its own inline size");
  assert.match(css, /\.familiar-tab__hero \{[^}]*flex: none/, "identity header never scrolls away");
  assert.match(css, /\.familiar-tab__tabs \{[^}]*border-bottom: 1px solid var\(--border-hairline\)/, "tab band draws the hairline the underline sits on");
  assert.match(css, /\.familiar-tab__section \{[^}]*overflow-y: auto/, "each section scrolls as one region");
});

test("the chat surface gives the tab a wide canvas and threads presence", () => {
  assert.match(
    chatSurface,
    /scope === "familiar"[\s\S]*?max-w-7xl[\s\S]*?<ChatFamiliarView[\s\S]*?familiar=\{activeFamiliar\}[\s\S]*?daemonRunning=\{daemonRunning\}[\s\S]*?onStartChat=\{startFamiliarHeroChat\}/,
    "Familiar tab hosts the scope-aware view in a max-w-7xl column with daemonRunning threaded",
  );
});

test("tokens only — the hero introduces no hex colors or novel palette", () => {
  const heroBlock = src.slice(
    src.indexOf("function FamiliarIdentityHero"),
    src.indexOf("// ── Capability panel"),
  );
  assert.doesNotMatch(heroBlock, /#[0-9a-fA-F]{3,8}\b/, "no hex colors in the hero");
  assert.doesNotMatch(heroBlock, /rgb\(|hsl\(/, "no raw color functions in the hero");
});
