"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type CSSProperties } from "react";
import { Icon } from "@/lib/icon";
import type { IconName } from "@/lib/icon";
import { AuthedImage } from "@/components/ui/authed-image";
import type { DashboardModel } from "@/lib/dashboard-model";
import type { Card, CardStatus } from "@/lib/cave-board-types";
import type { Familiar, SessionRow } from "@/lib/types";
import type { GitHubItem } from "@/lib/github-tasks";
import type { InboxItem } from "@/lib/cave-inbox";
import { relativeTime } from "@/lib/daily-report";
import { useDateTimePrefs } from "@/lib/datetime-format";
import { SectionHead, EmptyState, QuickLink } from "@/components/daily-report-ui";
import { Sparkline, type SparkPoint } from "@/components/ui/sparkline";
import { DonutChart } from "@/components/ui/charts/donut-chart";
import { TrendChart } from "@/components/ui/charts/trend-chart";
import { Heatmap } from "@/components/ui/charts/heatmap";
import {
  familiarMiniProfiles, familiarLoadSeries, dashboardSignals, type DashboardSignal, type FamiliarMiniProfile,
  defaultInsightOrder, sortInsightRows, filterInsightRows, type InsightSortKey, type SortDir,
  spaceUsageRows, sortSpaceRows, formatBytes, type SpaceSortKey, type SpaceUsageRow,
} from "@/lib/dashboard-analytics";
import type { SpaceUsageArea } from "@/lib/server/space-usage";
import {
  deriveCovenVitals, deriveCovenInsight, covenSessionsSeries,
  type FamiliarInsightRow, type CovenVitals,
} from "@/lib/coven-analytics";
import { deriveConfidenceScore, type ConfidenceScore, type ConfidenceFactor } from "@/lib/familiar-confidence";
import { deriveGrowthReport } from "@/lib/familiar-growth-signals";
import { buildFamiliarCardStats, type FamiliarCardStats, type CovenMemoryEntry } from "@/components/familiars-view-stats";
import type { ContractReport } from "@/lib/familiar-contract";
import type { RetroRunsSnapshot } from "@/lib/retro-runs";
import { usePausablePoll } from "@/lib/use-pausable-poll";
import { useMinuteTick } from "@/lib/use-minute-tick";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";
import { ActionInbox } from "@/components/dashboard/action-inbox";
import { TodaySummary } from "@/components/dashboard/today-summary";
import { RecentReports } from "@/components/dashboard/recent-reports";
import {
  DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors, closestCenter,
  type Announcements, type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, useSortable, arrayMove, sortableKeyboardCoordinates, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { openExternalUrl } from "@/lib/open-external";

// ─── Data shapes (client-fetched) ──────────────────────────────────────────────

type CockpitData = {
  cards: Card[];
  familiars: Familiar[];
  github: GitHubItem[];
  upcoming: InboxItem[];
  sessions: SessionRow[];
  memory: CovenMemoryEntry[];
  space: SpaceUsageArea[];
};

const EMPTY: CockpitData = { cards: [], familiars: [], github: [], upcoming: [], sessions: [], memory: [], space: [] };

const EMPTY_STATS: FamiliarCardStats = { memoryCount: 0, latestMemory: null, lastSessionAt: null, sessionsLast7d: 0, hasActiveSession: false };

// Contracts are fetched per-familiar; bound the fan-out for large covens. Rows
// beyond the cap still show activity/health (which need no contract) — they
// just read "—" for confidence.
const CONTRACT_FETCH_CAP = 12;

// Draggable secondary panels — order per column, persisted to localStorage. The
// insights hero (vitals + coven read + familiar table) is fixed above the grid.
const LAYOUT_KEY = "cave:cockpit:layout:v2";
type Layout = { main: string[]; rail: string[] };
const DEFAULT_LAYOUT: Layout = {
  main: ["usage", "signals", "needs", "board", "today"],
  rail: ["confidence", "agents", "load", "space", "github", "agenda"],
};

// Human titles for drag-and-drop announcements + grip labels (mirrors each
// widget's <Panel title>). dnd-kit's defaults read the raw ids, which are
// semantic but terse — screen readers should hear the visible panel names.
const PANEL_TITLES: Record<string, string> = {
  usage: "Activity over time",
  signals: "Signals",
  needs: "Needs attention",
  board: "Board",
  today: "Today summary",
  confidence: "Performance matrix",
  agents: "Familiars",
  load: "Familiar load",
  space: "Space usage",
  github: "GitHub",
  agenda: "Up next",
};
const panelTitle = (id: unknown): string => PANEL_TITLES[String(id)] ?? String(id);

/** Merge a saved order with the defaults: keep known ids in saved order, append
 *  any new defaults, drop anything unknown (survives version changes). */
function reconcileLayout(stored: Partial<Layout>): Layout {
  const fix = (saved: string[] | undefined, def: string[]) => {
    const s = (saved ?? []).filter((id) => def.includes(id));
    for (const id of def) if (!s.includes(id)) s.push(id);
    return s;
  };
  return { main: fix(stored.main, DEFAULT_LAYOUT.main), rail: fix(stored.rail, DEFAULT_LAYOUT.rail) };
}

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// ─── 7-day vitals trends (persisted client-side, keyed by day) ────────────────────

const TRENDS_KEY = "cave:cockpit:trends:v2";
const TREND_DAYS = 7;
type TrendKey = "confidence" | "active" | "sessions" | "accept" | "contract" | "needs";
type DaySnap = Record<TrendKey, number>;
type TrendStore = Record<string, DaySnap>; // "YYYY-MM-DD" -> snapshot

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Last `TREND_DAYS` points for one metric, oldest→newest; null value for missing days. */
function seriesFor(store: TrendStore, key: TrendKey, now: Date): SparkPoint[] {
  const out: SparkPoint[] = [];
  for (let i = TREND_DAYS - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    const v = store[dayKey(d)]?.[key];
    out.push({
      label: d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }),
      value: typeof v === "number" ? v : null,
    });
  }
  return out;
}

// ─── Status vocab ──────────────────────────────────────────────────────────────

const STATUS_META: Record<CardStatus, { label: string; color: string }> = {
  running: { label: "In progress", color: "var(--color-success)" },
  review: { label: "In review", color: "var(--color-info)" },
  blocked: { label: "Blocked", color: "var(--color-danger)" },
  inbox: { label: "Inbox", color: "var(--accent-presence)" },
  backlog: { label: "Backlog", color: "var(--text-muted)" },
  done: { label: "Done", color: "color-mix(in oklch, var(--color-success) 55%, var(--text-muted))" },
};
const STATUS_ORDER: CardStatus[] = ["running", "review", "blocked", "inbox", "backlog", "done"];

const HEALTH_META: Record<NonNullable<FamiliarInsightRow["health"]>, { label: string; tone: "good" | "warn" | "bad" | "calm" }> = {
  active: { label: "Active", tone: "good" },
  steady: { label: "Steady", tone: "calm" },
  quiet: { label: "Quiet", tone: "warn" },
  stalled: { label: "Stalled", tone: "bad" },
};

