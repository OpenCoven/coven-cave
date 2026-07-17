"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/lib/icon";
import { buildDashboardModel, type DashboardModel } from "@/lib/dashboard-model";
import type { Card, CardStatus } from "@/lib/cave-board-types";
import type { Familiar, SessionRow } from "@/lib/types";
import type { GitHubItem } from "@/lib/github-tasks";
import type { InboxItem } from "@/lib/cave-inbox";
import { relativeTime } from "@/lib/daily-report";
import { useDateTimePrefs } from "@/lib/datetime-format";
import { SectionHead, EmptyState, QuickLink } from "@/components/daily-report-ui";
import { TrendChart } from "@/components/ui/charts/trend-chart";
import {
  familiarMiniProfiles, familiarLoadSeries, dashboardSignals, type FamiliarMiniProfile,
  spaceUsageRows, formatBytes,
} from "@/lib/dashboard-analytics";
import type { SpaceUsageArea } from "@/lib/server/space-usage";
import {
  deriveCovenVitals, deriveCovenInsight, covenSessionsSeries,
  type FamiliarInsightRow, type CovenVitals,
} from "@/lib/coven-analytics";
import { deriveThreadConfidence, type ThreadConfidence } from "@/lib/thread-confidence";
import { deriveGrowthReport } from "@/lib/familiar-growth-signals";
import { ACTIVITY_DAYS, buildFamiliarCardStats, type FamiliarCardStats, type CovenMemoryEntry } from "@/components/familiars-view-stats";
import { useFamiliarContracts } from "@/lib/use-familiar-contracts";
import { usePausablePoll } from "@/lib/use-pausable-poll";
import { useMinuteTick } from "@/lib/use-minute-tick";
import { ActionInbox } from "@/components/dashboard/action-inbox";
import { TodaySummary } from "@/components/dashboard/today-summary";
import { RecentReports } from "@/components/dashboard/recent-reports";
import {
  DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors, closestCenter,
  type Announcements, type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, arrayMove, sortableKeyboardCoordinates, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import {
  AgendaPanel, AgentsPanel, BoardSnapshot, ConfidencePanel, CovenInsightBanner,
  FamiliarInsightsTable, GithubPanel, KpiTile, Panel, SignalsPanel, SortableWidget,
  SpaceUsagePanel, UsagePanel, type ConfidenceRow, type KpiTileProps,
} from "@/components/dashboard/cockpit-panels";
import {
  DEFAULT_LAYOUT, STATUS_ORDER, coverageSub, contractSub, dayKey, longDate, panelTitle,
  reconcileLayout, retroSub, seriesFor, wowSub,
  type DaySnap, type Layout, type TrendKey, type TrendStore,
} from "@/lib/dashboard-cockpit-format";

// ─── Data shapes (client-fetched) ──────────────────────────────────────────────

type CockpitData = {
  cards: Card[];
  familiars: Familiar[];
  github: GitHubItem[];
  inbox: InboxItem[];
  sessions: SessionRow[];
  memory: CovenMemoryEntry[];
  space: SpaceUsageArea[];
};

const EMPTY: CockpitData = { cards: [], familiars: [], github: [], inbox: [], sessions: [], memory: [], space: [] };

const EMPTY_STATS: FamiliarCardStats = { memoryCount: 0, latestMemory: null, lastSessionAt: null, sessionsTotal: 0, sessionsLast7d: 0, hasActiveSession: false, activity: new Array<number>(ACTIVITY_DAYS).fill(0) };

// A KPI tile's visual props plus the data plumbing the root owns: which trend
// metric feeds its sparkline and which fetch source gates its loading state.
type KpiSpec = Omit<KpiTileProps, "loading" | "series"> & {
  metric: TrendKey;
  src?: keyof CockpitData;
};

// Draggable secondary panels — order per column, persisted to localStorage. The
// insights hero (vitals + coven read + familiar table) is fixed above the grid.
const LAYOUT_KEY = "cave:cockpit:layout:v2";
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
// ─── Status vocab ──────────────────────────────────────────────────────────────

// ─── Root ───────────────────────────────────────────────────────────────────────

export function DashboardCockpit({ model: initialModel }: { model: DashboardModel }) {
  useDateTimePrefs(); // subscribe: re-render when the date/time density pref changes
  useMinuteTick();    // keep the "Updated Nm ago" pill honest between polls
  const [data, setData] = useState<CockpitData>(EMPTY);
  // Each source populates independently so a panel renders the moment its data
  // lands — the slow ones (sessions) never block the fast ones (board, familiars).
  const [ready, setReady] = useState<ReadonlySet<keyof CockpitData>>(new Set());
  // Truthful freshness: stamped when fetched data actually lands (not render
  // time), so a backgrounded tab shows real staleness when you come back.
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  // GitHub token probe (never the token itself): true/false from /api/github/pat,
  // null while unresolved or when the probe fails — the panel's empty state only
  // offers "Connect GitHub" on a proven false, never on a guess.
  const [ghConnected, setGhConnected] = useState<boolean | null>(null);
  // Live open total reported up by the ActionInbox — keeps the Needs-you vital
  // honest through optimistic done/dismiss/snooze between polls. Reset when a
  // fresh inbox lands (the rebuilt model is then authoritative).
  const [liveOpen, setLiveOpen] = useState<number | null>(null);

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
    // The needs-attention/caught-up read derives from this list — keep the
    // last known good copy on a failed poll rather than flashing "all clear".
    void getJson<{ items: InboxItem[] }>("/api/inbox").then((r) => {
      if (r?.items) {
        put("inbox", r.items);
        if (aliveRef.current) setLiveOpen(null);
      }
    });
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
    void getJson<{ hasPat: boolean }>("/api/github/pat").then((r) => {
      if (!aliveRef.current) return;
      setGhConnected(typeof r?.hasPat === "boolean" ? r.hasPat : null);
    });
  }, []);

  // Initial mount load, then refresh on a paused-when-backgrounded interval.
  useEffect(() => { load(); }, [load]);
  usePausablePoll(load, 30_000);

  // The server-rendered model is only the first-paint seed — each poll
  // rebuilds it from the fresh inbox so needs-attention/caught-up, today's
  // report, and recent reports stay live. (The old frozen snapshot husked the
  // needs panel: cleared items lingered ~forever, newly fired ones never
  // appeared, and the count badge lied.)
  const inboxReady = ready.has("inbox");
  const model = useMemo(
    () => (inboxReady ? buildDashboardModel(data.inbox, new Date()) : initialModel),
    [inboxReady, data.inbox, initialModel],
  );

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

  const upcoming = data.inbox
    .filter((i) => i.kind === "reminder" && i.status === "pending" && i.fireAt && new Date(i.fireAt).getTime() > nowMs)
    .sort((a, b) => new Date(a.fireAt!).getTime() - new Date(b.fireAt!).getTime())
    .slice(0, 5);

  // Predictive signals — pure + cheap over already-fetched data.
  const signals = useMemo(
    () => dashboardSignals({
      github: data.github, reading: [], sessions: data.sessions, familiars: data.familiars, nowMs,
    }),
    [data.github, data.sessions, data.familiars, nowMs],
  );

  // ── Per-familiar contract + thread self-report fetch (bounded) + one shared
  //    retro-runs snapshot. Keyed on the visible familiar set; rows recompute
  //    from live sessions. ──
  const {
    contracts: confidenceRaw,
    fetchedCount: contractFetchedCount,
    partial: contractFetchPartial,
  } = useFamiliarContracts(data.familiars);

  // ── Per-familiar insight rows (+ full thread confidence for the heatmap).
  //    Growth and activity derive from sessions/memory for every familiar;
  //    confidence comes from real thread self-reports (same metric as the
  //    analytics page), so it only fills for familiars with reflections. ──
  const perFamiliar = useMemo(() => {
    if (data.familiars.length === 0) return [] as { row: FamiliarInsightRow; confidence: ThreadConfidence | null }[];
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
      const contract = contractsById?.get(f.id) ?? null;
      const threadReports = confidenceRaw?.threadReportsById.get(f.id) ?? [];
      const threadConfidence = threadReports.length > 0 ? deriveThreadConfidence(threadReports) : null;
      // hasData false = unmeasured, never a fake "Low" — the row reads "—".
      const confidence = threadConfidence?.hasData ? threadConfidence : null;
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
      .map((x) => ({ id: x.row.id, name: x.row.name, score: x.confidence!.score, metrics: x.confidence!.metrics })),
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
  const scoredCoverageSub = coverageSub(vitals.confidenceTier ?? "fills in after thread reflections", contractFetchedCount, data.familiars.length, "scored");
  const contractCoverageSub = coverageSub(contractSub(vitals), contractFetchedCount, data.familiars.length, "checked");
  const kpis: KpiSpec[] = [
    { icon: "ph:seal-check", value: vitals.avgConfidence, label: "Coven confidence", sub: contractFetchPartial ? scoredCoverageSub : vitals.confidenceTier ?? "fills in after thread reflections", accent: "teal", metric: "confidence", good: "up", href: "/dashboard/familiars/growth" },
    { icon: "ph:sparkle", value: vitals.activeFamiliars, label: "Active familiars", sub: `${vitals.familiarCount} in coven`, accent: "green", metric: "active", good: "up", src: "familiars", href: "/?mode=agents" },
    { icon: "ph:heartbeat", value: vitals.sessions7d, label: "Sessions · 7d", sub: wowSub(vitals.sessionsWowDelta), accent: "lavender", metric: "sessions", good: "up", src: "sessions", href: "/?mode=agents" },
    { icon: "ph:flag-checkered", value: acceptPct, suffix: "%", label: "Retro accept rate", sub: retroSub(vitals), accent: "blue", metric: "accept", good: "up", href: "/dashboard/familiars/growth" },
    { icon: "ph:list-checks-bold", value: contractPct, suffix: "%", label: "Contract health", sub: contractFetchPartial ? contractCoverageSub : contractSub(vitals), accent: "amber", metric: "contract", good: "up", href: "/dashboard/familiars/growth" },
    { icon: "ph:warning-circle", value: liveOpen ?? model.openCount, label: "Needs you", sub: (liveOpen ?? model.openCount) === 0 ? "all clear" : "open items", accent: "rose", metric: "needs", good: "down", href: "/?mode=inbox" },
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
      needs: model.openCount,
    };
    setTrends((prev) => {
      const store: TrendStore = { ...prev, [dayKey(now)]: snap };
      const days = Object.keys(store).sort();
      while (days.length > 30) delete store[days.shift()!];
      try { localStorage.setItem(TRENDS_KEY, JSON.stringify(store)); } catch { /* ignore */ }
      return store;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vitalsReady, vitals.avgConfidence, vitals.activeFamiliars, vitals.sessions7d, acceptPct, contractPct, model.openCount]);

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
      // Bare like "today": ActionInbox owns its section chrome (title, live
      // count, select toggle) — a wrapping Panel double-headered the widget
      // and its frozen count husked after the last item was cleared.
      case "needs": return <ActionInbox initialItems={model.needsAttention} openCount={model.openCount} onOpenCount={setLiveOpen} />;
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
          <GithubPanel items={data.github} loaded={ready.has("github")} connected={ghConnected} />
        </Panel>);
      case "agenda": return (
        <Panel title="Up next" icon="ph:calendar-bold" count={upcoming.length || undefined} href="/?mode=calendar">
          <AgendaPanel items={upcoming} now={now} loaded={ready.has("inbox")} />
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
