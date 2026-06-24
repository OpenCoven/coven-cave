"use client";

import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Live boolean for the OS-level reduced-motion preference. Returns false on
 * the server and during the first render in the browser; flips synchronously
 * after mount if the user has the preference set. Subscribes to changes so
 * toggling the OS setting takes effect without reload.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia(QUERY);
    setReduced(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return reduced;
}

/**
 * Imperative one-shot read of the reduced-motion preference, for event handlers
 * and effects where a hook can't run. SSR-safe (returns false without a window).
 * Use to gate JS-driven smooth scrolling, which bypasses the CSS reduced-motion
 * reset because an explicit `behavior: "smooth"` option overrides scroll-behavior.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(QUERY).matches;
}

/** Reduced-motion-aware scroll behavior: "auto" when the user prefers reduced motion, else "smooth". */
export function smoothScrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? "auto" : "smooth";
}