const TIER_TONE: Record<string, "good" | "warn" | "bad" | "calm"> = {
  Trusted: "good", Reliable: "calm", Developing: "warn", Low: "bad",
};

// ─── Root ───────────────────────────────────────────────────────────────────────

export function DashboardCockpit({ model }: { model: DashboardModel }) {
  useDateTimePrefs(); // subscribe: re-render when the date/time density pref changes
  useMinuteTick();    // keep the "Updated Nm ago" pill honest between polls
  const [data, setData] = useState<CockpitData>(EMPTY);
  // Each source populates independently so a panel renders the moment its data
  // lands — the slow ones (sessions) never block the fast ones (board, familiars).
  const [ready, setReady] = useState<ReadonlySet<keyof CockpitData>>(new Set());
  // Truthful freshness: stamped when fetched data actually lands (not render
  // time), so a backgrounded tab shows real staleness when you come back.
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // Keep setState off an unmounted tree: the polled `load` may resolve after
  // unmount. A ref survives across the stable `load` identity.
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  const load = useCallback(() => {
    const put = <K extends keyof CockpitData>(key: K, value: CockpitData[K]) => {
      if (!aliveRef.current) return;
      setData((d) => ({ ...d, [key]: value }));
      setReady((r) => new Set(r).add(key));
      setLastUpdated(new Date());
    };
    void getJson<{ cards: Card[] }>("/api/board").then((r) => put("cards", r?.cards ?? []));
    void getJson<{ familiars: Familiar[] }>("/api/familiars").then((r) => put("familiars", r?.familiars ?? []));
    void getJson<{ items: InboxItem[] }>("/api/inbox?status=pending").then((r) => put("upcoming", r?.items ?? []));
    void getJson<{ sessions: SessionRow[] }>("/api/sessions/list").then((r) => put("sessions", r?.sessions ?? []));
    void getJson<{ entries: CovenMemoryEntry[] }>("/api/coven-memory").then((r) => put("memory", r?.entries ?? []));
    void getJson<{ areas: SpaceUsageArea[] }>("/api/space-usage").then((r) => put("space", r?.areas ?? []));
    void Promise.all([
      getJson<{ items: GitHubItem[] }>("/api/github/activity"),
      getJson<{ items: GitHubItem[] }>("/api/github/assigned"),
    ]).then(([ghAct, ghAssigned]) => {
      const ghMap = new Map<string, GitHubItem>();
      for (const it of [...(ghAct?.items ?? []), ...(ghAssigned?.items ?? [])]) ghMap.set(it.id, it);
      put("github", [...ghMap.values()]);
    });
  }, []);

  // Initial mount load, then refresh on a paused-when-backgrounded interval.
  useEffect(() => { load(); }, [load]);
  usePausablePoll(load, 30_000);

  const now = model.date;
  const nowMs = now.getTime();

  // ── Derived board figures ──
  const open = data.cards.filter((c) => c.status !== "done");
  const byStatus = useMemo(() => {
    const m = new Map<CardStatus, number>();
    for (const c of data.cards) m.set(c.status, (m.get(c.status) ?? 0) + 1);
    return m;
  }, [data.cards]);
  const activeCards = data.cards
    .filter((c) => c.status === "running" || c.status === "review" || c.status === "blocked")
    .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));

  const prsToReview = data.github.filter(
    (g) => g.kind === "review_request" || (g.kind === "pr" && g.state !== "closed"),
  );

  const upcoming = data.upcoming
    .filter((i) => i.kind === "reminder" && i.fireAt && new Date(i.fireAt).getTime() > nowMs)
    .sort((a, b) => new Date(a.fireAt!).getTime() - new Date(b.fireAt!).getTime())
    .slice(0, 5);

  // Predictive signals — pure + cheap over already-fetched data.
  const signals = useMemo(
    () => dashboardSignals({
      github: data.github, reading: [], sessions: data.sessions, familiars: data.familiars, nowMs,
    }),
    [data.github, data.sessions, data.familiars, nowMs],
  );

  // ── Per-familiar contract fetch (bounded) + one shared retro-runs snapshot.
  //    Keyed on the visible familiar set; rows recompute from live sessions. ──
  const [confidenceRaw, setConfidenceRaw] = useState<{
    contractsById: Map<string, ContractReport | null>; snapshot: RetroRunsSnapshot | null;
  } | null>(null);
  const contractFams = data.familiars.slice(0, CONTRACT_FETCH_CAP);
  const contractKey = contractFams.map((f) => f.id).join(",");
  const contractFetchedCount = contractFams.length;
  const contractFetchPartial = data.familiars.length > contractFetchedCount;
  useEffect(() => {
    if (!contractKey) { setConfidenceRaw(null); return; }
    let alive = true;
    const ids = contractKey.split(",");
    void Promise.all([
      getJson<{ snapshot?: RetroRunsSnapshot }>("/api/retro-runs"),
      ...ids.map((id) => getJson<{ report?: ContractReport }>(`/api/familiars/${encodeURIComponent(id)}/contract`)),
    ]).then(([retro, ...contracts]) => {
      if (!alive || !aliveRef.current) return;
      const contractsById = new Map<string, ContractReport | null>();
      ids.forEach((id, i) => contractsById.set(id, contracts[i]?.report ?? null));
      setConfidenceRaw({ contractsById, snapshot: retro?.snapshot ?? null });
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contractKey]);

  // ── Per-familiar insight rows (+ full confidence for the heatmap). Growth and
  //    activity derive from sessions/memory for every familiar; confidence only
  //    for those whose contract was fetched. ──
  const perFamiliar = useMemo(() => {
    if (data.familiars.length === 0) return [] as { row: FamiliarInsightRow; confidence: ConfidenceScore | null }[];
    const statsById = buildFamiliarCardStats({
      familiars: data.familiars, sessions: data.sessions, covenEntries: data.memory,
    });
    const profiles = familiarMiniProfiles(data.familiars, data.sessions, nowMs);
    const profileById = new Map<string, FamiliarMiniProfile>(profiles.map((p) => [p.id, p]));
    const snapshot = confidenceRaw?.snapshot ?? null;
    const contractsById = confidenceRaw?.contractsById ?? null;

    return data.familiars.map((f) => {
      const stats = statsById.get(f.id) ?? EMPTY_STATS;
      const profile = profileById.get(f.id);
      const retroState = snapshot?.familiars.find((r) => r.familiarId === f.id) ?? null;
      const growth = deriveGrowthReport({ familiar: f, stats, retroState, now: nowMs });
      const hasContract = contractsById?.has(f.id) ?? false;
      const contract = hasContract ? contractsById!.get(f.id) ?? null : null;
      const confidence = hasContract
        ? deriveConfidenceScore({ contractReport: contract, growthReport: growth, familiar: f })
        : null;
      const row: FamiliarInsightRow = {
        id: f.id,
        name: f.display_name,
        role: f.role || f.model || f.harness || "Familiar",
        color: f.color || "var(--accent-presence)",
        emoji: f.emoji ?? null,
        avatarUrl: f.avatarUrl ?? null,
        active: (f.active_sessions ?? 0) > 0 || stats.hasActiveSession,
        confidenceScore: confidence ? confidence.score : null,
        confidenceLabel: confidence ? confidence.label : null,
        health: growth.healthLabel,
        sessions7d: stats.sessionsLast7d,
        trend: profile?.trend ?? [],
        contractPass: contract ? contract.properties.filter((p) => p.pass).length : 0,
        contractTotal: contract ? contract.properties.length : 0,
        lastActiveAt: stats.lastSessionAt,
      };
      return { row, confidence };
    });
  }, [data.familiars, data.sessions, data.memory, confidenceRaw, nowMs]);

  const insightRows = useMemo(() => perFamiliar.map((x) => x.row), [perFamiliar]);
  const heatmapRows = useMemo<ConfidenceRow[]>(
    () => perFamiliar
      .filter((x) => x.confidence)
      .map((x) => ({ id: x.row.id, name: x.row.name, score: x.confidence!.score, factors: x.confidence!.factors })),
    [perFamiliar],
  );

  // ── Coven vitals + the plain-language read that leads the page ──
  const vitals = useMemo<CovenVitals>(
    () => deriveCovenVitals({
      rows: insightRows,
      sessions: data.sessions,
      retro: confidenceRaw?.snapshot
        ? { accepted: confidenceRaw.snapshot.summary.accepted, reverted: confidenceRaw.snapshot.summary.reverted }
        : null,
      nowMs,
    }),
    [insightRows, data.sessions, confidenceRaw, nowMs],
  );
  const covenInsight = useMemo(
    () => deriveCovenInsight({ vitals, rows: insightRows, familiarsLoaded: ready.has("familiars") }),
    [vitals, insightRows, ready],
  );
  const covenSeries = useMemo(() => covenSessionsSeries(data.sessions, nowMs, 14), [data.sessions, nowMs]);

  // ── Vitals KPI specs. Every tile is a live analytics figure with a 7-day
  //    trend; each carries the direction that reads as "good" so the delta is
  //    colored by meaning, and drills into the surface that owns the number. ──
  const contractPct = vitals.contractTotal ? Math.round((vitals.contractPass / vitals.contractTotal) * 100) : null;
  const acceptPct = vitals.retroAcceptRate != null ? Math.round(vitals.retroAcceptRate * 100) : null;
  const scoredCoverageSub = coverageSub(vitals.confidenceTier ?? "no scores yet", contractFetchedCount, data.familiars.length, "scored");
  const contractCoverageSub = coverageSub(contractSub(vitals), contractFetchedCount, data.familiars.length, "checked");
  const kpis: KpiSpec[] = [
    { icon: "ph:seal-check", value: vitals.avgConfidence, label: "Coven confidence", sub: contractFetchPartial ? scoredCoverageSub : vitals.confidenceTier ?? "no scores yet", accent: "teal", metric: "confidence", good: "up", href: "/dashboard/familiars/growth" },
    { icon: "ph:sparkle", value: vitals.activeFamiliars, label: "Active familiars", sub: `${vitals.familiarCount} in coven`, accent: "green", metric: "active", good: "up", src: "familiars", href: "/?mode=agents" },
    { icon: "ph:heartbeat", value: vitals.sessions7d, label: "Sessions · 7d", sub: wowSub(vitals.sessionsWowDelta), accent: "lavender", metric: "sessions", good: "up", src: "sessions", href: "/?mode=agents" },
    { icon: "ph:flag-checkered", value: acceptPct, suffix: "%", label: "Retro accept rate", sub: retroSub(vitals), accent: "blue", metric: "accept", good: "up", href: "/dashboard/familiars/growth" },
    { icon: "ph:list-checks-bold", value: contractPct, suffix: "%", label: "Contract health", sub: contractFetchPartial ? contractCoverageSub : contractSub(vitals), accent: "amber", metric: "contract", good: "up", href: "/dashboard/familiars/growth" },
    { icon: "ph:warning-circle", value: model.needsAttention.length, label: "Needs you", sub: model.caughtUp ? "all clear" : "open items", accent: "rose", metric: "needs", good: "down" },
  ];

  // ── 7-day vitals trends: load history; snapshot today once the feeding data
  //    is in (familiars + confidence). ──
  const [trends, setTrends] = useState<TrendStore>({});
  useEffect(() => {
    try { const raw = localStorage.getItem(TRENDS_KEY); if (raw) setTrends(JSON.parse(raw) as TrendStore); } catch { /* ignore */ }
  }, []);
  const vitalsReady = ready.has("cards") && ready.has("familiars") && (confidenceRaw !== null || data.familiars.length === 0);
  useEffect(() => {
    if (!vitalsReady) return;
    const snap: DaySnap = {
      confidence: vitals.avgConfidence ?? 0,
      active: vitals.activeFamiliars,
      sessions: vitals.sessions7d,
      accept: acceptPct ?? 0,
      contract: contractPct ?? 0,
      needs: model.needsAttention.length,
    };
    setTrends((prev) => {
      const store: TrendStore = { ...prev, [dayKey(now)]: snap };
      const days = Object.keys(store).sort();
      while (days.length > 30) delete store[days.shift()!];
      try { localStorage.setItem(TRENDS_KEY, JSON.stringify(store)); } catch { /* ignore */ }
      return store;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vitalsReady, vitals.avgConfidence, vitals.activeFamiliars, vitals.sessions7d, acceptPct, contractPct, model.needsAttention.length]);

  // ── Draggable secondary layout ──
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const [layout, setLayout] = useState<Layout>(DEFAULT_LAYOUT);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LAYOUT_KEY);
      if (raw) setLayout(reconcileLayout(JSON.parse(raw)));
    } catch { /* storage may be unavailable */ }
  }, []);
  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const a = String(active.id), o = String(over.id);
    for (const col of ["main", "rail"] as const) {
      const list = layout[col];
      if (list.includes(a) && list.includes(o)) {
        const next: Layout = { ...layout, [col]: arrayMove(list, list.indexOf(a), list.indexOf(o)) };
        setLayout(next);
        try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(next)); } catch { /* ignore */ }
        return;
      }
    }
  };

  // Speak panel titles + positions during drag — dnd-kit's defaults read the
  // raw widget ids. Positions come from the pre-move layout: with arrayMove
  // semantics the dragged panel takes over.id's index, so it reads correctly
  // for the drop announcement too.
  const positionOf = (id: string): { index: number; count: number } | null => {
    for (const col of ["main", "rail"] as const) {
      const idx = layout[col].indexOf(id);
      if (idx !== -1) return { index: idx + 1, count: layout[col].length };
    }
    return null;
  };
  const dragAnnouncements: Announcements = {
    onDragStart({ active }) {
      const pos = positionOf(String(active.id));
      return `Picked up ${panelTitle(active.id)}${pos ? `, position ${pos.index} of ${pos.count}` : ""}.`;
    },
    onDragOver({ active, over }) {
      if (!over) return undefined;
      const pos = positionOf(String(over.id));
      return pos ? `${panelTitle(active.id)} is over position ${pos.index} of ${pos.count}.` : undefined;
    },
    onDragEnd({ active, over }) {
      if (!over) return `${panelTitle(active.id)} was dropped.`;
      const pos = positionOf(String(over.id));
      return pos
        ? `${panelTitle(active.id)} moved to position ${pos.index} of ${pos.count}.`
        : `${panelTitle(active.id)} was dropped.`;
    },
    onDragCancel({ active }) {
      return `Dragging ${panelTitle(active.id)} cancelled.`;
    },
  };

  const isVisible = (id: string) => {
    if (id === "needs") return !model.caughtUp;
    if (id === "signals") return signals.length > 0;
    if (id === "confidence") return heatmapRows.length > 0;
    return true;
  };
  const widget = (id: string): ReactNode => {
    switch (id) {
      case "usage": return (
        <Panel title="Activity over time" icon="ph:graph-bold" hint="last 14 days">
          <UsagePanel series={covenSeries} load={familiarLoadSeries(data.familiars, data.sessions, nowMs, 7, 4)} loaded={ready.has("sessions")} total={vitals.sessions7d} delta={vitals.sessionsWowDelta} />
        </Panel>);
      case "signals": return signals.length === 0 ? null : (
        <Panel title="Signals" icon="ph:waveform-bold" count={signals.length}>
          <SignalsPanel signals={signals} />
        </Panel>);
      case "confidence": return heatmapRows.length === 0 ? null : (
        <Panel title="Performance matrix" icon="ph:squares-four" href="/dashboard/familiars/growth">
          <ConfidencePanel rows={heatmapRows} />
        </Panel>);
      case "needs": return model.caughtUp ? null : (
        <Panel title="Needs attention" icon="ph:warning-circle" count={model.needsAttention.length}>
          <ActionInbox initialItems={model.needsAttention} />
        </Panel>);
      case "board": return (
        <Panel title="Board" icon="ph:kanban-bold" hint={`${open.length} open`} href="/?mode=board">
          <BoardSnapshot byStatus={byStatus} total={data.cards.length} active={activeCards} loaded={ready.has("cards")} familiars={data.familiars} />
        </Panel>);
      case "today": return <TodaySummary summary={model.todaySummary} featured={model.featuredReport} now={now} />;
      case "agents": return (
        <Panel title="Familiars" icon="ph:users-three" count={data.familiars.length || undefined} href="/?mode=agents">
          <AgentsPanel familiars={data.familiars} sessions={data.sessions} loaded={ready.has("familiars")} />
        </Panel>);
      case "load": {
        const series = familiarLoadSeries(data.familiars, data.sessions, nowMs, 7, 4);
        return (
          <Panel title="Familiar load" icon="ph:chart-bar-bold" href="/dashboard/familiars/growth">
            {series.length > 0 ? (
              <div className="cockpit-load"><TrendChart series={series} height={150} fill={false} /></div>
            ) : (
              <EmptyState icon="ph:chart-bar-bold">No sessions in the last 7 days.</EmptyState>
            )}
          </Panel>);
      }
      case "space": {
        const rows = spaceUsageRows(data.space);
        return (
          <Panel title="Space usage" icon="ph:database-bold" hint={rows.length ? formatBytes(rows.reduce((s, r) => s + r.bytes, 0)) : undefined}>
            <SpaceUsagePanel rows={rows} loaded={ready.has("space")} />
          </Panel>);
      }
      case "github": return (
        <Panel title="GitHub" icon="ph:github-logo" count={data.github.length || undefined} hint={prsToReview.length ? `${prsToReview.length} to review` : undefined} href="/?mode=github">
          <GithubPanel items={data.github} loaded={ready.has("github")} />
        </Panel>);
      case "agenda": return (
        <Panel title="Up next" icon="ph:calendar-bold" count={upcoming.length || undefined} href="/?mode=calendar">
          <AgendaPanel items={upcoming} now={now} loaded={ready.has("upcoming")} />
        </Panel>);
      default: return null;
    }
  };

  return (
    <div className="cockpit">
      {/* Header */}
      <header className="cockpit-head">
        <div>
          <p className="cockpit-eyebrow">
            <Icon name="ph:graph-bold" aria-hidden /> Coven insights · {longDate(now)}
          </p>
          <h1 className="cockpit-title">{covenInsight.headline}</h1>
        </div>
        <div className="cockpit-head__meta">
          {/* The pill doubles as a manual refresh — the label stays truthful
              (stamped when data lands), the click re-pulls everything now. */}
          <button
            type="button"
            className="cockpit-pill cockpit-pill--refresh"
            onClick={load}
            title="Refresh now"
            aria-label={`Refresh now — updated ${lastUpdated ? relativeTime(lastUpdated.toISOString()) || "just now" : "…"}`}
          >
            <Icon name="ph:arrows-clockwise" aria-hidden />
            {lastUpdated ? `Updated ${relativeTime(lastUpdated.toISOString()) || "just now"}` : "Loading…"}
          </button>
        </div>
      </header>

      {/* Plain-language coven read — the "what you should know" line */}
      <CovenInsightBanner insight={covenInsight} />

      {/* Vitals rail */}
      <div className="cockpit-kpis">
        {kpis.map((k) => <KpiTile key={k.label} {...k} loading={k.src ? !ready.has(k.src) : k.value == null} series={seriesFor(trends, k.metric, now)} />)}
      </div>

      {/* Familiar insights — the centerpiece table */}
      <section className="cockpit-panel cockpit-panel--wide" aria-label="Familiar insights">
        <div className="cockpit-panel__head">
          <span className="cockpit-panel__title">
            <Icon name="ph:users-three" className="cockpit-panel__icon" aria-hidden />
            Familiar insights
            {insightRows.length ? <span className="cockpit-panel__count">{insightRows.length}</span> : null}
          </span>
          <span className="cockpit-panel__hint">confidence · activity · contract</span>
          <a className="cockpit-panel__more" href="/dashboard/familiars/growth" aria-label="Open familiar growth">
            <Icon name="ph:arrow-right-bold" aria-hidden />
          </a>
        </div>
        <div className="cockpit-panel__body">
          <FamiliarInsightsTable rows={insightRows} loaded={ready.has("familiars")} />
        </div>
      </section>

      {/* Secondary panels — drag to rearrange (hover for the grip) */}
      <DndContext id="dashboard-cockpit" sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd} accessibility={{ announcements: dragAnnouncements }}>
        <div className="cockpit-grid">
          {(["main", "rail"] as const).map((col) => {
            const ids = layout[col].filter(isVisible);
            return (
              <div key={col} className={`cockpit-col cockpit-col--${col}`}>
                <SortableContext items={ids} strategy={verticalListSortingStrategy}>
                  {ids.map((id) => <SortableWidget key={id} id={id} title={panelTitle(id)}>{widget(id)}</SortableWidget>)}
                </SortableContext>
              </div>
            );
          })}
        </div>
      </DndContext>

      {/* Quick actions + history */}
      <div className="cockpit-launch">
        <SectionHead icon="ph:squares-four" title="Jump back in" />
        <div className="cockpit-quicklinks">
          <QuickLink href="/" icon="ph:house-bold" label="Home" sub="Your cave" />
          <QuickLink href="/?mode=board" icon="ph:kanban-bold" label="Board" sub="Cards & tasks" />
          <QuickLink href="/dashboard/familiars/growth" icon="ph:chart-bar-bold" label="Growth" sub="Familiar performance" />
          <QuickLink href="/?mode=calendar" icon="ph:calendar-bold" label="Calendar" sub="Reminders & agenda" />
          <QuickLink href="/settings" icon="ph:gear-six" label="Settings" sub="Preferences" />
        </div>
      </div>

      <RecentReports reports={model.recentReports} now={now} hasFeatured={Boolean(model.featuredReport)} />

      <footer className="dr-footer">
        This cockpit reads your local board, inbox, familiars, sessions, and GitHub. Everything stays on your machine.
      </footer>
    </div>
  );
}

