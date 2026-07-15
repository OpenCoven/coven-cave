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

// ── fixed dark code chrome (cave-chat.css, CHAT-D13-01/02) ──────────────────
// Code blocks and system turns keep a fixed dark-terminal surface in BOTH
// modes, so their inks are fixed too — theme-independent, but they still must
// clear AA. Worst case is light mode: the 92%-alpha chrome composites over a
// near-white page, lightening the surface under the light inks. Audit over
// opaque white as the harshest base any theme can supply.

const chatCss = readFileSync(new URL("../styles/cave-chat.css", import.meta.url), "utf8");

const chromeRootBlock = chatCss.match(/:root\s*\{([\s\S]*?)\}/)?.[1] ?? "";
const chrome: TokenMap = new Map();
for (const m of chromeRootBlock.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
  chrome.set(m[1], m[2].trim());
}
// The body surface lives in globals.css (shared with the file editor).
const codeSurface = css.match(/--code-surface:\s*([^;]+);/)?.[1];
assert.ok(codeSurface, "--code-surface must be defined in globals.css");
chrome.set("--code-surface", codeSurface!);
for (const required of [
  "--code-chrome-ink",
  "--code-chrome-ink-muted",
  "--code-chrome-ink-faint",
  "--code-chrome-accent",
  "--code-chrome-surface-raised",
  "--code-chrome-surface-control",
  "--code-chrome-surface-control-hover",
  "--code-chrome-success",
  "--code-chrome-danger",
]) {
  assert.ok(chrome.has(required), `cave-chat.css :root must define ${required}`);
}

const OPAQUE_WHITE: Rgba = { r: 1, g: 1, b: 1, alpha: 1 };
function chromeSurface(token: string, base: Rgba = OPAQUE_WHITE): Rgba {
  const c = resolveThemeColor(chrome, token);
  assert.ok(c, `${token} must resolve to a color`);
  return flattenOnto(c!, base);
}

const codeBody = chromeSurface("--code-surface");
const codeRaised = chromeSurface("--code-chrome-surface-raised", codeBody);
const codeControl = chromeSurface("--code-chrome-surface-control", codeBody);
const codeControlHover = chromeSurface("--code-chrome-surface-control-hover", codeBody);

// Derived inks as declared in cave-chat.css — resolved from the live rules so
// the audit can't drift from the stylesheet.
function declaredColor(selectorRe: RegExp, label: string): string {
  const block = chatCss.match(selectorRe)?.[0] ?? "";
  const value = block.match(/color:\s*([^;]+);/)?.[1];
  assert.ok(value, `${label}: color declaration not found`);
  return value!.trim();
}
chrome.set("--_lang-ink", declaredColor(/\.cave-code-lang \{[^}]*\}/, ".cave-code-lang"));
chrome.set("--_ln-ink", declaredColor(/\.cave-ln \{[^}]*\}/, ".cave-ln"));
chrome.set(
  "--_add-strip",
  (chatCss.match(/\.cave-diff-add \{[^}]*background:\s*([^;]+);/) ?? [])[1] ?? "",
);
chrome.set(
  "--_del-strip",
  (chatCss.match(/\.cave-diff-del \{[^}]*background:\s*([^;]+);/) ?? [])[1] ?? "",
);

const addStrip = chromeSurface("--_add-strip", codeBody);
const delStrip = chromeSurface("--_del-strip", codeBody);

const chromeFailures: string[] = [];
const chromePairs: Array<{ fg: string; bg: Rgba; bgName: string; min: number }> = [
  // 10-12px labels, filenames, line counts, expand button, system meta.
  { fg: "--code-chrome-ink-faint", bg: codeBody, bgName: "code body", min: 4.5 },
  { fg: "--code-chrome-ink-faint", bg: codeRaised, bgName: "chrome header", min: 4.5 },
  { fg: "--code-chrome-ink-faint", bg: codeControl, bgName: "copy button", min: 4.5 },
  { fg: "--code-chrome-ink-muted", bg: codeBody, bgName: "code body", min: 4.5 },
  { fg: "--code-chrome-ink-muted", bg: codeRaised, bgName: "chrome header", min: 4.5 },
  { fg: "--code-chrome-ink", bg: codeControlHover, bgName: "copy button hover", min: 4.5 },
  // Language eyebrow + line-number ordinals (the CHAT-D13-02 micro-type).
  { fg: "--_lang-ink", bg: codeRaised, bgName: "chrome header", min: 4.5 },
  { fg: "--_ln-ink", bg: codeBody, bgName: "code body", min: 4.5 },
  // Diff +/- markers and the copy-confirmed state on their actual strips.
  { fg: "--code-chrome-success", bg: addStrip, bgName: "diff add strip", min: 4.5 },
  { fg: "--code-chrome-danger", bg: delStrip, bgName: "diff del strip", min: 4.5 },
  { fg: "--code-chrome-success", bg: codeControl, bgName: "copy button", min: 4.5 },
];
for (const pair of chromePairs) {
  const fg = resolveThemeColor(chrome, pair.fg);
  assert.ok(fg, `${pair.fg} must resolve`);
  const ratio = contrastRatio(flattenOnto(fg!, pair.bg), pair.bg);
  if (ratio < pair.min) {
    chromeFailures.push(
      `code chrome: ${pair.fg} on ${pair.bgName} = ${ratio.toFixed(2)} (needs ${pair.min})`,
    );
  }
}
assert.deepEqual(
  chromeFailures,
  [],
  `code-chrome contrast regressions:\n${chromeFailures.join("\n")}`,
);

// Opacity dimmers stacked on the faint ink are how sub-AA text evaded
// automated scans pre-fix (alpha-composited text). Keep them out.
for (const selector of [
  /\.cave-code-lang \{[^}]*\}/,
  /\.cave-code-filename \{[^}]*\}/,
  /\.cave-bubble-system-label--dim \{[^}]*\}/,
]) {
  const block = chatCss.match(selector)?.[0] ?? "";
  assert.ok(block.length > 0, `selector ${selector} must exist in cave-chat.css`);
  assert.ok(
    !/\bopacity:/.test(block),
    `${selector}: no opacity dimmer on chrome ink (CHAT-D13-02)`,
  );
}
assert.ok(
  !/\.cave-diff-meta \{[^}]*opacity:/.test(chatCss),
  ".cave-diff-meta: no opacity dimmer (CHAT-D13-02)",
);

console.log(`theme-contrast-audit: code-chrome ${chromePairs.length} pairs, 0 failures`);
