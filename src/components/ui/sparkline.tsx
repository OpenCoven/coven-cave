"use client";

import { useEffect, useRef, useState } from "react";

export type SparkPoint = { label: string; value: number | null };

/**
 * A compact trend sparkline (line + faint area fill) with a hover tooltip
 * showing the value for the day under the cursor. Width is measured so the
 * line and the hovered marker stay crisp (no non-uniform SVG scaling).
 */
export function Sparkline({ points, color, height = 26 }: { points: SparkPoint[]; color: string; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(120);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) setW(width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = points.length;
  const valid = points.map((p, i) => ({ ...p, i })).filter((p): p is { label: string; value: number; i: number } => p.value != null);
  if (valid.length < 2) {
    return <div className="spark spark--flat" style={{ height }} aria-hidden />;
  }

  const vs = valid.map((p) => p.value);
  const min = Math.min(...vs), max = Math.max(...vs), range = max - min || 1;
  const PAD = 3;
  const x = (i: number) => (n <= 1 ? w / 2 : (i / (n - 1)) * w);
  const y = (v: number) => height - PAD - ((v - min) / range) * (height - 2 * PAD);
  const line = valid.map((p, idx) => `${idx === 0 ? "M" : "L"}${x(p.i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const area = `${line} L${x(valid[valid.length - 1].i).toFixed(1)},${height} L${x(valid[0].i).toFixed(1)},${height} Z`;

  const hp = hover != null ? points[hover] : null;
  const hoverActive = hp != null && hp.value != null;

  return (
    <div
      ref={ref}
      className="spark"
      style={{ height }}
      onMouseLeave={() => setHover(null)}
      onMouseMove={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const rel = (e.clientX - rect.left) / (rect.width || 1);
        setHover(Math.max(0, Math.min(n - 1, Math.round(rel * (n - 1)))));
      }}
    >
      <svg width={w} height={height} viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" aria-hidden>
        <path d={area} fill={color} opacity="0.13" />
        <path d={line} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
        {hover != null ? (
          <line x1={x(hover)} y1="0" x2={x(hover)} y2={height} stroke="var(--border-strong)" strokeWidth="1" />
        ) : null}
        {hoverActive ? (
          <circle cx={x(hover!)} cy={y(hp!.value as number)} r="2.6" fill={color} stroke="var(--bg-raised)" strokeWidth="1.5" />
        ) : null}
      </svg>
      {hoverActive ? (
        <span className="spark-tip" style={{ left: `${(x(hover!) / (w || 1)) * 100}%` }}>
          <b>{hp!.value}</b> · {hp!.label}
        </span>
      ) : null}
    </div>
  );
}
