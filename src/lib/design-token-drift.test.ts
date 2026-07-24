// Design-token drift gate — Cave UX P3 (Sage's 2026-07-03 audit).
//
// The design-language shipping checklist (docs/coven-design-language.md §9,
// rule 1) is "tokens only — no hardcoded colors, radii, or font sizes". This
// gate keeps that contract enforceable in two tiers:
//
//   1. ZERO TOLERANCE for on-scale literals: running the codemod
//      (scripts/codemods/tokenize-css.mjs) over every in-scope CSS file must
//      be a no-op. A `font-size: 12px` that should be `var(--text-sm)` fails
//      here — fix by running:  node scripts/codemods/tokenize-css.mjs
//
//   2. RATCHETS for the judgment categories (off-scale px values, hex colors
//      outside token definitions, inline TSX style objects). These can only
//      go DOWN. If you add one deliberately (e.g. a genuinely dynamic inline
//      style), lower-or-equal is enforced — raise the baseline in the same
//      PR and say why. When you reduce drift, lower the baseline to bank it.
//
// The codemod's px→token tables are pinned against the live definitions in
// src/app/globals.css, so a token retune fails loudly instead of letting the
// codemod silently rewrite to stale values.

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import cssContract from "../../scripts/css-source-contract.cjs";

import {
  tokenizeCss,
  cssFilesInScope,
  FONT_SIZE_TOKENS,
  SPACE_TOKENS,
  RADIUS_TOKENS,
  FONT_SIZE_PROPS,
  SPACING_PROPS,
  RADIUS_PROPS,
  SANCTIONED_FONT_SIZE_LITERALS,
  EXEMPT_MARKER,
} from "../../scripts/codemods/tokenize-css.mjs";

// ── ratchet baselines ────────────────────────────────────────────────────────
// Current counts as of the P3 codemod PR. Only lower these (banking progress)
// or raise them with an explicit justification in your PR.
const BASELINES = {
  offScaleFontSizePx: 154, // 10.5px/11.5px/… — need per-case renormalization to the type scale (banked: canvas-editor.css on the type scale; familiar-tab retokenized the old hero/section styles; research-desk tabs shipped fully on the type scale, -3; familiar-tab five-section rebuild shipped fully on the type scale, -1; projects access page rebuild shipped fully on the type scale, -2)
  offScaleSpacingPx: 1550, // off-4px-grid pad/margin/gap components — banked: canvas-editor.css on the space scale (-1) + familiar-tab snapped to the 4px grid (-5). +123: research-desk redesign (cave-dl74) — the five tab sheets keep the design's compact even 2px-offset rhythm (6/10/14/18/22px gaps and paddings, same family the surface it replaced used); odd values were snapped to the grid in the same PR. +7: home-minimal PR (2026-07-22) — new home-composer/landing-composer.css + hearth-continuations.css compact UI rhythms (7px gaps, 6px accent-dot, 5px pill gap, 13px/14px organic pill padding — off-scale by design for visual compactness). -10: projects access page rebuild (cave-luq4) replaced the hub CSS fully on the space scale; re-banked at 1467 after rebasing onto main commits 7cf9d13f0..fbcadfd3b which added +4 (still -6 vs the pre-rebuild 1473). -1: drive-by banked in the hex-token chunk PR (cave-gyh2). +26: Queue tab redesign (Queue.dc.html handoff) — the refreshed familiar-work-queue.css keeps the design's compact rhythm (7px control gaps, 6px row-meta gaps, 5px check-dot gaps, 3px accent rail, 30px action-button height, 130px note-textarea min-height, 180px forward-menu min-width, 37px menu offset); on-scale values were tokenized by tokenize-css.mjs in the same PR and font-size literals were snapped to the type scale. -2: Tasks toolbar redesign (tasks-list-redesign-refresh) swapped the compact board header for the design's roomier command bar; net off-scale spacing dropped even though the new toolbar adds off-scale rhythm, because the removed compact-header + search-wrap block carried more off-grid values. +40: launcher 3a home dashboard (home-dashboard.css) — the work-led dashboard shell keeps the design mock's compact rhythm (13/22px chrome & board padding, 9/10/11/18/26px rail & row gaps/padding, 2/3/5/6/7px micro-gaps incl. the Resume CTA pill), off the 4px grid by design; the redesign also RECLAIMED the retired hearth/hero/Continue sheets, so this is the NET delta after removal; on-grid values were tokenized by the codemod in the same PR. +20: Review Deck redesign (Review Deck.dc.html handoff) — new review-deck.css keeps the design's compact rhythm (2px stat/pill micro-gaps, 3px pill padding, 5px pill gaps, 6px row/eyebrow margins, 7px key/button gaps, 14px panel-head padding), off the 4px grid by design; the trivially-equivalent 9/7/13px values were snapped to the space scale in the same PR and font-size literals to the type scale.
  offScaleRadiusPx: 211, // 4px/6px/10px/14px/… radii between the sanctioned steps. +5: research-desk 2px/4px accent-mark radii (short solid marks, not container corners). -5: projects access page rebuild removed the hub's off-step radii
  hexOutsideDefinitions: 51, // hex in render CSS (token definitions excluded) — +1: canvas-editor.css sketch-frame #fff ground, sketch CONTENT not interface color, same precedent as chat-canvas.css's thumbnail #fff. -104: cave-gyh2 chunk 1 — dropped 76 stale var(--token, #hex) fallbacks for globally-defined tokens; fixed 6 fallbacks whose token never existed (--warning/--danger -> --color-warning/--color-danger); mapped accent-filled controls to --accent-presence-foreground and danger/success fills to --color-danger-foreground/--color-success-foreground (promoted the success sibling in foundations.css); promoted the codex module's stray #0f1012/#061312 into --cv-* definitions. -1 banked in the design-doc reconcile PR (cave-kf3x). Remaining 51 need design decisions (canvas/QR grounds, GitHub brand colors, profile-card palette, decorative art, #000 shade mixes).
  inlineTsxStyles: 227, // style={{…}} in TSX; many are legit dynamic values (banked from 500 — the count had drifted far below the old ceiling; -2: projects access page rebuild dropped the hub's inline styles)
};

