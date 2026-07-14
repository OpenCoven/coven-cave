// @ts-nocheck
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Familiar tab identity hero + wide-canvas layout (cave-5p3y).
//
// The chat surface's Familiar tab is a first-class identity surface, not a
// relocated 320px inspector sidepanel: it must open on WHO the familiar is
// (avatar, serif display name, role, presence, runtime) before WHAT it can do
// (the capability grid), and the grid must earn a wide canvas with two columns.

const src = readFileSync(new URL("./inspector-pane.tsx", import.meta.url), "utf8");
const chatSurface = readFileSync(new URL("./chat-surface.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

test("identity hero leads the Familiar tab and paints before the capability fetches", () => {
  assert.match(src, /function FamiliarIdentityHero\(/, "hero component declared");
  // The hero renders in BOTH branches: while loading (skeleton below it) and
  // with the loaded grid — identity never waits on capability plumbing.
  const heroMounts = src.match(/<FamiliarIdentityHero familiar=\{familiar\} daemonRunning=\{daemonRunning\} \/>/g) ?? [];
  assert.ok(heroMounts.length >= 2, `hero mounts in loading AND loaded branches (got ${heroMounts.length})`);
  assert.match(
    src,
    /if \(loading\) \{[\s\S]*?<FamiliarIdentityHero[\s\S]*?<SkeletonRows/,
    "loading keeps the skeleton below the already-painted hero",
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
  assert.match(
    src,
    /activeSessions > 0 \? \([\s\S]*?bg-\[var\(--accent-presence\)\]\/15/,
    "active-session chip is the accent moment",
  );
});

test("hero bridges: profile card + analytics links (roster idiom, no second identity presentation)", () => {
  assert.match(
    src,
    /href=\{`\/dashboard\/familiars\/\$\{encodeURIComponent\(familiar\.id\)\}\/profile`\}/,
    "Profile → links to the cave-ujbr profile card route",
  );
  assert.match(
    src,
    /href=\{`\/dashboard\/familiars\/\$\{encodeURIComponent\(familiar\.id\)\}\/analytics`\}/,
    "Analytics → links to the analytics route",
  );
});

test("wide-canvas layout: container-query grid, two columns >=900px, single below", () => {
  assert.match(css, /\.familiar-tab \{[^}]*container-type: inline-size/, "panel measures its own inline size");
  assert.match(css, /\.familiar-tab__grid \{[^}]*grid-template-columns: minmax\(0, 1fr\)/, "single column default");
  assert.match(
    css,
    /@container \(min-width: 900px\) \{[\s\S]*?\.familiar-tab__grid \{[\s\S]*?grid-template-columns: minmax\(0, 1\.15fr\) minmax\(0, 1fr\)/,
    "two-column grid on a wide canvas",
  );
  const cols = src.match(/familiar-tab__col/g) ?? [];
  assert.ok(cols.length >= 2, "capability sections split into two source-ordered columns");
});

test("the chat surface gives the tab a wide canvas and threads presence", () => {
  assert.match(
    chatSurface,
    /scope === "familiar"[\s\S]*?max-w-5xl[\s\S]*?<InspectorPane familiar=\{activeFamiliar\} tab="familiar" daemonRunning=\{daemonRunning\} \/>/,
    "Familiar tab hosts the pane in a max-w-5xl column with daemonRunning threaded",
  );
});

test("tokens only — the hero introduces no hex colors or novel palette", () => {
  const heroBlock = src.slice(
    src.indexOf("function FamiliarIdentityHero"),
    src.indexOf("function FamiliarCapabilityPanel"),
  );
  assert.ok(heroBlock.length > 0, "hero block located");
  assert.doesNotMatch(heroBlock, /#[0-9a-fA-F]{3,8}\b/, "no raw hex colors in the hero");
  assert.doesNotMatch(heroBlock, /(?:^|[^-\w])(?:rgb|hsl)a?\(/, "no raw rgb()/hsl() in the hero");
});
