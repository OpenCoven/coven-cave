/**
 * foil/browser — material-aware foil for a dropped image, entirely client-side.
 *
 * Produces the plate the card's CSS consumes as `--holo-tex`. Runs on canvas so
 * the summoning preview updates instantly with no server round-trip; the maths
 * in `plate.ts` is shared verbatim with the server path.
 *
 * The plate is masked by the artwork's own materials, so foil lands on things
 * that would actually reflect and matte fabric stays dead. Because the mask
 * physically prevents spill onto the rest of the image, the effect can be run
 * much hotter than a full-bleed plate.
 */

import { renderPlate, type TemplateName } from "./plate";

/** Fraction of the frame foil should occupy. Coverage is TARGETED rather than
 *  thresholded at a fixed luminance: a constant tuned on one image is
 *  meaningless on the next, and targeting keeps a whole roster consistent
 *  regardless of how each portrait was exposed. */
const TARGET_COVERAGE = 0.06;

/** Below this median border luminance the backdrop counts as dark. */
const DARK_BACKDROP = 60;

export type MaskStrategy = {
  /** Median luminance of the frame border — what the backdrop actually is. */
  backdrop: number;
  /** Solved luminance cut for the target coverage. */
  threshold: number;
  /** Whether a local-texture gate was applied. */
  textureGate: boolean;
};

function luminanceOf(data: Uint8ClampedArray, i: number): number {
  return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
}

/**
 * Extract a specular mask: where is this image made of something reflective?
 *
 * Two cues, and which ones apply is decided from the image rather than fixed:
 *
 *  · Brightness always. The cut is solved from the histogram to hit
 *    TARGET_COVERAGE, so it adapts to exposure.
 *  · Local texture ONLY when the backdrop is bright. A bright backdrop passes a
 *    luminance test and leaks foil into empty space, and a studio backdrop is
 *    smooth where worked metal is not. But on a DARK backdrop the same gate is
 *    actively harmful — polished chrome is smooth and patterned fabric is not,
 *    so it would reject the metal and foil the cloth.
 */
export function extractSpecularMask(
  img: ImageData,
): { mask: Uint8ClampedArray; strategy: MaskStrategy } {
  const { width: W, height: H, data } = img;
  const lum = new Float32Array(W * H);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) lum[p] = luminanceOf(data, i);

  // Backdrop = median luminance around the frame edge.
  const border: number[] = [];
  const band = Math.max(2, Math.round(Math.min(W, H) * 0.04));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (x < band || y < band || x >= W - band || y >= H - band) border.push(lum[y * W + x]);
    }
  }
  border.sort((a, b) => a - b);
  const backdrop = border[border.length >> 1] ?? 0;
  const textureGate = backdrop >= DARK_BACKDROP;

  // Solve the threshold for the target share of the frame.
  const hist = new Uint32Array(256);
  for (let p = 0; p < lum.length; p++) hist[Math.min(255, Math.max(0, Math.round(lum[p])))]++;
  let acc = 0;
  let threshold = 255;
  for (let v = 255; v >= 0; v--) {
    acc += hist[v];
    if (acc / lum.length >= TARGET_COVERAGE) { threshold = v; break; }
  }

  const span = Math.max(12, 255 - threshold);
  const mask = new Uint8ClampedArray(W * H);
  for (let p = 0; p < lum.length; p++) {
    const v = lum[p];
    mask[p] = v < threshold ? 0 : Math.min(255, Math.round(Math.pow((v - threshold) / span, 0.66) * 255));
  }

  if (textureGate) {
    const R = 3;
    const gate = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let sum = 0, sum2 = 0, n = 0;
        for (let dy = -R; dy <= R; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= H) continue;
          for (let dx = -R; dx <= R; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= W) continue;
            const v = lum[yy * W + xx];
            sum += v; sum2 += v * v; n++;
          }
        }
        const mean = sum / n;
        gate[y * W + x] = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
      }
    }
    for (let p = 0; p < mask.length; p++) {
      mask[p] = Math.round(mask[p] * Math.min(1, gate[p] / 7.5));
    }
  }

  return { mask, strategy: { backdrop: Math.round(backdrop), threshold, textureGate } };
}

/** Separable box blur — cheap, and adequate for softening a mask. */
function blur(src: Uint8ClampedArray, W: number, H: number, radius: number): Uint8ClampedArray {
  if (radius < 1) return src;
  const tmp = new Float32Array(W * H);
  const out = new Uint8ClampedArray(W * H);
  const span = radius * 2 + 1;
  for (let y = 0; y < H; y++) {
    let acc = 0;
    for (let x = -radius; x <= radius; x++) acc += src[y * W + Math.min(W - 1, Math.max(0, x))];
    for (let x = 0; x < W; x++) {
      tmp[y * W + x] = acc / span;
      acc -= src[y * W + Math.min(W - 1, Math.max(0, x - radius))];
      acc += src[y * W + Math.min(W - 1, Math.max(0, x + radius + 1))];
    }
  }
  for (let x = 0; x < W; x++) {
    let acc = 0;
    for (let y = -radius; y <= radius; y++) acc += tmp[Math.min(H - 1, Math.max(0, y)) * W + x];
    for (let y = 0; y < H; y++) {
      out[y * W + x] = acc / span;
      acc -= tmp[Math.min(H - 1, Math.max(0, y - radius)) * W + x];
      acc += tmp[Math.min(H - 1, Math.max(0, y + radius + 1)) * W + x];
    }
  }
  return out;
}

