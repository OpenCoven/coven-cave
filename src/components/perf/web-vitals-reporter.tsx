"use client";

// Captures Core Web Vitals (LCP, INP, CLS, FCP, TTFB) via Next's built-in
// reporter — no extra dependency, no network. Each metric is:
//   • stashed on window.__caveVitals (inspect from the console any time),
//   • logged via console.debug in development,
//   • re-broadcast as a `cave:web-vital` CustomEvent the PerfOverlay listens for.
//
// Renders nothing. Mounted once in the root layout. This is the runtime half of
// the perf analytics: before/after numbers for the bundle-split / polling work
// and anything that follows.

import { useReportWebVitals } from "next/web-vitals";
import { rateWebVital, type WebVitalRating } from "@/lib/perf/web-vitals-format";

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

export function WebVitalsReporter() {
  useReportWebVitals((metric) => {
    const entry: CaveVital = {
      name: metric.name,
      value: metric.value,
      rating: rateWebVital(metric.name, metric.value),
      at: Date.now(),
    };
    if (typeof window !== "undefined") {
      window.__caveVitals = { ...window.__caveVitals, [metric.name]: entry };
      window.dispatchEvent(new CustomEvent("cave:web-vital", { detail: entry }));
    }
    if (process.env.NODE_ENV === "development") {
      // eslint-disable-next-line no-console
      console.debug(`[web-vital] ${entry.name} ${entry.value.toFixed(1)} (${entry.rating})`);
    }
  });
  return null;
}
