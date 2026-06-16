"use client";

import { useEffect } from "react";

/**
 * "Cast from a distance" for the corner sidepanel triggers. shell.tsx already
 * publishes a per-float cursor proximity (`--float-prox`) that fades in a purple
 * glow as you approach; this layer adds the spell: once the cursor is close
 * enough that the trigger has gone purple, it auto-fires the toggle (calls the
 * button's own click — opening/closing the panel from afar) and flashes a purple
 * sparkle (`.magic-cast`). Hysteresis re-arms only after the cursor leaves, so it
 * casts once per approach rather than flickering.
 *
 * Additive + self-contained: it reads the DOM and clicks the existing buttons,
 * never touching shell.tsx's glow effect. Disabled for touch / reduced-motion.
 */

const FIRE_DIST = 64; // px to the chip center — "purple enough" to cast
const RELEASE_DIST = 130; // px — must leave beyond this to re-arm
const CAST_MS = 650;

export function MagicTriggers() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia?.("(pointer: coarse)").matches) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    const armed = new Map<Element, boolean>();
    let raf = 0;
    let x = 0;
    let y = 0;

    const tick = () => {
      raf = 0;
      const els = document.querySelectorAll<HTMLElement>(
        ".shell-panel-float--left, .shell-panel-float--right",
      );
      els.forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0) return;
        // chip center: corner tabs pinned ~17.5px in from the corner (matches shell.tsx)
        const cx = el.classList.contains("shell-panel-float--left") ? r.left + 17.5 : r.right - 17.5;
        const cy = r.top + 17.5;
        const dist = Math.hypot(x - cx, y - cy);
        if (!armed.has(el)) armed.set(el, true);
        if (dist <= FIRE_DIST && armed.get(el)) {
          armed.set(el, false);
          el.classList.add("magic-cast");
          el.click();
          window.setTimeout(() => el.classList.remove("magic-cast"), CAST_MS);
        } else if (dist > RELEASE_DIST) {
          armed.set(el, true);
        }
      });
    };

    const onMove = (e: MouseEvent) => {
      x = e.clientX;
      y = e.clientY;
      if (!raf) raf = window.requestAnimationFrame(tick);
    };

    window.addEventListener("mousemove", onMove, { passive: true });
    return () => {
      window.removeEventListener("mousemove", onMove);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, []);

  return null;
}
