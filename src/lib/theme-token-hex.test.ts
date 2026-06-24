import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { rgbaBytesToHex } from "./theme-token-hex";

test("builds #rrggbb from opaque sRGB bytes", () => {
  assert.equal(rgbaBytesToHex(154, 142, 205, 255), "#9a8ecd");
  assert.equal(rgbaBytesToHex(8, 6, 15, 255), "#08060f");
  assert.equal(rgbaBytesToHex(0, 0, 0), "#000000");
  assert.equal(rgbaBytesToHex(255, 255, 255), "#ffffff");
});

test("keeps a meaningful alpha as #rrggbbaa", () => {
  // color-mix(... 55%) → white at alpha 0x8c
  assert.equal(rgbaBytesToHex(250, 250, 250, 140), "#fafafa8c");
  assert.equal(rgbaBytesToHex(247, 247, 247, 31), "#f7f7f71f");
});

test("drops a redundant fully-opaque alpha (and defaults to opaque)", () => {
  assert.equal(rgbaBytesToHex(17, 34, 51, 255), "#112233");
  assert.equal(rgbaBytesToHex(17, 34, 51), "#112233");
});

test("clamps out-of-range channels into the sRGB byte range", () => {
  assert.equal(rgbaBytesToHex(300, -5, 128), "#ff0080");
  assert.equal(rgbaBytesToHex(0, 0, 0, 999), "#000000");
});

test("rounds fractional channels", () => {
  assert.equal(rgbaBytesToHex(127.5, 127.4, 0.6), "#807f01");
});

test("persistThemeTokens rasterises tokens to sRGB hex before PUT", () => {
  const src = readFileSync(new URL("../components/settings-shell.tsx", import.meta.url), "utf8");
  // Must paint + read the pixel — reading fillStyle back doesn't down-convert
  // lab()/oklch() on modern engines (CSS Color 4).
  assert.match(src, /getContext\("2d",\s*\{\s*willReadFrequently:\s*true\s*\}\)/, "should request a readback-optimised 2D context");
  assert.match(src, /ctx\.fillRect\(0,\s*0,\s*1,\s*1\)/, "should paint the colour onto the canvas");
  assert.match(src, /ctx\.getImageData\(0,\s*0,\s*1,\s*1\)\.data/, "should read the rasterised sRGB pixel");
  assert.match(src, /rgbaBytesToHex\(r,\s*g,\s*b,\s*a\)/, "should convert the sRGB bytes to hex");
  // Guard against regressions: never PUT the raw authored token, and don't rely
  // on the fillStyle round-trip alone.
  assert.doesNotMatch(src, /tokens\[key\]\s*=\s*value;/, "must not PUT the raw authored token value");
  assert.doesNotMatch(src, /return normalizedColorToHex\(got\)/, "must not depend on the fillStyle round-trip");
});
