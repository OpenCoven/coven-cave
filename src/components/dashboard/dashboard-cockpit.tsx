"use client";

import { useEffect, useMemo, useState, type ReactNode, type CSSProperties } from "react";
import { Icon } from "@/lib/icon";
import type { IconName } from "@/lib/icon";
import type { DashboardModel } from "@/lib/dashboard-model";
import type { Card, CardStatus } from "@/lib/cave-board-types";
import type { Familiar } from "@/lib/types";
import type { GitHubItem } from "@/lib/github-tasks";
import type { InboxItem } from "@/lib/cave-inbox";
import { relativeTime } from "@/lib/daily-report";
import { useDateTimePrefs } from "@/lib/datetime-format";
import { SectionHead, EmptyState, QuickLink } from "@/components/daily-report-ui";
import { Sparkline, type SparkPoint } from "@/components/ui/sparkline";
import { ActionInbox } from "@/components/dashboard/action-inbox";
import { TodaySummary } from "@/components/dashboard/today-summary";
import { RecentReports } from "@/components/dashboard/recent-reports";
import {
  DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors, closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, useSortable, arrayMove, sortableKeyboardCoordinates, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

// ─── Data shapes (client-fetched) ──────────────────────────────────────────────

type SessionRow = { id: string; title?: string; status?: string; model?: string | null; updatedAt?: string | null };
type ReadingItem = { id: string; title: string; url?: string; sourceType?: string; status?: string };

type CockpitData = {
  cards: Card[];
  familiars: Familiar[];
  github: GitHubItem[];
  reading: ReadingItem[];
  upcoming: InboxItem[];
  sessions: SessionRow[];
};

const EMPTY: CockpitData = { cards: [], familiars: [], github: [], reading: [], upcoming: [], sessions: [] };

// Draggable panel layout — order per column, persisted to localStorage.
const LAYOUT_KEY = "cave:cockpit:layout";
type Layout = { main: string[]; rail: string[] };
const DEFAULT_LAYOUT: Layout = { main: ["needs", "board", "today"], rail: ["agents", "github", "agenda", "reading"] };

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

// ─── 7-day KPI trends (persisted client-side, keyed by day) ──────────────────────

const TRENDS_KEY = "cave:cockpit:trends";
const TREND_DAYS = 7;
type TrendKey = "needs" | "tasks" | "progress" | "review" | "prs" | "reading";
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

// ─── Root ───────────────────────────────────────────────────────────────────────

export function DashboardCockpit({ model }: { model: DashboardModel }) {
  useDateTimePrefs(); // subscribe: re-render when the date/time density pref changes
  const [data, setData] = useState<CockpitData>(EMPTY);
  // Each source populates independently so a panel renders the moment its data
  // lands — the slow ones (sessions) never block the fast ones (board, agents).
  const [ready, setReady] = useState<ReadonlySet<keyof CockpitData>>(new Set());

  useEffect(() => {
    let alive = true;
    const put = <K extends keyof CockpitData>(key: K, value: CockpitData[K]) => {
      if (!alive) return;
      setData((d) => ({ ...d, [key]: value }));
      setReady((r) => new Set(r).add(key));
    };
    void getJson<{ cards: Card[] }>("/api/board").then((r) => put("cards", r?.cards ?? []));
    void getJson<{ familiars: Familiar[] }>("/api/familiars").then((r) => put("familiars", r?.familiars ?? []));
    void getJson<{ items: ReadingItem[] }>("/api/library/reading").then((r) => put("reading", r?.items ?? []));
    void getJson<{ items: InboxItem[] }>("/api/inbox?status=pending").then((r) => put("upcoming", r?.items ?? []));
    void getJson<{ sessions: SessionRow[] }>("/api/sessions/list").then((r) => put("sessions", r?.sessions ?? []));
    void Promise.all([
      getJson<{ items: GitHubItem[] }>("/api/github/activity"),
      getJson<{ items: GitHubItem[] }>("/api/github/assigned"),
    ]).then(([ghAct, ghAssigned]) => {
      const ghMap = new Map<string, GitHubItem>();
      for (const it of [...(ghAct?.items ?? []), ...(ghAssigned?.items ?? [])]) ghMap.set(it.id, it);
      put("github", [...ghMap.values()]);
    });
    return () => { alive = false; };
  }, []);

  const now = model.date;

  // ── Derived ──
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
  const readingQueue = data.reading.filter((r) => r.status === "want-to-read" || r.status === "reading");
  const runningSessions = data.sessions.filter((s) => (s.status ?? "").toLowerCase() === "running");

  const upcoming = data.upcoming
    .filter((i) => i.kind === "reminder" && i.fireAt && new Date(i.fireAt).getTime() > now.getTime())
    .sort((a, b) => new Date(a.fireAt!).getTime() - new Date(b.fireAt!).getTime())
    .slice(0, 5);

  const kpis: KpiSpec[] = [
    { icon: "ph:warning-circle", value: model.needsAttention.length, label: "Needs you", accent: "rose", metric: "needs" },
    { icon: "ph:kanban-bold", value: open.length, label: "Active tasks", accent: "lavender", src: "cards", metric: "tasks" },
    { icon: "ph:lightning-bold", value: (byStatus.get("running") ?? 0) + runningSessions.length, label: "In progress", accent: "green", src: "cards", metric: "progress" },
    { icon: "ph:git-merge", value: byStatus.get("review") ?? 0, label: "In review", accent: "blue", src: "cards", metric: "review" },
    { icon: "ph:git-pull-request", value: prsToReview.length, label: "PRs to review", accent: "amber", src: "github", metric: "prs" },
    { icon: "ph:books-bold", value: readingQueue.length, label: "To read", accent: "blue", src: "reading", metric: "reading" },
  ];

  // ── 7-day KPI trends: load history; snapshot today once the live data is in ──
  const [trends, setTrends] = useState<TrendStore>({});
  useEffect(() => {
    try { const raw = localStorage.getItem(TRENDS_KEY); if (raw) setTrends(JSON.parse(raw) as TrendStore); } catch { /* ignore */ }
  }, []);
  const coreReady = ready.has("cards") && ready.has("github") && ready.has("reading");
  useEffect(() => {
    if (!coreReady) return;
    const snap = Object.fromEntries(kpis.map((k) => [k.metric, k.value])) as DaySnap;
    setTrends((prev) => {
      const store: TrendStore = { ...prev, [dayKey(now)]: snap };
      const days = Object.keys(store).sort();
      while (days.length > 30) delete store[days.shift()!];
      try { localStorage.setItem(TRENDS_KEY, JSON.stringify(store)); } catch { /* ignore */ }
      return store;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coreReady]);

  // ── Draggable layout ──
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

  const isVisible = (id: string) => id !== "needs" || !model.caughtUp;
  const widget = (id: string): ReactNode => {
    switch (id) {
      case "needs": return model.caughtUp ? null : (
        <Panel title="Needs attention" icon="ph:warning-circle" count={model.needsAttention.length}>
          <ActionInbox initialItems={model.needsAttention} />
        </Panel>);
      case "board": return (
        <Panel title="Board" icon="ph:kanban-bold" hint={`${open.length} open`}>
          <BoardSnapshot byStatus={byStatus} total={data.cards.length} active={activeCards} loaded={ready.has("cards")} familiars={data.familiars} />
        </Panel>);
      case "today": return <TodaySummary summary={model.todaySummary} featured={model.featuredReport} now={now} />;
      case "agents": return (
        <Panel title="Agents" icon="ph:sparkle" count={data.familiars.length || undefined}>
          <AgentsPanel familiars={data.familiars} loaded={ready.has("familiars")} />
        </Panel>);
      case "github": return (
        <Panel title="GitHub" icon="ph:github-logo" count={data.github.length || undefined} hint={prsToReview.length ? `${prsToReview.length} to review` : undefined}>
          <GithubPanel items={data.github} loaded={ready.has("github")} />
        </Panel>);
      case "agenda": return (
        <Panel title="Up next" icon="ph:calendar-bold" count={upcoming.length || undefined}>
          <AgendaPanel items={upcoming} now={now} loaded={ready.has("upcoming")} />
        </Panel>);
      case "reading": return (
        <Panel title="Reading" icon="ph:books-bold" count={readingQueue.length || undefined} hint={readingQueue.length ? undefined : "queue empty"}>
          <ReadingPanel items={readingQueue} loaded={ready.has("reading")} />
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
            <Icon name={greetIcon(now)} aria-hidden /> {greeting(now)} · {longDate(now)}
          </p>
          <h1 className="cockpit-title">
            {model.caughtUp ? "All caught up" : `${model.needsAttention.length} ${model.needsAttention.length === 1 ? "thing needs" : "things need"} you`}
          </h1>
        </div>
        <div className="cockpit-head__meta">
          <span className="cockpit-pill">
            <Icon name="ph:clock" aria-hidden /> Updated {relativeTime(now.toISOString(), now) || "just now"}
          </span>
        </div>
      </header>

      {/* KPI rail */}
      <div className="cockpit-kpis">
        {kpis.map((k) => <KpiTile key={k.label} {...k} loading={k.src ? !ready.has(k.src) : false} series={seriesFor(trends, k.metric, now)} />)}
      </div>

      {/* Main grid — panels drag to rearrange (hover for the grip) */}
      <DndContext id="dashboard-cockpit" sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <div className="cockpit-grid">
          {(["main", "rail"] as const).map((col) => {
            const ids = layout[col].filter(isVisible);
            return (
              <div key={col} className={`cockpit-col cockpit-col--${col}`}>
                <SortableContext items={ids} strategy={verticalListSortingStrategy}>
                  {ids.map((id) => <SortableWidget key={id} id={id}>{widget(id)}</SortableWidget>)}
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
          <QuickLink href="/#card-" icon="ph:kanban-bold" label="Board" sub="Cards & tasks" />
          <QuickLink href="/dashboard/familiars/growth" icon="ph:chart-bar-bold" label="Growth" sub="Familiar performance" />
          <QuickLink href="/dashboard?view=evals" icon="ph:flask" label="Evals" sub="Suites, loops, freshness" />
          <QuickLink href="/" icon="ph:calendar-bold" label="Calendar" sub="Reminders & agenda" />
          <QuickLink href="/" icon="ph:books-bold" label="Library" sub="Saved knowledge" />
          <QuickLink href="/settings" icon="ph:gear-six" label="Settings" sub="Preferences" />
        </div>
      </div>

      <RecentReports reports={model.recentReports} now={now} hasFeatured={Boolean(model.featuredReport)} />

      <footer className="dr-footer">
        This cockpit reads your local board, inbox, agents, GitHub, and reading list. Everything stays on your machine.
      </footer>
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

function SortableWidget({ id, children }: { id: string; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    zIndex: isDragging ? 20 : undefined,
    opacity: isDragging ? 0.92 : undefined,
  };
  return (
    <div ref={setNodeRef} style={style} className={`cockpit-sortable${isDragging ? " is-dragging" : ""}`}>
      <button type="button" className="cockpit-grip" aria-label="Drag to rearrange" {...attributes} {...listeners}>
        <Icon name="ph:dots-six-vertical" aria-hidden />
      </button>
      {children}
    </div>
  );
}

// ─── KPI tile ────────────────────────────────────────────────────────────────────

type KpiSpec = { icon: IconName; value: number; label: string; accent: "rose" | "lavender" | "green" | "blue" | "amber"; metric: TrendKey; src?: keyof CockpitData; href?: string };
const KPI_ACCENT: Record<KpiSpec["accent"], string> = {
  rose: "var(--color-danger)", lavender: "var(--accent-presence)", green: "var(--color-success)",
  blue: "var(--color-info)", amber: "var(--color-warning)",
};

function KpiTile({ icon, value, label, accent, href, loading, series }: KpiSpec & { loading: boolean; series: SparkPoint[] }) {
  const color = KPI_ACCENT[accent];
  const pts = series.map((p) => p.value).filter((v): v is number => v != null);
  const delta = pts.length >= 2 ? pts[pts.length - 1] - pts[0] : 0;
  const inner = (
    <>
      <span className="cockpit-kpi__top">
        <span className="cockpit-kpi__icon" style={{ ["--kpi" as string]: color }}>
          <Icon name={icon} aria-hidden />
        </span>
        {!loading && delta !== 0 ? (
          <span className="cockpit-kpi__delta" title={`${delta > 0 ? "+" : ""}${delta} over ${TREND_DAYS} days`}>
            {delta > 0 ? "▲" : "▼"} {Math.abs(delta)}
          </span>
        ) : null}
      </span>
      <span className="cockpit-kpi__value">{loading ? "—" : value}</span>
      <span className="cockpit-kpi__label">{label}</span>
      <Sparkline points={series} color={color} height={22} />
    </>
  );
  return href ? <a className="cockpit-kpi" href={href}>{inner}</a> : <div className="cockpit-kpi">{inner}</div>;
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
      <div className="cockpit-bar" role="img" aria-label="Board status distribution">
        {segs.map(({ s, n }) => (
          <span key={s} className="cockpit-bar__seg" title={`${STATUS_META[s].label}: ${n}`}
            style={{ flexGrow: n, background: STATUS_META[s].color }} />
        ))}
      </div>
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

// ─── Agents ──────────────────────────────────────────────────────────────────────

function AgentsPanel({ familiars, loaded }: { familiars: Familiar[]; loaded: boolean }) {
  if (!loaded) return <PanelSkeleton rows={3} />;
  if (familiars.length === 0) return <EmptyState icon="ph:sparkle">No familiars configured.</EmptyState>;
  return (
    <ul className="cockpit-agents">
      {familiars.slice(0, 6).map((f) => {
        const active = (f.active_sessions ?? 0) > 0;
        return (
          <li key={f.id} className="cockpit-agent">
            <span className="cockpit-agent__avatar" style={{ background: f.color || "var(--accent-presence)" }}>
              {(f.display_name || "?").slice(0, 1).toUpperCase()}
              {active ? <span className="cockpit-agent__on" /> : null}
            </span>
            <span className="cockpit-agent__body">
              <span className="cockpit-agent__name" title={f.display_name}>{f.display_name}</span>
              <span className="cockpit-agent__role" title={f.role || f.model || "familiar"}>{f.role || f.model || "familiar"}</span>
            </span>
            {active ? <span className="cockpit-agent__busy">{f.active_sessions} active</span> : null}
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
          <a className="cockpit-ghrow" href={g.url} target="_blank" rel="noreferrer">
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
  return <span className="cockpit-dot" style={{ background: color }} title={`Checks: ${s}`} />;
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

// ─── Reading ─────────────────────────────────────────────────────────────────────

function ReadingPanel({ items, loaded }: { items: ReadingItem[]; loaded: boolean }) {
  if (!loaded) return <PanelSkeleton rows={2} />;
  if (items.length === 0) return <EmptyState icon="ph:books-bold">Reading queue is clear.</EmptyState>;
  return (
    <ul className="cockpit-reading">
      {items.slice(0, 5).map((r) => {
        const reading = r.status === "reading";
        return (
          <li key={r.id}>
            <a className="cockpit-readrow" href={r.url || "#"} target={r.url ? "_blank" : undefined} rel="noreferrer">
              <span className="cockpit-dot" style={{ background: reading ? "var(--accent-presence)" : "var(--text-muted)" }} />
              <span className="cockpit-readrow__title" title={r.title}>{r.title}</span>
              {host(r.url) ? <span className="cockpit-readrow__host">{host(r.url)}</span> : null}
            </a>
          </li>
        );
      })}
    </ul>
  );
}
function host(url?: string): string | null {
  if (!url) return null;
  try { return new URL(url).host.replace(/^www\./, ""); } catch { return null; }
}

// ─── Bits ────────────────────────────────────────────────────────────────────────

function PanelSkeleton({ rows }: { rows: number }) {
  return <div className="cockpit-skel">{Array.from({ length: rows }).map((_, i) => <span key={i} className="cockpit-skel__row" />)}</div>;
}

function greeting(now: Date): string {
  const h = now.getHours();
  if (h < 5) return "Late night";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  if (h < 21) return "Good evening";
  return "Good night";
}
function greetIcon(now: Date): IconName {
  const h = now.getHours();
  return h < 6 || h >= 19 ? "ph:moon" : "ph:sun";
}
function longDate(now: Date): string {
  return now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}
