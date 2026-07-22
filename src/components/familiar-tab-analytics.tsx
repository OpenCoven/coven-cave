"use client";

// Familiar tab — Analytics section (design-handoff rebuild).
//
// Every number on this surface is derived from the SAME analytics data layer
// the standalone familiar analytics page uses (loadFamiliarAnalyticsData →
// buildFamiliarAnalyticsModel): session pulse, recent sessions, and self-heal
// requests. Nothing is fabricated — there is no token API, so there is no
// token KPI; deltas only render when the pulse window can honestly compare
// halves; and an empty session history renders one empty state instead of
// hollow charts.
//
// Carousel slides stay MOUNTED and toggle `visibility` inside a grid stack
// (design lines 342-349) so the visx charts never re-measure/re-animate when
// the user pages between them.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildFamiliarAnalyticsModel,
  loadFamiliarAnalyticsData,
  type FamiliarAnalyticsData,
  type FamiliarAnalyticsModel,
} from "@/components/familiar-analytics-data";
import { TrendChart, type TrendSeries } from "@/components/ui/charts/trend-chart";
import { DonutChart } from "@/components/ui/charts/donut-chart";
import { BarChart, type BarDatum } from "@/components/ui/charts/bar-chart";
import { Heatmap, type HeatCell } from "@/components/ui/charts/heatmap";
import { LifecycleBadge } from "@/components/ui/lifecycle-badge";
import { SkeletonRows } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { IconButton } from "@/components/ui/icon-button";
import { Icon } from "@/lib/icon";
import { relativeTime } from "@/lib/relative-time";
import { usePausablePoll } from "@/lib/use-pausable-poll";
import { pulseDelta, pulseTotal, type PulseDay } from "@/lib/session-pulse";
import type { CardLifecycle } from "@/lib/cave-board-types";
import type { Familiar, SessionRow } from "@/lib/types";
import "@/styles/familiar-tab-analytics.css";

// ── Honest derivations ───────────────────────────────────────────────────────

type SessionOutcome = "running" | "failed" | "completed";

/** Same status buckets the familiar analytics page uses for its session dots. */
function sessionOutcome(status: string): SessionOutcome {
  const s = (status || "").toLowerCase();
  if (/(running|active|working|streaming|starting)/.test(s)) return "running";
  if (/(error|fail|killed|crash)/.test(s)) return "failed";
  return "completed";
}

function countOutcomes(sessions: SessionRow[]): Record<SessionOutcome, number> {
  const counts: Record<SessionOutcome, number> = { running: 0, failed: 0, completed: 0 };
  for (const session of sessions) counts[sessionOutcome(session.status)] += 1;
  return counts;
}

function projectBasename(root: string): string {
  const parts = (root || "").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "unknown";
}

