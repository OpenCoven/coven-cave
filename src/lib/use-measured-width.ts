"use client";

import { useEffect, useState, type RefObject } from "react";

/**
 * Live width of an element's content box, or `null` until it has been measured
 * (cave-k3a9u).
 *
 * `null` is deliberately distinct from `0`. A caller deciding a layout has to
 * tell "this box is genuinely tiny" apart from "no measurement has arrived
 * yet" — on the server, on the first paint, and in test environments without
 * ResizeObserver — because those want opposite fallbacks.
 *
 * Reach for this instead of a viewport media query whenever the thing being
 * sized is a panel rather than the page. A surface that can sit beside other
 * surfaces, inside a split, or next to the app sidebar has a width the viewport
 * does not describe.
 */
export function useMeasuredWidth(ref: RefObject<HTMLElement | null>): number | null {
  const [width, setWidth] = useState<number | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const read = (next: number) => {
      setWidth((previous) => (previous === next ? previous : next));
    };
    read(element.clientWidth);
    const observer = new ResizeObserver((entries) => {
      read(entries[0]?.contentRect.width ?? element.clientWidth);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return width;
}
