"use client";

import { useEffect, useState } from "react";

const MOBILE_QUERY = "(max-width: 1023px)";
const COARSE_POINTER_QUERY = "(pointer: coarse)";

/**
 * Live boolean for "viewport narrower than the desktop shell breakpoint."
 * SSR-safe: returns false on the server and during the first browser render,
 * then flips synchronously after mount and subscribes to viewport changes.
 * Pair with CSS @media (max-width: 1023px) so server-rendered markup matches.
 */
export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia(MOBILE_QUERY);
    setMobile(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setMobile(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return mobile;
}

/**
 * True when the primary pointer is coarse (touchscreen). Used to gate
 * hover-dependent behavior and to suppress autoFocus that would pop the
 * on-screen keyboard.
 */
export function useIsCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia(COARSE_POINTER_QUERY);
    setCoarse(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setCoarse(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return coarse;
}

export type VisualViewportState = {
  height: number;
  offsetTop: number;
};

/**
 * Tracks window.visualViewport so layout can respond to the iOS on-screen
 * keyboard. Falls back to window.innerHeight when the API is unavailable
 * (older browsers, Tauri webview, SSR). The returned values are 0 until
 * after mount on the client.
 */
export function useVisualViewport(): VisualViewportState {
  const [state, setState] = useState<VisualViewportState>({ height: 0, offsetTop: 0 });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const vv = window.visualViewport;
    const read = () => {
      if (vv) {
        setState({ height: vv.height, offsetTop: vv.offsetTop });
      } else {
        setState({ height: window.innerHeight, offsetTop: 0 });
      }
    };
    read();
    if (vv) {
      vv.addEventListener("resize", read);
      vv.addEventListener("scroll", read);
      return () => {
        vv.removeEventListener("resize", read);
        vv.removeEventListener("scroll", read);
      };
    }
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, []);

  return state;
}