/** Compact "18m" / "42s" / "2h" run duration; null when degenerate. */
function runDuration(session: SessionRow): string | null {
  const start = Date.parse(session.created_at);
  const end = Date.parse(session.updated_at);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const ms = end - start;
  if (ms < 1000) return null;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
// Six 4-hour bands cover the day without pretending hourly resolution.
const HOUR_BANDS = ["12a", "4a", "8a", "12p", "4p", "8p"] as const;

function heatmapFromSessions(sessions: SessionRow[]): { cells: HeatCell[]; max: number } {
  const counts = new Map<string, number>();
  for (const session of sessions) {
    const ms = Date.parse(session.created_at);
    if (!Number.isFinite(ms)) continue;
    const date = new Date(ms);
    // getDay(): 0 = Sunday; rotate so the grid reads Mon → Sun.
    const row = WEEKDAYS[(date.getDay() + 6) % 7];
    const col = HOUR_BANDS[Math.min(5, Math.floor(date.getHours() / 4))];
    const key = `${row}:${col}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let max = 0;
  const cells: HeatCell[] = [];
  for (const row of WEEKDAYS) {
    for (const col of HOUR_BANDS) {
      const value = counts.get(`${row}:${col}`) ?? 0;
      if (value > max) max = value;
      cells.push({ row, col, value });
    }
  }
  return { cells, max };
}

function barsByProject(sessions: SessionRow[], cap = 6): BarDatum[] {
  const counts = new Map<string, number>();
  for (const session of sessions) {
    const label = projectBasename(session.project_root);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, cap)
    .map(([label, value]) => ({ label, value }));
}

function sessionsPerDaySeries(pulse: PulseDay[]): TrendSeries[] {
  return [{
    id: "sessions",
    label: "Sessions",
    color: "var(--accent-presence)",
    points: pulse.map((day, x) => ({ x, y: day.count })),
  }];
}

function cumulativeSeries(pulse: PulseDay[]): TrendSeries[] {
  let sum = 0;
  return [{
    id: "cumulative",
    label: "Cumulative sessions",
    color: "var(--color-success)",
    points: pulse.map((day, x) => {
      sum += day.count;
      return { x, y: sum };
    }),
  }];
}

// ── Shared chrome ────────────────────────────────────────────────────────────

function CarouselDots({
  labels,
  index,
  onGo,
}: {
  labels: string[];
  index: number;
  onGo: (i: number) => void;
}) {
  return (
    <span className="familiar-analytics-tab__dots">
      {labels.map((label, i) => (
        <button
          key={label}
          type="button"
          className={`familiar-analytics-tab__dot focus-ring${i === index ? " is-active" : ""}`}
          aria-label={label}
          aria-current={i === index || undefined}
          onClick={() => onGo(i)}
        />
      ))}
    </span>
  );
}

/** Grid-stacked slide: stays mounted, toggles visibility so charts never re-measure. */
function Slide({ hidden, children }: { hidden: boolean; children: React.ReactNode }) {
  return (
    <div
      className={`familiar-analytics-tab__slide${hidden ? " is-hidden" : ""}`}
      aria-hidden={hidden || undefined}
    >
      {children}
    </div>
  );
}

// ── Section ──────────────────────────────────────────────────────────────────

const RECENT_RUNS_SHOWN = 7;
const HEAL_REQUESTS_SHOWN = 5;

// Remounting this section (tab flips, familiar switches back and forth) used
// to re-fire all eight analytics endpoints every time. Cache the last landed
// snapshot per familiar for one poll interval and serve it on mount; the 60s
// quiet poll keeps it honest.
const ANALYTICS_CACHE_TTL_MS = 60_000;
const analyticsCache = new Map<string, { data: FamiliarAnalyticsData; at: number }>();

export function FamiliarAnalyticsSection({ familiar }: { familiar: Familiar }) {
  const [data, setData] = useState<FamiliarAnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Truthful freshness stamp — set when a load actually lands, never faked.
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [trendIdx, setTrendIdx] = useState(0);
  const [chartIdx, setChartIdx] = useState(0);

  // Only the latest issued load may write state (mount, familiar switch,
  // manual refresh, and the 60s poll interleave).
  const generation = useRef(0);

  const load = useCallback(async ({ quiet = false } = {}) => {
    const gen = ++generation.current;
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const next = await loadFamiliarAnalyticsData(familiar.id);
      if (generation.current !== gen) return;
      analyticsCache.set(familiar.id, { data: next, at: Date.now() });
      setData(next);
      setUpdatedAt(new Date().toISOString());
    } catch (err) {
      if (generation.current !== gen) return;
      setError(err instanceof Error ? err.message : "analytics data unavailable");
    } finally {
      if (generation.current === gen) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [familiar.id]);

  useEffect(() => {
    const cached = analyticsCache.get(familiar.id);
    if (cached && Date.now() - cached.at < ANALYTICS_CACHE_TTL_MS) {
      setData(cached.data);
      setUpdatedAt(new Date(cached.at).toISOString());
      setLoading(false);
      return;
    }
    setData(null);
    setUpdatedAt(null);
    void load();
  }, [familiar.id, load]);

  usePausablePoll(() => void load({ quiet: true }), 60_000);

  const model = useMemo(() => (data ? buildFamiliarAnalyticsModel(data) : null), [data]);

  if (loading && !model) {
    return (
      <div className="familiar-analytics-tab" aria-busy="true">
        <SkeletonRows count={8} />
      </div>
    );
  }

  if (!model) {
    return (
      <div className="familiar-analytics-tab">
        {error ? (
          <div className="familiar-analytics-tab__alert" role="alert">
            <Icon name="ph:warning-circle" aria-hidden />
            <span>{error}</span>
            <button type="button" className="familiar-analytics-tab__retry focus-ring" onClick={() => void load()}>
              Retry
            </button>
          </div>
        ) : (
          <EmptyState
            compact
            icon="ph:terminal-window"
            headline="No analytics yet."
            subtitle="Numbers appear once this familiar has run a session."
          />
        )}
      </div>
    );
  }

  return <AnalyticsBody
    model={model}
    error={error}
    updatedAt={updatedAt}
    refreshing={refreshing}
    onRefresh={() => void load({ quiet: true })}
    onRetry={() => void load()}
    trendIdx={trendIdx}
    setTrendIdx={setTrendIdx}
    chartIdx={chartIdx}
    setChartIdx={setChartIdx}
  />;
}

const TREND_LABELS = ["Sessions per day", "Cumulative sessions"];
const CHART_LABELS = ["Session outcomes", "Sessions by project", "Activity by weekday"];

function AnalyticsBody({
  model,
  error,
  updatedAt,
  refreshing,
  onRefresh,
  onRetry,
  trendIdx,
  setTrendIdx,
  chartIdx,
  setChartIdx,
}: {
  model: FamiliarAnalyticsModel;
  error: string | null;
  updatedAt: string | null;
  refreshing: boolean;
  onRefresh: () => void;
  onRetry: () => void;
  trendIdx: number;
  setTrendIdx: (updater: (i: number) => number) => void;
  chartIdx: number;
  setChartIdx: (updater: (i: number) => number) => void;
}) {
  const { sessionPulse, recentSessions, healRequests } = model;
  const outcomes = useMemo(() => countOutcomes(recentSessions), [recentSessions]);
  const windowTotal = pulseTotal(sessionPulse);
  const delta = pulseDelta(sessionPulse);
  const attempted = outcomes.completed + outcomes.failed;
  const successRate = attempted > 0 ? `${Math.round((outcomes.completed / attempted) * 100)}%` : "—";

  const trendSlides = useMemo(() => [
    sessionsPerDaySeries(sessionPulse),
    cumulativeSeries(sessionPulse),
  ], [sessionPulse]);
  const heat = useMemo(() => heatmapFromSessions(recentSessions), [recentSessions]);
  const bars = useMemo(() => barsByProject(recentSessions), [recentSessions]);
  const heatColorFor = useCallback((value: number) => {
    if (value === 0) return "var(--bg-raised)";
    const pct = Math.round(20 + (value / Math.max(1, heat.max)) * 80);
    return `color-mix(in oklch, var(--accent-presence) ${pct}%, transparent)`;
  }, [heat.max]);

  const shownRuns = recentSessions.slice(0, RECENT_RUNS_SHOWN);
  const shownHeals = healRequests.slice(0, HEAL_REQUESTS_SHOWN);

  // Deltas only when the pulse window has anything to compare — an all-zero
  // window renders no delta rather than a fake "steady".
  const sessionsNote = delta.current + delta.previous > 0
    ? delta.delta === 0 ? "steady" : `${delta.delta > 0 ? "+" : "−"}${Math.abs(delta.delta)} wk`
    : null;
  const sessionsNoteTone = delta.delta > 0 ? "up" : delta.delta < 0 ? "down" : "flat";

  return (
    <div className="familiar-analytics-tab">
      {error ? (
        <div className="familiar-analytics-tab__alert" role="alert">
          <Icon name="ph:warning-circle" aria-hidden />
          <span>{error}</span>
          <button type="button" className="familiar-analytics-tab__retry focus-ring" onClick={onRetry}>
            Retry
          </button>
        </div>
      ) : null}
      {model.errors.length > 0 ? (
        <div className="familiar-analytics-tab__alert" role="alert">
          <Icon name="ph:warning-circle" aria-hidden />
          <span>Some analytics endpoints degraded: {model.errors.join("; ")}</span>
        </div>
      ) : null}

      <div className="familiar-analytics-tab__toolbar">
        <span className="familiar-analytics-tab__freshness">
          {updatedAt ? `updated ${relativeTime(updatedAt)}` : ""}
        </span>
        <IconButton
          icon="ph:arrow-clockwise"
          size="sm"
          aria-label="Refresh analytics"
          onClick={onRefresh}
          disabled={refreshing}
        />
      </div>

      {/* KPI row — every value computed from the model, no fabricated numbers. */}
      <div className="familiar-analytics-tab__kpis">
        <div className="familiar-analytics-tab__kpi">
          <span className="familiar-analytics-tab__kpi-label">Sessions</span>
          <span className="familiar-analytics-tab__kpi-value">{windowTotal}</span>
          {sessionsNote ? (
            <span className={`familiar-analytics-tab__kpi-note familiar-analytics-tab__kpi-note--${sessionsNoteTone}`}>
              {sessionsNote}
            </span>
          ) : null}
        </div>
        <div className="familiar-analytics-tab__kpi">
          <span className="familiar-analytics-tab__kpi-label">Completed</span>
          <span className="familiar-analytics-tab__kpi-value">{outcomes.completed}</span>
          <span className="familiar-analytics-tab__kpi-note">of {recentSessions.length} recent</span>
        </div>
        <div className="familiar-analytics-tab__kpi">
          <span className="familiar-analytics-tab__kpi-label">Success rate</span>
          <span className="familiar-analytics-tab__kpi-value">{successRate}</span>
        </div>
        <div className="familiar-analytics-tab__kpi">
          <span className="familiar-analytics-tab__kpi-label">Running now</span>
          <span className="familiar-analytics-tab__kpi-value">{outcomes.running}</span>
        </div>
      </div>

      {recentSessions.length === 0 ? (
        <EmptyState
          compact
          icon="ph:terminal-window"
          headline="No sessions yet."
          subtitle="Charts appear once this familiar has run a session."
        />
      ) : (
        <div className="familiar-analytics-tab__grid">
          {/* Trend carousel — two real trends derived from the 14-day pulse. */}
          <section aria-label="Trend carousel" className="familiar-analytics-tab__card">
            <div className="familiar-analytics-tab__card-head">
              <span className="familiar-analytics-tab__card-title">{TREND_LABELS[trendIdx]}</span>
              <span className="familiar-analytics-tab__nav">
                <IconButton
                  icon="ph:caret-left"
                  size="xs"
                  aria-label="Previous trend"
                  onClick={() => setTrendIdx((i) => (i + TREND_LABELS.length - 1) % TREND_LABELS.length)}
                />
                <CarouselDots labels={TREND_LABELS} index={trendIdx} onGo={(i) => setTrendIdx(() => i)} />
                <IconButton
                  icon="ph:caret-right"
                  size="xs"
                  aria-label="Next trend"
                  onClick={() => setTrendIdx((i) => (i + 1) % TREND_LABELS.length)}
                />
              </span>
            </div>
            <div className="familiar-analytics-tab__stack">
              <Slide hidden={trendIdx !== 0}>
                <TrendChart
                  series={trendSlides[0]}
                  height={160}
                  ariaLabel={`Sessions per day over the last ${sessionPulse.length} days, ${windowTotal} total`}
                />
              </Slide>
              <Slide hidden={trendIdx !== 1}>
                <TrendChart
                  series={trendSlides[1]}
                  height={160}
                  ariaLabel={`Cumulative sessions over the last ${sessionPulse.length} days, reaching ${windowTotal}`}
                />
              </Slide>
            </div>
          </section>

          {/* Chart carousel — outcomes donut, per-project bars, weekday heatmap. */}
          <section aria-label="Chart carousel" className="familiar-analytics-tab__card">
            <div className="familiar-analytics-tab__card-head">
              <span className="familiar-analytics-tab__card-title">{CHART_LABELS[chartIdx]}</span>
              <span className="familiar-analytics-tab__nav">
                <IconButton
                  icon="ph:caret-left"
                  size="xs"
                  aria-label="Previous chart"
                  onClick={() => setChartIdx((i) => (i + CHART_LABELS.length - 1) % CHART_LABELS.length)}
                />
                <CarouselDots labels={CHART_LABELS} index={chartIdx} onGo={(i) => setChartIdx(() => i)} />
                <IconButton
                  icon="ph:caret-right"
                  size="xs"
                  aria-label="Next chart"
                  onClick={() => setChartIdx((i) => (i + 1) % CHART_LABELS.length)}
                />
              </span>
            </div>
            <div className="familiar-analytics-tab__stack familiar-analytics-tab__stack--charts">
              <Slide hidden={chartIdx !== 0}>
                <div className="familiar-analytics-tab__donut-wrap">
                  <DonutChart
                    size={150}
                    thickness={20}
                    data={[
                      { label: "Completed", value: outcomes.completed, color: "var(--color-success)" },
                      { label: "Running", value: outcomes.running, color: "var(--accent-presence)" },
                      { label: "Failed", value: outcomes.failed, color: "var(--color-danger)" },
                    ]}
                    ariaLabel={`Session outcomes: ${outcomes.completed} completed, ${outcomes.running} running, ${outcomes.failed} failed`}
                  />
                </div>
              </Slide>
              <Slide hidden={chartIdx !== 1}>
                <BarChart data={bars} height={150} defaultColor="var(--accent-presence)" />
              </Slide>
              <Slide hidden={chartIdx !== 2}>
                <Heatmap
                  rows={[...WEEKDAYS]}
                  cols={[...HOUR_BANDS]}
                  cells={heat.cells}
                  colorFor={heatColorFor}
                  height={150}
                  ariaLabel={`Session activity by weekday and time of day across the last ${recentSessions.length} sessions`}
                  cellTitle={(cell) => `${cell.row} ${cell.col}: ${cell.value} session${cell.value === 1 ? "" : "s"}`}
                />
              </Slide>
            </div>
          </section>
        </div>
      )}

      <div className="familiar-analytics-tab__grid">
        {/* Recent runs — same /#chat-<id> drill-through as the analytics page. */}
        <section aria-label="Recent runs" className="familiar-analytics-tab__card familiar-analytics-tab__card--list">
          <div className="familiar-analytics-tab__card-head familiar-analytics-tab__card-head--list">
            <span className="familiar-analytics-tab__card-title">Recent runs</span>
            <span className="familiar-analytics-tab__card-meta">
              {shownRuns.length > 0 ? `latest ${shownRuns.length}` : ""}
            </span>
          </div>
          {shownRuns.length === 0 ? (
            <p className="familiar-analytics-tab__quiet">No runs yet.</p>
          ) : (
            <ul className="familiar-analytics-tab__runs">
              {shownRuns.map((session) => {
                const dur = runDuration(session);
                const lifecycle: CardLifecycle = sessionOutcome(session.status);
                return (
                  <li key={session.id} className="familiar-analytics-tab__run">
                    <a
                      className="familiar-analytics-tab__run-title focus-ring"
                      href={`/#chat-${encodeURIComponent(session.id)}`}
                      title="Open this thread in chat"
                    >
                      {session.title || projectBasename(session.project_root)}
                    </a>
                    <span className="familiar-analytics-tab__run-when">{relativeTime(session.updated_at)}</span>
                    <span className="familiar-analytics-tab__run-dur">{dur ?? ""}</span>
                    <LifecycleBadge lifecycle={lifecycle} />
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Needs a human — real self-heal requests from the model. */}
        <section aria-label="Needs a human" className="familiar-analytics-tab__card familiar-analytics-tab__card--list">
          <div className="familiar-analytics-tab__card-head familiar-analytics-tab__card-head--list">
            <span className="familiar-analytics-tab__card-title">Needs a human</span>
            <span
              className={`familiar-analytics-tab__count-pill${healRequests.length > 0 ? " familiar-analytics-tab__count-pill--warning" : ""}`}
            >
              {healRequests.length}
            </span>
          </div>
          {shownHeals.length === 0 ? (
            <p className="familiar-analytics-tab__quiet">Nothing waiting on you.</p>
          ) : (
            <ul className="familiar-analytics-tab__heals">
              {shownHeals.map((request) => (
                <li key={request.id} className="familiar-analytics-tab__heal">
                  <span className="familiar-analytics-tab__heal-title">{request.title}</span>
                  <span className="familiar-analytics-tab__heal-note">{request.detail}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
