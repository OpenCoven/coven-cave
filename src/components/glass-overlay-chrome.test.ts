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

console.log("glass-overlay-chrome.test.ts: ok");
