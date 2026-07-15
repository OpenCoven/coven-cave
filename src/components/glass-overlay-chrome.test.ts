// @ts-nocheck
// Glassmorphic overlay chrome (cave-6u0j): overlay surfaces pair a translucent
// theme-derived fill with backdrop blur, from shared --glass-* tokens — with
// opaque fallbacks wherever backdrop-filter is unavailable or the user asked
// the OS for reduced transparency (a see-through fill WITHOUT blur is
// unreadable over scrolling content).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const palette = readFileSync(new URL("./command-palette.tsx", import.meta.url), "utf8");
const bell = readFileSync(new URL("./notification-bell.tsx", import.meta.url), "utf8");

// ── Tokens: theme-derived, so every accent theme + light mode track ──────────
assert.match(css, /--glass-blur: \d+px;/, "glass blur token exists");
assert.match(css, /--glass-saturate: \d+%;/, "glass saturate token exists");
assert.match(
  css,
  /--glass-elevated: color-mix\(in oklch, var\(--bg-elevated\) \d+%, transparent\);/,
  "elevated glass derives from the theme's elevated surface",
);
assert.match(
  css,
  /--glass-raised: color-mix\(in oklch, var\(--bg-raised\) \d+%, transparent\);/,
  "raised glass derives from the theme's raised surface",
);

