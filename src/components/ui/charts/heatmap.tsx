"use client";

import { Group } from "@visx/group";
import { scaleBand } from "@visx/scale";
import { ParentSize } from "@visx/responsive";
import "@/styles/charts.css";

export type HeatCell = { row: string; col: string; value: number };

/**
 * Row × column grid of cells, each colored by `colorFor(value)` (a function the
 * caller supplies so the color ramp can use theme tokens). Rendered as plain
 * SVG rects positioned by band scales — no extra visx subpackage needed.
 */
export function Heatmap({
  rows,
  cols,
  cells,
  colorFor,
  height = 160,
}: {
  rows: string[];
  cols: string[];
  cells: HeatCell[];
  colorFor: (value: number) => string;
  height?: number;
}) {
  return (
    <div className="cave-chart cave-chart--heatmap" style={{ height }}>
      <ParentSize>
        {({ width }) => (
          <HeatInner width={width} height={height} rows={rows} cols={cols} cells={cells} colorFor={colorFor} />
        )}
      </ParentSize>
    </div>
  );
}

function HeatInner({
  width,
  height,
  rows,
  cols,
  cells,
  colorFor,
}: {
  width: number;
  height: number;
  rows: string[];
  cols: string[];
  cells: HeatCell[];
  colorFor: (value: number) => string;
}) {
  const margin = { top: 2, right: 2, bottom: 2, left: 2 };
  const iw = Math.max(0, width - margin.left - margin.right);
  const ih = Math.max(0, height - margin.top - margin.bottom);
  if (rows.length === 0 || cols.length === 0 || width === 0) {
    return <div className="cave-chart__empty">No data yet</div>;
  }

  const xScale = scaleBand({ domain: cols, range: [0, iw], padding: 0.06 });
  const yScale = scaleBand({ domain: rows, range: [0, ih], padding: 0.06 });

  return (
    <svg width={width} height={height} role="img" aria-hidden>
      <Group left={margin.left} top={margin.top}>
        {cells.map((c) => {
          const cx = xScale(c.col);
          const cy = yScale(c.row);
          if (cx == null || cy == null) return null;
          return (
            <rect
              key={`${c.row}:${c.col}`}
              className="cave-chart__cell"
              x={cx}
              y={cy}
              width={xScale.bandwidth()}
              height={yScale.bandwidth()}
              rx={2}
              fill={colorFor(c.value)}
            />
          );
        })}
      </Group>
    </svg>
  );
}
