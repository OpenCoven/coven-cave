/**
 * glitch-source — the artwork, reduced to something a glitch can be made of
 * (cave-3rz.3).
 *
 * The scry animation is not decoration drawn beside the likeness: it is the
 * likeness coming apart. That only reads if every torn slice and every shard in
 * flight carries the ACTUAL pixels it was lifted from, so this module turns the
 * dropped image into a small buffer the canvas can `drawImage` out of at speed.
 *
 * Three properties are load-bearing:
 *
 *  1. **It is built once, at drop.** `getImageData` is the expensive call and it
 *     happens exactly once per file, inside the same pass that already rasterises
 *     the foil plate (`use-conjured-card.ts`). Nothing here runs per frame.
 *  2. **It is small.** 128px wide. Channel separation means drawing the same
 *     patch three times, so the buffer it comes out of has to be cheap to blit;
 *     a 128px grid is far more detail than a 4-16px shard ever shows, and three
 *     tinted copies of it cost ~200KB of VRAM rather than ~3MB.
 *  3. **It is biased toward the foil's own specular mask.** `extractSpecularMask`
 *     already decides which parts of this image are made of something reflective.
 *     Lifting shards preferentially from there means the destabilising picks up
 *     the same highlights the foil does, instead of scattering uniformly over
 *     flat background. The bias is a weighting, not a filter — the whole frame
 *     still contributes, or a dark portrait would only ever shed its catchlights.
 *
 * Pure and DOM-free on purpose: the sampler is the part that can be wrong in a
 * way you cannot see, so it is tested directly (`glitch-source.test.ts`) rather
 * than eyeballed through a canvas.
 */

/**
 * Working width of the glitch buffer. See note 2 above.
 *
 * 256 rather than something smaller because a torn slice is drawn at CARD width:
 * below this the tear stops looking like displaced image data and starts looking
 * like a blurred rectangle, which is the failure this whole effect exists to
 * avoid. Three tinted copies at this size cost about 1.1 MB.
 */
export const GLITCH_WIDTH = 256;

/** How many pre-drawn sample coordinates to carry. One shard consumes one pick
 *  per spawn; at ~30 spawns/second a scry never exhausts the ring. */
export const PICK_COUNT = 1024;

/**
 * How much more likely a fully specular pixel is to be lifted than a matte one.
 *
 * Deliberately a factor and not a threshold. The mask targets ~6% coverage, so
 * a filter would confine every shard to a handful of highlights and the effect
 * would stop reading as "the image" at all.
 */
export const SPECULAR_BIAS = 7;

export type GlitchSource = {
  width: number;
  height: number;
  /** RGBA of the artwork, box-downscaled onto the glitch grid. */
  rgba: Uint8ClampedArray;
  /** The foil pipeline's specular mask, max-pooled onto the same grid. */
  spec: Uint8ClampedArray;
  /** Pre-drawn sample coordinates, packed as x,y pairs. */
  picks: Uint16Array;
  /** Share of the grid the mask calls specular at all. */
  specularArea: number;
  /** Share of `picks` that landed on a specular pixel. Recorded so the bias is
   *  a measured number rather than a claim in a comment. */
  specularShare: number;
};

export type GlitchSourceInput = {
  /** The artwork at foil working size (RGBA). */
  data: Uint8ClampedArray;
  width: number;
  height: number;
  /** `extractSpecularMask`'s output, one byte per pixel at the same size. */
  mask?: Uint8ClampedArray | null;
  /** Fixed so a given likeness always tears the same way. */
  seed?: number;
  targetWidth?: number;
  pickCount?: number;
};

