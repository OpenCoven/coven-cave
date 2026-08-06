"use client";

/**
 * ScryGlitch — the likeness coming apart while it is being read (cave-3rz.3).
 *
 * The scry costs 12-18 s, and what fills that time is not a spinner and not a
 * shower of accent-coloured motes: it is THE IMAGE ITSELF destabilising. Every
 * torn slice and every shard in flight is drawn out of the dropped artwork's own
 * pixels, so what you see is displaced image data rather than decoration parked
 * next to a picture. That single fact is most of the effect — a particle
 * carrying its source colour reads as the image coming apart; the same particle
 * in a theme accent reads as a loading animation.
 *
 * Three layers, one canvas:
 *
 *  1. **Tearing.** Horizontal slices of the card's own artwork, displaced
 *     sideways and split into RGB channels, drawn back over the card.
 *  2. **Shards.** Rectangles and thin slices lifted from the artwork at mixed
 *     scales — single pixels, 8-18px blocks, wide 1-3px slivers — travelling to
 *     the field slots on the right in stepped, snapping motion. Their red and
 *     blue run a pixel or two either side of their green while they are
 *     unstable, and converge as each one settles.
 *  3. **The finalise.** One decisive chromatic snap on completion, then crisp
 *     and still. A shutter closing, not an animation fading out.
 *
 * **Destabilising and stabilising at once.** Two independent mechanisms, on
 * purpose. Globally, turbulence is driven by the REAL stage the scry reports
 * (`picking` → … → `done`), so the picture calms because the harness is actually
 * getting somewhere — not because a timer said so. Locally, every shard carries
 * its own settle point, so at any moment some are still tearing while others
 * have already snapped back together. Uniform chaos that uniformly decays reads
 * as one effect fading; this reads as an image resolving.
 *
 * **What stays crisp, always.** The name and the stat plate. Their live DOM
 * rects are punched out of the canvas clip, so nothing this file draws can land
 * on them at any turbulence — a geometric guarantee rather than a tuning choice.
 *
 * **Cost, measured.** `getImageData` happens ONCE per drop, in the pass that
 * already rasterises the foil plate, and the channel split runs off a 256px
 * buffer rather than the source. Per frame this is a few hundred `drawImage`
 * calls of small rects and no pixel readback at all: **0.6 ms median, 1.0 ms
 * p95** at devicePixelRatio 1 and **1.0-1.1 ms median, 2.2-2.4 ms p95** at
 * devicePixelRatio 2, timed inside the rAF callback across the highest-
 * turbulence six seconds of a real scry.
 *
 * That was never the interesting number. The cost that mattered was
 * COMPOSITING — a full-viewport canvas repainting over the card's two
 * blend-mode layers halved the page's frame rate at 2x, at no extra JS cost at
 * all. The fix is a pair of CSS declarations, and the note on `.scry-glitch` in
 * `familiar-rite.css` carries the measurements; do not remove either half.
 *
 * `prefers-reduced-motion: reduce` drops the whole thing: datamoshing is a
 * strong vestibular trigger, and there is no reduced version of it worth
 * shipping. Nothing here is load-bearing for meaning — the stage rail and the
 * slots carry that, and they are unaffected.
 */

import { useEffect, useRef } from "react";

import { coverSourceRect, type GlitchSource } from "@/lib/glitch-source";
import type { ScryStage } from "@/lib/scry-stream";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";

/**
 * How unstable the picture is at each stage the endpoint can prove it reached.
 *
 * Monotonic, and it reaches zero only at `done`. The point is that the image
 * looks like it is RESOLVING rather than degrading, which needs the calming to
 * be tied to real progress; a decay curve on a timer would drift away from a
 * slow harness and start calming while nothing had happened.
 */
const STAGE_TURBULENCE: Record<ScryStage, number> = {
  picking: 1,
  harness: 0.84,
  staged: 0.66,
  looking: 0.44,
  speaking: 0.2,
  done: 0,
};

/** How fast turbulence chases its stage target. Slow enough that a stage change
 *  reads as a settling rather than a step. */