// ── Primitives: popover + modal are glass; the scrim gains a depth blur ──────
assert.match(
  css,
  /\.ui-popover \{[\s\S]{0,400}?background: var\(--glass-elevated\);[\s\S]{0,200}?backdrop-filter: blur\(var\(--glass-blur\)\) saturate\(var\(--glass-saturate\)\);/,
  "ui-popover pairs the translucent fill with backdrop blur",
);
assert.match(
  css,
  /\.ui-modal \{[\s\S]{0,500}?background: var\(--glass-raised\);[\s\S]{0,300}?backdrop-filter: blur\(/,
  "ui-modal is a glass sheet",
);
assert.match(
  css,
  /\.ui-modal-backdrop \{[\s\S]{0,300}?backdrop-filter: blur\(/,
  "the modal scrim blurs the app behind it",
);

// ── Shared utility + fallbacks ────────────────────────────────────────────────
assert.match(
  css,
  /\.glass-overlay \{\s*\n\s*background: var\(--glass-elevated\);\s*\n\s*backdrop-filter: blur\(var\(--glass-blur\)\) saturate\(var\(--glass-saturate\)\);/,
  "the glass-overlay utility exists for component-class surfaces",
);
assert.match(
  css,
  /@supports not \(\(backdrop-filter: blur\(1px\)\) or \(-webkit-backdrop-filter: blur\(1px\)\)\) \{[\s\S]{0,400}?background: var\(--bg-elevated\);/,
  "no-backdrop-filter environments fall back to opaque surfaces",
);
assert.match(
  css,
  /@media \(prefers-reduced-transparency: reduce\) \{[\s\S]{0,600}?backdrop-filter: none;/,
  "the OS reduced-transparency setting restores opaque, blur-free chrome",
);

// Every glass consumer keeps -webkit-backdrop-filter for WebKit (the Tauri
// webview on macOS is WebKit — the native platform this vibe is for).
const webkitPairs = css.match(/backdrop-filter: blur\(var\(--glass-blur\)\) saturate\(var\(--glass-saturate\)\);\s*\n\s*-webkit-backdrop-filter: blur\(var\(--glass-blur\)\) saturate\(var\(--glass-saturate\)\);/g) ?? [];
assert.ok(webkitPairs.length >= 2, "glass consumers carry the -webkit- prefix pair");

// ── Component-class surfaces ride the shared utility ─────────────────────────
assert.match(palette, /className="glass-overlay mt-\[12vh\]/, "the command palette dialog is glass");
assert.doesNotMatch(palette, /mt-\[12vh\][^"]*bg-\[var\(--bg-elevated\)\]/, "the palette's old opaque fill is gone");
assert.match(bell, /notification-bell__popover glass-overlay/, "the notification bell popover is glass");

// ── Frosted floating chrome (autopilot: "ultra opaque components → frosty") ──
// Floating overlays that used to paint fully-solid theme fills now pair a
// translucent glass fill with backdrop blur, and every one of them appears in
// BOTH opaque-fallback blocks (@supports-not and reduced-transparency), so
// nothing goes see-through where the blur can't render.
const GLASS_RE = String.raw`background: var\(--glass-(?:elevated|raised)\);\s*\n\s*backdrop-filter: blur\(var\(--glass-blur\)\) saturate\(var\(--glass-saturate\)\);\s*\n\s*-webkit-backdrop-filter: blur\(var\(--glass-blur\)\) saturate\(var\(--glass-saturate\)\);`;
const frostedGlobals = [
  String.raw`\.shell-nav-panel > \.shell-nav--peek`,
  String.raw`\.ui-dock-chat`,
  String.raw`\.ui-tooltip`,
  String.raw`\.familiar-switcher__popover`,
  String.raw`\.cave-cal-detail-panel`,
  String.raw`\.familiar-studio__drawer`,
  String.raw`\.quick-chat-overlay`,
  String.raw`\.ui-undo-toast`,
];
for (const sel of frostedGlobals) {
  assert.match(
    css,
    new RegExp(`${sel} \\{[\\s\\S]{0,700}?${GLASS_RE}`),
    `${sel} is frosted glass`,
  );
}
// Both fallback blocks restore an opaque fill for every frosted global.
const supportsBlock = css.match(/@supports not \(\(backdrop-filter: blur\(1px\)\) or \(-webkit-backdrop-filter: blur\(1px\)\)\) \{[\s\S]*?\n\}/)?.[0] ?? "";
const reducedBlock = css.match(/@media \(prefers-reduced-transparency: reduce\) \{[\s\S]*?\n\}/)?.[0] ?? "";
for (const sel of ["shell-nav--peek", "ui-dock-chat", "ui-tooltip", "familiar-switcher__popover", "cave-cal-detail-panel", "familiar-studio__drawer", "quick-chat-overlay", "ui-undo-toast"]) {
  assert.ok(supportsBlock.includes(sel), `${sel} has an opaque no-backdrop-filter fallback`);
  assert.ok(reducedBlock.includes(sel), `${sel} respects reduced transparency`);
}

// Feature stylesheets carry the same pairing + their own fallback blocks.
const featureSheets: Array<[string, string[]]> = [
  ["../styles/dashboard.css", ["dash-snooze__menu", "spark-tip"]],
  ["../styles/cave-chat.css", ["cave-chat-model-popover", "voice-call-overlay__dialog", "cave-table-lightbox__panel"]],
  // flow.css left with the retired FlowView surface (cave-c3yt).
  ["../styles/home-composer.css", ["hc-slash-menu"]],
  ["../styles/journal.css", ["journal-notice"]],
  ["../styles/summoning-circle.css", ["summoning-dialog"]],
  ["../styles/board.css", ["board-drawer", "gh-pat-dialog", "gh-action-popover", "gh-profile-card"]],
];
for (const [file, selectors] of featureSheets) {
  const sheet = readFileSync(new URL(file, import.meta.url), "utf8");
  const sheetSupports = sheet.match(/@supports not \(\(backdrop-filter: blur\(1px\)\) or \(-webkit-backdrop-filter: blur\(1px\)\)\) \{[\s\S]*?\n\}/g)?.join("\n") ?? "";
  const sheetReduced = sheet.match(/@media \(prefers-reduced-transparency: reduce\) \{[\s\S]*?\n\}/g)?.join("\n") ?? "";
  for (const sel of selectors) {
    assert.match(
      sheet,
      new RegExp(`\\.${sel}(?::not\\([^)]*\\))? \\{[\\s\\S]{0,900}?backdrop-filter:\\s*blur\\(var\\(--glass-blur\\)\\) saturate\\(var\\(--glass-saturate\\)\\)`),
      `${file} ${sel} is frosted glass`,
    );
    assert.ok(sheetSupports.includes(sel), `${file} ${sel} has an opaque no-backdrop-filter fallback`);
    assert.ok(sheetReduced.includes(sel), `${file} ${sel} respects reduced transparency`);
  }
}

console.log("glass-overlay-chrome.test.ts: ok");
