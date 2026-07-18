"use client";

import { Group } from "@visx/group";
import { Pie } from "@visx/shape";
import { ParentSize } from "@visx/responsive";
import "@/styles/charts.css";

export type DonutDatum = { label: string; value: number; color: string };

/**
 * Donut chart (a Pie with an inner radius). Each slice color is supplied by the
 * caller (CSS custom properties recommended so it tracks the theme).
 */
export function DonutChart({
  data,
  size = 160,
  thickness = 22,
  ariaLabel,
}: {
  data: DonutDatum[];
  size?: number;
  thickness?: number;
  /** When set, the chart SVG is exposed to AT as role="img" with this label (a
   *  text summary of the data). Without it the SVG stays aria-hidden. */
  ariaLabel?: string;
}) {
  return (
    <div className="cave-chart cave-chart--donut" style={{ height: size }}>
      <ParentSize>
        {({ width }) => <DonutInner width={width} size={size} thickness={thickness} data={data} ariaLabel={ariaLabel} />}
      </ParentSize>
    </div>
  );
}

function DonutInner({
  width,
  size,
  thickness,
  data,
  ariaLabel,
}: {
  width: number;
  size: number;
  thickness: number;
  data: DonutDatum[];
  ariaLabel?: string;
}) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  if (total <= 0 || width === 0) {
    return <div className="cave-chart__empty">No data yet</div>;
  }
  const dim = Math.min(width, size);
  const radius = dim / 2;
  const innerRadius = Math.max(0, radius - thickness);

  return (
    <svg width={width} height={size} {...(ariaLabel ? { role: "img", "aria-label": ariaLabel } : { "aria-hidden": true })}>
      <Group top={size / 2} left={width / 2}>
        <Pie
          data={data}
          pieValue={(d) => d.value}
          outerRadius={radius}
          innerRadius={innerRadius}
          padAngle={0.02}
        >
          {(pie) =>
            pie.arcs.map((arc) => (
              <path key={arc.data.label} d={pie.path(arc) ?? undefined} fill={arc.data.color}>
                {/* Native SVG hover detail: "In review: 3 (25%)" */}
                <title>{`${arc.data.label}: ${arc.data.value} (${Math.round((arc.data.value / total) * 100)}%)`}</title>
              </path>
            ))
          }
        </Pie>
      </Group>
    </svg>
  );
}