// ─── Coven insight banner ────────────────────────────────────────────────────────

const INSIGHT_ICON: Record<"good" | "warn" | "bad", IconName> = {
  good: "ph:check-circle-bold", warn: "ph:warning-circle", bad: "ph:warning-fill",
};
function CovenInsightBanner({ insight }: { insight: { headline: string; detail: string; tone: "good" | "warn" | "bad" } }) {
  return (
    <div className={`coven-insight coven-insight--${insight.tone}`} role="note">
      <Icon name={INSIGHT_ICON[insight.tone]} className="coven-insight__icon" aria-hidden />
      <span className="coven-insight__text">
        <b>{insight.headline}.</b> {insight.detail}
      </span>
    </div>
  );
}

// ─── Panel wrapper ───────────────────────────────────────────────────────────────

function Panel({ title, icon, count, hint, href, children }: {
  title: string; icon: IconName; count?: number; hint?: string; href?: string; children: ReactNode;
}) {
  return (
    <section className="cockpit-panel" aria-label={title}>
      <div className="cockpit-panel__head">
        <span className="cockpit-panel__title">
          <Icon name={icon} className="cockpit-panel__icon" aria-hidden />
          {title}
          {count != null ? <span className="cockpit-panel__count">{count}</span> : null}
        </span>
        {hint ? <span className="cockpit-panel__hint">{hint}</span> : null}
        {href ? (
          <a className="cockpit-panel__more" href={href} aria-label={`Open ${title}`}>
            <Icon name="ph:arrow-right-bold" aria-hidden />
          </a>
        ) : null}
      </div>
      <div className="cockpit-panel__body">{children}</div>
    </section>
  );
}

