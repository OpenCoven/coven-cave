"use client";

import { useEffect } from "react";

/**
 * Sparkle the top-bar sidepanel trigger on an actual click. Clicking the nav or
 * side-panel toggle (`.shell-top-toggle--nav` / `.shell-top-toggle--right`)
 * fires its own toggle and adds a one-shot purple `.magic-cast` sparkle.
 */

const CAST_MS = 650;

export function MagicTriggers() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const el = target?.closest(".shell-top-toggle--nav, .shell-top-toggle--right");
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
