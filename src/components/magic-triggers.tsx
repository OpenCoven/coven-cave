"use client";

import { useEffect } from "react";

/**
 * Sparkle the corner sidepanel trigger on an actual click. Opening is
 * click-to-open — there is no proximity auto-open. shell.tsx still fades in the
 * purple proximity glow as hover feedback (and `.shell-panel-float` is
 * `cursor: pointer`, so hovering shows the hand); clicking the trigger fires its
 * own toggle and adds a one-shot purple `.magic-cast` sparkle.
 */

const CAST_MS = 650;

export function MagicTriggers() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const el = target?.closest(".shell-panel-float--left, .shell-panel-float--right");
      if (!(el instanceof HTMLElement)) return;
      if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
      el.classList.add("magic-cast");
      window.setTimeout(() => el.classList.remove("magic-cast"), CAST_MS);
    };

    // Capture so the sparkle is added even though the button's own onClick also runs.
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  return null;
}
