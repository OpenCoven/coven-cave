"use client";

// Captures Core Web Vitals (LCP, INP, CLS, FCP, TTFB) via Next's built-in
// reporter — no extra dependency, no network. Each metric is:
//   • stashed on window.__caveVitals (inspect from the console any time),
//   • logged via console.debug in development,
//   • re-broadcast as a `cave:web-vital` CustomEvent the PerfOverlay listens for.
//
// Renders nothing. Mounted once in the root layout, and reports only while the
// perf overlay is on (#5795). This is the runtime half of the perf analytics:
// before/after numbers for the bundle-split / polling work and anything that
// follows.

import { useEffect, useState } from "react";
import { useReportWebVitals } from "next/web-vitals";
import { rateWebVital, type WebVitalRating } from "@/lib/perf/web-vitals-format";
import { recordPerfSample } from "@/lib/perf/perf-store";

export type CaveVital = {
  name: string;
  value: number;
  rating: WebVitalRating;
  at: number;
};

declare global {
  interface Window {
    __caveVitals?: Record<string, CaveVital>;
  }
}

/** The perf overlay's switch: `?perf=1` in the URL, or
 *  `localStorage.setItem("cave:perf-overlay", "1")`. */
export function perfOverlayEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (new URLSearchParams(window.location.search).get("perf") === "1") return true;
    return window.localStorage.getItem("cave:perf-overlay") === "1";
  } catch {
    return false;
  }
}

function reportVital(metric: { name: string; value: number }) {
  const entry: CaveVital = {
    name: metric.name,
    value: metric.value,
    rating: rateWebVital(metric.name, metric.value),
    at: Date.now(),
  };
  if (typeof window !== "undefined") {
    window.__caveVitals = { ...window.__caveVitals, [metric.name]: entry };
    window.dispatchEvent(new CustomEvent("cave:web-vital", { detail: entry }));
    // `window.__caveVitals` is inspectable but dies with the page, and the
    // console.debug below is development-only, so neither could ever support
    // a before/after comparison. Persist alongside them rather than instead:
    // the overlay listens for the event and the console line is still the
    // fastest read during development.
    recordPerfSample({
      kind: "vital",
      name: entry.name,
      value: entry.value,
      at: entry.at,
      rating: entry.rating,
    });
  }
  if (process.env.NODE_ENV === "development") {
    // eslint-disable-next-line no-console
    console.debug(`[web-vital] ${entry.name} ${entry.value.toFixed(1)} (${entry.rating})`);
  }
}

function VitalsCapture() {
  useReportWebVitals(reportVital);
  return null;
}

/**
 * Reports only while the perf overlay is on (#5795). Next's bundled web-vitals
 * keeps a keydown and a click listener for LCP that are never removed, and
 * each keystroke or click then adds a `visibilitychange` listener that's never
 * removed either: 1,000 keystrokes took the page from 29 of them to 2,031, for
 * every user, all day, to collect numbers only a measuring session reads. That
 * session still pays it. The switch is read once, after mount, as the overlay
 * reads it, so turn it on before the load being measured.
 */
export function WebVitalsReporter() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    setEnabled(perfOverlayEnabled());
  }, []);
  return enabled ? <VitalsCapture /> : null;
}
