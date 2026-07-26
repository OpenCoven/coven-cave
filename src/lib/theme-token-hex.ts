// Resolving published theme tokens to plain sRGB hex.
//
// The desktop mirrors its colour tokens to GET /api/theme so other clients (the
// iOS app) can match the appearance. Those tokens are authored as modern CSS
// colours — `lab(...)`, `oklch(...)`, `color-mix(in oklch, ...)` — and
// `getComputedStyle` returns a CSS *custom property* as its authored value, not
// a resolved colour. Clients with a plain `#RRGGBB` parser (iOS `Color(hex:)`)
// can't read those, so they silently fall back.
//
// The browser side resolves each token by *rasterising* it: paint the colour
// onto a 1×1 `<canvas>` (whose backing store is sRGB) and read the pixel back
// with `getImageData`, which always yields sRGB bytes regardless of the input
// colour space. Reading `ctx.fillStyle` back is NOT enough — modern engines
// preserve `lab()`/`oklch()` there (CSS Color 4), so the wide-gamut string
// would survive untouched. This module is the pure tail of that: turn the
// sRGB RGBA bytes into the `#RRGGBB` / `#RRGGBBAA` form every client understands.

function clampByte(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(255, Math.round(n)));
}

function hex2(n: number): string {
  return clampByte(n).toString(16).padStart(2, "0");
}

/**
 * Build `#RRGGBB` (opaque) or `#RRGGBBAA` (translucent) from sRGB RGBA byte
 * channels (0–255), as produced by a canvas `getImageData` read. A fully-opaque
 * alpha is dropped so the common case stays `#RRGGBB`.
 */
export function rgbaBytesToHex(r: number, g: number, b: number, a = 255): string {
  const alpha = clampByte(a);
  const base = `#${hex2(r)}${hex2(g)}${hex2(b)}`;
  return alpha >= 255 ? base : `${base}${hex2(alpha)}`;
}
