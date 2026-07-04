import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  themeTokens,
  resolveThemeColor,
  parseThemeColor,
  flattenOnto,
  contrastRatio,
  type TokenMap,
  type Rgba,
} from "./theme-contrast.ts";
import { THEME_IDS } from "./theme-palettes.ts";

// ── unit sanity for the color math ──────────────────────────────────────────

{
  // Known WCAG anchors.
  const white = parseThemeColor("#ffffff")!;
  const black = parseThemeColor("#000000")!;
  assert.equal(contrastRatio(white, black).toFixed(0), "21");
  assert.equal(contrastRatio(white, white).toFixed(0), "1");

  // oklch pure white/black round-trip.
  assert.ok(contrastRatio(parseThemeColor("oklch(1 0 0)")!, black) > 20.9);
  assert.ok(contrastRatio(parseThemeColor("oklch(0 0 0)")!, white) > 20.9);

  // color-mix with transparent scales alpha; flattening composites it.
  const mixed = parseThemeColor("color-mix(in oklch, #ffffff 50%, transparent)")!;
  assert.ok(Math.abs(mixed.alpha - 0.5) < 1e-6);
  const flattened = flattenOnto(mixed, black);
  assert.ok(Math.abs(flattened.r - 0.5) < 0.02);

  // var() resolution incl. fallback.
  const tokens: TokenMap = new Map([
    ["--a", "#336699"],
    ["--b", "var(--a)"],
    ["--c", "var(--missing, var(--b))"],
  ]);
  assert.equal(resolveThemeColor(tokens, "--c")!.b > 0.5, true);
}

// ── the shipping gate: every premade palette meets WCAG 2.1 ────────────────
// Text pairs need AA 4.5:1; non-text UI (focus rings, presence accents,
// strong borders) needs 3:1 per §1.4.11. If this fails after a palette edit,
// the palette is what has to change — not the thresholds.

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

const OPAQUE_BLACK: Rgba = { r: 0, g: 0, b: 0, alpha: 1 };

function surface(tokens: TokenMap, bgToken: string): Rgba | null {
  const base = resolveThemeColor(tokens, "--bg-base");
  const bg = resolveThemeColor(tokens, bgToken);
  if (!bg) return null;
  const flatBase = base ? flattenOnto(base, OPAQUE_BLACK) : OPAQUE_BLACK;
  return flattenOnto(bg, flatBase);
}

type Pair = { fg: string; bg: string; min: number };
const PAIRS: Pair[] = [
  { fg: "--text-primary", bg: "--bg-base", min: 4.5 },
  { fg: "--text-primary", bg: "--bg-elevated", min: 4.5 },
  { fg: "--text-secondary", bg: "--bg-base", min: 4.5 },
  { fg: "--text-secondary", bg: "--bg-raised", min: 4.5 },
  { fg: "--text-secondary", bg: "--bg-elevated", min: 4.5 },
  { fg: "--text-muted", bg: "--bg-base", min: 4.5 },
  { fg: "--text-muted", bg: "--bg-panel", min: 4.5 },
  { fg: "--muted-foreground", bg: "--background", min: 4.5 },
  { fg: "--muted-foreground", bg: "--card", min: 4.5 },
  { fg: "--card-foreground", bg: "--card", min: 4.5 },
  { fg: "--popover-foreground", bg: "--popover", min: 4.5 },
  { fg: "--secondary-foreground", bg: "--secondary", min: 4.5 },
  { fg: "--accent-foreground", bg: "--accent", min: 4.5 },
  { fg: "--primary-foreground", bg: "--primary", min: 4.5 },
  { fg: "--accent-presence-foreground", bg: "--accent-presence", min: 4.5 },
  { fg: "--destructive-foreground", bg: "--destructive", min: 4.5 },
  { fg: "--brand-foreground", bg: "--brand", min: 4.5 },
  { fg: "--accent-presence", bg: "--bg-base", min: 3 },
  { fg: "--ring", bg: "--background", min: 3 },
  { fg: "--ring-focus", bg: "--bg-base", min: 3 },
  { fg: "--border-strong", bg: "--bg-base", min: 3 },
];

const failures: string[] = [];
let checked = 0;
for (const id of THEME_IDS) {
  for (const mode of ["dark", "light"] as const) {
    const tokens = themeTokens(css, id, mode);
    // Guard the extraction itself: a regression that empties a theme's block
    // would otherwise "pass" by having nothing to check.
    assert.ok(
      resolveThemeColor(tokens, "--bg-base"),
      `${id}/${mode}: --bg-base must resolve to a color (theme block extraction broke?)`,
    );
    for (const pair of PAIRS) {
      const fg = resolveThemeColor(tokens, pair.fg);
      const bg = surface(tokens, pair.bg);
      if (!fg || !bg) continue; // token not used by this theme
      checked++;
      const ratio = contrastRatio(flattenOnto(fg, bg), bg);
      if (ratio < pair.min) {
        failures.push(
          `${id} ${mode}: ${pair.fg} on ${pair.bg} = ${ratio.toFixed(2)} (needs ${pair.min})`,
        );
      }
    }
  }
}

assert.ok(checked > 600, `expected to audit >600 pairs, only checked ${checked}`);
assert.deepEqual(
  failures,
  [],
  `WCAG contrast regressions:\n${failures.join("\n")}`,
);

// The High Contrast theme holds itself to AAA body text (7:1), both modes.
for (const mode of ["dark", "light"] as const) {
  const tokens = themeTokens(css, "contrast", mode);
  for (const [fg, bg] of [
    ["--text-primary", "--bg-base"],
    ["--text-secondary", "--bg-base"],
    ["--text-muted", "--bg-panel"],
  ] as const) {
    const f = resolveThemeColor(tokens, fg)!;
    const b = surface(tokens, bg)!;
    const ratio = contrastRatio(flattenOnto(f, b), b);
    assert.ok(ratio >= 7, `contrast/${mode}: ${fg} on ${bg} = ${ratio.toFixed(2)} — AAA (7:1) required`);
  }
}

console.log(`theme-contrast-audit: ${checked} pairs across ${THEME_IDS.length} themes × 2 modes, 0 failures`);
