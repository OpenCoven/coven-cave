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
  offScaleFontSizePx: 173, // 10.5px/11.5px/… — need per-case renormalization to the type scale
  offScaleSpacingPx: 1355, // off-4px-grid pad/margin/gap components (2px/6px/10px/…) — +4: the chat composer footer band copies the home hc-footer-band metrics verbatim (6px 10px pad, 6px gap, 11px chip pad) for cross-composer parity
  offScaleRadiusPx: 213, // 4px/6px/10px/14px/… radii between the sanctioned steps
  hexOutsideDefinitions: 157, // hex in render CSS (token definitions excluded)
  inlineTsxStyles: 510, // style={{…}} in TSX; many are legit dynamic values
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
  const globals = readFileSync("src/app/globals.css", "utf8");
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
