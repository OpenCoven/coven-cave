// Resolving published theme tokens to plain sRGB hex.
//
// The desktop mirrors its colour tokens to GET /api/theme so other clients (the
// iOS app) can match the appearance. Those tokens are authored as modern CSS
// colours — `lab(...)`, `oklch(...)`, `color-mix(in oklch, ...)` — and
// `getComputedStyle` returns a CSS *custom property* as its authored value, not
// a resolved colour. Clients with a plain `#RRGGBB` parser (iOS `Color(hex:)`)
// can't read those, so they silently fall back.
//
// The browser side resolves each token through a `<canvas>` 2D `fillStyle`
// round-trip — the most reliable CSS-colour→sRGB normaliser available — which
// yields `#rrggbb` (opaque) or `rgba(r, g, b, a)` (translucent). This module is
// the pure tail of that: turn a canvas-normalised colour string into the
// `#RRGGBB` / `#RRGGBBAA` form every client understands.

function clampByte(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(255, Math.round(n)));
}

function hex2(n: number): string {
  return clampByte(n).toString(16).padStart(2, "0");
}

/**
 * Convert a canvas-normalised colour string to `#RRGGBB` (opaque) or
 * `#RRGGBBAA` (translucent). Accepts:
 *   - `#rgb` / `#rgba` / `#rrggbb` / `#rrggbbaa` (passed through, expanded, and
 *     lower-cased; a fully-opaque alpha is dropped)
 *   - `rgb(r, g, b)` / `rgba(r, g, b, a)` (canvas's serialisation)
 * Anything unrecognised is returned unchanged, so callers can keep the raw
 * token rather than corrupt it.
 */
export function normalizedColorToHex(input: string): string {
  const value = input.trim();
  if (!value) return input;

  if (value.startsWith("#")) {
    const h = value.slice(1).toLowerCase();
    // #rgb / #rgba → expand each nibble.
    if (h.length === 3 || h.length === 4) {
      const expanded = h
        .split("")
        .map((c) => c + c)
        .join("");
      return collapseOpaque(`#${expanded}`);
    }
    if (h.length === 6 || h.length === 8) return collapseOpaque(`#${h}`);
    return input;
  }

  const m = value.match(/^rgba?\(([^)]+)\)$/i);
  if (!m) return input;
  // Pull the channel numbers out, tolerating both comma- and space-separated
  // forms. Percentages on RGB channels aren't part of canvas's serialisation,
  // so a plain numeric parse is sufficient.
  const nums = m[1].match(/-?[\d.]+/g);
  if (!nums || nums.length < 3) return input;
  const r = clampByte(parseFloat(nums[0]));
  const g = clampByte(parseFloat(nums[1]));
  const b = clampByte(parseFloat(nums[2]));
  const a = nums.length >= 4 ? clampByte(parseFloat(nums[3]) * 255) : 255;
  return a >= 255 ? `#${hex2(r)}${hex2(g)}${hex2(b)}` : `#${hex2(r)}${hex2(g)}${hex2(b)}${hex2(a)}`;
}

/** Drop a redundant fully-opaque alpha so `#rrggbbff` → `#rrggbb`. */
function collapseOpaque(hex: string): string {
  if (hex.length === 9 && hex.slice(7).toLowerCase() === "ff") return hex.slice(0, 7);
  return hex;
}
