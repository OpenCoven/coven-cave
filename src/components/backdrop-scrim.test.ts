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
  /html\[data-backdrop-on\] \.home-hearth-card \{[^}]*background: color-mix\(in oklch, var\(--bg-base\) 72%, transparent\);[^}]*\}/,
  "Home uses one uniform theme-derived hearth surface while a backdrop is active",
);
assert.match(
  css,
  /html\[data-backdrop-on\] \.home-hearth-card \{[^}]*border-radius: var\(--radius-xl\);[^}]*\}/,
  "the hearth surface rounds with the Appearance corner-radius tokens, not square corners",
);
assert.doesNotMatch(
  css,
  /html\[data-backdrop-on\] \.home-composer-root::before/,
  "Home no longer paints a full-area pseudo-element behind the hearth",
);
assert.doesNotMatch(
  css,
  /html\[data-backdrop-on\] \.home-hearth-card(?:::before|::after)? \{[^}]*radial-gradient\(/s,
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
  /prefers-reduced-transparency: reduce[\s\S]*html\[data-backdrop-on\] \.home-hearth-card \{[^}]*background: color-mix\(in oklch, var\(--bg-panel\) 55%, transparent\);[^}]*\}/,
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

// ── Top bar joins the backdrop (cave-vyp3e) ──────────────────────────────────
// .shell-top and .top-bar paint an opaque var(--bg-base) so they read as a
// seamless extension of the canvas. With a backdrop on, everything below them
// is translucent, so an opaque bar cut the image off in a hard line. Pin the
// glass AND both fallbacks: a translucent band with no scrim would leave the
// bar's controls and search text sitting on raw photo.
assert.match(
  css,
  /html\[data-backdrop-on\] \.shell-top,\s*\n\s*html\[data-backdrop-on\] \.top-bar \{[^}]*background: color-mix\(in oklch, var\(--bg-base\) 46%, transparent\);[^}]*\}/,
  "both top bars take the same 46% glass the native titlebar already uses",
);
assert.match(
  css,
  /html\[data-backdrop-on\] \.shell-top,\s*\n\s*html\[data-backdrop-on\] \.top-bar \{[^}]*backdrop-filter: blur\(var\(--glass-blur\)\) saturate\(var\(--glass-saturate\)\);[^}]*\}/,
  "the band blurs the backdrop behind it rather than only tinting it",
);
// Both fallbacks restore the OPAQUE band. The native rule falls back to
// transparent because the window supplies its own material; in the browser the
// baseline is var(--bg-base), so transparent would strand the controls.
assert.match(
  css,
  /@supports not \(\(backdrop-filter: blur\(1px\)\) or \(-webkit-backdrop-filter: blur\(1px\)\)\) \{\s*\n\s*html\[data-backdrop-on\] \.shell-top,\s*\n\s*html\[data-backdrop-on\] \.top-bar \{\s*\n\s*background: var\(--bg-base\);/,
  "without backdrop-filter the bar falls back to the opaque band, not a bare wash",
);
assert.match(
  css,
  /@media \(prefers-reduced-transparency: reduce\) \{\s*\n\s*html\[data-backdrop-on\] \.shell-top,\s*\n\s*html\[data-backdrop-on\] \.top-bar \{[^}]*backdrop-filter: none;[^}]*\}/,
  "reduced-transparency drops the glass instead of merely thinning it",
);

// ── Accent wash fallback (cave-vyp3e follow-up) ──────────────────────────────
// A familiar switched on with no uploaded image enabled a layer with nothing
// in it, so the toggle read as broken. The wash is the tail of the chain:
// familiar image → app image → accent. (Reuses `layer`, read above.)
assert.match(
  css,
  /html\[data-backdrop\] \.cave-backdrop-layer\[data-backdrop-style="accent"\] \{[^}]*radial-gradient\(/s,
  "the accent style paints a gradient wash rather than a flat tint",
);
assert.match(
  css,
  /color-mix\(in oklch, var\(--cave-backdrop-accent, var\(--accent-presence\)\) 22%, transparent\)/,
  "the wash is seeded from the familiar accent and falls back to the theme accent",
);
// Ordering is the contract, not the boolean: the wash must be REACHED ONLY
// when both images are absent, and must never pre-empt Blaze.
assert.match(
  layer,
  /accentShowing =\s*\n?\s*effectiveEnabled && !blazeShowing && effectiveUrl === null && accentWash !== null/,
  "the wash requires no image of either kind and yields to Blaze",
);
assert.match(
  layer,
  /data-backdrop-style=\{blazeShowing \? "blaze" : accentShowing \? "accent" : "image"\}/,
  "Blaze outranks the wash, which outranks the image style",
);
