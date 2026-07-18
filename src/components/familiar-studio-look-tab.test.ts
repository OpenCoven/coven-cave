// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./familiar-studio-look-tab.tsx", import.meta.url),
  "utf8",
);

assert.match(source, /export function FamiliarStudioLookTab/);
assert.match(source, /FamiliarGlyphPickerPanel/);
// Image upload logic lives in the shared hook (also used by the Studio header).
assert.match(source, /useFamiliarImageUpload/, "Look tab uploads via the shared hook");
assert.match(source, /setFamiliarOverride/);
assert.match(source, /color/);
assert.match(source, /input.*type="color"/);
assert.match(source, /input.*type="file"/);
assert.match(source, /onDrop|onDragOver/, "Drag-drop wired for image upload");
// Image selection above icons: the "Avatar image" section must render before "Icon".
assert.match(
  source,
  />Avatar image<\/h3>[\s\S]*>Icon<\/h3>/,
  "Avatar image section should appear above the Icon section",
);
assert.match(
  source,
  /Large raster images are downsized automatically/,
  "Upload hint should explain automatic downsizing",
);
assert.match(
  source,
  /color-mix\(in oklch, var\(--accent-presence\)/,
  "Color presets should include theme-derived pastel colors",
);
assert.match(
  source,
  /type ColorScope = "familiar" \| "harness"/,
  "Look tab should support familiar and harness color scopes",
);
assert.match(
  source,
  /allFamiliars: ResolvedFamiliar\[\]/,
  "Look tab should receive all familiars for group palette assignment",
);
assert.match(
  source,
  /setFamiliarOverride\(target\.id, \{ color \}\)/,
  "Color scope application should write the selected color to every target familiar",
);
assert.match(source, /Same runtime/, "Look tab should expose same-runtime color assignment");
assert.match(source, /Palette by familiar/, "Look tab should expose per-familiar palette distribution");
assert.match(source, /Palette by runtime/, "Look tab should expose per-runtime palette distribution");

// ── A11y state on color controls + toast live region (2026-07-06) ───────────
assert.match(source, /aria-pressed=\{currentColor === preset\.color\}/, "accent swatches expose pressed state");
assert.match(source, /aria-pressed=\{colorScope === "familiar"\}/, "scope buttons expose pressed state");
assert.match(source, /className="familiar-studio-look__toast" role="status"/, "the upload toast is a live region");

// ── per-familiar backdrop switch (cave-kf8p) ─────────────────────────────────
assert.match(
  source,
  /isFamiliarBackdropOn\(prefs, familiarId, previewUrl !== null\)/,
  "the switch reflects effective state: explicit entry, else image presence",
);
assert.match(
  source,
  /setFamiliarBackdropEnabled\(familiarId, !enabled\)/,
  "toggling records an explicit per-familiar choice",
);
assert.match(
  source,
  /role="switch"[\s\S]{0,120}aria-checked=\{enabled\}/,
  "the backdrop switch is an accessible switch control",
);
assert.match(
  source,
  /Show backdrop while this familiar is active/,
  "the switch label names the behavior",
);
assert.match(
  source,
  /No image uploaded — the app backdrop image is used\./,
  "the on-without-image state explains the app-image fallback",
);
assert.match(
  source,
  /appImagePresent\s*\?\s*"No image uploaded — the app backdrop image is used\."/,
  "the app-image claim is made only when an app image actually exists",
);
assert.match(
  source,
  /only the backdrop tint shows until an image is set here or in Settings → Appearance\./,
  "the no-image-anywhere state tells the truth about the tint-only render",
);
assert.match(
  source,
  /familiars\[familiarId\] !== true\) \{\s*setFamiliarBackdropEnabled\(familiarId, true\);/,
  "uploading an image records an explicit on (guarded against redundant writes)",
);

console.log("familiar-studio-look-tab.test.ts: ok");
