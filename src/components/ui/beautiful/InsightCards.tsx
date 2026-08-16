"use client";

import { useMemo, useState } from "react";

import { TrendChart, type TrendPoint, type TrendSeries } from "@/components/ui/charts/trend-chart";

/* ─────────────────────────────────────────────────────────
 * INSIGHT CARDS
 * Embedded mini-visualizations in an "Insights N ‹ ›"
 * carousel. Autoplay yields as soon as a person uses it.
 * ───────────────────────────────────────────────────────── */

const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";

const formatPercent = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;
const formatMoney = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;
const SNAPSHOT_END = Math.floor(Date.now() / 1000);

/* CAVE PORT: upstream renders these with the `liveline` package. Both call
 * sites use it in its static mode (`paused`, no scrub, no pulse) and draw
 * their own hover cursor and tooltip on top, so the only thing it contributes
 * is the polyline itself — which Cave's own visx chart primitive already
 * draws. Swapping to TrendChart keeps the charts on one charting stack and
 * drops a dependency, and it is why there is no dark-mode hook here any more:
 * TrendChart takes its colours as CSS custom properties, so it repaints with
 * the theme instead of being told which theme is active. */
function makePoints(values: number[], gap = 6): TrendPoint[] {
  return values.map((value, index) => ({
    x: SNAPSHOT_END - (values.length - 1 - index) * gap,
    y: value,
  }));
}

/* inline @entity mention */
function Entity({ name, tone }: { name: string; tone: string }) {
  return (
    <span className="inline-flex items-center gap-1 align-baseline font-medium text-bui-ink">
      <span className={`inline-block size-2.5 rounded-full ${tone}`} />
      @{name}
    </span>
  );
}

function Mono({ children, tone }: { children: React.ReactNode; tone: "red" | "green" }) {
  return (
    <code className={`font-mono text-[length:var(--text-sm)] ${tone === "red" ? "text-bui-red" : "text-bui-green"}`}>
      {children}
    </code>
  );
}

function chartIndexFromPointer(event: React.PointerEvent<HTMLDivElement>, pointCount: number) {
  const rect = event.currentTarget.getBoundingClientRect();
  const progress = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  return Math.round(progress * (pointCount - 1));
}

function ChartTooltip({ rows }: { rows: { label: string; value: string; color: string }[] }) {
  return (
    <div className="insight-chart-tooltip">
      <span className="insight-chart-tooltip-time">Today, 12:00</span>
      {rows.map((row) => (
        <div key={row.label} className="insight-chart-tooltip-row">
          <span className="insight-chart-tooltip-label"><span className="insight-chart-tooltip-dot" style={{ background: row.color }} />{row.label}</span>
          <strong>{row.value}</strong>
        </div>
      ))}
    </div>
  );
}

