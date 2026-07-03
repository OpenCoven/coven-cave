"use client";

import { Group } from "@visx/group";
import { scaleLinear } from "@visx/scale";
import { LinePath, AreaClosed } from "@visx/shape";
import { ParentSize } from "@visx/responsive";
import { curveMonotoneX } from "@visx/curve";
import "@/styles/charts.css";

export type TrendPoint = { x: number; y: number };
export type TrendSeries = { id: string; label: string; color: string; points: TrendPoint[] };

/**
 * Multi-series line chart (optional area fill) with an optional horizontal
 * threshold marker (e.g. an SLA pass-rate floor). Colors come from the caller
 * (pass CSS custom properties like `var(--accent-presence)`).
 */
export function TrendChart({
  series,
  height = 160,
  threshold,
  fill = true,
  ariaLabel,
}: {
  series: TrendSeries[];
  height?: number;
  threshold?: number;
  fill?: boolean;
  /** When set, the chart SVG is exposed to AT as role="img" with this label (a
   *  text summary of the data). Without it the SVG stays aria-hidden. */
  ariaLabel?: string;
}) {
  return (
    <div className="cave-chart cave-chart--trend" style={{ height }}>
      <ParentSize>
        {({ width }) => (
          <TrendInner width={width} height={height} series={series} threshold={threshold} fill={fill} ariaLabel={ariaLabel} />
        )}
      </ParentSize>
    </div>
  );
}

function TrendInner({
  width,
  height,
  series,
  threshold,
  fill,
  ariaLabel,
}: {
  width: number;
  height: number;
  series: TrendSeries[];
  threshold?: number;
  fill: boolean;
  ariaLabel?: string;
}) {
  const margin = { top: 8, right: 8, bottom: 8, left: 8 };
  const iw = Math.max(0, width - margin.left - margin.right);
  const ih = Math.max(0, height - margin.top - margin.bottom);

  const allX = series.flatMap((s) => s.points.map((p) => p.x));
  const allY = series.flatMap((s) => s.points.map((p) => p.y));
  if (allX.length < 2 || width === 0) {
    return <div className="cave-chart__empty">No trend data yet</div>;
  }

  const xScale = scaleLinear({ domain: [Math.min(...allX), Math.max(...allX)], range: [0, iw] });
  const yMax = Math.max(threshold ?? 0, ...allY) || 1;
  const yScale = scaleLinear({ domain: [0, yMax], range: [ih, 0], nice: true });

  return (
    <svg width={width} height={height} {...(ariaLabel ? { role: "img", "aria-label": ariaLabel } : { "aria-hidden": true })}>
      <Group left={margin.left} top={margin.top}>
        {threshold != null ? (
          <line className="cave-chart__threshold" x1={0} x2={iw} y1={yScale(threshold)} y2={yScale(threshold)} />
        ) : null}
        {series.map((s) => (
          <Group key={s.id}>
            {fill ? (
              <AreaClosed
                data={s.points}
                x={(p) => xScale(p.x)}
                y={(p) => yScale(p.y)}
                yScale={yScale}
                curve={curveMonotoneX}
                fill={s.color}
                opacity={0.12}
              />
            ) : null}
            <LinePath
              data={s.points}
              x={(p) => xScale(p.x)}
              y={(p) => yScale(p.y)}
              curve={curveMonotoneX}
              stroke={s.color}
              strokeWidth={1.8}
            />
          </Group>
        ))}
      </Group>
    </svg>
  );
}