const TURBULENCE_EASE = 2.4;

/** Shards per second, at rest and at full turbulence. */
const EMIT_MIN = 9;
const EMIT_MAX = 34;
const MAX_SHARDS = 150;

/** Seconds in flight. Slow enough to follow one shard across with the eye. */
const TRAVEL_MIN = 1;
const TRAVEL_MAX = 1.8;

/** Tear bands at full turbulence. Sparse on purpose: the brief is that some
 *  regions tear while others are ALREADY crisp, and that only reads if most of
 *  the card is untorn at any given moment. */
const MAX_BANDS = 7;
const BAND_LIFE_MIN_MS = 70;
const BAND_LIFE_MAX_MS = 260;

/** The finalise. Short, because a shutter is short. */
const FINALE_MS = 320;
/** Channel separation at the peak of the snap, in CSS px. */
const FINALE_ABERRATION = 8;
/** The last convulsion rides the opening fifth of it, then stops dead. */
const FINALE_TEAR_FRACTION = 0.2;

/** The SLOTS are re-measured on this cadence as well as on resize — the rite's
 *  right column changes height when a step swaps, and no resize event fires.
 *
 *  The CARD is not on this cadence. `.rite__stage` runs a permanent float
 *  animation, so its rect moves every single frame; measuring it at 250 ms left
 *  the tear up to 8 px off the artwork underneath it AND let ink land on the
 *  name plate the clip is supposed to protect (measured: peak alpha 177/255
 *  over the name and stat plate before this was per-frame, 0 after). Four
 *  `getBoundingClientRect` calls a frame share one layout flush and are cheap;
 *  a tear that does not line up with the picture is the whole effect failing. */
const REMEASURE_SLOTS_MS = 250;

/**
 * How far outside a must-stay-legible rect the punch-out extends, in CSS px.
 *
 * The clip edge is antialiased, so a hole cut exactly on the text box leaves a
 * one-pixel fringe of glitch lying along it (measured: a full-width row at
 * alpha 60-180 on the top of the stat plate and the bottom of the name row).
 * Two pixels of margin puts that fringe outside the text entirely.
 */
const QUIET_PAD = 2;

type Rect = { x: number; y: number; w: number; h: number };

type ShardKind = "pixel" | "block" | "slice";

type Shard = {
  /** Where in the source buffer this shard was lifted from. */
  sx: number; sy: number; sw: number; sh: number;
  /** Drawn size, in CSS px. */
  dw: number; dh: number;
  x0: number; y0: number;
  cx: number; cy: number;
  x1: number; y1: number;
  t: number;
  rate: number;
  /** Past this point on its journey the shard is crisp and stops jumping. */
  settle: number;
  sep: number;
  jumpX: number;
  jumpY: number;
  jumpUntil: number;
  kind: ShardKind;
};

type Band = {
  /** Card-local top edge and height, in CSS px. */
  y: number; h: number;
  dx: number;
  sep: number;
  until: number;
};

export type ScryGlitchProps = {
  /** The scry's own lifecycle. `scrying` emits; `done` fires the finalise. */
  status: "idle" | "scrying" | "done" | "failed";
  /** The stage the endpoint last reported reaching. Drives the calming. */
  stage: ScryStage | null;
  /** The artwork, reduced at drop. Nothing draws until this exists. */
  source: GlitchSource | null;
  /** The card's artwork element — what tears, and what shards lift off. */
  artSelector: string;
  /** Regions that must stay legible. Punched out of the clip, every frame. */
  quietSelector: string;
  /** Elements shards land in. Any carrying `data-scry-landed="true"` is skipped. */
  targetSelector: string;
};

function rectWithin(el: Element, origin: DOMRect): Rect {
  const r = el.getBoundingClientRect();
  return { x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height };
}

