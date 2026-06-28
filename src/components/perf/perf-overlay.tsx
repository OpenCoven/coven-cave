"use client";

// Display-only perf HUD. Hidden by default; enable with `?perf=1` in the URL or
// `localStorage.setItem("cave:perf-overlay", "1")`. Shows live Web Vitals
// (colored by rating) and the most recent custom perf measures (markStart/
// markEnd). pointer-events-none so it never steals clicks from the app.

import { useEffect, useState } from "react";
import { formatWebVital, type WebVitalRating } from "@/lib/perf/web-vitals-format";
import { getPerfMeasures, type PerfMeasure } from "@/lib/perf/marks";
import type { CaveVital } from "@/components/perf/web-vitals-reporter";

const RATING_COLOR: Record<WebVitalRating, string> = {
  good: "#34d399",
  "needs-improvement": "#fbbf24",
  poor: "#f87171",
  unknown: "#9ca3af",
};

function enabledFromEnv(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const q = new URLSearchParams(window.location.search);
    if (q.get("perf") === "1") return true;
    return window.localStorage.getItem("cave:perf-overlay") === "1";
  } catch {
    return false;
  }
}

export function PerfOverlay() {
  const [enabled, setEnabled] = useState(false);
  const [vitals, setVitals] = useState<Record<string, CaveVital>>({});
  const [measures, setMeasures] = useState<readonly PerfMeasure[]>([]);

  // Gate read happens post-mount so SSR markup stays empty (no hydration drift).
  useEffect(() => {
    setEnabled(enabledFromEnv());
  }, []);

  useEffect(() => {
    if (!enabled) return;
    setVitals(window.__caveVitals ?? {});
    setMeasures([...getPerfMeasures()]);
    const onVital = () => setVitals({ ...(window.__caveVitals ?? {}) });
    const onMeasure = () => setMeasures([...getPerfMeasures()]);
    window.addEventListener("cave:web-vital", onVital as EventListener);
    window.addEventListener("cave:perf-measure", onMeasure as EventListener);
    return () => {
      window.removeEventListener("cave:web-vital", onVital as EventListener);
      window.removeEventListener("cave:perf-measure", onMeasure as EventListener);
    };
  }, [enabled]);

  if (!enabled) return null;

  const vitalRows = Object.values(vitals).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div
      aria-hidden
      style={{
        position: "fixed",
        right: 8,
        bottom: 8,
        zIndex: 2147483647,
        pointerEvents: "none",
        font: "11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace",
        color: "#e5e7eb",
        background: "rgba(17,17,19,0.82)",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 8,
        padding: "8px 10px",
        maxWidth: 240,
        backdropFilter: "blur(6px)",
      }}
    >
      <div style={{ opacity: 0.6, marginBottom: 4, letterSpacing: 0.4 }}>PERF</div>
      {vitalRows.length === 0 ? (
        <div style={{ opacity: 0.5 }}>waiting for vitals…</div>
      ) : (
        vitalRows.map((v) => (
          <div key={v.name} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <span style={{ color: RATING_COLOR[v.rating] }}>{v.name}</span>
            <span>{formatWebVital(v.name, v.value)}</span>
          </div>
        ))
      )}
      {measures.length > 0 && (
        <div style={{ marginTop: 6, borderTop: "1px solid rgba(255,255,255,0.12)", paddingTop: 4 }}>
          {measures.slice(-4).map((m, i) => (
            <div key={`${m.name}-${i}`} style={{ display: "flex", justifyContent: "space-between", gap: 12, opacity: 0.85 }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.name}</span>
              <span>{Math.round(m.duration)} ms</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
