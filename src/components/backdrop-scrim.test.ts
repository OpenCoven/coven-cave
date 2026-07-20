// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Facelift cave-hct3: the full-area radial ground behind Home read as a
// blurry oval. Keep the scene visible around one uniform, theme-derived
// readability surface on the existing hearth card instead.
const css = readFileSync(new URL("../styles/backdrop.css", import.meta.url), "utf8");

// ── Home hearth glass ─────────────────────────────────────────────────────────
assert.match(
  css,
  /html\[data-backdrop-on\] \.home-hearth-card \{\s*background: color-mix\(in oklch, var\(--bg-base\) 72%, transparent\);\s*\}/,
  "Home uses one uniform theme-derived hearth surface while a backdrop is active",
);
assert.doesNotMatch(
  css,
  /html\[data-backdrop-on\] \.home-composer-root::before/,
  "Home no longer paints a full-area pseudo-element behind the hearth",
);
assert.doesNotMatch(
  css,
  /html\[data-backdrop-on\][^{]*home[^{]*\{[^}]*radial-gradient\(/s,
  "the backdrop-only Home treatment contains no radial gradient",
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
  /prefers-reduced-transparency: reduce[\s\S]*html\[data-backdrop-on\] \.home-hearth-card \{\s*background: color-mix\(in oklch, var\(--bg-panel\) 55%, transparent\);/,
  "reduced transparency restores the normal Home card fill",
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

// ── Per-familiar backdrop override wiring (cave-j0dz, cave-kf8p) ─────────────
// The active chat familiar's own backdrop takes over the layer while the
// familiar is switched on; the app-wide image stays the fallback/default.
const layer = readFileSync(new URL("./cave-backdrop-layer.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");
const lookTab = readFileSync(new URL("./familiar-studio-look-tab.tsx", import.meta.url), "utf8");

assert.match(
  layer,
  /const effectiveUrl = familiarImageShowing \? familiarUrl : imageUrl;/,
  "the familiar's own image wins while showing; the generic image is the fallback",
);
assert.match(
  layer,
  /const effectiveEnabled = prefs\.enabled \|\| familiarOn;/,
  "an enabled familiar shows a backdrop even when the app-wide backdrop is off",
);
assert.match(
  layer,
  /matchAccent: false, accentSeed: null/,
  "the generic image's sampled accent never tints a familiar override",
);
assert.match(
  workspace,
  /familiarId=\{mode === "chat" \? activeId : null\}/,
  "the workspace scopes the override to the active single-familiar chat selection",
);
assert.match(
  lookTab,
  /FamiliarBackdropSection familiarId=\{familiar\.id\}/,
  "the Studio Look tab owns the per-familiar backdrop controls",
);
assert.match(
  lookTab,
  /writeFamiliarBackdropImage\(familiarId, blob\)/,
  "uploads persist through the per-familiar backdrop store",
);
