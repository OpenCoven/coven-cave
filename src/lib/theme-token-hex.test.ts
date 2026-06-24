import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { normalizedColorToHex } from "./theme-token-hex";

test("persistThemeTokens resolves tokens to hex via a canvas round-trip before PUT", () => {
  const src = readFileSync(new URL("../components/settings-shell.tsx", import.meta.url), "utf8");
  // Tokens must be normalised through the canvas resolver, not posted raw — the
  // bug was PUTting getComputedStyle's authored lab()/color-mix() values.
  assert.match(src, /getContext\("2d"\)/, "should create a 2D canvas context to resolve colours");
  assert.match(src, /resolveTokenToHex\(ctx, value\)/, "tokens should be resolved before being sent");
  assert.match(src, /normalizedColorToHex\(got\)/, "the canvas result should be normalised to hex");
  // Guard against a regression back to posting the raw computed value.
  assert.doesNotMatch(src, /tokens\[key\]\s*=\s*value;/, "must not PUT the raw authored token value");
});

test("passes through #rrggbb unchanged (lower-cased)", () => {
  assert.equal(normalizedColorToHex("#9A8ECD"), "#9a8ecd");
  assert.equal(normalizedColorToHex("#161422"), "#161422");
});

test("expands #rgb and #rgba shorthand", () => {
  assert.equal(normalizedColorToHex("#abc"), "#aabbcc");
  assert.equal(normalizedColorToHex("#abcd"), "#aabbccdd");
});

test("drops a redundant fully-opaque alpha", () => {
  assert.equal(normalizedColorToHex("#112233ff"), "#112233");
  assert.equal(normalizedColorToHex("#abcf"), "#aabbcc");
});

test("keeps a meaningful alpha as #rrggbbaa", () => {
  assert.equal(normalizedColorToHex("#11223380"), "#11223380");
});

test("converts rgb() to #rrggbb (canvas serialisation)", () => {
  assert.equal(normalizedColorToHex("rgb(154, 142, 205)"), "#9a8ecd");
  assert.equal(normalizedColorToHex("rgb(0, 0, 0)"), "#000000");
  assert.equal(normalizedColorToHex("rgb(255, 255, 255)"), "#ffffff");
});

test("converts rgba() with alpha to #rrggbbaa", () => {
  // 0.5 * 255 = 127.5 → rounds to 128 = 0x80
  assert.equal(normalizedColorToHex("rgba(17, 34, 51, 0.5)"), "#11223380");
  // fully opaque rgba collapses to 6 digits
  assert.equal(normalizedColorToHex("rgba(154, 142, 205, 1)"), "#9a8ecd");
});

test("clamps out-of-range channels into sRGB byte range", () => {
  assert.equal(normalizedColorToHex("rgb(300, -5, 128)"), "#ff0080");
});

test("tolerates space-separated rgb (color-4 serialisation)", () => {
  assert.equal(normalizedColorToHex("rgb(154 142 205)"), "#9a8ecd");
});

test("returns unrecognised input unchanged so callers keep the raw token", () => {
  // If the canvas round-trip is ever skipped, an unresolved lab()/color-mix()
  // string must pass through rather than be corrupted.
  assert.equal(normalizedColorToHex("lab(1.87792% 1.50546 -3.6698)"), "lab(1.87792% 1.50546 -3.6698)");
  assert.equal(normalizedColorToHex("color-mix(in oklch, white 55%, transparent)"), "color-mix(in oklch, white 55%, transparent)");
  assert.equal(normalizedColorToHex(""), "");
});
