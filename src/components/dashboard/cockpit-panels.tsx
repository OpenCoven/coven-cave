"use client";

// Presentational panel layer for the dashboard cockpit — extracted from
// dashboard-cockpit.tsx (cave-tsoz). Each panel owns its skeleton and empty
// state; the cockpit root owns data fetching, derivation, and layout. Pure
// label/vocab helpers live in @/lib/dashboard-cockpit-format.

import { useMemo, useState, type ReactNode, type CSSProperties } from "react";
import { Icon } from "@/lib/icon";
import type { IconName } from "@/lib/icon";
import { AuthedImage } from "@/components/ui/authed-image";
import type { Card, CardStatus } from "@/lib/cave-board-types";
import type { Familiar, SessionRow } from "@/lib/types";
import type { GitHubItem } from "@/lib/github-tasks";
import type { InboxItem } from "@/lib/cave-inbox";
import { relativeTime } from "@/lib/daily-report";
import { EmptyState } from "@/components/daily-report-ui";
import { Sparkline, type SparkPoint } from "@/components/ui/sparkline";
import { DonutChart } from "@/components/ui/charts/donut-chart";
import { Heatmap } from "@/components/ui/charts/heatmap";
import {
  familiarMiniProfiles, familiarLoadSeries, type DashboardSignal,
  defaultInsightOrder, sortInsightRows, filterInsightRows, type InsightSortKey, type SortDir,
  sortSpaceRows, formatBytes, type SpaceSortKey, type SpaceUsageRow,
} from "@/lib/dashboard-analytics";
import type { FamiliarInsightRow } from "@/lib/coven-analytics";
import type { ConfidenceFactor } from "@/lib/familiar-confidence";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { openExternalUrl } from "@/lib/open-external";
import {
  HEALTH_META, STATUS_META, STATUS_ORDER, TIER_TONE, TREND_DAYS,
  confidenceColor, githubEmptyState, prettyFactor, shortRepo, whenLabel,
} from "@/lib/dashboard-cockpit-format";

// ─── Coven insight banner ────────────────────────────────────────────────────────

const INSIGHT_ICON: Record<"good" | "warn" | "bad", IconName> = {
  good: "ph:check-circle-bold", warn: "ph:warning-circle", bad: "ph:warning-fill",
};
export function CovenInsightBanner({ insight }: { insight: { headline: string; detail: string; tone: "good" | "warn" | "bad" } }) {
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

export function Panel({ title, icon, count, hint, href, children }: {
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

export function SortableWidget({ id, title, children }: { id: string; title: string; children: ReactNode }) {
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

export type KpiTileProps = {
  icon: IconName; value: number | null; suffix?: string; label: string; sub?: string;
  accent: "rose" | "lavender" | "green" | "blue" | "amber" | "teal";
  good: "up" | "down"; href?: string; loading: boolean; series: SparkPoint[];
};
const KPI_ACCENT: Record<KpiTileProps["accent"], string> = {
  rose: "var(--color-danger)", lavender: "var(--accent-presence)", green: "var(--color-success)",
  blue: "var(--color-info)", amber: "var(--color-warning)", teal: "oklch(0.68 0.12 190)",
};

export function KpiTile({ icon, value, suffix, label, sub, accent, good, href, loading, series }: KpiTileProps) {
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
      {/* No wave without data — loading or empty, a flatline under "—" reads
          as a dead metric (cave-m4oq). One accent for every trend: the wave is
          texture, the tile icon carries the semantic tint. */}
      {value == null ? null : (
        <Sparkline points={series} color="var(--accent-presence)" height={22} />
      )}
    </>
  );
  return href ? <a className="cockpit-kpi" href={href}>{inner}</a> : <div className="cockpit-kpi">{inner}</div>;
}

// ─── Familiar insights table (centerpiece) ────────────────────────────────────────

/** Sortable column headers: click cycles default → desc → asc (numeric) or
 *  default → asc → desc (name). The "default" order keeps the curated ranking
 *  (confidence, then activity). */
type InsightSort = { key: InsightSortKey; dir: SortDir } | null;

export function FamiliarInsightsTable({ rows, loaded }: { rows: FamiliarInsightRow[]; loaded: boolean }) {
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
            {r.trend.length ? <Sparkline points={r.trend} color="var(--accent-presence)" height={22} /> : <span className="cockpit-fam__dash">—</span>}
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
            {r.lastActiveAt ? <time dateTime={r.lastActiveAt}>{relativeTime(r.lastActiveAt) || "just now"}</time> : <span className="cockpit-fam__dash">never</span>}
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

export function UsagePanel({ series, load, loaded, total, delta }: {
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

export function BoardSnapshot({ byStatus, total, active, loaded, familiars }: {
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

export function AgentsPanel({ familiars, sessions, loaded }: { familiars: Familiar[]; sessions: SessionRow[]; loaded: boolean }) {
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
              {p ? <span className="cockpit-agent__trend"><Sparkline points={p.trend} color="var(--accent-presence)" height={20} /></span> : null}
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
export function GithubPanel({ items, loaded, connected }: {
  items: GitHubItem[]; loaded: boolean; connected: boolean | null;
}) {
  if (!loaded) return <PanelSkeleton rows={3} />;
  if (items.length === 0) {
    const empty = githubEmptyState(connected);
    return (
      <EmptyState icon="ph:github-logo">
        {empty.copy}
        {empty.showConnect ? (
          <a className="cockpit-connect focus-ring" href="/?mode=github">Connect GitHub</a>
        ) : null}
      </EmptyState>
    );
  }
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
// ─── Agenda ──────────────────────────────────────────────────────────────────────

export function AgendaPanel({ items, now, loaded }: { items: InboxItem[]; now: Date; loaded: boolean }) {
  if (!loaded) return <PanelSkeleton rows={2} />;
  if (items.length === 0) return <EmptyState icon="ph:calendar-bold">Nothing scheduled ahead.</EmptyState>;
  return (
    <ul className="cockpit-agenda">
      {items.map((i) => (
        <li key={i.id} className="cockpit-agendarow">
          <time className="cockpit-agendarow__when" dateTime={i.fireAt!}>{whenLabel(i.fireAt!, now)}</time>
          <span className="cockpit-agendarow__title" title={i.title}>{i.title}</span>
        </li>
      ))}
    </ul>
  );
}
// ─── Signals ─────────────────────────────────────────────────────────────────────

const SIGNAL_ICON: Record<DashboardSignal["severity"], IconName> = { warn: "ph:warning", info: "ph:info" };

// Keep the panel scannable: the stalest drift leads, the long tail collapses
// into a drill-through instead of swamping the column.
const SIGNALS_CAP = 8;

export function SignalsPanel({ signals }: { signals: DashboardSignal[] }) {
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

export type ConfidenceRow = { id: string; name: string; score: number; factors: ConfidenceFactor[] };

export function ConfidencePanel({ rows }: { rows: ConfidenceRow[] }) {
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
export function SpaceUsagePanel({ rows, loaded }: { rows: SpaceUsageRow[]; loaded: boolean }) {
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
        const lastModifiedIso = r.lastModifiedMs ? new Date(r.lastModifiedMs).toISOString() : null;
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
              {lastModifiedIso ? <time dateTime={lastModifiedIso}>{relativeTime(lastModifiedIso) || "just now"}</time> : "—"}
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