/**
 * The vertical span of the card that is allowed to come apart.
 *
 * Everything between the lowest legible rect above the card's middle and the
 * highest one below it. Two things fall out of this at once: the name and the
 * stat plate are never touched, and the tear is confined to the band where the
 * card's scrim is transparent — so a slice redrawn from the source artwork is
 * the same brightness as the untouched pixels either side of it, instead of a
 * conspicuously bright rectangle sitting on a darkened corner.
 */
function tearableBand(art: Rect, quiet: Rect[]): Rect {
  const middle = art.y + art.h / 2;
  let top = art.y;
  let bottom = art.y + art.h;
  for (const q of quiet) {
    if (q.x > art.x + art.w || q.x + q.w < art.x) continue;
    const centre = q.y + q.h / 2;
    if (centre < middle) top = Math.max(top, q.y + q.h);
    else bottom = Math.min(bottom, q.y);
  }
  return { x: art.x, y: top, w: art.w, h: Math.max(0, bottom - top) };
}

/** A point inside a rect, biased away from the very edge. */
function pointIn(rect: Rect, inset = 0.12): { x: number; y: number } {
  const fx = inset + Math.random() * (1 - inset * 2);
  const fy = inset + Math.random() * (1 - inset * 2);
  return { x: rect.x + rect.w * fx, y: rect.y + rect.h * fy };
}

/**
 * Four plates: the artwork whole, then its red, green and blue on their own.
 *
 * Separation is done by DRAWING the same patch three times with `lighter` rather
 * than by shifting bytes per frame — at a third of the wanted alpha each, the
 * three sum back to the exact source colour when the offsets are zero and to a
 * chromatic fringe when they are not. That is what lets this run at a few
 * hundred draws a frame without touching a pixel buffer.
 *
 * The whole plate exists so the common case is not paying for that. Most shards
 * are past their settle point at any moment, and a shard with no separation is
 * one `source-over` draw instead of three additive ones. It carries the same
 * colours: `lighter` at a third alpha and `source-over` at full alpha resolve to
 * the identical RGB, so nothing about the effect changes with the fast path.
 */
type Plates = { whole: HTMLCanvasElement; channels: HTMLCanvasElement[] };

function buildPlates(source: GlitchSource): Plates {
  const { width: W, height: H, rgba } = source;
  // The buffer type is spelled out: `ImageData` refuses a view over a
  // `SharedArrayBuffer`, and an unparameterised `Uint8ClampedArray` might be one.
  const toCanvas = (data: Uint8ClampedArray<ArrayBuffer>) => {
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.putImageData(new ImageData(data, W, H), 0, 0);
    return canvas;
  };
  const whole = new Uint8ClampedArray(W * H * 4);
  whole.set(rgba);
  return {
    whole: toCanvas(whole),
    channels: [0, 1, 2].map((channel) => {
      const plate = new Uint8ClampedArray(W * H * 4);
      for (let p = 0; p < W * H; p++) {
        const i = p * 4;
        plate[i + channel] = rgba[i + channel];
        plate[i + 3] = 255;
      }
      return toCanvas(plate);
    }),
  };
}