// ── unit sanity for the codemod transform ───────────────────────────────────

{
  // On-scale literals tokenize; result is idempotent.
  const src = ".a {\n  font-size: 12px;\n  padding: 8px 12px;\n  border-radius: 999px;\n}\n";
  const out = tokenizeCss(src);
  assert.ok(out.includes("font-size: var(--text-sm);"));
  assert.ok(out.includes("padding: var(--space-2) var(--space-3);"));
  assert.ok(out.includes("border-radius: var(--radius-pill);"));
  assert.equal(tokenizeCss(out), out, "codemod must be idempotent");

  // Off-scale, zero, negative, calc/var-wrapped, and rem values are untouched.
  // font-size: 16px is the sanctioned iOS anti-zoom floor (see the codemod's
  // table comment) and stays literal too.
  const keep = [
    "  font-size: 10.5px;",
    "  font-size: 16px;",
    "  font-size: 0.875rem;",
    "  padding: 0 11px;",
    "  margin: -8px;",
    "  gap: calc(8px + 1px);",
    "  padding: var(--x, 12px);",
    "  border-radius: 6px;",
    "  line-height: 16px;", // not a tokenized property
    "  width: 12px;", // not a tokenized property
  ];
  for (const line of keep) {
    const block = `.a {\n${line}\n}\n`;
    assert.equal(tokenizeCss(block), block, `must not rewrite: ${line.trim()}`);
  }

  // Token definitions stay literal — that's where px belongs.
  const def = ":root {\n  --space-2: 8px;\n  --text-sm: 12px;\n}\n";
  assert.equal(tokenizeCss(def), def);

  // Comments (block and inline-before) are never rewritten.
  const comment = "/*\n  padding: 8px;\n*/\n.a { /* gap: 4px */ color: red; }\n";
  assert.equal(tokenizeCss(comment), comment);

  // The exempt marker is an explicit opt-out.
  const exempt = `.a {\n  font-size: 12px; /* ${EXEMPT_MARKER}: needs fixed px */\n}\n`;
  assert.equal(tokenizeCss(exempt), exempt);
}

// ── pin: codemod tables mirror the live globals.css token definitions ──────

{
  const globals = cssContract.readEffectiveCssSync("src/app/globals.css", "utf8") as string;
  const defined = new Map<string, string>();
  for (const m of globals.matchAll(/^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/gim)) {
    if (!defined.has(m[1])) defined.set(m[1], m[2].trim()); // first (=:root dark) wins
  }
  for (const [table, name] of [
    [FONT_SIZE_TOKENS, "font-size"],
    [SPACE_TOKENS, "space"],
    [RADIUS_TOKENS, "radius"],
  ] as const) {
    for (const [px, token] of table as Map<string, string>) {
      assert.equal(
        defined.get(token),
        px,
        `${name} table drift: codemod maps ${px} -> ${token}, but globals.css defines ${token}: ${defined.get(token) ?? "(missing)"} — update scripts/codemods/tokenize-css.mjs to match`,
      );
    }
  }
}

