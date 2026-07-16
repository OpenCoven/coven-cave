// @ts-nocheck
// Backdrop vibe (cave-bq7s): unit tests for the pure derivation math, plus
// source pins for the storage split, the one-var accent cascade, and the
// layer/settings wiring.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import {
  dominantVibrantOklab,
  fitAccentToBackground,
  readFamiliarBackdropImage,
  writeFamiliarBackdropImage,
} from "./cave-backdrop.ts";
import { createBackdropImageState } from "./backdrop-image-state.ts";
import { createDefaultPreferences } from "./preferences-schema.ts";
import { parseThemeColor, contrastRatio } from "./theme-contrast.ts";

// Known-missing familiar bytes are fetched once during normal navigation, but
// an in-app mutation invalidates the bounded negative cache immediately.
{
  const originalFetch = globalThis.fetch;
  let reads = 0;
  globalThis.fetch = async (_input, init) => {
    if (init?.method === "DELETE") return new Response(null, { status: 204 });
    reads += 1;
    return new Response(null, { status: 204 });
  };
  try {
    assert.equal(await readFamiliarBackdropImage("missing-cache-test"), null);
    assert.equal(await readFamiliarBackdropImage("missing-cache-test"), null);
    assert.equal(reads, 1, "a known-missing familiar backdrop is not refetched on rerender");
    await writeFamiliarBackdropImage("missing-cache-test", null);
    assert.equal(await readFamiliarBackdropImage("missing-cache-test"), null);
    assert.equal(reads, 2, "a backdrop mutation invalidates the known-missing cache");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

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

// â”€â”€ durable image state: live replacement, migration, and retry semantics â”€â”€
{
  const oldImage = new Blob(["old"], { type: "image/jpeg" });
  const replacement = new Blob(["replacement"], { type: "image/jpeg" });
  const laterCentralImage = new Blob(["later"], { type: "image/jpeg" });
  let central: Blob | null = oldImage;
  let legacy: Blob | null = oldImage;
  let tombstoned = false;
  let revisions = 0;

  const state = createBackdropImageState({
    async readCentral() {
      return central ? { kind: "found", blob: central } : { kind: "missing" };
    },
    async readLegacy() {
      return legacy;
    },
    async persistCentral(blob) {
      central = blob;
      tombstoned = blob === null;
    },
    async mirrorLegacy(blob) {
      legacy = blob;
    },
    migrationBlocked() {
      return tombstoned;
    },
  });
  state.subscribe(() => {
    revisions += 1;
  });

  assert.equal(await state.read(), oldImage, "the initial central image is read");
  await state.write(replacement);
  assert.equal(revisions, 1, "replacing bytes publishes a live image revision");
  assert.equal(await state.read(), replacement, "the replacement is immediately readable from the live cache");

  await state.write(null);
  assert.equal(legacy, replacement, "an explicit clear leaves legacy IndexedDB bytes intact");
  assert.equal(await state.read(), null, "the canonical tombstone prevents legacy resurrection");

  // A missing/null result is never cached forever. If a different process
  // writes an image, the very next read can recover even before metadata sync.
  central = laterCentralImage;
  tombstoned = false;
  assert.equal(await state.read(), laterCentralImage, "a later central image replaces a prior null result");
}

{
  const legacy = new Blob(["legacy"], { type: "image/jpeg" });
  let central: Blob | null = null;
  let uploadAttempts = 0;
  let failFirstUpload = true;
  const state = createBackdropImageState({
    async readCentral() {
      return central ? { kind: "found", blob: central } : { kind: "missing" };
    },
    async readLegacy() {
      return legacy;
    },
    async persistCentral(blob) {
      uploadAttempts += 1;
      if (failFirstUpload) {
        failFirstUpload = false;
        throw new Error("sidecar temporarily unavailable");
      }
      central = blob;
    },
    async mirrorLegacy() {
      throw new Error("migration must not rewrite or delete the legacy source");
    },
    migrationBlocked() {
      return false;
    },
  });

  await assert.rejects(state.migrateLegacy(), /temporarily unavailable/);
  assert.equal(
    await state.migrateLegacy(),
    "uploaded",
    "a transient migration failure remains retryable",
  );
  assert.equal(uploadAttempts, 2);
  assert.equal(central, legacy, "the second migration attempt imports the legacy bytes");
  assert.equal(await state.migrateLegacy(), "already-complete", "a successful import is one-time");
}

{
  const fallback = new Blob(["fallback"], { type: "image/jpeg" });
  const recovered = new Blob(["central"], { type: "image/jpeg" });
  let reads = 0;
  const state = createBackdropImageState({
    async readCentral() {
      reads += 1;
      if (reads === 1) throw new Error("401 is not absence");
      return { kind: "found", blob: recovered };
    },
    async readLegacy() {
      return fallback;
    },
    async persistCentral() {},
    async mirrorLegacy() {},
    migrationBlocked() {
      return false;
    },
  });

  assert.equal(await state.read(), fallback, "legacy bytes can render during a transient/auth failure");
  assert.equal(await state.read(), recovered, "the next read retries instead of caching the fallback/null result");
  assert.equal(reads, 2);
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
const bootstrapController = await readFile(
  new URL("../components/preferences-bootstrap-controller.tsx", import.meta.url),
  "utf8",
);
const bootScript = await readFile(new URL("../../public/scripts/theme-init.js", import.meta.url), "utf8");

// The central API is canonical; old origin stores remain migration/mirror data.
assert.match(lib, /indexedDB\.open\(DB_NAME, DB_VERSION\)/, "legacy image bytes remain available for migration");
assert.match(lib, /PREFS_KEY = "cave:backdrop:v1"/, "legacy prefs remain a stable compatibility mirror");
assert.match(lib, /response\.status === 204 \|\| response\.status === 404/, "clean 204 and legacy 404 both classify a missing central image");
assert.match(lib, /FAMILIAR_BACKDROP_MISSING_TTL_MS = 5 \* 60_000/, "known-missing familiar backdrops are bounded-cached across normal navigation");
assert.match(lib, /familiarBackdropMissingUntil\.delete\(familiarId\)/, "familiar writes immediately invalidate the negative cache");
assert.doesNotMatch(lib, /\.delete\(IMAGE_KEY\)/, "legacy backdrop bytes are never deleted during migration or clear");

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
assert.match(layer, /useBackdropImageRevision\(\)/, "the mounted layer subscribes to image replacements");
assert.match(
  layer,
  /\[prefs\.enabled, imageRevision\]/,
  "an enabled backdrop reloads when its durable bytes are replaced",
);

{
  const preferences = createDefaultPreferences(true);
  const seed = { L: 0.3, a: 0.12, b: 0.02 };
  const background = "#15121b";
  preferences.appearance.backdrop = {
    ...preferences.appearance.backdrop,
    enabled: true,
    matchAccent: true,
    accentSeed: seed,
  };
  preferences.appearance.theme.tokens = { "--bg-base": background };
  const inline = new Map<string, string>();
  const html = {
    style: {
      setProperty(name: string, value: string) { inline.set(name, String(value)); },
      removeProperty(name: string) { inline.delete(name); },
    },
    setAttribute() {},
    removeAttribute() {},
  };
  const storage = new Map<string, string>();
  vm.runInNewContext(bootScript, {
    document: {
      documentElement: html,
      getElementById: (id: string) => id === "cave-preferences-bootstrap"
        ? { textContent: JSON.stringify(preferences) }
        : null,
    },
    localStorage: {
      getItem(key: string) { return storage.get(key) ?? null; },
      setItem(key: string, value: string) { storage.set(key, String(value)); },
      removeItem(key: string) { storage.delete(key); },
    },
    window: { matchMedia: () => ({ matches: true }) },
  });
  assert.equal(
    inline.get("--accent-presence"),
    fitAccentToBackground(seed, background),
    "pre-paint and hydrated backdrop accent fitting produce the same CSS value",
  );
}
assert.match(
  layer,
  /URL\.revokeObjectURL\(urlRef\.current\)/,
  "the layer revokes its previous object URL before replacing or clearing it",
);
assert.match(layer, /root\.dataset\.backdropOn = "1"/, "the frontmost-surface flag rides <html>");
assert.match(
  workspace,
  /<CaveBackdropLayer\s+active=\{mode === "home" \|\| mode === "chat"\}\s+familiarId=\{mode === "chat" \? activeId : null\}\s*\/>/,
  "the workspace scopes the backdrop to Home + Chat, with the active chat familiar as the override scope",
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
  bootstrapController,
  /await initializeAppPreferences\(\)[\s\S]*migrateLegacyBackdropImage\(\)/,
  "legacy image migration runs after authenticated preference bootstrap even when Appearance is never opened",
);
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
