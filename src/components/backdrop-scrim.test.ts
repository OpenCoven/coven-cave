// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Facelift cave-8pk2: with a scene backdrop on, the Home hero copy and the
// chat landing cluster sat straight on the photo — only the layer's global
// 18→42% gradient behind them. These pin the content-cluster grounds that
// keep copy legible at any backdrop intensity without dulling the scene.
const css = readFileSync(new URL("../styles/backdrop.css", import.meta.url), "utf8");

// ── Home hero ground ─────────────────────────────────────────────────────────
assert.match(
  css,
  /html\[data-backdrop-on\] \.home-composer-root::before \{[^}]*radial-gradient\(/s,
  "the Home column gets a radial ground behind the hero + composer",
);
assert.match(
  css,
  /\.home-composer-root::before \{[^}]*pointer-events: none/s,
  "the ground never intercepts clicks",
);
assert.match(
  css,
  /color-mix\(in oklch, var\(--bg-base\) 52%, transparent\)/,
  "the ground derives from --bg-base (theme-correct in dark and light)",
);

// ── Chat landing glass ───────────────────────────────────────────────────────
assert.match(
  css,
  /html\[data-backdrop-on\] \.cave-chat-empty-shell \{[^}]*backdrop-filter: blur\(var\(--glass-blur\)\)/s,
  "the chat landing cluster earns the same glass ground as the live transcript",
);

// ── Familiar tab glass ───────────────────────────────────────────────────────
assert.match(
  css,
  /html\[data-backdrop-on\] \.familiar-tab \{[^}]*backdrop-filter: blur\(50px\)/s,
  "the Familiar tab earns a deep-blur glass column over the image",
);
assert.match(
  css,
  /html\[data-backdrop-on\] \.familiar-tab \{[^}]*--text-muted: var\(--text-secondary\)/s,
  "muted text reads at secondary strength on the Familiar tab over the image",
);

// ── Quiet-text lift extends to Home ──────────────────────────────────────────
assert.match(
  css,
  /html\[data-backdrop-on\] \.home-composer-root \{\n  --text-muted: var\(--text-secondary\);/,
  "muted text reads at secondary strength over the image on Home too",
);

// ── Degradation contract ─────────────────────────────────────────────────────
assert.match(
  css,
  /@supports not \(\(backdrop-filter[^)]*\)[^{]*\{[\s\S]*?\.cave-chat-empty-shell,\s*html\[data-backdrop-on\] \.familiar-tab \{[^}]*92%/,
  "no backdrop-filter → the landing and Familiar-tab glass go near-opaque",
);
assert.match(
  css,
  /prefers-reduced-transparency: reduce[\s\S]*\.home-composer-root::before \{\s*display: none/,
  "reduced transparency hides the image, so the ground goes too",
);
assert.match(
  css,
  /prefers-reduced-transparency: reduce[\s\S]*\.cave-chat-empty-shell \{[^}]*background: transparent/s,
  "reduced transparency drops the landing glass with the image",
);
assert.match(
  css,
  /prefers-reduced-transparency: reduce[\s\S]*\.familiar-tab \{[^}]*background: transparent/s,
  "reduced transparency drops the Familiar-tab glass with the image",
);

console.log("backdrop-scrim.test.ts: ok");