// ── tier 1: the codemod is a no-op over the tree (no on-scale literals) ─────

const files = cssFilesInScope();
assert.ok(files.length > 10, "scanner should find the src CSS tree");

for (const rel of files) {
  const source = readFileSync(rel, "utf8");
  assert.equal(
    tokenizeCss(source),
    source,
    `${rel} has on-scale px literals that must use tokens — run: node scripts/codemods/tokenize-css.mjs`,
  );
}

// ── tier 2: ratchets ────────────────────────────────────────────────────────

/** Strip block comments so commented-out CSS never counts as drift. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
}

const DECL_RE = /^(\s*)([a-zA-Z-]+)(\s*:\s*)([^;]*);/;
const PX_RE = /^([0-9]+(?:\.[0-9]+)?)px$/;

function countOffScale(
  source: string,
  props: Set<string>,
  table: Map<string, string>,
  sanctioned: Set<string> = new Set(),
): number {
  let count = 0;
  for (const line of stripComments(source).split("\n")) {
    if (line.includes(EXEMPT_MARKER)) continue;
    if (line.trimStart().startsWith("--")) continue;
    const m = DECL_RE.exec(line);
    if (!m || !props.has(m[2].toLowerCase())) continue;
    for (const piece of m[4].split(/\s+/)) {
      const px = PX_RE.exec(piece);
      if (!px) continue;
      const value = Number.parseFloat(px[1]);
      if (value === 0) continue; // zero needs no token
      if (sanctioned.has(`${value}px`)) continue;
      if (!table.has(`${value}px`)) count += 1;
    }
  }
  return count;
}

function countHexOutsideDefinitions(source: string): number {
  let count = 0;
  for (const line of stripComments(source).split("\n")) {
    if (line.trimStart().startsWith("--")) continue; // token definitions are sanctioned
    count += (line.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).length;
  }
  return count;
}

const totals = {
  offScaleFontSizePx: 0,
  offScaleSpacingPx: 0,
  offScaleRadiusPx: 0,
  hexOutsideDefinitions: 0,
};
for (const rel of files) {
  const source = readFileSync(rel, "utf8");
  totals.offScaleFontSizePx += countOffScale(
    source,
    FONT_SIZE_PROPS,
    FONT_SIZE_TOKENS,
    SANCTIONED_FONT_SIZE_LITERALS,
  );
  totals.offScaleSpacingPx += countOffScale(source, SPACING_PROPS, SPACE_TOKENS);
  totals.offScaleRadiusPx += countOffScale(source, RADIUS_PROPS, RADIUS_TOKENS);
  totals.hexOutsideDefinitions += countHexOutsideDefinitions(source);
}

function countInlineTsxStyles(dir: string): number {
  let count = 0;
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) count += countInlineTsxStyles(full);
    else if (entry.endsWith(".tsx"))
      count += (readFileSync(full, "utf8").match(/style=\{\{/g) ?? []).length;
  }
  return count;
}
const inlineTsxStyles = countInlineTsxStyles("src");

function ratchet(name: keyof typeof BASELINES, actual: number) {
  assert.ok(
    actual <= BASELINES[name],
    `token-drift ratchet "${name}" went UP: ${actual} > baseline ${BASELINES[name]}. ` +
      `New hardcoded values need tokens (docs/coven-design-language.md §9 rule 1); ` +
      `if this one is genuinely dynamic/off-scale by design, raise the baseline in this PR and justify it.`,
  );
  if (actual < BASELINES[name]) {
    console.log(
      `[token-drift] ${name}: ${actual} < baseline ${BASELINES[name]} — lower the baseline to bank the progress`,
    );
  }
}

ratchet("offScaleFontSizePx", totals.offScaleFontSizePx);
ratchet("offScaleSpacingPx", totals.offScaleSpacingPx);
ratchet("offScaleRadiusPx", totals.offScaleRadiusPx);
ratchet("hexOutsideDefinitions", totals.hexOutsideDefinitions);
ratchet("inlineTsxStyles", inlineTsxStyles);

console.log(
  `design-token-drift: ok (codemod no-op over ${files.length} css files; ratchets ` +
    `font=${totals.offScaleFontSizePx} space=${totals.offScaleSpacingPx} radius=${totals.offScaleRadiusPx} ` +
    `hex=${totals.hexOutsideDefinitions} inline=${inlineTsxStyles})`,
);
