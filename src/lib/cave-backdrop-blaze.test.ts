// @ts-nocheck
// Blaze backdrop style (cave-99s9): unit tests for the accent → fire-color
// derivation, plus source pins for the component contract (reduced motion,
// lazy chunk, live theme tracking).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  blazeColorsFromAccent,
  BLAZE_FALLBACK_SMOKE,
  BLAZE_FALLBACK_SPARK,
  BLAZE_OPTIONS,
} from "./cave-backdrop-blaze-colors.ts";

// ── Smoke IS the accent; sparks sit 70% toward neutral grey ──────────────────
{
  const { sparkColor, smokeColor } = blazeColorsFromAccent("rgb(255, 0, 0)");
  assert.deepEqual(smokeColor, [1, 0, 0], "smoke takes the accent directly");
  const expected = [1 * 0.3 + 0.66 * 0.7, 0.66 * 0.7, 0.66 * 0.7];
  for (let i = 0; i < 3; i++) {
    assert.ok(Math.abs(sparkColor[i] - expected[i]) < 1e-6, "sparks mix 70% toward 0.66 grey");
  }
}

// ── The oklch syntax the theme tokens actually use parses in range ───────────
{
  const { sparkColor, smokeColor } = blazeColorsFromAccent("oklch(0.72 0.16 293)");
  assert.ok(smokeColor.every((c) => c >= 0 && c <= 1), "oklch accents land in 0–1 channels");
  assert.ok(sparkColor.every((c) => c >= 0 && c <= 1), "spark channels stay clamped");
}

// ── Unparseable accent → the exact Canvas UI playground values ───────────────
{
  const { sparkColor, smokeColor } = blazeColorsFromAccent("");
  assert.deepEqual(sparkColor, BLAZE_FALLBACK_SPARK);
  assert.deepEqual(smokeColor, BLAZE_FALLBACK_SMOKE);
}

// ── The exact playground option values (user-configured) ─────────────────────
assert.deepEqual(BLAZE_OPTIONS, {
  height: 0.75,
  distortion: 0.5,
  distortionScale: 1,
  speed: 0.5,
  sparks: 0.75,
  sparkDensity: 0.75,
  sparkSize: 0.75,
  layers: 5,
  smoke: 1,
  glow: 0.5,
});

// ── Component contract pins ──────────────────────────────────────────────────
const component = readFileSync(new URL("../components/cave-backdrop-blaze.tsx", import.meta.url), "utf8");
assert.match(
  component,
  /if \(reducedMotion \|\| accentCss === null\) return null;/,
  "reduced motion skips mounting the GPU loop entirely",
);
assert.match(
  component,
  /dynamic\(\(\) => import\("@\/components\/canvasui\/Blaze"\), \{ ssr: false \}\)/,
  "the vendored WebGL file stays out of the main bundle",
);
assert.match(
  component,
  /attributeFilter: \["data-theme", "data-mode", "style"\]/,
  "colors re-derive live on theme/mode/custom-accent changes",
);

// ── Layer integration ────────────────────────────────────────────────────────
const layer = readFileSync(new URL("../components/cave-backdrop-layer.tsx", import.meta.url), "utf8");
assert.match(
  layer,
  /prefs\.style === "blaze" && !familiarImageShowing/,
  "a familiar's own image still overrides the Blaze style while active",
);
assert.match(
  layer,
  /\{blazeShowing && active \? <CaveBackdropBlaze \/> : null\}/,
  "the GPU loop unmounts whenever no backdrop surface is frontmost",
);
assert.match(
  layer,
  /data-backdrop-style=\{blazeShowing \? "blaze" : "image"\}/,
  "CSS can target the active backdrop style",
);
assert.match(
  layer,
  /prefs\.style === "image" &&\n\s*\(prefs\.enabled \|\|/,
  "image bytes are not fetched while the Blaze style is selected",
);

// The store's own write-path applies raw prefs synchronously (before the layer
// effect re-applies suppressed ones). Guarding the accent branch on the image
// style keeps a leftover image accentSeed from flashing document-wide between
// those two applies while Blaze is selected.
{
  const src = readFileSync(new URL("./cave-backdrop.ts", import.meta.url), "utf8");
  assert.match(
    src,
    /if \(active && prefs\.style === "image" && prefs\.matchAccent && prefs\.accentSeed\) \{/,
    "an image-sampled accent never drives the document while Blaze is selected",
  );
}

// ── CSS: fill + reduced-motion hide ──────────────────────────────────────────
const css = readFileSync(new URL("../styles/backdrop.css", import.meta.url), "utf8");
assert.match(
  css,
  /\.cave-backdrop-blaze \{\n  position: absolute;\n  inset: 0;\n\}/,
  "the Blaze visual fills the fixed layer",
);
assert.match(
  css,
  /@media \(prefers-reduced-motion: reduce\) \{\n  html\[data-backdrop\] \.cave-backdrop-layer\[data-backdrop-style="blaze"\] \{\n    display: none;\n  \}\n\}/,
  "reduced motion hides the animated style entirely (no frozen fire frame)",
);

// ── Settings: the style picker and its enablement rules ──────────────────────
const settings = readFileSync(new URL("../components/backdrop-settings.tsx", import.meta.url), "utf8");
assert.match(settings, /ariaLabel="Backdrop style"/, "the style picker is a labeled segmented control");
assert.match(
  settings,
  /writeBackdropPrefs\(\{ style, enabled: true \}\);/,
  "choosing Blaze turns the backdrop on without needing an image",
);
assert.match(
  settings,
  /if \(prefs\.style === "blaze" && prefs\.enabled\) return;/,
  "re-clicking Blaze re-asserts enablement (heals a stomped enabled:false, e.g. a clear that raced the switch)",
);
assert.match(
  settings,
  /const imagePresent = readAppPreferences\(\)\.appearance\.backdrop\.image\.present;/,
  "image-style enablement reads the store's synchronous truth, not the async-hydrating thumbnail",
);
assert.match(
  settings,
  /writeBackdropPrefs\(\{ style, enabled: imagePresent \}\);/,
  "switching to Image stays on only when a stored image exists",
);
assert.match(
  settings,
  /\{prefs\.style === "image" \? \(/,
  "the image chooser and accent-match rows are image-style-only",
);

// ── Boot script: pre-paint parity with the hydrated runtime ──────────────────
const boot = readFileSync(new URL("../../public/scripts/theme-init.js", import.meta.url), "utf8");
assert.match(
  boot,
  /backdropEnabled && backdropStyle === "image" && backdropPrefs\.matchAccent !== false/,
  "the pre-paint sampled-accent branch is image-style-only, matching applyBackdropToDocument's guard",
);
assert.match(
  boot,
  /style: backdrop\.style === "blaze" \? "blaze" : "image"/,
  "the boot legacy-mirror write carries style, so it round-trips instead of being stomped every boot",
);

// ── Familiar Look tab: fallback copy knows about the Blaze style ─────────────
const lookTab = readFileSync(
  new URL("../components/familiar-studio-look-tab.tsx", import.meta.url),
  "utf8",
);
assert.match(
  lookTab,
  /the animated Blaze backdrop shows/,
  "the no-familiar-image fallback note describes Blaze when that style is selected",
);

console.log("cave-backdrop-blaze.test.ts: ok");