// ─── Sortable widget wrapper ─────────────────────────────────────────────────────

function SortableWidget({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const reduceMotion = usePrefersReducedMotion();
  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    // dnd-kit drives the settle animation via an inline JS transition that the
    // global reduced-motion CSS reset can't reach — drop it so panels snap into
    // place instead of sliding when the user asks for less motion.
    transition: reduceMotion ? undefined : transition,
    zIndex: isDragging ? 20 : undefined,
    opacity: isDragging ? 0.92 : undefined,
  };
  return (
    <div ref={setNodeRef} style={style} className={`cockpit-sortable${isDragging ? " is-dragging" : ""}`}>
      <button type="button" className="cockpit-grip" aria-label={`Drag to rearrange: ${title}`} {...attributes} {...listeners}>
        <Icon name="ph:dots-six-vertical" aria-hidden />
      </button>
      {children}
    </div>
  );
}

// ─── Vitals KPI tile ─────────────────────────────────────────────────────────────

type KpiSpec = {
  icon: IconName; value: number | null; suffix?: string; label: string; sub?: string;
  accent: "rose" | "lavender" | "green" | "blue" | "amber" | "teal";
  metric: TrendKey; good: "up" | "down"; src?: keyof CockpitData; href?: string;
};
const KPI_ACCENT: Record<KpiSpec["accent"], string> = {
  rose: "var(--color-danger)", lavender: "var(--accent-presence)", green: "var(--color-success)",
  blue: "var(--color-info)", amber: "var(--color-warning)", teal: "oklch(0.68 0.12 190)",
};