/** Deterministic 32-bit LCG. A seeded sampler is a testable sampler. */
function rng(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** Anything at or above this counts as "the mask says specular here". */
const SPECULAR_FLOOR = 24;

/**
 * Reduce the artwork and its specular mask onto one small grid, then draw a ring
 * of specular-weighted sample coordinates from it.
 *
 * Colour is box-AVERAGED (a shard should carry the local colour, not whichever
 * pixel happened to land on the sample point) while the mask is MAX-POOLED (a
 * highlight one pixel wide still means "there is metal here", and averaging it
 * away is how a bias toward reflective regions quietly becomes no bias at all).
 */
export function buildGlitchSource(input: GlitchSourceInput): GlitchSource {
  const { data, width: srcW, height: srcH } = input;
  const targetWidth = Math.max(8, Math.min(input.targetWidth ?? GLITCH_WIDTH, srcW));
  const scale = targetWidth / srcW;
  const W = targetWidth;
  const H = Math.max(1, Math.round(srcH * scale));

  const rgba = new Uint8ClampedArray(W * H * 4);
  const spec = new Uint8ClampedArray(W * H);
  const mask = input.mask ?? null;

  for (let y = 0; y < H; y++) {
    const y0 = Math.floor((y * srcH) / H);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * srcH) / H));
    for (let x = 0; x < W; x++) {
      const x0 = Math.floor((x * srcW) / W);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * srcW) / W));
      let r = 0, g = 0, b = 0, n = 0, hottest = 0;
      for (let sy = y0; sy < y1 && sy < srcH; sy++) {
        for (let sx = x0; sx < x1 && sx < srcW; sx++) {
          const i = (sy * srcW + sx) * 4;
          r += data[i]; g += data[i + 1]; b += data[i + 2];
          n++;
          if (mask) {
            const m = mask[sy * srcW + sx];
            if (m > hottest) hottest = m;
          }
        }
      }
      const p = y * W + x;
      const o = p * 4;
      rgba[o] = n ? r / n : 0;
      rgba[o + 1] = n ? g / n : 0;
      rgba[o + 2] = n ? b / n : 0;
      rgba[o + 3] = 255;
      spec[p] = hottest;
    }
  }

  // Weighted draw. A cumulative table plus a binary search is O(log n) per pick
  // and builds in one pass, which matters because this runs on the drop frame
  // alongside the plate rasteriser.
  const total = W * H;
  const cumulative = new Float64Array(total);
  let acc = 0;
  let specularPixels = 0;
  for (let p = 0; p < total; p++) {
    const m = spec[p] / 255;
    if (spec[p] >= SPECULAR_FLOOR) specularPixels++;
    acc += 1 + Math.pow(m, 0.7) * SPECULAR_BIAS;
    cumulative[p] = acc;
  }

  const count = Math.max(1, input.pickCount ?? PICK_COUNT);
  const picks = new Uint16Array(count * 2);
  const next = rng(input.seed ?? 0x5c2b);
  let specularPicks = 0;
  for (let i = 0; i < count; i++) {
    const target = next() * acc;
    let lo = 0;
    let hi = total - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cumulative[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    picks[i * 2] = lo % W;
    picks[i * 2 + 1] = (lo / W) | 0;
    if (spec[lo] >= SPECULAR_FLOOR) specularPicks++;
  }

  return {
    width: W,
    height: H,
    rgba,
    spec,
    picks,
    specularArea: specularPixels / total,
    specularShare: specularPicks / count,
  };
}

/**
 * Which part of the source an `object-fit: cover` element actually shows.
 *
 * The card crops its artwork (`object-fit: cover; object-position: 50% 12%`), so
 * a torn slice drawn from the full frame would not line up with the pixels
 * underneath it and the tear would read as an unrelated overlay. This is the one
 * piece of geometry that decides whether the effect looks like the image coming
 * apart or like something drawn on top of it.
 */
export function coverSourceRect(
  srcW: number, srcH: number,
  dstW: number, dstH: number,
  posX = 0.5, posY = 0.12,
): { x: number; y: number; w: number; h: number } {
  if (srcW <= 0 || srcH <= 0 || dstW <= 0 || dstH <= 0) {
    return { x: 0, y: 0, w: srcW, h: srcH };
  }
  const srcAspect = srcW / srcH;
  const dstAspect = dstW / dstH;
  if (srcAspect > dstAspect) {
    // Source is wider: full height is shown, the sides are cropped.
    const w = srcH * dstAspect;
    return { x: (srcW - w) * posX, y: 0, w, h: srcH };
  }
  const h = srcW / dstAspect;
  return { x: 0, y: (srcH - h) * posY, w: srcW, h };
}