export type FoilPlateInput = {
  /** The dropped artwork, already drawn to a canvas at working size. */
  image: ImageData;
  /** Drives mark selection — pass the familiar's role/type words. */
  theme?: string;
  seed?: number | string;
  /** Higher is denser dots. */
  pitchScale?: number;
};

export type FoilPlateOutput = {
  /** `url(...)`-ready data URI for the card's `--holo-tex`. */
  dataUrl: string;
  coverage: number;
  strategy: MaskStrategy;
  /**
   * The specular mask this plate was cut from, one byte per source pixel.
   *
   * Returned rather than recomputed because a second consumer exists: the scry
   * glitch lifts its shards preferentially from the reflective regions
   * (`glitch-source.ts`). Handing back the mask keeps that a reuse of this
   * pipeline instead of a second, subtly different one — and `extractSpecularMask`
   * is the most expensive step here, so running it twice per drop is the one
   * cost worth avoiding.
   */
  mask: Uint8ClampedArray;
};

/**
 * Build the masked foil plate for a piece of artwork.
 *
 * The carrier is deliberately `full-bleed` + `flat`: under a mask the MASK must
 * supply the shape. A composed plate has empty regions of its own, which punch
 * holes in the masked subject and read as the foil being misaligned.
 */
export function buildFoilPlate(input: FoilPlateInput): FoilPlateOutput {
  const { width: W, height: H } = input.image;
  const { mask, strategy } = extractSpecularMask(input.image);

  const soft = blur(mask, W, H, 1);
  const halo = blur(mask, W, H, 9);

  const plate = renderPlate({
    width: W,
    height: H,
    theme: input.theme ?? "",
    seed: input.seed ?? 0,
    template: "full-bleed" as TemplateName,
    falloff: "flat",
    pitchScale: input.pitchScale ?? 0.9,
    markCount: 1,
  });

  const out = new Uint8ClampedArray(W * H * 4);
  let lit = 0;
  for (let p = 0; p < W * H; p++) {
    const m = soft[p] / 255;
    // Dots carry the effect. The sheen is only a floor so metal still reads as
    // lit between dots — too much and the subject becomes a plain bright shape
    // and the halftone character is lost.
    const dots = (plate.data[p] / 255) * m;
    const sheen = m * 0.13;
    const bleed = (halo[p] / 255) * m * 0.12;
    const v = Math.min(1, (dots + sheen + bleed) * 1.55);
    const b = Math.round(v * 255);
    const i = p * 4;
    out[i] = b; out[i + 1] = b; out[i + 2] = b; out[i + 3] = 255;
    if (b > 24) lit++;
  }

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");
  ctx.putImageData(new ImageData(out, W, H), 0, 0);

  return {
    dataUrl: canvas.toDataURL("image/png"),
    coverage: lit / (W * H),
    strategy,
    mask,
  };
}

/**
 * Dominant chromatic hue of an image, as a hex accent.
 *
 * Deterministic and pixel-derived on purpose: asking a model to name a colour
 * is slower, costs a round-trip, and is less accurate than reading the pixels.
 * Near-black and near-neutral samples are dropped so a dark costume or chrome
 * doesn't dominate the vote.
 */
export function extractAura(img: ImageData, fallback: string): string {
  const { data } = img;
  const bins = new Map<number, { n: number; h: number; s: number; l: number }>();

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    const l = (mx + mn) / 2;
    if (l < 0.16 || l > 0.94) continue;
    const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    if (s < 0.1) continue;
    let h = 0;
    if (d) {
      if (mx === r) h = ((g - b) / d) % 6;
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
    }
    h = (h * 60 + 360) % 360;
    const key = Math.round(h / 12) * 12;
    const e = bins.get(key) ?? { n: 0, h: 0, s: 0, l: 0 };
    e.n++; e.h += h; e.s += s; e.l += l;
    bins.set(key, e);
  }

  const top = [...bins.values()].sort((a, b) => b.n - a.n)[0];
  if (!top) return fallback;

  const h = top.h / top.n;
  // Lift toward a usable accent: source art is often muted, and a card accent
  // has to carry on a dark ground without becoming a different colour.
  const s = Math.min(0.66, Math.max(0.34, (top.s / top.n) * 1.5));
  const l = Math.min(0.62, Math.max(0.46, (top.l / top.n) * 1.35));

  const a = s * Math.min(l, 1 - l);
  const ch = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return `#${[ch(0), ch(8), ch(4)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}