function KpiTile({ icon, value, suffix, label, sub, accent, good, href, loading, series }: KpiSpec & { loading: boolean; series: SparkPoint[] }) {
  const color = KPI_ACCENT[accent];
  const pts = series.map((p) => p.value).filter((v): v is number => v != null);
  const delta = pts.length >= 2 ? pts[pts.length - 1] - pts[0] : 0;
  // Color the delta by meaning, not direction: a rise in a "good=up" metric is
  // progress (success); a rise in a "good=down" metric (Needs you) is load.
  const beneficial = delta === 0 ? null : (delta > 0) === (good === "up");
  const display = loading || value == null ? "—" : `${value}${suffix ?? ""}`;
  const inner = (
    <>
      <span className="cockpit-kpi__top">
        <span className="cockpit-kpi__icon" style={{ ["--kpi" as string]: color }}>
          <Icon name={icon} aria-hidden />
        </span>
        {!loading && delta !== 0 ? (
          <span
            className={`cockpit-kpi__delta cockpit-kpi__delta--${beneficial ? "good" : "bad"}`}
            title={`${delta > 0 ? "+" : ""}${delta}${suffix ?? ""} over ${TREND_DAYS} days`}
          >
            {delta > 0 ? "▲" : "▼"} {Math.abs(delta)}{suffix ?? ""}
          </span>
        ) : null}
      </span>
      <span className="cockpit-kpi__value">{display}</span>
      <span className="cockpit-kpi__label">{label}</span>
      {sub ? <span className="cockpit-kpi__sub">{sub}</span> : null}
      <Sparkline points={series} color={color} height={22} />
    </>
  );
  return href ? <a className="cockpit-kpi" href={href}>{inner}</a> : <div className="cockpit-kpi">{inner}</div>;
}

function wowSub(delta: number): string {
  if (delta > 0) return `▲ ${delta} vs last week`;
  if (delta < 0) return `▼ ${Math.abs(delta)} vs last week`;
  return "level with last week";
}
function retroSub(v: CovenVitals): string {
  const runs = v.retroAccepted + v.retroReverted;
  if (runs === 0) return "no retro runs";
  return `${v.retroAccepted}/${runs} accepted`;
}
function contractSub(v: CovenVitals): string {
  if (v.contractTotal === 0) return "no contracts";
  return `${v.contractPass}/${v.contractTotal} passing`;
}
function coverageSub(base: string, fetched: number, total: number, verb: "scored" | "checked"): string {
  if (total <= fetched) return base;
  return `${base} · first ${fetched}/${total} ${verb}`;
}

// ─── Familiar insights table (centerpiece) ────────────────────────────────────────

/** Sortable column headers: click cycles default → desc → asc (numeric) or
 *  default → asc → desc (name). The "default" order keeps the curated ranking
 *  (confidence, then activity). */
type InsightSort = { key: InsightSortKey; dir: SortDir } | null;

