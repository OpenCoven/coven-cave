// @ts-nocheck
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Familiar tab capability sections — de-box / one-accent / teach states
// (cave-7e1l). The inspector-era section styling put an accent tint, border,
// or colored chip on nearly every row; empty states named pages with no
// affordance; raw filesystem paths ran as body copy. This pins the facelift
// language: washes + hairlines, accent reserved for presence, CTAs on empty
// states, paths demoted to tooltips.

const src = readFileSync(new URL("./chat-familiar-view.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

test("KindBadge is neutral — the per-kind color map is gone", () => {
  assert.doesNotMatch(src, /const colorMap/, "no per-kind color map");
  const badge = src.slice(src.indexOf("function KindBadge"), src.indexOf("function navigateMode"));
  assert.match(badge, /bg-\[var\(--bg-raised\)\][^"]*text-\[var\(--text-muted\)\]/, "one quiet style for every kind");
  assert.doesNotMatch(badge, /accent-presence|color-success|color-warning/, "no status colors on kind metadata");
});

test("capability rows are de-boxed: shared list wash + hairline dividers, no accent tints", () => {
  assert.match(css, /\.familiar-tab__list \{[^}]*color-mix\(in oklch, var\(--bg-raised\) 40%, transparent\)/, "group wash");
  assert.match(css, /\.familiar-tab__list \{[^}]*inset 0 0 0 1px color-mix\(in oklch, var\(--border-hairline\)/, "soft inset hairline, no hard border");
  assert.match(css, /\.familiar-tab__rows > li \+ li \{[^}]*border-top: 1px solid color-mix\(in oklch, var\(--border-hairline\)/, "hairline row dividers");
  // The old boxed/tinted row classes must not survive anywhere in the panel.
  assert.doesNotMatch(src, /border-\[color-mix\(in_oklch,var\(--accent-presence\)_20%,transparent\)\]/, "no accent-bordered role boxes");
  assert.doesNotMatch(src, /bg-\[color-mix\(in_oklch,var\(--accent-presence\)_10%,transparent\)\] px-2 py-1/, "no accent-tinted skill rows");
  assert.doesNotMatch(src, /bg-\[color-mix\(in_oklch,var\(--color-success\)_10%,transparent\)\]/, "no success-tinted skill rows");
  assert.doesNotMatch(src, /border-\[color-mix\(in_oklch,var\(--color-warning\)_20%,transparent\)\]/, "no warning-bordered MCP boxes");
  assert.doesNotMatch(src, /accentClass/, "collapsible groups lost their colored left-border seam");
});

test("skills render through one shared SkillItem row with the path demoted to a tooltip", () => {
  assert.match(src, /function SkillItem\(/, "shared row component");
  const items = src.match(/<SkillItem\b/g) ?? [];
  assert.ok(items.length >= 3, `all three provenance groups use SkillItem (got ${items.length})`);
  assert.match(src, /<li className="px-2 py-1\.5" title=\{sourcePath\}>/, "source path is a tooltip, not body copy");
  // Raw workspace paths no longer run as visible copy.
  assert.doesNotMatch(src, /No skills in ~\/\.openclaw/, "empty copy no longer recites raw paths");
  assert.doesNotMatch(src, /inherited from: roles\//, "role provenance path is not body copy");
  assert.match(src, /title=\{`Inherited from roles\/\$\{role\.id\}\/ROLE\.md`\}/, "role provenance lives in the row tooltip");
});

test("every teach state has a real CTA riding cave:navigate-mode", () => {
  assert.match(src, /function navigateMode\(mode: "roles" \| "capabilities" \| "marketplace"\)/, "navigate helper");
  assert.match(src, /new CustomEvent\("cave:navigate-mode", \{ detail: \{ mode \} \}\)/, "workspace bridge event");
  assert.match(src, /No roles active for this familiar\.[\s\S]{0,200}?CapCta label="Open Roles →" onClick=\{\(\) => navigateMode\("roles"\)\}/, "roles empty → Open Roles");
  assert.match(src, /No plugins in the latest runtime capability scan\.[\s\S]{0,200}?CapCta label="Open Capabilities →" onClick=\{\(\) => navigateMode\("capabilities"\)\}/, "plugins empty → Open Capabilities");
  assert.match(src, /No skills installed for this familiar yet\.[\s\S]{0,200}?CapCta label="Browse Marketplace →" onClick=\{\(\) => navigateMode\("marketplace"\)\}/, "familiar skills empty → Browse Marketplace");
  assert.match(src, /function CapCta\([\s\S]*?focus-ring/, "CTA buttons carry the shared focus ring");
});

test("chip diet: enabled is silent, only disabled earns a marker (and a dimmed row)", () => {
  assert.doesNotMatch(src, /\{p\.enabled \? "enabled" : "disabled"\}/, "no enabled/disabled twin chips");
  const disabledMarkers = src.match(/\{p\.enabled \? null : \(/g) ?? [];
  assert.ok(disabledMarkers.length >= 2, "plugins + MCP rows only mark the disabled exception");
  const dimmedRows = src.match(/p\.enabled \? "" : "opacity-60"/g) ?? [];
  assert.ok(dimmedRows.length >= 2, "disabled rows dim instead of chipping");
});

test("collapsible groups are keyboard-honest: aria-expanded + focus ring", () => {
  const section = src.slice(src.indexOf("function CollapsibleSection"), src.indexOf("// ── Main panel"));
  assert.match(section, /aria-expanded=\{open\}/, "toggle announces its state");
  assert.match(section, /focus-ring/, "toggle has the shared focus ring");
});

test("runtime section drops the duplicate runtime row; loading shimmer is grid-shaped", () => {
  assert.doesNotMatch(src, /<CapRow label="runtime"/, "the header scope already names the runtime");
  assert.match(
    src,
    /if \(loading\) \{[\s\S]*?<div className="familiar-tab__grid" aria-hidden>[\s\S]*?<SkeletonRows[\s\S]*?<SkeletonRows/,
    "loading shimmer mirrors the two-column grid it resolves into",
  );
});
