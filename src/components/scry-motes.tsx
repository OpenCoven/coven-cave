"use client";

/**
 * ScryMotes — details being drawn out of the likeness (cave-3rz.3).
 *
 * One canvas, not dozens of animated DOM nodes: a scry emits ~15 motes a second
 * for up to twenty seconds, and that many elements each running their own
 * compositor animation is a measurable cost on a surface that is already
 * rasterising a foil plate.
 *
 * The metaphor is literal and directional. Motes lift off the artwork on the
 * LEFT and travel to the field slots on the RIGHT, so the eye is pointed at the
 * causal relationship — this picture is where those words are coming from —
 * rather than at a generic spinner parked somewhere neutral.
 *
 * Geometry is read from the DOM rather than passed as refs so the canvas stays
 * decoupled from the rite's layout: it finds its source and its targets by
 * selector, and a slot marks itself finished with `data-scry-landed`. Motes
 * stop being aimed at a slot the moment its value has arrived, so the traffic
 * always shows what is still outstanding.
 *
 * Nothing here is load-bearing for meaning. The stage rail and the slots carry
 * the information; this is ambient, which is exactly why
 * `prefers-reduced-motion: reduce` drops it entirely — the caller renders the
 * still fallback instead.
 */

import { useEffect, useRef } from "react";

/** Motes per second while a slot is still waiting. Enough to read as a stream,
 *  sparse enough that the artwork underneath stays legible. */
const EMIT_RATE = 15;
/** Seconds in flight. Slow enough to follow one mote across with the eye. */
const TRAVEL_MIN = 1.1;
const TRAVEL_MAX = 1.9;
const MAX_MOTES = 220;
/** Layout is re-measured on this cadence as well as on resize — the rite's
 *  right column changes height when a step swaps, and no resize event fires. */
const REMEASURE_MS = 250;
const FALLBACK_ACCENT = "#5FB0FF";

type Rect = { x: number; y: number; w: number; h: number };

type Mote = {
  x0: number; y0: number;
  cx: number; cy: number;
  x1: number; y1: number;
  t: number;
  rate: number;
  size: number;
};

export type ScryMotesProps = {
  /** Emit while true; motes already in flight always finish their journey. */
  active: boolean;
  /** Element the motes lift off — the card's artwork. */
  sourceSelector: string;
  /** Elements they land in. Any carrying `data-scry-landed="true"` is skipped. */
  targetSelector: string;
};

function rectWithin(el: Element, origin: DOMRect): Rect {
  const r = el.getBoundingClientRect();
  return { x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height };
}

/** A point inside a rect, biased away from the very edge. */
function pointIn(rect: Rect, inset = 0.12): { x: number; y: number } {
  const fx = inset + Math.random() * (1 - inset * 2);
  const fy = inset + Math.random() * (1 - inset * 2);
  return { x: rect.x + rect.w * fx, y: rect.y + rect.h * fy };
}

/**
 * Resolve a themed colour to something canvas accepts.
 *
 * Themes define `--accent-presence` as hex in some palettes and `oklch()` in
 * others; assigning an unsupported value to `fillStyle` is silently ignored
 * rather than throwing, so the sentinel below is how we tell the difference.
 */
function canvasColor(ctx: CanvasRenderingContext2D, value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return FALLBACK_ACCENT;
  const sentinel = "#010203";
  ctx.fillStyle = sentinel;
  ctx.fillStyle = trimmed;
  return ctx.fillStyle === sentinel ? FALLBACK_ACCENT : trimmed;
}

export function ScryMotes({ active, sourceSelector, targetSelector }: ScryMotesProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  // The loop parks itself once the last mote lands; this restarts it when a
  // second scry begins without remounting the canvas.
  const kickRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (active) kickRef.current?.();
  }, [active]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    if (!canvas || !host) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let frame = 0;
    let running = true;
    const motes: Mote[] = [];
    let emitAcc = 0;
    let nextSlot = 0;
    let source: Rect | null = null;
    let targets: Rect[] = [];
    let lastMeasure = 0;
    let accent = FALLBACK_ACCENT;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const r = host.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(r.width * dpr));
      canvas.height = Math.max(1, Math.round(r.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const measure = () => {
      const origin = host.getBoundingClientRect();
      const sourceEl = document.querySelector(sourceSelector);
      source = sourceEl ? rectWithin(sourceEl, origin) : null;
      targets = [...document.querySelectorAll(targetSelector)]
        .filter((el) => el.getAttribute("data-scry-landed") !== "true")
        .map((el) => rectWithin(el, origin));
      accent = canvasColor(
        ctx,
        getComputedStyle(host).getPropertyValue("--accent-presence"),
      );
    };

    const spawn = () => {
      if (!source || targets.length === 0 || motes.length >= MAX_MOTES) return;
      const slot = nextSlot % targets.length;
      nextSlot += 1;
      const from = pointIn(source, 0.08);
      const to = pointIn(targets[slot], 0.2);
      // Arc upward and forward: a straight line reads as a progress bar, a
      // bowed path reads as something lifting free of the picture.
      const lift = 24 + Math.random() * 70;
      motes.push({
        x0: from.x, y0: from.y,
        cx: (from.x + to.x) / 2 + (Math.random() - 0.5) * 40,
        cy: Math.min(from.y, to.y) - lift,
        x1: to.x, y1: to.y,
        t: 0,
        rate: 1 / (TRAVEL_MIN + Math.random() * (TRAVEL_MAX - TRAVEL_MIN)),
        size: 0.9 + Math.random() * 1.9,
      });
    };

    let last = performance.now();
    const draw = (now: number) => {
      if (!running) return;
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      if (now - lastMeasure > REMEASURE_MS) {
        lastMeasure = now;
        measure();
      }

      if (activeRef.current) {
        emitAcc += dt * EMIT_RATE;
        while (emitAcc >= 1) {
          emitAcc -= 1;
          spawn();
        }
      } else {
        emitAcc = 0;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = accent;
      for (let i = motes.length - 1; i >= 0; i -= 1) {
        const m = motes[i];
        m.t += dt * m.rate;
        if (m.t >= 1) {
          motes.splice(i, 1);
          continue;
        }
        // Quadratic Bézier, sampled a few times so each mote leaves a short
        // tail — one dot per mote reads as noise, a tail reads as travel.
        for (let k = 0; k < 3; k += 1) {
          const t = Math.max(0, m.t - k * 0.035);
          const u = 1 - t;
          const x = u * u * m.x0 + 2 * u * t * m.cx + t * t * m.x1;
          const y = u * u * m.y0 + 2 * u * t * m.cy + t * t * m.y1;
          // Fade in off the artwork, brighten, then wink out on arrival.
          const life = Math.sin(Math.PI * m.t) ** 0.7;
          ctx.globalAlpha = life * (0.85 - k * 0.26);
          const radius = m.size * (1 - k * 0.22) * (0.55 + life * 0.65);
          ctx.beginPath();
          ctx.arc(x, y, radius, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;

      // Keep drawing until the last mote has landed, even after emitting stops,
      // so the stream drains instead of vanishing at the moment of arrival.
      if (activeRef.current || motes.length > 0) {
        frame = requestAnimationFrame(draw);
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
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
    // The effect owns a long-lived loop; `active` is read through a ref so
    // flipping it never restarts the animation mid-flight.
  }, [sourceSelector, targetSelector]);

  return <canvas ref={canvasRef} className="scry-motes" aria-hidden />;
}
