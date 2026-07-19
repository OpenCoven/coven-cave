"use client";

import { Group } from "@visx/group";
import { scaleBand, scaleLinear } from "@visx/scale";
import { Bar } from "@visx/shape";
import { ParentSize } from "@visx/responsive";
import "@/styles/charts.css";

export type BarDatum = { label: string; value: number; color?: string };

/**
 * Categorical bar chart. Each datum may carry its own color; otherwise the
 * shared `defaultColor` (a CSS custom property) is used.
 */
export function BarChart({
  data,
  height = 160,
  defaultColor = "var(--accent-presence)",
}: {
  data: BarDatum[];
  height?: number;
  defaultColor?: string;
}) {
  return (
    <div className="cave-chart cave-chart--bar" style={{ height }}>
      <ParentSize debounceTime={0}>
        {({ width }) => (
          <BarInner width={width} height={height} data={data} defaultColor={defaultColor} />
        )}
      </ParentSize>
    </div>
  );
}

function BarInner({
  width,
  height,
  data,
  defaultColor,
}: {
  width: number;
  height: number;
  data: BarDatum[];
  defaultColor: string;
}) {
  // Bottom margin reserves a row for the category labels (.cave-chart__label
  // is --text-2xs = 10px; 14px clears descenders).
  const margin = { top: 8, right: 4, bottom: 14, left: 4 };
  const iw = Math.max(0, width - margin.left - margin.right);
  const ih = Math.max(0, height - margin.top - margin.bottom);
  if (data.length === 0 || width === 0) {
    return <div className="cave-chart__empty">No data yet</div>;
  }

  const xScale = scaleBand({ domain: data.map((d) => d.label), range: [0, iw], padding: 0.25 });
  const yMax = Math.max(...data.map((d) => d.value)) || 1;
  const yScale = scaleLinear({ domain: [0, yMax], range: [ih, 0], nice: true });

  return (
    <svg width={width} height={height} aria-hidden>
      <Group left={margin.left} top={margin.top}>
        {data.map((d) => {
          const bw = xScale.bandwidth();
          const bh = ih - (yScale(d.value) ?? ih);
          const x = xScale(d.label) ?? 0;
          return (
            <Group key={d.label}>
              <Bar
                className="cave-chart__bar"
                x={x}
                y={yScale(d.value)}
                width={bw}
                height={Math.max(0, bh)}
                rx={3}
                fill={d.color ?? defaultColor}
              />
              <text
                className="cave-chart__label"
                x={x + bw / 2}
                y={ih + 10}
                textAnchor="middle"
              >
                {d.label}
              </text>
            </Group>
          );
        })}
      </Group>
    </svg>
  );
}