/* 1 — return comparison: 2 series, legend + big deltas + line chart */
function CompareCard() {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const data = useMemo(
    () => ({
      mint: makePoints([-2.9, -3.4, -3.05, -3.86, -3.52, -4.1, -3.82, -4.41]),
      pistachio: makePoints([0.22, 0.58, 0.42, 0.91, 0.76, 1.08, 0.96, 1.15]),
    }),
    [],
  );

  const latestMint = data.mint.at(-1)?.y ?? -4.41;
  const latestPistachio = data.pistachio.at(-1)?.y ?? 1.15;
  const series: TrendSeries[] = useMemo(
    () => [
      {
        id: "mint",
        label: "Mint Chip",
        points: data.mint,
        color: "var(--bui-orange)",
      },
      {
        id: "pistachio",
        label: "Pistachio",
        points: data.pistachio,
        color: "var(--bui-accent)",
      },
    ],
    [data.mint, data.pistachio],
  );

  return (
    <div className="min-h-[278px] rounded-bui-card bg-bui-surface p-3 shadow-bui-hairline">
      <div className="flex items-center gap-4">
        {[
          {
            name: "Mint Chip",
            delta: formatPercent(latestMint),
            sub: "-$2,377.66",
            tone: "red",
            dot: "bg-bui-orange",
          },
          {
            name: "Pistachio",
            delta: formatPercent(latestPistachio),
            sub: "+$617.22",
            tone: "green",
            dot: "bg-bui-accent",
          },
        ].map((s) => (
          <div key={s.name} className="flex-1">
            <span className="flex items-center gap-1.5 text-[length:var(--text-sm)] text-bui-ink-2">
              <span className={`size-2 rounded-full ${s.dot}`} />
              {s.name}
            </span>
            <span className={`block text-[length:var(--text-lg)] font-semibold tracking-[-0.01em] tabular-nums ${s.tone === "red" ? "text-bui-red" : "text-bui-green"}`}>
              {s.delta}
            </span>
            <Mono tone={s.tone as "red" | "green"}>{s.sub}</Mono>
          </div>
        ))}
      </div>
      <div className="mt-2 overflow-hidden rounded-bui-control bg-bui-inset shadow-bui-hairline">
        <div className="flex items-center justify-between border-b border-bui-line px-2.5 py-1.5">
          <span className="text-[length:var(--text-xs)] text-bui-ink-3 tabular-nums">
            Trend snapshot
          </span>
          <span className="rounded-full bg-bui-field px-2 py-0.5 text-[length:var(--text-xs)] font-medium text-bui-ink-2">
            Snapshot
          </span>
        </div>
        <div
          className="insight-chart-stage relative h-[166px]"
          onPointerDown={(event) => setHoverIndex(chartIndexFromPointer(event, data.mint.length))}
          onPointerMove={(event) => setHoverIndex(chartIndexFromPointer(event, data.mint.length))}
          onPointerLeave={() => setHoverIndex(null)}
          onPointerCancel={() => setHoverIndex(null)}
          onPointerUp={() => setHoverIndex(null)}
        >
          <TrendChart
            series={series}
            height={166}
            fill={false}
            ariaLabel={`Return comparison. Mint Chip ${formatPercent(latestMint)}, Pistachio ${formatPercent(latestPistachio)}.`}
          />
          {hoverIndex !== null && <>
            <span className="insight-chart-cursor" style={{ left: `${(hoverIndex / (data.mint.length - 1)) * 100}%` }} />
            <span className="insight-chart-tooltip-anchor" style={{ left: `${Math.min(Math.max((hoverIndex / (data.mint.length - 1)) * 100, 28), 72)}%` }}>
              <ChartTooltip rows={[{ label: "Mint Chip", value: formatPercent(data.mint[hoverIndex].y), color: "var(--bui-orange)" }, { label: "Pistachio", value: formatPercent(data.pistachio[hoverIndex].y), color: "var(--bui-accent)" }]} />
            </span>
          </>}
        </div>
      </div>
    </div>
  );
}

