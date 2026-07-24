// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Facelift cave-hct3: the full-area radial ground behind Home read as a
// blurry oval. Keep the scene visible around one uniform, theme-derived
// readability surface on the existing hearth card instead.
const css = readFileSync(new URL("../styles/backdrop.css", import.meta.url), "utf8");

// ── Home dashboard glass (launcher 3a) ────────────────────────────────────────
// The dashboard is a dense surface (section labels + board rows sit on the
// photo), so it earns the Familiar-tab glass idiom: a translucent theme-derived
// ground with a real blur over the whole surface. The rail + docked composer
// keep their own solid --bg-panel fills, so the image shows through the board
// content area only.
assert.match(
  css,
  /html\[data-backdrop-on\] \.home-composer-root\.home-dash \{[^}]*background: color-mix\(in oklch, var\(--bg-base\) 62%, transparent\);[^}]*\}/,
  "Home uses one uniform theme-derived glass ground while a backdrop is active",
);
assert.match(
  css,
  /html\[data-backdrop-on\] \.home-composer-root\.home-dash \{[^}]*backdrop-filter: blur\(var\(--glass-blur\)\)[^}]*\}/,
  "the dashboard ground earns a real blur so its on-surface type stays legible over the image",
);
assert.doesNotMatch(
  css,
  /html\[data-backdrop-on\] \.home-composer-root::before/,
  "Home no longer paints a full-area pseudo-element behind the content",
);
assert.doesNotMatch(
  css,
  /html\[data-backdrop-on\] \.home-composer-root\.home-dash(?:::before|::after)? \{[^}]*radial-gradient\(/s,
  "the backdrop-only Home treatment contains no radial gradient",
);
// The retired hearth card no longer carries a backdrop treatment.
assert.doesNotMatch(
  css,
  /html\[data-backdrop-on\] \.home-hearth-card/,
  "the retired hearth-card backdrop rules are gone (Home is the dashboard shell now)",
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
  /prefers-reduced-transparency: reduce[\s\S]*html\[data-backdrop-on\] \.home-composer-root\.home-dash \{[^}]*background: var\(--bg-base\);[^}]*backdrop-filter: none;[^}]*\}/,
  "reduced transparency restores the Home dashboard's opaque base surface",
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
