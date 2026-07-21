// @ts-nocheck
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Familiar tab identity hero + wide-canvas layout (cave-5p3y, redesigned by
// the design handoff).
//
// The chat surface's Familiar tab is a first-class identity surface, not a
// relocated 320px inspector sidepanel: it must open on WHO the familiar is
// (avatar, serif display name, role, presence, runtime) before WHAT it can do
// (the capability cards), and the card grid must earn a wide pane with the
// handoff's 1.5fr/1fr columns.

const src = readFileSync(new URL("./chat-familiar-capabilities.tsx", import.meta.url), "utf8");
const chatSurface = readFileSync(new URL("./chat-surface.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles/familiar-tab.css", import.meta.url), "utf8");

test("identity hero leads the Familiar tab and paints before the capability fetches", () => {
  assert.match(src, /function FamiliarIdentityHero\(/, "hero component declared");
  // The hero renders in BOTH branches: while loading (skeleton below it) and
  // with the loaded grid — identity never waits on capability plumbing.
  const heroMounts = src.match(/<FamiliarIdentityHero familiar=\{familiar\} daemonRunning=\{daemonRunning\} onStartChat=\{onStartChat\} \/>/g) ?? [];
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
  // Presence is a hairline pill chip whose online state tints with the
  // presence accent (the design language's accent, not the mock's green).
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

test("hero bridges: profile card + analytics links (roster idiom, no second identity presentation)", () => {
  assert.match(
    src,
    /href=\{`\/dashboard\/familiars\/\$\{encodeURIComponent\(familiar\.id\)\}\/profile`\}/,
    "Profile links to the cave-ujbr profile card route",
  );
  assert.match(
    src,
    /href=\{`\/dashboard\/familiars\/\$\{encodeURIComponent\(familiar\.id\)\}\/analytics`\}/,
    "Analytics links to the analytics route",
  );
  // The handoff's chip row: runtime + model as mono hairline pills, a divider,
  // then the accent link pills.
  assert.match(src, /familiar\.harness \? \(\s*<span className="familiar-tab__pill font-mono" title="Runtime">/, "runtime pill");
  assert.match(src, /familiar\.model \? \(\s*<span className="familiar-tab__pill font-mono" title="Model">/, "model pill");
  assert.match(src, /className="familiar-tab__links-divider" aria-hidden="true"/, "divider between metadata and links");
  assert.match(
    css,
    /\.familiar-tab__link-pill:hover \{[^}]*background: color-mix\(in oklch, var\(--accent-presence\) 10%, transparent\)/,
    "link pills hover with the 10% accent tint",
  );
});

test("wide-canvas layout: container-query card grid, 1.5fr/1fr >=840px, single below", () => {
  assert.match(css, /\.familiar-tab__main \{[^}]*container-type: inline-size/, "detail pane measures its own inline size");
  assert.match(css, /\.familiar-tab__grid \{[^}]*grid-template-columns: minmax\(0, 1fr\)/, "single column default");
  assert.match(
    css,
    /@container \(min-width: 840px\) \{[\s\S]*?\.familiar-tab__grid \{[\s\S]*?grid-template-columns: minmax\(0, 1\.5fr\) minmax\(0, 1fr\)/,
    "two-column 1.5fr/1fr grid on a wide pane",
  );
  const cols = src.match(/familiar-tab__col/g) ?? [];
  assert.ok(cols.length >= 2, "capability cards split into two source-ordered columns");
});

test("header stays put; the card grid (or its columns) own the scrolling", () => {
  assert.match(
    src,
    /className="chat-familiar-view familiar-tab flex h-full min-h-0 flex-row"[\s\S]{0,80}?aria-label="Familiar profile"/,
    "the section remains the labelled landmark, now hosting rail + detail",
  );
  assert.match(css, /\.familiar-tab__hero \{[^}]*flex: none/, "identity header never scrolls away");
  assert.match(css, /\.familiar-tab__grid \{[^}]*overflow-y: auto/, "stacked grid scrolls as one region on narrow panes");
  assert.match(
    css,
    /@container \(min-width: 840px\) \{[\s\S]*?\.familiar-tab__col \{[\s\S]*?overflow-y: auto/,
    "wide panes give each column its own scroll",
  );
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
    src.indexOf("function FamiliarCapabilityPanel"),
  );
  assert.ok(heroBlock.length > 0, "hero block located");
  assert.doesNotMatch(heroBlock, /#[0-9a-fA-F]{3,8}\b/, "no raw hex colors in the hero");
  assert.doesNotMatch(heroBlock, /(?:^|[^-\w])(?:rgb|hsl)a?\(/, "no raw rgb()/hsl() in the hero");
});