/* 2 — anomaly: bars with threshold + big spent value */
function AnomalyCard() {
  const [metric, setMetric] = useState<"spend" | "usage">("spend");
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const spend = useMemo(
    () => makePoints([274, 289, 264, 307, 331, 1210, 1718, 2112], 7),
    [],
  );
  const usage = useMemo(
    () => makePoints([18, 19, 17, 21, 22, 58, 81, 96], 7),
    [],
  );

  const data = metric === "spend" ? spend : usage;
  const value = data.at(-1)?.y ?? (metric === "spend" ? 2112 : 96);
  const threshold = metric === "spend" ? "$2,112" : "82 kWh";
  const moneyLabel = formatMoney(spend.at(-1)?.y ?? 2112);

  return (
    <div className="min-h-[278px] rounded-bui-card bg-bui-surface p-3 shadow-bui-hairline">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[length:var(--text-sm)] font-medium text-bui-ink">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--bui-red)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
          High freezer spend
        </span>
        <span className="rounded-full bg-bui-field px-2 py-0.5 text-[length:var(--text-xs)] font-medium text-bui-ink-2">
          Snapshot
        </span>
      </div>
      <div className="mt-2 overflow-hidden rounded-bui-control bg-bui-inset shadow-bui-hairline">
        <div className="flex items-center justify-between border-b border-bui-line px-2.5 py-1.5">
          <span className="text-[length:var(--text-xs)] text-bui-ink-3 tabular-nums">
            {hoverIndex !== null
              ? metric === "spend"
                ? formatMoney(data[hoverIndex].y)
                : `${Math.round(data[hoverIndex].y)} kWh`
              : `${threshold} threshold`}
          </span>
          <span className="flex rounded-full bg-bui-field p-0.5">
            {(["spend", "usage"] as const).map((item) => (
              <button
                key={item}
                type="button"
                aria-pressed={metric === item}
                onClick={() => setMetric(item)}
                className={`rounded-full px-2 py-0.5 text-[length:var(--text-xs)] font-medium transition-[background-color,color,box-shadow,transform] duration-150 active:scale-[0.96] ${
                  metric === item ? "bg-bui-surface text-bui-ink shadow-bui-btn" : "text-bui-ink-3 hover:text-bui-ink-2"
                }`}
              >
                {item === "spend" ? "Spend" : "Usage"}
              </button>
            ))}
          </span>
        </div>
        <div
          className="insight-chart-stage relative h-[166px]"
          onPointerDown={(event) => setHoverIndex(chartIndexFromPointer(event, data.length))}
          onPointerMove={(event) => setHoverIndex(chartIndexFromPointer(event, data.length))}
          onPointerLeave={() => setHoverIndex(null)}
          onPointerCancel={() => setHoverIndex(null)}
          onPointerUp={() => setHoverIndex(null)}
        >
          <TrendChart
            series={[{ id: metric, label: metric === "spend" ? "Spend" : "Usage", points: data, color: "var(--bui-red)" }]}
            height={166}
            fill={false}
            ariaLabel={`${metric === "spend" ? "Spend" : "Usage"} trend, currently ${
              metric === "spend" ? formatMoney(value) : `${Math.round(value)} kWh`
            } against a ${threshold} threshold.`}
          />
          {hoverIndex !== null && <>
            <span className="insight-chart-cursor" style={{ left: `${(hoverIndex / (data.length - 1)) * 100}%` }} />
            <span className="insight-chart-tooltip-anchor" style={{ left: `${Math.min(Math.max((hoverIndex / (data.length - 1)) * 100, 28), 72)}%` }}>
              <ChartTooltip rows={[{ label: metric === "spend" ? "Spend" : "Usage", value: metric === "spend" ? formatMoney(data[hoverIndex].y) : `${Math.round(data[hoverIndex].y)} kWh`, color: "var(--bui-red)" }]} />
            </span>
          </>}
        </div>
      </div>
      <div className="mt-1.5 flex items-baseline gap-2">
        <span className="text-[length:var(--text-lg)] font-semibold tracking-[-0.01em] text-bui-ink tabular-nums">
          {moneyLabel} spent
        </span>
        <Mono tone="red">+$1,834.66</Mono>
        <span className="text-[length:var(--text-xs)] text-bui-ink-3">vs 3 months</span>
      </div>
    </div>
  );
}