function FamiliarInsightsTable({ rows, loaded }: { rows: FamiliarInsightRow[]; loaded: boolean }) {
  const [sort, setSort] = useState<InsightSort>(null);
  const [query, setQuery] = useState("");
  const visible = useMemo(() => {
    const filtered = filterInsightRows(rows, query);
    return sort ? sortInsightRows(filtered, sort.key, sort.dir) : defaultInsightOrder(filtered);
  }, [rows, sort, query]);

  const cycleSort = (key: InsightSortKey, firstDir: SortDir) => {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: firstDir };
      const second: SortDir = firstDir === "desc" ? "asc" : "desc";
      return prev.dir === firstDir ? { key, dir: second } : null; // third click restores curated order
    });
  };
  const ariaSort = (key: InsightSortKey): "ascending" | "descending" | "none" =>
    sort?.key === key ? (sort.dir === "asc" ? "ascending" : "descending") : "none";
  const sortHeader = (key: InsightSortKey, label: string, firstDir: SortDir) => (
    <button type="button" className={`cockpit-sorthead${sort?.key === key ? " is-sorted" : ""}`} onClick={() => cycleSort(key, firstDir)}>
      {label}
      <Icon name={sort?.key === key ? (sort.dir === "asc" ? "ph:caret-up" : "ph:caret-down") : "ph:caret-up-down"} aria-hidden />
    </button>
  );

  if (!loaded) return <PanelSkeleton rows={4} />;
  if (rows.length === 0) return <EmptyState icon="ph:users-three-bold">No familiars in your coven yet.</EmptyState>;
  return (
    <>
      {rows.length > 3 ? (
        <div className="cockpit-fam__tools">
          <label className="cockpit-fam__filter">
            <Icon name="ph:magnifying-glass" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter familiars…"
              aria-label="Filter familiars by name, role, or health"
            />
          </label>
          {query && visible.length !== rows.length ? (
            <span className="cockpit-fam__matchcount" role="status">{visible.length}/{rows.length}</span>
          ) : null}
        </div>
      ) : null}
      <div className="cockpit-fam" role="table" aria-label="Familiar insights">
        <div className="cockpit-fam__head" role="row">
          <span role="columnheader" aria-sort={ariaSort("name")}>{sortHeader("name", "Familiar", "asc")}</span>
          <span role="columnheader" aria-sort={ariaSort("confidence")}>{sortHeader("confidence", "Confidence", "desc")}</span>
          <span role="columnheader" aria-sort={ariaSort("sessions")}>{sortHeader("sessions", "Activity", "desc")}</span>
          <span role="columnheader" className="cockpit-fam__trendcol">7-day sessions</span>
          <span role="columnheader" className="cockpit-fam__contractcol" aria-sort={ariaSort("contract")}>{sortHeader("contract", "Contract", "desc")}</span>
          <span role="columnheader" className="cockpit-fam__lastcol" aria-sort={ariaSort("lastActive")}>{sortHeader("lastActive", "Last active", "desc")}</span>
        </div>
        {visible.length === 0 ? (
          <p className="cockpit-muted cockpit-fam__nomatch">No familiars match “{query}”.</p>
        ) : null}
        {visible.map((r) => (
        <a key={r.id} className="cockpit-fam__row" role="row" href={`/dashboard/familiars/${encodeURIComponent(r.id)}/analytics`}>
          <span className="cockpit-fam__who" role="cell">
            <span className="cockpit-fam__avatar" style={{ background: r.color }}>
              <AuthedImage src={r.avatarUrl} alt="" fallback={r.emoji || r.name.slice(0, 1).toUpperCase()} />
              {r.active ? <span className="cockpit-fam__on" title="Active session" /> : null}
            </span>
            <span className="cockpit-fam__id">
              <b className="cockpit-fam__name" title={r.name}>{r.name}</b>
              <span className="cockpit-fam__role" title={r.role}>{r.role}</span>
            </span>
          </span>
          <span className="cockpit-fam__conf" role="cell">
            {r.confidenceScore != null ? (
              <>
                <span className="cockpit-fam__score">{r.confidenceScore}</span>
                {r.confidenceLabel ? <Badge tone={TIER_TONE[r.confidenceLabel] ?? "calm"}>{r.confidenceLabel}</Badge> : null}
              </>
            ) : <span className="cockpit-fam__dash" title="No contract fetched yet">—</span>}
          </span>
          <span className="cockpit-fam__act" role="cell">
            {r.health ? <Badge tone={HEALTH_META[r.health].tone}>{HEALTH_META[r.health].label}</Badge> : null}
            <span className="cockpit-fam__sessions">{r.sessions7d}<i>/7d</i></span>
          </span>
          <span className="cockpit-fam__trend cockpit-fam__trendcol" role="cell">
            {r.trend.length ? <Sparkline points={r.trend} color={r.color} height={22} /> : <span className="cockpit-fam__dash">—</span>}
          </span>
          <span className="cockpit-fam__contract cockpit-fam__contractcol" role="cell">
            {r.contractTotal > 0 ? (
              <span className={`cockpit-fam__ratio${r.contractPass === r.contractTotal ? " is-pass" : " is-warn"}`}>
                <Icon name={r.contractPass === r.contractTotal ? "ph:check-circle-bold" : "ph:warning-circle"} aria-hidden />
                {r.contractPass}/{r.contractTotal}
              </span>
            ) : <span className="cockpit-fam__dash">—</span>}
          </span>
          <span className="cockpit-fam__last cockpit-fam__lastcol" role="cell">
            {r.lastActiveAt ? (relativeTime(r.lastActiveAt) || "just now") : <span className="cockpit-fam__dash">never</span>}
          </span>
        </a>
      ))}
      </div>
    </>
  );
}

function Badge({ tone, children }: { tone: "good" | "warn" | "bad" | "calm"; children: ReactNode }) {
  return <span className={`cockpit-badge cockpit-badge--${tone}`}>{children}</span>;
}

// ─── Usage over time ───────────────────────────────────────────────────────────────

