// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./familiar-image-upload.ts", import.meta.url), "utf8");

assert.match(source, /export function useFamiliarImageUpload/, "exposes the shared upload hook");
assert.match(source, /export async function prepareFamiliarImage/, "exposes image preparation");
assert.match(source, /export const FAMILIAR_IMAGE_ACCEPT/, "exposes a shared accept list");
assert.match(source, /setFamiliarImage/, "hook commits the prepared image to the store");
assert.match(source, /clearFamiliarImage/, "hook can clear the familiar image");
assert.match(
  source,
  /MAX_FAMILIAR_IMAGE_DATAURL_BYTES/,
  "preparation reads the familiar image storage cap before saving",
);
assert.match(source, /downsizeFamiliarImage/, "oversized raster uploads are automatically downsized");
assert.match(
  source,
  /DOWNSIZABLE_MIMES = new Set\(\["image\/png", "image\/jpeg", "image\/webp"\]\)/,
  "only raster formats are canvas-downsized; SVG stays guarded by the store cap",
);
assert.match(
  source,
  /Image was downsized for Cave\./,
  "user gets feedback when a large image is compressed successfully",
);

// ── Upload outcomes reach assistive tech (2026-07-06) ───────────────────────
// The toast is visual-only; every outcome (success included, which never had
// a toast) mirrors through the shared live region.
assert.match(source, /useAnnouncer/, "the upload hook announces outcomes");
assert.match(source, /announce\(res\.reason, "assertive"\)/, "store rejections announce assertively");
assert.match(source, /announce\("Avatar updated\."\)/, "plain successes are announced");
assert.match(source, /announce\(message, "assertive"\)/, "read/resize failures announce assertively");

console.log("familiar-image-upload.test.ts: ok");
