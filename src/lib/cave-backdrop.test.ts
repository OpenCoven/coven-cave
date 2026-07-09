// @ts-nocheck
// Backdrop vibe (cave-bq7s): unit tests for the pure derivation math, plus
// source pins for the storage split, the one-var accent cascade, and the
// layer/settings wiring.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dominantVibrantOklab, fitAccentToBackground } from "./cave-backdrop.ts";
import { parseThemeColor, contrastRatio } from "./theme-contrast.ts";

// ── dominantVibrantOklab: picks the vibrant hue, ignores neutrals ────────────
function pixels(colors: Array<[number, number, number]>, repeat = 1): Uint8ClampedArray {
  const out = new Uint8ClampedArray(colors.length * repeat * 4);
  let i = 0;
  for (let r = 0; r < repeat; r++) {
    for (const [red, green, blue] of colors) {
      out[i++] = red;
      out[i++] = green;
      out[i++] = blue;
      out[i++] = 255;
    }
  }
  return out;
}

{
  // Mostly gray with a strong orange minority — the orange must win.
  const data = pixels([
    ...Array.from({ length: 30 }, () => [128, 128, 128]),
    ...Array.from({ length: 10 }, () => [255, 120, 40]),
  ]);
  const seed = dominantVibrantOklab(data);
  assert.ok(seed, "a vibrant minority against neutral majority still yields a seed");
  assert.ok(seed.a > 0.05, `orange seed should sit in the +a half (got a=${seed.a.toFixed(3)})`);
}

{
  // Pure grayscale → no seed; the theme accent must stay.
  const data = pixels(Array.from({ length: 40 }, (_, i) => [i * 6, i * 6, i * 6]));
  assert.equal(dominantVibrantOklab(data), null, "a grayscale image has no vibe seed");
}

{
  // Transparent pixels are ignored entirely.
  const data = pixels([[255, 0, 0]]);
  data[3] = 0;
  assert.equal(dominantVibrantOklab(data), null, "fully transparent pixels carry no vibe");
}

// ── fitAccentToBackground: keeps ≥3:1 against the live background ───────────
{
  const seed = { L: 0.3, a: 0.12, b: 0.02 }; // dark red — too dark for a dark bg
  const css = fitAccentToBackground(seed, "oklch(0.13 0.022 293)");
  assert.match(css, /^oklch\(/, "fit emits an oklch() color");
  const rgb = parseThemeColor(css);
  const bg = parseThemeColor("oklch(0.13 0.022 293)");
  assert.ok(rgb && bg, "both colors parse");
  assert.ok(
    contrastRatio(rgb, bg) >= 3,
    `derived accent must reach 3:1 on the dark base (got ${contrastRatio(rgb, bg).toFixed(2)})`,
  );
}

{
  const seed = { L: 0.9, a: 0.1, b: 0.05 }; // near-white — too light for a light bg
  const css = fitAccentToBackground(seed, "oklch(0.97 0.005 293)");
  const rgb = parseThemeColor(css);
  const bg = parseThemeColor("oklch(0.97 0.005 293)");
  assert.ok(
    contrastRatio(rgb, bg) >= 3,
    `derived accent must reach 3:1 on the light base (got ${contrastRatio(rgb, bg).toFixed(2)})`,
  );
}

// ── source pins ──────────────────────────────────────────────────────────────
const lib = await readFile(new URL("./cave-backdrop.ts", import.meta.url), "utf8");
const layer = await readFile(new URL("../components/cave-backdrop-layer.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../styles/backdrop.css", import.meta.url), "utf8");
const settings = await readFile(new URL("../components/settings-shell.tsx", import.meta.url), "utf8");
const workspace = await readFile(new URL("../components/workspace.tsx", import.meta.url), "utf8");
const backdropSettings = await readFile(new URL("../components/backdrop-settings.tsx", import.meta.url), "utf8");

// Storage split: image bytes in IDB, prefs (incl. the seed) in localStorage.
assert.match(lib, /indexedDB\.open\(DB_NAME, DB_VERSION\)/, "image bytes live in IndexedDB");
assert.match(lib, /PREFS_KEY = "cave:backdrop:v1"/, "prefs persist under a stable versioned key");

// The vibe rides exactly one custom property, so clearing restores the theme.
assert.match(
  lib,
  /root\.style\.setProperty\("--accent-presence", fitAccentToBackground/,
  "the derived accent overrides --accent-presence inline (ring/tints cascade)",
);
assert.match(
  lib,
  /root\.style\.removeProperty\("--accent-presence"\)/,
  "disabling the match restores the theme accent untouched",
);

// The layer stays mounted and crossfades; only home/chat lift the opaque panes.
assert.match(layer, /data-on=\{active \? "true" : "false"\}/, "the layer crossfades via data-on");
assert.match(layer, /root\.dataset\.backdropOn = "1"/, "the frontmost-surface flag rides <html>");
assert.match(
  workspace,
  /<CaveBackdropLayer active=\{mode === "home" \|\| mode === "chat"\} \/>/,
  "the workspace scopes the backdrop to Home + Chat",
);
assert.match(css, /html\[data-backdrop-on\] \.shell-root,/, "shell panes go translucent only while a backdrop surface is frontmost");
assert.match(
  css,
  /@media \(prefers-reduced-transparency: reduce\)[\s\S]*display: none/,
  "reduced-transparency users get their solid surfaces back",
);
assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, "backdrop.css is tokens-only");

// Readability over the image (cave-5oeu): the transcript flattens bubbles to
// bare text, so the reading column (and the group-chat shell) gets real glass
// — scrim + blur — and the quiet text lifts one contrast step. Engines
// without backdrop-filter fall back to a near-opaque fill instead of
// see-through text.
assert.match(
  css,
  /html\[data-backdrop-on\] \.cave-chat-linear \.cave-chat-thread,\s*html\[data-backdrop-on\] \.cave-group-chat-shell \{[^}]*backdrop-filter: blur\(var\(--glass-blur\)\)/,
  "the chat reading column sits on glass while the image is frontmost",
);
assert.match(
  css,
  /html\[data-backdrop-on\] \.cave-chat-linear,\s*html\[data-backdrop-on\] \.cave-group-chat-shell \{[^}]*--text-muted: var\(--text-secondary\)/,
  "quiet transcript text lifts to secondary strength over the image",
);
assert.match(
  css,
  /@supports not \(\(backdrop-filter: blur\(1px\)\)[\s\S]*?92%, transparent\)/,
  "no-blur engines get a near-opaque fill instead of see-through text",
);

// Settings wiring: the Appearance section owns the controls.
assert.match(settings, /<BackdropSettings \/>/, "Appearance renders the backdrop controls");
assert.match(backdropSettings, /prepareBackdropImage\(file\)/, "picking an image downscales + derives the seed");
assert.match(backdropSettings, /accent matched to the image/i, "the pick announces the vibe match to AT");
assert.match(backdropSettings, /writeBackdropImage\(null\)/, "Clear removes the stored image");
assert.match(
  backdropSettings,
  /accept="image\/png,image\/jpeg,image\/webp,image\/avif,image\/heic,image\/heif"/,
  "the picker accepts HEIC/HEIF photos (cave-cjpb)",
);
assert.match(
  backdropSettings,
  /convert it to JPEG first/,
  "an undecodable HEIC gets an actionable announce, not the engine's decode error",
);

console.log("cave-backdrop.test.ts: ok");