export function ScryGlitch({
  status, stage, source, artSelector, quietSelector, targetSelector,
}: ScryGlitchProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const reduced = usePrefersReducedMotion();

  // Read through refs so the long-lived loop never restarts mid-flight.
  const statusRef = useRef(status);
  statusRef.current = status;
  const stageRef = useRef(stage);
  stageRef.current = stage;
  const sourceRef = useRef<GlitchSource | null>(source);
  const platesRef = useRef<Plates | null>(null);
  /** `performance.now()` at the moment the shutter started, or 0. */
  const finaleRef = useRef(0);
  // The loop parks itself once the last shard lands; this restarts it.
  const kickRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    sourceRef.current = source;
    platesRef.current = source && !reduced ? buildPlates(source) : null;
    return () => { platesRef.current = null; };
  }, [reduced, source]);

  // The finalise is a TRANSITION, not a state: it fires when a scry that was
  // actually in flight lands, and never on a remount that happens to be `done`.
  const prevStatus = useRef(status);
  useEffect(() => {
    const was = prevStatus.current;
    prevStatus.current = status;
    if (status === "scrying") {
      finaleRef.current = 0;
      kickRef.current?.();
      return;
    }
    if (status === "done" && was === "scrying") {
      finaleRef.current = performance.now();
      kickRef.current?.();
    }
  }, [status]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    if (!canvas || !host || reduced) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let frame = 0;
    let running = true;
    const shards: Shard[] = [];
    const bands: Band[] = [];
    let emitAcc = 0;
    let nextSlot = 0;
    let pickCursor = 0;
    let art: Rect | null = null;
    /** The part of the card that may tear: the artwork between the name row and
     *  the stat plate. Also exactly the band the card's scrim leaves alone, so a
     *  slice redrawn here matches the brightness of the pixels beside it. */
    let tear: Rect | null = null;
    let quiet: Rect[] = [];
    let targets: Rect[] = [];
    let hostSize = { w: 0, h: 0 };
    let lastMeasure = 0;
    let turbulence = 1;

    const dpr = () => Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      const r = host.getBoundingClientRect();
      hostSize = { w: r.width, h: r.height };
      canvas.width = Math.max(1, Math.round(r.width * dpr()));
      canvas.height = Math.max(1, Math.round(r.height * dpr()));
      ctx.setTransform(dpr(), 0, 0, dpr(), 0, 0);
    };

    /** The card and the regions that must stay legible. Every frame: the card
     *  is mid-float and eight pixels of drift is the difference between a tear
     *  and an overlay. */
    const measureCard = () => {
      const origin = host.getBoundingClientRect();
      hostSize = { w: origin.width, h: origin.height };
      const artEl = document.querySelector(artSelector);
      art = artEl ? rectWithin(artEl, origin) : null;
      quiet = [...document.querySelectorAll(quietSelector)].map((el) => {
        const r = rectWithin(el, origin);
        return {
          x: r.x - QUIET_PAD, y: r.y - QUIET_PAD,
          w: r.w + QUIET_PAD * 2, h: r.h + QUIET_PAD * 2,
        };
      });
      tear = art ? tearableBand(art, quiet) : null;
      return origin;
    };

    /** Where shards are headed. A slot that has its value is no longer a
     *  target, so the traffic always shows what is still outstanding. */
    const measureSlots = (origin: DOMRect) => {
      targets = [...document.querySelectorAll(targetSelector)]
        .filter((el) => el.getAttribute("data-scry-landed") !== "true")
        .map((el) => rectWithin(el, origin));
    };

    const measure = () => measureSlots(measureCard());

    /** Everything except the regions that must stay readable. Applied to the
     *  whole frame, so legibility is not something a layer can opt out of. */
    const clipToLegible = () => {
      ctx.beginPath();
      ctx.rect(0, 0, hostSize.w, hostSize.h);
      for (const q of quiet) ctx.rect(q.x, q.y, q.w, q.h);
      ctx.clip("evenodd");
    };

    /** Which part of the source buffer the card is actually showing. The card
     *  crops its artwork, and a tear drawn from the uncropped frame would not
     *  line up with the pixels underneath it. */
    const coverOf = (src: GlitchSource, rect: Rect) =>
      coverSourceRect(src.width, src.height, rect.w, rect.h, 0.5, 0.12);

    /**
     * Draw a patch of the artwork, optionally with its channels pulled apart.
     *
     * `sep` below the threshold reconstructs the source colour exactly (see
     * `buildPlates`), so callers never branch on whether a given thing is
     * currently glitching.
     */
    const blit = (
      sx: number, sy: number, sw: number, sh: number,
      dx: number, dy: number, dw: number, dh: number,
      alpha: number, sep: number,
    ) => {
      const plates = platesRef.current;
      if (!plates) return;
      if (sep < 0.35) {
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = alpha;
        ctx.drawImage(plates.whole, sx, sy, sw, sh, dx, dy, dw, dh);
        return;
      }
      const [r, g, b] = plates.channels;
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = alpha / 3;
      ctx.drawImage(r, sx, sy, sw, sh, dx - sep, dy - sep * 0.28, dw, dh);
      ctx.drawImage(g, sx, sy, sw, sh, dx, dy, dw, dh);
      ctx.drawImage(b, sx, sy, sw, sh, dx + sep, dy + sep * 0.28, dw, dh);
    };

    const rollBand = (now: number, rect: Rect): Band => {
      const slab = Math.random() < 0.22;
      const h = slab ? 16 + Math.random() * 30 : 2 + Math.random() * 9;
      const reach = slab ? 18 : 38;
      return {
        y: Math.random() * Math.max(1, rect.h - h),
        h,
        dx: (Math.random() - 0.5) * 2 * reach * turbulence,
        sep: turbulence * (1 + Math.random() * 3),
        until: now + BAND_LIFE_MIN_MS + Math.random() * (BAND_LIFE_MAX_MS - BAND_LIFE_MIN_MS),
      };
    };

    /**
     * Tear the card.
     *
     * A band draws a full-width slice of the artwork displaced sideways. The
     * untouched card shows through the sliver it vacates, which is what makes it
     * read as displaced data rather than as an overlay. Bands are re-rolled on
     * expiry rather than animated, because datamosh SNAPS — a slice that slid
     * smoothly would read as a wave, not as corruption.
     */
    const drawBands = (now: number, src: GlitchSource, artRect: Rect, band: Rect) => {
      const want = Math.round(turbulence * MAX_BANDS);
      while (bands.length > want) bands.pop();
      while (bands.length < want) bands.push(rollBand(now, band));
      for (const b of bands) {
        if (now > b.until) Object.assign(b, rollBand(now, band));
      }
      if (!bands.length) return;

      ctx.save();
      ctx.beginPath();
      ctx.rect(band.x, band.y, band.w, band.h);
      ctx.clip();
      for (const b of bands) {
        const rows = sourceRows(src, artRect, band.y + b.y, b.h);
        blit(
          rows.sx, rows.sy, rows.sw, rows.sh,
          artRect.x + b.dx, band.y + b.y, artRect.w, b.h,
          0.94, b.sep,
        );
      }
      ctx.restore();
    };

    /** The rows of the source buffer showing at a given band of the card. All
     *  source mapping goes through the FULL artwork rect, because that is what
     *  the card's `object-fit: cover` crop is computed against. */
    const sourceRows = (src: GlitchSource, artRect: Rect, y: number, h: number) => {
      const cover = coverOf(src, artRect);
      return {
        sx: cover.x,
        sy: cover.y + ((y - artRect.y) / artRect.h) * cover.h,
        sw: cover.w,
        sh: Math.max(0.5, (h / artRect.h) * cover.h),
      };
    };

    /** Lift a shard off a specular-weighted point of the artwork that the card
     *  is actually showing, and aim it at a slot still waiting for a value. */
    const spawn = (src: GlitchSource, rect: Rect) => {
      if (targets.length === 0 || shards.length >= MAX_SHARDS) return;
      const cover = coverOf(src, rect);
      if (cover.w <= 0 || cover.h <= 0) return;
      const total = src.picks.length / 2;

      let px = 0;
      let py = 0;
      let found = false;
      for (let attempt = 0; attempt < 12 && !found; attempt++) {
        const i = (pickCursor++ % total) * 2;
        px = src.picks[i];
        py = src.picks[i + 1];
        found =
          px >= cover.x && px < cover.x + cover.w &&
          py >= cover.y && py < cover.y + cover.h;
      }
      if (!found) {
        px = Math.floor(cover.x + Math.random() * cover.w);
        py = Math.floor(cover.y + Math.random() * cover.h);
      }

      const roll = Math.random();
      const kind: ShardKind = roll < 0.35 ? "pixel" : roll < 0.75 ? "block" : "slice";
      let sw: number;
      let sh: number;
      let dw: number;
      let dh: number;
      if (kind === "pixel") {
        sw = 1; sh = 1;
        dw = 2 + Math.random() * 2;
        dh = dw;
      } else if (kind === "block") {
        sw = 2 + Math.floor(Math.random() * 4);
        sh = 2 + Math.floor(Math.random() * 4);
        dw = 8 + Math.random() * 10;
        dh = dw * (sh / sw);
      } else {
        sw = 8 + Math.floor(Math.random() * 20);
        sh = 1;
        dw = 34 + Math.random() * 66;
        dh = 1 + Math.random() * 2;
      }
      sw = Math.min(sw, src.width - px);
      sh = Math.min(sh, src.height - py);
      if (sw < 1 || sh < 1) return;

      const from = {
        x: rect.x + ((px - cover.x) / cover.w) * rect.w,
        y: rect.y + ((py - cover.y) / cover.h) * rect.h,
      };
      const slot = nextSlot % targets.length;
      nextSlot += 1;
      const to = pointIn(targets[slot], 0.2);
      // Arc upward and forward: a straight line reads as a progress bar, a bowed
      // path reads as something lifting free of the picture.
      const lift = 20 + Math.random() * 66;
      shards.push({
        sx: px, sy: py, sw, sh, dw, dh,
        x0: from.x, y0: from.y,
        cx: (from.x + to.x) / 2 + (Math.random() - 0.5) * 40,
        cy: Math.min(from.y, to.y) - lift,
        x1: to.x, y1: to.y,
        t: 0,
        rate: 1 / (TRAVEL_MIN + Math.random() * (TRAVEL_MAX - TRAVEL_MIN)),
        // Every shard resolves at its own point on the journey. This is the
        // local half of "destabilising and stabilising at the same time".
        settle: 0.3 + Math.random() * 0.55,
        sep: 1.2 + Math.random() * 2.6,
        jumpX: 0, jumpY: 0, jumpUntil: 0,
        kind,
      });
    };

    const drawShards = (now: number, dt: number) => {
      for (let i = shards.length - 1; i >= 0; i -= 1) {
        const m = shards[i];
        m.t += dt * m.rate;
        if (m.t >= 1) {
          shards.splice(i, 1);
          continue;
        }
        const u = 1 - m.t;
        let x = u * u * m.x0 + 2 * u * m.t * m.cx + m.t * m.t * m.x1;
        let y = u * u * m.y0 + 2 * u * m.t * m.cy + m.t * m.t * m.y1;

        const unstable = m.t < m.settle;
        const local = unstable ? 1 - m.t / m.settle : 0;
        const heat = turbulence * local;

        if (unstable && Math.random() < dt * (0.8 + turbulence * 5)) {
          m.jumpX = (Math.random() - 0.5) * 70 * heat;
          m.jumpY = (Math.random() - 0.5) * 18 * heat;
          m.jumpUntil = now + 40 + Math.random() * 110;
        }
        if (now < m.jumpUntil) { x += m.jumpX; y += m.jumpY; }

        // Stepped travel. Corrupted data moves in blocks; smooth motion is the
        // one thing that would give this away as an ordinary particle system.
        const q = 1 + heat * 6;
        x = Math.round(x / q) * q;
        y = Math.round(y / q) * q;

        // Fade in off the artwork, brighten, then wink out on arrival.
        const life = Math.sin(Math.PI * m.t) ** 0.7;
        blit(
          m.sx, m.sy, m.sw, m.sh,
          x - m.dw / 2, y - m.dh / 2, m.dw, m.dh,
          Math.min(1, life * 1.3) * 0.92,
          // A single-pixel shard is 2-4px on screen; a pixel of channel offset
          // on it is invisible and costs three draws instead of one.
          m.kind === "pixel" ? 0 : m.sep * heat,
        );
      }
    };

    /**
     * The shutter.
     *
     * Not a fade. The whole artwork is REPLACED by a channel-displaced copy of
     * itself on the first frame, and both the displacement and the copy's own
     * opacity collapse on hard curves — so what you see is the picture snapping
     * back into register and locking, not an effect being switched off. The last
     * few tears ride the opening fifth and then stop dead.
     *
     * A replacement rather than added fringes because added fringes over a flat
     * region are just a colour wash: real aberration cancels to the source
     * colour wherever the image is even, and shows only on edges. Drawing all
     * three plates at a third alpha each is exactly that (see
     * `buildPlates`), for the same three draw calls.
     */
    const drawFinale = (now: number, src: GlitchSource, artRect: Rect, band: Rect) => {
      const p = (now - finaleRef.current) / FINALE_MS;
      if (p >= 1) return;
      const ab = Math.pow(1 - p, 2.6) * FINALE_ABERRATION;

      ctx.save();
      ctx.beginPath();
      ctx.rect(band.x, band.y, band.w, band.h);
      ctx.clip();

      if (p < FINALE_TEAR_FRACTION) {
        for (const b of bands) {
          const rows = sourceRows(src, artRect, band.y + b.y, b.h);
          blit(
            rows.sx, rows.sy, rows.sw, rows.sh,
            artRect.x + b.dx, band.y + b.y, artRect.w, b.h,
            0.9 * (1 - p / FINALE_TEAR_FRACTION), b.sep,
          );
        }
      }

      const rows = sourceRows(src, artRect, band.y, band.h);
      blit(
        rows.sx, rows.sy, rows.sw, rows.sh,
        artRect.x, band.y, artRect.w, band.h,
        Math.pow(1 - p, 1.4), ab,
      );
      ctx.restore();
    };

    let last = performance.now();
    const draw = (now: number) => {
      if (!running) return;
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const origin = measureCard();
      if (now - lastMeasure > REMEASURE_SLOTS_MS) {
        lastMeasure = now;
        measureSlots(origin);
      }

      const src = sourceRef.current;
      const emitting = statusRef.current === "scrying";
      const finalising = finaleRef.current > 0 && now - finaleRef.current < FINALE_MS;

      const target = emitting ? STAGE_TURBULENCE[stageRef.current ?? "picking"] : 0;
      turbulence += (target - turbulence) * Math.min(1, dt * TURBULENCE_EASE);
      if (turbulence < 0.01) turbulence = 0;

      ctx.setTransform(dpr(), 0, 0, dpr(), 0, 0);
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
      ctx.clearRect(0, 0, hostSize.w, hostSize.h);

      if (src && (emitting || shards.length || finalising)) {
        ctx.save();
        clipToLegible();

        if (emitting && art && tear) {
          emitAcc += dt * (EMIT_MIN + turbulence * (EMIT_MAX - EMIT_MIN));
          while (emitAcc >= 1) {
            emitAcc -= 1;
            spawn(src, art);
          }
          drawBands(now, src, art, tear);
        } else {
          emitAcc = 0;
        }

        if (finalising) {
          // The shutter closes on a still picture, so nothing survives it.
          shards.length = 0;
          if (art && tear) drawFinale(now, src, art, tear);
        } else {
          drawShards(now, dt);
        }

        ctx.restore();
      }

      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;

      // Keep drawing until the last shard has landed and the shutter has shut,
      // so the stream drains instead of vanishing at the moment of arrival.
      if (emitting || shards.length > 0 || finalising) {
        frame = requestAnimationFrame(draw);
      } else {
        bands.length = 0;
        ctx.clearRect(0, 0, hostSize.w, hostSize.h);
        running = false;
      }
    };

    const kick = () => {
      if (running) return;
      running = true;
      last = performance.now();
      frame = requestAnimationFrame(draw);
    };
    kickRef.current = kick;

    resize();
    measure();
    frame = requestAnimationFrame(draw);
    const observer = new ResizeObserver(() => {
      resize();
      measure();
    });
    observer.observe(host);
    window.addEventListener("scroll", measure, { passive: true });

    return () => {
      running = false;
      kickRef.current = null;
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("scroll", measure);
    };
    // The effect owns a long-lived loop; status, stage and the source are read
    // through refs so none of them ever restarts the animation mid-flight.
  }, [artSelector, quietSelector, reduced, targetSelector]);

  return <canvas ref={canvasRef} className="scry-glitch" aria-hidden />;
}
