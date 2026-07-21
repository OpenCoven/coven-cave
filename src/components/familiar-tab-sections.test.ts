// @ts-nocheck
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Familiar tab capability sections — cards / one-accent / teach states
// (cave-7e1l, redesigned by the design handoff into Roles / Skills / Runtime /
// Capabilities cards). This pins the card language: hairline-bordered
// translucent panels, neutral kind metadata, accent reserved for presence,
// CTAs on empty states, paths demoted to tooltips.

const src = readFileSync(new URL("./chat-familiar-capabilities.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles/familiar-tab.css", import.meta.url), "utf8");
const navigation = readFileSync(new URL("../lib/familiar-surface-navigation.ts", import.meta.url), "utf8");

test("KindBadge is neutral — the per-kind color map is gone", () => {
  assert.doesNotMatch(src, /const colorMap/, "no per-kind color map");
  const badge = src.slice(src.indexOf("function KindBadge"), src.indexOf("function CapCta"));
  assert.match(badge, /bg-\[var\(--bg-raised\)\][^"]*text-\[var\(--text-muted\)\]/, "one quiet style for every kind");
  assert.doesNotMatch(badge, /accent-presence|color-success|color-warning/, "no status colors on kind metadata");
});

test("capability cards: hairline border + translucent panel wash, no accent tints on rows", () => {
  assert.match(css, /\.familiar-tab__card \{[^}]*border: 1px solid var\(--border-hairline\)/, "cards are hairline-bordered");
  assert.match(css, /\.familiar-tab__card \{[^}]*color-mix\(in oklch, var\(--bg-raised\) 40%, transparent\)/, "40% translucent panel wash");
  assert.match(src, /function CapCard\(/, "one shared card scaffold");
  assert.match(css, /\.familiar-tab__card-title \{[^}]*text-transform: uppercase/, "uppercase card headers");
  // The old boxed/tinted row classes must not survive anywhere in the panel.
  assert.doesNotMatch(src, /border-\[color-mix\(in_oklch,var\(--accent-presence\)_20%,transparent\)\]/, "no accent-bordered role boxes");
  assert.doesNotMatch(src, /bg-\[color-mix\(in_oklch,var\(--accent-presence\)_10%,transparent\)\] px-2 py-1/, "no accent-tinted skill rows");
  assert.doesNotMatch(src, /bg-\[color-mix\(in_oklch,var\(--color-success\)_10%,transparent\)\]/, "no success-tinted skill rows");
  assert.doesNotMatch(src, /border-\[color-mix\(in_oklch,var\(--color-warning\)_20%,transparent\)\]/, "no warning-bordered MCP boxes");
  assert.doesNotMatch(src, /accentClass/, "collapsible groups lost their colored left-border seam");
});

test("roles are expandable rows: chevron + name + meta, description on demand", () => {
  assert.match(src, /aria-expanded=\{open\}[\s\S]{0,300}?title=\{`Inherited from roles\/\$\{role\.id\}\/ROLE\.md`\}/, "role rows toggle with provenance in the tooltip");
  assert.match(src, /\{role\.familiar\} · \{role\.skills\.length\} skill\{role\.skills\.length === 1 \? "" : "s"\}/, "meta names the scope and skill count");
  assert.match(src, /\{open && role\.description \? \(\s*<p className="familiar-tab__row-desc">/, "descriptions render only when expanded");
});

test("skills render through one shared row path with the path demoted to a tooltip", () => {
  assert.match(src, /function SkillItem\(/, "shared row component");
  const groups = src.match(/<SkillRows\b/g) ?? [];
  assert.ok(groups.length >= 3, `all three provenance groups render through SkillRows (got ${groups.length})`);
  assert.match(src, /<li className="familiar-tab__skill-row" title=\{sourcePath\}>/, "source path is a tooltip, not body copy");
  assert.match(src, /font-mono text-\[length:var\(--text-base\)\] font-medium/, "skill names are mono");
  // Raw workspace paths no longer run as visible copy.
  assert.doesNotMatch(src, /No skills in ~\/\.openclaw/, "empty copy no longer recites raw paths");
  assert.doesNotMatch(src, /inherited from: roles\//, "role provenance path is not body copy");
});

test("skill groups preview 6 rows with a Show N more / Show fewer toggle", () => {
  assert.match(src, /const SKILL_GROUP_PREVIEW = 6/, "preview cap");
  assert.match(
    src,
    /const hiddenCount = rows\.length - SKILL_GROUP_PREVIEW;[\s\S]{0,120}?rows\.slice\(0, SKILL_GROUP_PREVIEW\)/,
    "rows beyond the cap are held back",
  );
  assert.match(src, /\{showAll \? "Show fewer" : `Show \$\{hiddenCount\} more`\}/, "state-aware toggle copy");
});

test("every teach state has a real CTA riding cave:navigate-mode", () => {
  assert.match(navigation, /function navigateFamiliarSurface\(mode: "roles" \| "capabilities" \| "marketplace"\)/, "navigate helper");
  assert.match(navigation, /new CustomEvent\("cave:navigate-mode", \{ detail: \{ mode \} \}\)/, "workspace bridge event");
  assert.match(src, /No roles active for this familiar\.[\s\S]{0,200}?CapCta label="Open roles →" onClick=\{\(\) => navigateFamiliarSurface\("roles"\)\}/, "roles empty → Open roles");
  assert.match(src, /No plugins or MCP servers in the latest capability scan\.[\s\S]{0,200}?CapCta label="Open capabilities →" onClick=\{\(\) => navigateFamiliarSurface\("capabilities"\)\}/, "capabilities empty → Open capabilities");
  assert.match(src, /No skills installed for this familiar yet\.[\s\S]{0,200}?CapCta label="Browse marketplace →" onClick=\{\(\) => navigateFamiliarSurface\("marketplace"\)\}/, "familiar skills empty → Browse marketplace");
  assert.match(src, /function CapCta\([\s\S]*?focus-ring/, "CTA buttons carry the shared focus ring");
  // Dashed = invitation: the empty rows use the dashed hairline idiom.
  assert.match(css, /\.familiar-tab__empty \{[^}]*border: 1px dashed var\(--border-hairline\)/, "dashed empty rows");
});

test("chip diet: enabled is silent, only disabled earns a marker (and a dimmed row)", () => {
  assert.doesNotMatch(src, /\{p\.enabled \? "enabled" : "disabled"\}/, "no enabled/disabled twin chips");
  const disabledMarkers = src.match(/\{p\.enabled \? null : \(/g) ?? [];
  assert.ok(disabledMarkers.length >= 2, "plugin + MCP rows only mark the disabled exception");
  const dimmedRows = src.match(/p\.enabled \? "" : "opacity-60"/g) ?? [];
  assert.ok(dimmedRows.length >= 2, "disabled rows dim instead of chipping");
});

test("collapsible groups are keyboard-honest: aria-expanded + focus ring", () => {
  const section = src.slice(src.indexOf("function CollapsibleSection"), src.indexOf("function CapCard"));
  assert.match(section, /aria-expanded=\{open\}/, "toggle announces its state");
  assert.match(section, /focus-ring/, "toggle has the shared focus ring");
});

test("runtime card: label/value facts with scan freshness; loading shimmer is grid-shaped", () => {
  assert.doesNotMatch(src, /<CapRow label="runtime"/, "no duplicate runtime row");
  assert.match(
    src,
    /harnessManifest\?\.scanned_at\s*\?\s*`scanned \$\{relativeTime\(harnessManifest\.scanned_at\) \|\| "just now"\}`/,
    "scan freshness sits in the card header",
  );
  assert.match(src, /familiar-tab__fact-label">Runtime<\/span>/, "Runtime fact");
  assert.match(src, /familiar-tab__fact-label">Model<\/span>/, "Model fact");
  assert.match(
    src,
    /familiar-tab__fact-label">Binary<\/span>[\s\S]{0,300}?title=\{harnessReport\?\.path \?\? undefined\}/,
    "Binary path is ellipsized with a full-path tooltip",
  );
  assert.match(css, /\.familiar-tab__fact-label \{[^}]*width: 64px/, "64px muted fact labels");
  assert.match(
    src,
    /if \(loading\) \{[\s\S]*?<div className="familiar-tab__grid" aria-hidden>[\s\S]*?<SkeletonRows[\s\S]*?<SkeletonRows/,
    "loading shimmer mirrors the two-column grid it resolves into",
  );
});

test("capabilities card merges plugins + MCP servers with an honest summary", () => {
  assert.match(
    src,
    /title="Capabilities"[\s\S]{0,200}?\$\{nonMcpPlugins\.length\} plugin\$\{nonMcpPlugins\.length === 1 \? "" : "s"\} · \$\{mcpPlugins\.length\} MCP/,
    "summary counts both kinds",
  );
  assert.match(src, /\{nonMcpPlugins\.map\(/, "plugin rows");
  assert.match(src, /\{mcpPlugins\.map\(/, "MCP rows");
  assert.match(src, /<KindBadge kind="mcp" \/>/, "MCP rows keep the existing kind label");
});
