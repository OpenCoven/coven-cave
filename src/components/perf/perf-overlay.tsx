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
  good: "var(--color-success)",
  "needs-improvement": "var(--color-warning)",
  poor: "var(--color-danger)",
  unknown: "var(--text-muted)",
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
      className="[position:fixed]! [right:8px]! [bottom:8px]! [z-index:2147483647]! [pointer-events:none]! [font:11px/1.5_ui-monospace,_SFMono-Regular,_Menlo,_monospace]! [color:var(--code-foreground)]! [background:rgba(17,17,19,0.82)]! [border:1px_solid_rgba(255,255,255,0.12)]! [border-radius:var(--radius-control)]! [padding:var(--space-2)_10px]! [max-width:240px]! [backdrop-filter:blur(6px)]!"
    >
      <div className="[opacity:0.6]! [margin-bottom:var(--space-1)]! [letter-spacing:0.4px]!">PERF</div>
      {vitalRows.length === 0 ? (
        <div className="[opacity:0.5]!">waiting for vitals…</div>
      ) : (
        vitalRows.map((v) => (
          <div key={v.name} className="[display:flex]! [justify-content:space-between]! [gap:var(--space-3)]!">
            <span style={{ color: RATING_COLOR[v.rating] }}>{v.name}</span>
            <span>{formatWebVital(v.name, v.value)}</span>
          </div>
        ))
      )}
      {measures.length > 0 && (
        <div className="[margin-top:6px]! [border-top:1px_solid_rgba(255,255,255,0.12)]! [padding-top:var(--space-1)]!">
          {measures.slice(-4).map((m, i) => (
            <div key={`${m.name}-${i}`} className="[display:flex]! [justify-content:space-between]! [gap:var(--space-3)]! [opacity:0.85]!">
              <span className="[overflow:hidden]! [text-overflow:ellipsis]! [white-space:nowrap]!">{m.name}</span>
              <span>{Math.round(m.duration)} ms</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