/* 3 — allocation: hero number + segmented bar + legend */
function AllocationCard() {
  const segments = [
    { name: "VAN", label: "Vanilla", pct: 72.5, amount: "$51,785", cls: "bg-bui-orange", tone: "text-bui-orange" },
    { name: "CHOC", label: "Chocolate", pct: 22.8, amount: "$16,278", cls: "bg-bui-line-strong", tone: "text-bui-ink-2" },
    { name: "MINT", label: "Mint", pct: 4.7, amount: "$3,357", cls: "bg-bui-line", tone: "text-bui-ink-3" },
  ];
  const [selected, setSelected] = useState(segments[0].name);
  const active = segments.find((segment) => segment.name === selected) ?? segments[0];

  return (
    <div className="min-h-[278px] rounded-bui-card bg-bui-surface p-3 shadow-bui-hairline">
      <span className="flex items-center gap-1.5 text-[length:var(--text-sm)] font-medium text-bui-ink">
        <span className="flex size-3.5 items-center justify-center rounded-full bg-bui-orange text-[length:var(--text-2xs)] font-bold text-white">
          V
        </span>
        Vanilla allocation
      </span>
      <span className="mt-1 block text-[length:var(--text-xl)] font-semibold tracking-[-0.01em] text-bui-ink tabular-nums">
        {active.amount}
      </span>
      <div
        className="mt-3 flex h-9 gap-0.5 overflow-hidden rounded-full bg-bui-field p-0.5"
        role="group"
        aria-label="Allocation segments"
      >
        {segments.map((s) => (
          <button
            key={s.name}
            type="button"
            aria-pressed={selected === s.name}
            aria-label={`${s.label}: ${s.pct}%`}
            onClick={() => setSelected(s.name)}
            className={`relative h-full overflow-hidden rounded-full ${s.cls} transition-[opacity,transform,box-shadow] duration-300 active:scale-[0.98]`}
            style={{
              width: `${s.pct}%`,
              opacity: selected === s.name ? 1 : 0.58,
              boxShadow: selected === s.name ? "inset 0 0 0 1px rgba(255,255,255,0.22)" : undefined,
              transitionTimingFunction: EASE,
            }}
          >
            <span
              className="absolute inset-y-1 left-1 rounded-full bg-white/20 transition-[width,opacity] duration-500"
              style={{
                width: selected === s.name ? "calc(100% - 8px)" : "0%",
                opacity: selected === s.name ? 1 : 0,
                transitionTimingFunction: EASE,
              }}
            />
          </button>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-1.5">
        {segments.map((s) => (
          <button
            key={s.name}
            type="button"
            aria-pressed={selected === s.name}
            onClick={() => setSelected(s.name)}
            className={`flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[length:var(--text-xs)] transition-[background-color,color,transform] duration-150 active:scale-[0.96] ${
              selected === s.name ? "bg-bui-field text-bui-ink" : "text-bui-ink-2 hover:bg-bui-hover hover:text-bui-ink"
            }`}
          >
            <span className={`size-1.5 rounded-full ${s.cls}`} />
            {s.name} <span className="tabular-nums">{s.pct}%</span>
          </button>
        ))}
      </div>
      <div className="mt-3 min-h-16 rounded-bui-control bg-bui-inset px-2.5 py-2 shadow-bui-hairline">
        <span className={`block text-[length:var(--text-sm)] font-medium ${active.tone}`}>{active.label}</span>
        <span className="mt-1 block text-[length:var(--text-xs)] leading-relaxed text-bui-ink-3">
          Contribution snapshot across current inventory value. Segment selection changes the inspected group without moving the card.
        </span>
      </div>
    </div>
  );
}

const PAGES = [
  {
    key: "compare",
    prose: (
      <>
        The worst performer in your <Entity name="Creamery" tone="bg-bui-orange" /> is
        Rocky Road — down <Mono tone="red">-6%</Mono> or <Mono tone="red">-$2,453.44</Mono>.
      </>
    ),
    Card: CompareCard,
    pill: "Should I rebalance flavors?",
  },
  {
    key: "anomaly",
    prose: (
      <>
        Unusually high freezer bill on <span className="font-medium text-bui-ink">Dec 13</span> —{" "}
        <Mono tone="red">+$1,834.66</Mono> above your average.
      </>
    ),
    Card: AnomalyCard,
    pill: "Get tips on cutting freezer costs",
  },
  {
    key: "allocation",
    prose: (
      <>
        You&apos;re heavily invested in <Entity name="Vanilla" tone="bg-bui-orange" /> — it&apos;s{" "}
        <span className="font-medium text-bui-ink">72.5%</span> of your case.
      </>
    ),
    Card: AllocationCard,
    pill: "If we look at seasonals, what changes?",
  },
];

export function InsightCards() {
  const [page, setPage] = useState(0);

  const move = (direction: -1 | 1) => {
    setPage((current) => (current + direction + PAGES.length) % PAGES.length);
  };

  const { prose, Card, pill } = PAGES[page];

  return (
    <div className="min-h-[408px] w-full max-w-86">
      {/* pager header */}
      <div className="flex items-center justify-between">
        <span className="flex items-baseline gap-1.5">
          <span className="text-[length:var(--text-base)] font-semibold text-bui-ink">Insights</span>
          <span className="text-[length:var(--text-base)] text-bui-ink-3 tabular-nums">{PAGES.length}</span>
        </span>
        <span className="flex items-center gap-0.5">
          {(["M15 18l-6-6 6-6", "M9 6l6 6-6 6"] as const).map((d, i) => (
            <button
              key={i}
              aria-label={i === 0 ? "Previous insight" : "Next insight"}
              onClick={() => move(i === 0 ? -1 : 1)}
              className="flex size-6 items-center justify-center rounded-[6px] text-bui-ink-3
                transition-[background-color,color,transform] duration-100 hover:bg-bui-hover
                hover:text-bui-ink active:scale-[0.96]"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d={d} />
              </svg>
            </button>
          ))}
        </span>
      </div>

      {/* page content — blurred crossfade */}
      <div
        className="transition-[opacity,filter] duration-250 [opacity:1]! [filter:blur(0)]!"
      >
        <p className="mt-1.5 text-[length:var(--text-base)] leading-relaxed text-bui-ink-2">{prose}</p>
        <div className="mt-2">
          <Card />
        </div>
        <button
          className="mt-2 rounded-full bg-bui-surface px-3 py-1.5 text-left text-[length:var(--text-sm)] text-bui-ink
            shadow-bui-btn transition-colors duration-100 hover:bg-bui-hover"
        >
          {pill}
        </button>
      </div>
    </div>
  );
}
