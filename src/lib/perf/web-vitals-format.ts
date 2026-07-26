// Pure helpers for rating + formatting Web Vitals, shared by the reporter and
// the dev overlay. Kept free of browser/React imports so it's unit-testable.
//
// Thresholds follow Google's Core Web Vitals guidance (good / needs-improvement
// / poor). Values are in milliseconds except CLS, which is unitless.

export type WebVitalName = "LCP" | "INP" | "CLS" | "FCP" | "TTFB";
export type WebVitalRating = "good" | "needs-improvement" | "poor" | "unknown";

// [goodMax, poorMin]: value <= goodMax → good; value > poorMin → poor;
// in between → needs-improvement.
export const WEB_VITAL_THRESHOLDS: Record<WebVitalName, [number, number]> = {
  LCP: [2500, 4000],
  INP: [200, 500],
  CLS: [0.1, 0.25],
  FCP: [1800, 3000],
  TTFB: [800, 1800],
};

export function rateWebVital(name: string, value: number): WebVitalRating {
  const t = WEB_VITAL_THRESHOLDS[name as WebVitalName];
  if (!t || !Number.isFinite(value)) return "unknown";
  const [goodMax, poorMin] = t;
  if (value <= goodMax) return "good";
  if (value > poorMin) return "poor";
  return "needs-improvement";
}

/** Human-readable value: CLS is unitless to 3 decimals; everything else is ms. */
export function formatWebVital(name: string, value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (name === "CLS") return value.toFixed(3);
  return `${Math.round(value)} ms`;
}