function UsagePanel({ series, load, loaded, total, delta }: {
  series: SparkPoint[]; load: ReturnType<typeof familiarLoadSeries>; loaded: boolean; total: number; delta: number;
}) {
  if (!loaded) return <PanelSkeleton rows={3} />;
  const any = series.some((p) => (p.value ?? 0) > 0);
  if (!any) return <EmptyState icon="ph:graph-bold">No sessions in the last 14 days.</EmptyState>;
  return (
    <div className="cockpit-usage">
      <div className="cockpit-usage__figure">
        <span className="cockpit-usage__big">{total}</span>
        <span className="cockpit-usage__unit">sessions this week</span>
        <span className={`cockpit-usage__delta cockpit-usage__delta--${delta >= 0 ? "up" : "down"}`}>
          {delta > 0 ? `▲ ${delta}` : delta < 0 ? `▼ ${Math.abs(delta)}` : "level"} vs last week
        </span>
      </div>
      <div className="cockpit-usage__spark"><Sparkline points={series} color="var(--accent-presence)" height={48} /></div>
      {load.length > 0 ? (
        <ul className="cockpit-usage__legend">
          {load.map((s) => (
            <li key={s.id}><span className="cockpit-dot" style={{ background: s.color }} />{s.label}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// ─── Board snapshot ──────────────────────────────────────────────────────────────

function BoardSnapshot({ byStatus, total, active, loaded, familiars }: {
  byStatus: Map<CardStatus, number>; total: number; active: Card[]; loaded: boolean; familiars: Familiar[];
}) {
  if (!loaded) return <PanelSkeleton rows={3} />;
  if (total === 0) return <EmptyState icon="ph:kanban-bold">No cards on the board yet.</EmptyState>;
  const segs = STATUS_ORDER.map((s) => ({ s, n: byStatus.get(s) ?? 0 })).filter((x) => x.n > 0);
  const famName = (id: string | null) => familiars.find((f) => f.id === id)?.display_name;
  return (
    <>
      <DonutChart
        data={segs.map(({ s, n }) => ({ label: STATUS_META[s].label, value: n, color: STATUS_META[s].color }))}
        size={132}
        thickness={18}
        ariaLabel={`Board status: ${segs.map(({ s, n }) => `${STATUS_META[s].label} ${n}`).join(", ")}`}
      />
      <div className="cockpit-bar__legend">
        {segs.map(({ s, n }) => (
          <span key={s} className="cockpit-legend">
            <span className="cockpit-dot" style={{ background: STATUS_META[s].color }} />
            {STATUS_META[s].label} <b>{n}</b>
          </span>
        ))}
      </div>
      {active.length > 0 ? (
        <ul className="cockpit-cards">
          {active.slice(0, 6).map((c) => (
            <li key={c.id}>
              <a className="cockpit-cardrow" href={`/#card-${c.id}`}>
                <span className="cockpit-dot" style={{ background: STATUS_META[c.status].color }} />
                <span className="cockpit-cardrow__title" title={c.title}>{c.title}</span>
                {famName(c.familiarId) ? <span className="cockpit-cardrow__who">{famName(c.familiarId)}</span> : null}
              </a>
            </li>
          ))}
        </ul>
      ) : <p className="cockpit-muted">Nothing actively in flight.</p>}
    </>
  );
}

// ─── Familiars roster ──────────────────────────────────────────────────────────────

function AgentsPanel({ familiars, sessions, loaded }: { familiars: Familiar[]; sessions: SessionRow[]; loaded: boolean }) {
  const profiles = useMemo(() => familiarMiniProfiles(familiars, sessions, Date.now()), [familiars, sessions]);
  if (!loaded) return <PanelSkeleton rows={3} />;
  if (familiars.length === 0) return <EmptyState icon="ph:sparkle">No familiars configured.</EmptyState>;
  return (
    <ul className="cockpit-agents">
      {familiars.slice(0, 6).map((f) => {
        const active = (f.active_sessions ?? 0) > 0;
        const p = profiles.find((x) => x.id === f.id);
        return (
          <li key={f.id} className="cockpit-agent">
            {/* The whole row drills into the familiar's analytics page. */}
            <a className="cockpit-agent__link" href={`/dashboard/familiars/${encodeURIComponent(f.id)}/analytics`}>
              <span className="cockpit-agent__avatar" style={{ background: f.color || "var(--accent-presence)" }}>
                {f.emoji || (f.display_name || "?").slice(0, 1).toUpperCase()}
                {active ? <span className="cockpit-agent__on" /> : null}
              </span>
              <span className="cockpit-agent__body">
                <span className="cockpit-agent__name" title={f.display_name}>{f.display_name}</span>
                <span className="cockpit-agent__role" title={f.role || f.model || "familiar"}>{f.role || f.model || "familiar"}</span>
              </span>
              {p ? <span className="cockpit-agent__count">{p.sessionsLast7d}/7d</span> : null}
              {p ? <span className="cockpit-agent__trend"><Sparkline points={p.trend} color={f.color || "var(--accent-presence)"} height={20} /></span> : null}
              {active ? <span className="cockpit-agent__busy">{f.active_sessions} active</span> : null}
            </a>
          </li>
        );
      })}
    </ul>
  );
}

// ─── GitHub ──────────────────────────────────────────────────────────────────────

const GH_ICON: Record<GitHubItem["kind"], IconName> = {
  pr: "ph:git-pull-request", review_request: "ph:git-pull-request", issue: "ph:circle", notification: "ph:bell",
};
function GithubPanel({ items, loaded }: { items: GitHubItem[]; loaded: boolean }) {
  if (!loaded) return <PanelSkeleton rows={3} />;
  if (items.length === 0) return <EmptyState icon="ph:github-logo">No GitHub activity, or no token configured.</EmptyState>;
  return (
    <ul className="cockpit-gh">
      {items.slice(0, 6).map((g) => (
        <li key={g.id}>
          <a
            className="cockpit-ghrow"
            href={g.url}
            onClick={(event) => {
              event.preventDefault();
              openExternalUrl(g.url);
            }}
          >
            <Icon name={GH_ICON[g.kind]} className="cockpit-ghrow__icon" aria-hidden />
            <span className="cockpit-ghrow__title" title={g.title}>{g.title}</span>
            <span className="cockpit-ghrow__meta">
              {checkDot(g.checkStatus)}
              <span className="cockpit-ghrow__repo">{shortRepo(g.repo)}{g.number ? ` #${g.number}` : ""}</span>
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}
function checkDot(s: GitHubItem["checkStatus"]) {
  if (!s) return null;
  const color = s === "passing" ? "var(--color-success)" : s === "failing" ? "var(--color-danger)" : "var(--color-warning)";
  return <span className="cockpit-dot" style={{ background: color }} title={`Checks: ${s}`} role="img" aria-label={`Checks ${s}`} />;
}
function shortRepo(repo: string): string {
  const slash = repo.lastIndexOf("/");
  return slash >= 0 ? repo.slice(slash + 1) : repo;
}

// ─── Agenda ──────────────────────────────────────────────────────────────────────

function AgendaPanel({ items, now, loaded }: { items: InboxItem[]; now: Date; loaded: boolean }) {
  if (!loaded) return <PanelSkeleton rows={2} />;
  if (items.length === 0) return <EmptyState icon="ph:calendar-bold">Nothing scheduled ahead.</EmptyState>;
  return (
    <ul className="cockpit-agenda">
      {items.map((i) => (
        <li key={i.id} className="cockpit-agendarow">
          <span className="cockpit-agendarow__when">{whenLabel(i.fireAt!, now)}</span>
          <span className="cockpit-agendarow__title" title={i.title}>{i.title}</span>
        </li>
      ))}
    </ul>
  );
}
function whenLabel(iso: string, now: Date): string {
  const d = new Date(iso);
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (sameDay) return `Today ${time}`;
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  if (d.toDateString() === tomorrow.toDateString()) return `Tmrw ${time}`;
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${time}`;
}

// ─── Signals ─────────────────────────────────────────────────────────────────────

const SIGNAL_ICON: Record<DashboardSignal["severity"], IconName> = { warn: "ph:warning", info: "ph:info" };

// Keep the panel scannable: the stalest drift leads, the long tail collapses
// into a drill-through instead of swamping the column.
const SIGNALS_CAP = 8;

function SignalsPanel({ signals }: { signals: DashboardSignal[] }) {
  const shown = signals.slice(0, SIGNALS_CAP);
  const hidden = signals.length - shown.length;
  return (
    <ul className="cockpit-signals">
      {shown.map((s) => {
        const inner = (
          <>
            <Icon name={SIGNAL_ICON[s.severity]} className="cockpit-signal__icon" aria-hidden />
            <span className="cockpit-signal__text">{s.text}</span>
          </>
        );
        return (
          <li key={s.id}>
            {s.href ? (
              // An actionable signal takes you to where you can act on it —
              // the stalled PR, the board, the familiar's analytics.
              <a
                className={`cockpit-signal cockpit-signal--${s.severity} cockpit-signal--link`}
                href={s.href}
                onClick={s.external ? (event) => { event.preventDefault(); openExternalUrl(s.href!); } : undefined}
              >
                {inner}
              </a>
            ) : (
              <span className={`cockpit-signal cockpit-signal--${s.severity}`}>{inner}</span>
            )}
          </li>
        );
      })}
      {hidden > 0 ? (
        <li>
          <a className="cockpit-signal cockpit-signal--more" href="/?mode=github">
            <Icon name="ph:arrow-right-bold" className="cockpit-signal__icon" aria-hidden />
            <span className="cockpit-signal__text">+{hidden} more — review on the GitHub surface</span>
          </a>
        </li>
      ) : null}
    </ul>
  );
}

// ─── Confidence / performance heatmap ────────────────────────────────────────────

type ConfidenceRow = { id: string; name: string; score: number; factors: ConfidenceFactor[] };

/** Pretty label for a confidence factor key (e.g. "accept_rate" → "Accept"). */
function prettyFactor(label: string): string {
  const base = label.replace(/_score$/, "").replace(/_rate$/, "");
  return base.split("_").map((w) => w.slice(0, 1).toUpperCase() + w.slice(1)).join(" ");
}

/** 0 → danger, 1 → success, ramped through color-mix in oklch. */
function confidenceColor(value: number): string {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return `color-mix(in oklch, var(--color-success) ${pct}%, var(--color-danger))`;
}

function ConfidencePanel({ rows }: { rows: ConfidenceRow[] }) {
  const cols = rows[0]?.factors.map((f) => prettyFactor(f.label)) ?? [];
  // Cell value = the factor's normalized 0..1 strength (raw score ÷ 100).
  const cells = rows.flatMap((r) =>
    r.factors.map((f) => ({ row: r.name, col: prettyFactor(f.label), value: f.value / 100 })),
  );
  return (
    <div className="cockpit-confidence">
      <div className="cockpit-confidence__cols" style={{ ["--cols" as string]: cols.length }}>
        {cols.map((c) => <span key={c}>{c}</span>)}
      </div>
      <div className="cockpit-confidence__grid">
        <div className="cockpit-confidence__rows">
          {rows.map((r) => (
            <a
              key={r.id}
              href={`/dashboard/familiars/${encodeURIComponent(r.id)}/analytics`}
              title={`${r.name}: confidence ${r.score} — open analytics`}
            >
              {r.name}
            </a>
          ))}
        </div>
        <Heatmap
          rows={rows.map((r) => r.name)}
          cols={cols}
          cells={cells}
          colorFor={confidenceColor}
          height={Math.max(72, rows.length * 26)}
          ariaLabel={`Confidence factors by familiar: ${rows.map((r) => `${r.name} ${r.score}`).join(", ")}`}
          cellTitle={(c) => `${c.row} · ${c.col}: ${Math.round(c.value * 100)}/100`}
        />
      </div>
    </div>
  );
}

// ─── Space usage ─────────────────────────────────────────────────────────────────

type SpaceSort = { key: SpaceSortKey; dir: SortDir };

/** Local disk footprint per `~/.coven` area: sortable rows, share bars, and a
 *  cleanup drill-through per area. Figures come from the bounded server scan. */
function SpaceUsagePanel({ rows, loaded }: { rows: SpaceUsageRow[]; loaded: boolean }) {
  const [sort, setSort] = useState<SpaceSort>({ key: "bytes", dir: "desc" });
  const sorted = useMemo(() => sortSpaceRows(rows, sort.key, sort.dir), [rows, sort]);
  if (!loaded) return <PanelSkeleton rows={3} />;
  if (rows.length === 0) return <EmptyState icon="ph:database-bold">No local coven data found.</EmptyState>;

  const cycle = (key: SpaceSortKey, firstDir: SortDir) =>
    setSort((prev) => prev.key === key
      ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
      : { key, dir: firstDir });
  const ariaSort = (key: SpaceSortKey): "ascending" | "descending" | "none" =>
    sort.key === key ? (sort.dir === "asc" ? "ascending" : "descending") : "none";
  const head = (key: SpaceSortKey, label: string, firstDir: SortDir) => (
    <button type="button" className={`cockpit-sorthead${sort.key === key ? " is-sorted" : ""}`} onClick={() => cycle(key, firstDir)}>
      {label}
      <Icon name={sort.key === key ? (sort.dir === "asc" ? "ph:caret-up" : "ph:caret-down") : "ph:caret-up-down"} aria-hidden />
    </button>
  );

  return (
    <div className="cockpit-space" role="table" aria-label="Local space usage by area">
      <div className="cockpit-space__head" role="row">
        <span role="columnheader" aria-sort={ariaSort("label")}>{head("label", "Area", "asc")}</span>
        <span role="columnheader" aria-sort={ariaSort("bytes")}>{head("bytes", "Size", "desc")}</span>
        <span role="columnheader" className="cockpit-space__filescol" aria-sort={ariaSort("files")}>{head("files", "Files", "desc")}</span>
        <span role="columnheader" className="cockpit-space__lastcol" aria-sort={ariaSort("lastModified")}>{head("lastModified", "Updated", "desc")}</span>
      </div>
      {sorted.map((r) => {
        const inner = (
          <>
            <span className="cockpit-space__area" role="cell" title={r.relPath}>
              <b>{r.label}</b>
              <span className="cockpit-space__path">{r.relPath}</span>
            </span>
            <span className="cockpit-space__size" role="cell">
              <b>{formatBytes(r.bytes)}{r.truncated ? "+" : ""}</b>
              <span className="cockpit-space__bar" aria-hidden>
                <i style={{ width: `${Math.max(2, r.sharePct)}%` }} />
              </span>
            </span>
            <span className="cockpit-space__files cockpit-space__filescol" role="cell">{r.files}{r.truncated ? "+" : ""}</span>
            <span className="cockpit-space__last cockpit-space__lastcol" role="cell">
              {r.lastModifiedMs ? (relativeTime(new Date(r.lastModifiedMs).toISOString()) || "just now") : "—"}
            </span>
          </>
        );
        // Areas a surface owns drill into that surface; the rest are plain rows.
        return r.href ? (
          <a key={r.id} className="cockpit-space__row cockpit-space__row--link" role="row" href={r.href} title={r.actionLabel ?? undefined}>
            {inner}
          </a>
        ) : (
          <span key={r.id} className="cockpit-space__row" role="row">{inner}</span>
        );
      })}
    </div>
  );
}

// ─── Bits ────────────────────────────────────────────────────────────────────────

function PanelSkeleton({ rows }: { rows: number }) {
  return <div className="cockpit-skel">{Array.from({ length: rows }).map((_, i) => <span key={i} className="cockpit-skel__row" />)}</div>;
}

function longDate(now: Date): string {
  return now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}
