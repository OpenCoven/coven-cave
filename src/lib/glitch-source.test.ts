import assert from "node:assert/strict";

import {
  buildGlitchSource,
  coverSourceRect,
  GLITCH_WIDTH,
  type GlitchSourceInput,
} from "./glitch-source.ts";

/** A frame whose left half is one colour and right half another. */
function twoTone(
  W: number, H: number,
  left: [number, number, number],
  right: [number, number, number],
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const c = x < W / 2 ? left : right;
      data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255;
    }
  }
  return data;
}

function pixelAt(source: { width: number; rgba: Uint8ClampedArray }, x: number, y: number) {
  const i = (y * source.width + x) * 4;
  return [source.rgba[i], source.rgba[i + 1], source.rgba[i + 2]];
}

const SRC = 256;
const base: GlitchSourceInput = {
  data: twoTone(SRC, SRC, [220, 30, 40], [20, 60, 210]),
  width: SRC,
  height: SRC,
  seed: 7,
};

// ── The shards must carry the image, not a palette ───────────────────────────
// This is the whole effect. If the downscale loses the source colour, every
// shard is decoration no matter how it moves.

const plain = buildGlitchSource(base);

assert.equal(plain.width, GLITCH_WIDTH, "the buffer is reduced to the glitch grid");
assert.equal(plain.height, GLITCH_WIDTH, "a square source stays square");

{
  const [r, g, b] = pixelAt(plain, 4, 40);
  assert.ok(r > 200 && g < 60 && b < 70, `left half keeps its red, got ${r},${g},${b}`);
}
{
  const [r, g, b] = pixelAt(plain, plain.width - 5, 40);
  assert.ok(b > 190 && r < 60, `right half keeps its blue, got ${r},${g},${b}`);
}

// Averaging, not nearest-neighbour: the seam between the halves must blend.
{
  const seam = pixelAt(plain, plain.width / 2 - 1, 20);
  const inner = pixelAt(plain, 4, 20);
  assert.deepEqual(seam, inner, "a box average over a flat region is that region");
}

// ── Downscaling must average, not sample ─────────────────────────────────────
// A checkerboard is the case that separates the two: nearest-neighbour returns
// pure black or pure white, an average returns grey.
{
  const W = 64;
  const checks = new Uint8ClampedArray(W * W * 4);
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const v = (x + y) % 2 === 0 ? 255 : 0;
      checks[i] = v; checks[i + 1] = v; checks[i + 2] = v; checks[i + 3] = 255;
    }
  }
  const reduced = buildGlitchSource({ data: checks, width: W, height: W, targetWidth: 16 });
  const [r] = pixelAt(reduced, 5, 5);
  assert.ok(r > 100 && r < 155, `a checkerboard averages to mid grey, got ${r}`);
}

// ── Determinism ──────────────────────────────────────────────────────────────
// A likeness must tear the same way every time it is dropped.

{
  const again = buildGlitchSource(base);
  assert.deepEqual([...again.picks], [...plain.picks], "the same seed draws the same picks");
  const other = buildGlitchSource({ ...base, seed: 8 });
  assert.notDeepEqual([...other.picks], [...plain.picks], "a different seed draws differently");
}

// ── Picks cover the frame when nothing says otherwise ────────────────────────

{
  let left = 0;
  for (let i = 0; i < plain.picks.length; i += 2) {
    if (plain.picks[i] < plain.width / 2) left++;
  }
  const share = left / (plain.picks.length / 2);
  assert.ok(share > 0.4 && share < 0.6, `unmasked picks are even across the frame, got ${share}`);
  assert.equal(plain.specularArea, 0, "no mask means nothing is called specular");
}

// ── The specular bias ────────────────────────────────────────────────────────
// The foil pipeline already decides where this image is reflective. Shards
// should come preferentially from there — but the bias must be a WEIGHTING:
// a filter would confine every shard to ~6% of the frame and the effect would
// stop reading as the image at all.

{
  const mask = new Uint8ClampedArray(SRC * SRC);
  // A hot band across 6% of the frame, matching the foil's coverage target.
  const bandStart = Math.round(SRC * 0.4);
  const bandEnd = Math.round(SRC * 0.46);
  for (let y = bandStart; y < bandEnd; y++) {
    for (let x = 0; x < SRC; x++) mask[y * SRC + x] = 255;
  }
  const masked = buildGlitchSource({ ...base, mask });

  assert.ok(
    Math.abs(masked.specularArea - 0.06) < 0.02,
    `the mask covers about 6% of the grid, got ${masked.specularArea}`,
  );
  assert.ok(
    masked.specularShare > masked.specularArea * 3,
    `picks are pulled toward the mask: ${masked.specularShare} vs area ${masked.specularArea}`,
  );
  assert.ok(
    masked.specularShare < 0.75,
    `but the rest of the frame still contributes, got ${masked.specularShare}`,
  );

  // The colours still come from the artwork, not from the mask.
  const [r, g, b] = pixelAt(masked, 4, 40);
  assert.ok(r > 200 && g < 60 && b < 70, `mask must not tint the buffer, got ${r},${g},${b}`);
}

// A mask that is hot everywhere must not change the distribution — a uniform
// weight is still a uniform weight, however large.
{
  const mask = new Uint8ClampedArray(SRC * SRC).fill(255);
  const flat = buildGlitchSource({ ...base, mask });
  let left = 0;
  for (let i = 0; i < flat.picks.length; i += 2) {
    if (flat.picks[i] < flat.width / 2) left++;
  }
  const share = left / (flat.picks.length / 2);
  assert.ok(share > 0.4 && share < 0.6, `a flat mask stays even, got ${share}`);
  assert.equal(flat.specularArea, 1, "a flat hot mask calls the whole frame specular");
}

// ── The crop the card actually shows ─────────────────────────────────────────
// The tear has to line up with the pixels underneath it, and the card crops its
// artwork with `object-fit: cover; object-position: 50% 12%`.

{
  // Wide source into a tall box: the sides are cropped, full height is shown.
  const r = coverSourceRect(400, 200, 100, 200, 0.5, 0.12);
  assert.equal(r.h, 200, "full source height is shown");
  assert.equal(r.w, 100, "the visible width matches the destination aspect");
  assert.equal(r.x, 150, "a centred horizontal crop");
  assert.equal(r.y, 0);
}
{
  // Tall source into a wide box: the top and bottom are cropped, biased high.
  const r = coverSourceRect(200, 400, 200, 100, 0.5, 0.12);
  assert.equal(r.w, 200, "full source width is shown");
  assert.equal(r.h, 100, "the visible height matches the destination aspect");
  assert.equal(r.x, 0);
  assert.ok(
    Math.abs(r.y - 36) < 0.001,
    `object-position 12% biases the crop toward the top, got ${r.y}`,
  );
}
{
  // Matching aspects crop nothing.
  const r = coverSourceRect(300, 600, 100, 200);
  assert.deepEqual(r, { x: 0, y: 0, w: 300, h: 600 });
}
{
  // Degenerate input must not produce NaN geometry — a NaN source rect silently
  // draws nothing, which looks exactly like the effect being switched off.
  const r = coverSourceRect(0, 0, 100, 200);
  assert.deepEqual(r, { x: 0, y: 0, w: 0, h: 0 });
}

console.log("glitch-source: ok");
