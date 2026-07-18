/**
 * Pure derivations behind the bento dashboard (`/dashboard`).
 *
 * Everything here is deterministic on its inputs so the whole surface can be
 * unit-tested without React: stat totals, streak gamification, the 53-week
 * session heatmap, the merged activity feed, board buckets, the 14-day
 * activity carousel (series + SVG paths), the performance matrix and the
 * GitHub rail. The component layer (`bento-dashboard.tsx`) only fetches,
 * holds UI state and renders what these return.
 */

import type { Card } from "@/lib/cave-board-types";
import type { InboxItem } from "@/lib/cave-inbox";
import type { Familiar, SessionRow } from "@/lib/types";
import type { GitHubItem } from "@/lib/github-tasks";
import type { ThreadMetricKey } from "@/lib/thread-confidence";
import { deriveThreadConfidence } from "@/lib/thread-confidence";
import type { ThreadSelfReport } from "@/lib/thread-self-report";
import { itemHref } from "@/lib/daily-report";
import { sessionsPerDay } from "@/lib/dashboard-analytics";

const DAY_MS = 86_400_000;

// ─── Stat tiles ───────────────────────────────────────────────────────────────

export function sessionTotals(sessions: SessionRow[], nowMs: number): { total: number; last30d: number } {
  let total = 0;
  let last30d = 0;
  const cutoff = nowMs - 30 * DAY_MS;
  for (const s of sessions) {
    if (s.archived_at) continue;
    total += 1;
    const t = Date.parse(s.created_at);
    if (!Number.isNaN(t) && t >= cutoff) last30d += 1;
  }
  return { total, last30d };
}

/** Longest run of consecutive UTC days with at least one familiar session —
 *  the "best" the current streak is measured against. Same day attribution as
 *  {@link import("./familiar-renown").covenStreak}: archived and
 *  familiar-less sessions don't count. */
export function longestStreak(sessions: SessionRow[]): number {
  const days = new Set<number>();
  for (const s of sessions) {
    if (s.archived_at || !s.familiarId) continue;
    const t = Date.parse(s.created_at);
    if (!Number.isNaN(t)) days.add(Math.floor(t / DAY_MS));
  }
  const sorted = [...days].sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  let prev: number | null = null;
  for (const d of sorted) {
    run = prev !== null && d === prev + 1 ? run + 1 : 1;
    if (run > best) best = run;
    prev = d;
  }
  return best;
}

/** How many of the 5 streak pips are filled: current streak as a share of the
 *  personal best, so the row reads as progress toward it. A fresh coven
 *  (best = 0) shows no filled pips rather than a divide-by-zero flourish. */
export function streakPips(current: number, best: number): number {
  if (best <= 0) return 0;
  return Math.round(Math.min(current / best, 1) * 5);
}

// ─── Session heatmap (53 weeks × 7 days, column-major) ───────────────────────

export type HeatCell = {
  /** ISO date (UTC) the cell covers. */
  date: string;
  count: number;
  /** 0–4 intensity bucket; render via the `bd-heat-l{n}` classes. */
  level: number;
  /** True for cells after today in the trailing week — rendered invisible. */
  future: boolean;
};

function heatLevel(count: number): number {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count <= 3) return 2;
  if (count <= 6) return 3;
  return 4;
}

/**
 * GitHub-style year heatmap: `weeks` columns of 7 rows (Sunday-first),
 * column-major so CSS `grid-auto-flow: column` lays it out directly. The
 * final column is the current week; cells after today are `future`.
 */
export function heatmapCells(
  sessions: SessionRow[],
  nowMs: number,
  weeks = 53,
): { cells: HeatCell[]; monthLabels: string[] } {
  const perDay = new Map<number, number>();
  for (const s of sessions) {
    if (s.archived_at) continue;
    const t = Date.parse(s.created_at);
    if (Number.isNaN(t)) continue;
    const day = Math.floor(t / DAY_MS);
    perDay.set(day, (perDay.get(day) ?? 0) + 1);
  }

  const today = Math.floor(nowMs / DAY_MS);
  const todayDow = new Date(today * DAY_MS).getUTCDay();
  const lastColSunday = today - todayDow;
  const firstDay = lastColSunday - (weeks - 1) * 7;

  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const cells: HeatCell[] = [];
  const monthLabels: string[] = [];
  for (let w = 0; w < weeks; w++) {
    const colSunday = firstDay + w * 7;
    const label = months[new Date(colSunday * DAY_MS).getUTCMonth()];
    if (monthLabels[monthLabels.length - 1] !== label) monthLabels.push(label);
    for (let d = 0; d < 7; d++) {
      const day = colSunday + d;
      const count = perDay.get(day) ?? 0;
      const future = day > today;
      cells.push({
        date: new Date(day * DAY_MS).toISOString().slice(0, 10),
        count: future ? 0 : count,
        level: future ? 0 : heatLevel(count),
        future,
      });
    }
  }
  return { cells, monthLabels };
}

// ─── Activity feed ────────────────────────────────────────────────────────────

export type FeedRow = {
  id: string;
  /** ISO timestamp the row is sorted by. */
  at: string;
  text: string;
  href: string;
};

function familiarName(familiars: Familiar[], id: string | null | undefined): string | null {
  if (!id) return null;
  const f = familiars.find((x) => x.id === id);
  return f ? f.display_name || f.name || f.id : null;
}

/** Merge the freshest signals (sessions, board moves, GitHub, fired
 *  reminders) into one reverse-chronological feed. */
export function activityFeed(args: {
  sessions: SessionRow[];
  cards: Card[];
  github: GitHubItem[];
  inbox: InboxItem[];
  familiars: Familiar[];
  cap?: number;
}): FeedRow[] {
  const { sessions, cards, github, inbox, familiars, cap = 30 } = args;
  const rows: FeedRow[] = [];

  for (const s of sessions) {
    if (s.archived_at) continue;
    const fam = familiarName(familiars, s.familiarId) ?? s.harness;
    const verb = s.status === "running" ? "is running" : "finished";
    rows.push({ id: `session:${s.id}`, at: s.updated_at, text: `${fam} ${verb} · ${s.title}`, href: `/#chat-${s.id}` });
  }
  for (const c of cards) {
    const fam = familiarName(familiars, c.familiarId);
    rows.push({
      id: `card:${c.id}`,
      at: c.updatedAt,
      text: `${fam ? `${fam} · ` : ""}${c.title} → ${c.status}`,
      href: `/#card-${c.id}`,
    });
  }
  for (const g of github) {
    const repo = g.repo.includes("/") ? g.repo.slice(g.repo.indexOf("/") + 1) : g.repo;
    const num = g.number ? `#${g.number} ` : "";
    const prefix = g.kind === "review_request" ? "review requested · " : "";
    rows.push({ id: `gh:${g.id}`, at: g.updatedAt, text: `${prefix}${repo} ${num}· ${g.title}`, href: g.url });
  }
  for (const item of inbox) {
    if (!item.firedAt) continue;
    rows.push({ id: `inbox:${item.id}`, at: item.firedAt, text: `${item.kind} · ${item.title}`, href: itemHref(item) });
  }

  return rows
    .filter((r) => !Number.isNaN(Date.parse(r.at)))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, cap);
}

/** Compact feed timestamp: `HH:MM` for today (local), `jul 17` for older. */
export function feedTime(iso: string, nowMs: number): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const then = new Date(t);
  const now = new Date(nowMs);
  if (
    then.getFullYear() === now.getFullYear() &&
    then.getMonth() === now.getMonth() &&
    then.getDate() === now.getDate()
  ) {
    return `${String(then.getHours()).padStart(2, "0")}:${String(then.getMinutes()).padStart(2, "0")}`;
  }
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  return `${months[then.getMonth()]} ${then.getDate()}`;
}

// ─── Board buckets ────────────────────────────────────────────────────────────

export type BoardEntry = {
  id: string;
  title: string;
  familiarId: string | null;
  /** Microcopy under the title — "wisp · review". */
  sub: string;
  href: string;
};

export type BoardBuckets = {
  needsYou: BoardEntry[];
  inFlight: BoardEntry[];
  done: BoardEntry[];
};

/**
 * The three bento board columns. "Needs you" leads with open inbox items
 * (the daemon's actual asks) and adds review/blocked cards; "in flight" is
 * running cards; "done" is the freshest wins, dimmed by the CSS layer.
 */
export function boardBuckets(args: {
  cards: Card[];
  needsAttention: InboxItem[];
  familiars: Familiar[];
  doneCap?: number;
}): BoardBuckets {
  const { cards, needsAttention, familiars, doneCap = 4 } = args;
  const byRecency = (a: Card, b: Card) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt);

  const needsYou: BoardEntry[] = needsAttention.map((item) => ({
    id: `inbox:${item.id}`,
    title: item.title,
    familiarId: item.familiarId ?? null,
    sub: `${familiarName(familiars, item.familiarId) ?? "coven"} · ${item.kind}`,
    href: itemHref(item),
  }));
  for (const c of [...cards].sort(byRecency)) {
    if (c.status !== "review" && c.status !== "blocked") continue;
    needsYou.push({
      id: `card:${c.id}`,
      title: c.title,
      familiarId: c.familiarId,
      sub: `${familiarName(familiars, c.familiarId) ?? "board"} · ${c.status}`,
      href: `/#card-${c.id}`,
    });
  }

  const entry = (c: Card, sub: string): BoardEntry => ({
    id: `card:${c.id}`,
    title: c.title,
    familiarId: c.familiarId,
    sub,
    href: `/#card-${c.id}`,
  });
  const inFlight = [...cards]
    .filter((c) => c.status === "running")
    .sort(byRecency)
    .map((c) => entry(c, `${familiarName(familiars, c.familiarId) ?? "board"} · running`));
  const done = [...cards]
    .filter((c) => c.status === "done")
    .sort(byRecency)
    .slice(0, doneCap)
    .map((c) => entry(c, familiarName(familiars, c.familiarId) ?? "board"));

  return { needsYou, inFlight, done };
}

// ─── Activity-over-time carousel (14d) ────────────────────────────────────────

export type CarouselSlide = {
  /** Familiar id, or null for the all-familiars aggregate. */
  familiarId: string | null;
  name: string;
  /** 14 daily counts, oldest first. */
  series: number[];
  /** Sessions in the trailing 7 days. */
  weekTotal: number;
  /** Trailing week minus the week before it. */
  weekDelta: number;
};

/**
 * Slide 0 aggregates the whole coven; then the top familiars by 14-day
 * volume (ties broken by name) so the carousel starts with the busiest.
 */
export function carouselSlides(
  sessions: SessionRow[],
  familiars: Familiar[],
  nowMs: number,
  topCount = 4,
): { slides: CarouselSlide[]; max: number } {
  const days = 14;
  const mk = (familiarId: string | null, name: string): CarouselSlide => {
    const series = sessionsPerDay(sessions, familiarId, nowMs, days);
    const weekTotal = series.slice(7).reduce((a, b) => a + b, 0);
    const prev = series.slice(0, 7).reduce((a, b) => a + b, 0);
    return { familiarId, name, series, weekTotal, weekDelta: weekTotal - prev };
  };

  const ranked = familiars
    .map((f) => mk(f.id, f.display_name || f.name || f.id))
    .sort((a, b) => {
      const at = a.series.reduce((x, y) => x + y, 0);
      const bt = b.series.reduce((x, y) => x + y, 0);
      return bt - at || a.name.localeCompare(b.name);
    })
    .slice(0, topCount);

  const slides = [mk(null, "all familiars"), ...ranked];
  const max = Math.max(1, ...slides.flatMap((s) => s.series));
  return { slides, max };
}

/** SVG path pair for one carousel slide, on the design's 240×56 viewBox. */
export function sparkPath(series: number[], max: number, width = 240, height = 56): { line: string; area: string } {
  const n = Math.max(series.length - 1, 1);
  const safeMax = Math.max(max, 1);
  const pts = series.map((v, i) => ({
    x: (i / n) * width,
    y: height - 4 - (v / safeMax) * (height - 12),
  }));
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  return { line, area: `${line} L${width} ${height} L0 ${height} Z` };
}

/** Y position (px, same viewBox as {@link sparkPath}) for a hover dot. */
export function sparkY(value: number, max: number, height = 56): number {
  return height - 4 - (value / Math.max(max, 1)) * (height - 12);
}

/** Hover-tooltip label for a carousel point: "jul 17 · 3 sessions". */
export function carouselDayLabel(index: number, nowMs: number, value: number, days = 14): string {
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const d = new Date(nowMs - (days - 1 - index) * DAY_MS);
  return `${months[d.getMonth()]} ${d.getDate()} · ${value} session${value === 1 ? "" : "s"}`;
}

// ─── Performance matrix ───────────────────────────────────────────────────────

export const MATRIX_COLUMNS: { key: ThreadMetricKey; label: string }[] = [
  { key: "confidence", label: "conf" },
  { key: "toolReliability", label: "rel" },
  { key: "memoryRecall", label: "recall" },
  { key: "fileLocatability", label: "files" },
];

export type MatrixCell = {
  key: ThreadMetricKey;
  /** Null when the familiar has no self-reports yet — unmeasured, not zero. */
  value: number | null;
  /** 0 (no data) or 1–4 intensity bucket. */
  level: number;
  title: string;
};

export type MatrixRow = { familiarId: string; name: string; cells: MatrixCell[] };

/** Design ramp bucket: ≥88 → 4, ≥76 → 3, ≥64 → 2, else 1. */
export function matrixLevel(value: number): number {
  if (value >= 88) return 4;
  if (value >= 76) return 3;
  if (value >= 64) return 2;
  return 1;
}

export function matrixRows(
  familiars: { id: string; name: string }[],
  threadReportsById: Map<string, ThreadSelfReport[]>,
): MatrixRow[] {
  return familiars.map(({ id, name }) => {
    const confidence = deriveThreadConfidence(threadReportsById.get(id) ?? []);
    const byKey = new Map(confidence.metrics.map((m) => [m.key, m.value]));
    const cells: MatrixCell[] = MATRIX_COLUMNS.map(({ key, label }) => {
      if (!confidence.hasData) {
        return { key, value: null, level: 0, title: `${name} · ${label} — no reports yet` };
      }
      const value = Math.round(byKey.get(key) ?? 0);
      return { key, value, level: matrixLevel(value), title: `${name} · ${label} ${value}%` };
    });
    return { familiarId: id, name, cells };
  });
}

// ─── GitHub rail ──────────────────────────────────────────────────────────────

export type GitHubRepoGroup = { repo: string; items: GitHubItem[] };

/** Group items by repo, freshest repo first, freshest items first. */
export function githubByRepo(items: GitHubItem[], repoCap = 3, rowCap = 4): GitHubRepoGroup[] {
  const groups = new Map<string, GitHubItem[]>();
  for (const it of [...items].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))) {
    const list = groups.get(it.repo) ?? [];
    list.push(it);
    groups.set(it.repo, list);
  }
  return [...groups.entries()]
    .slice(0, repoCap)
    .map(([repo, list]) => ({ repo: repo.toLowerCase(), items: list.slice(0, rowCap) }));
}

/** CI rollup across PR rows: failing wins, then pending, then passing.
 *  Null when no row carries a check status (nothing to claim). */
export function ciSummary(items: GitHubItem[]): "passing" | "failing" | "pending" | null {
  let seen: "passing" | "pending" | null = null;
  for (const it of items) {
    if (it.checkStatus === "failing") return "failing";
    if (it.checkStatus === "pending") seen = "pending";
    else if (it.checkStatus === "passing" && seen === null) seen = "passing";
  }
  return seen;
}

// ─── Top collaborators ────────────────────────────────────────────────────────

/** Familiars ranked by lifetime session volume — the footer avatar rail. */
export function topCollaborators<T extends { id: string }>(
  familiars: T[],
  sessionsTotalById: Map<string, number>,
  cap = 7,
): T[] {
  return [...familiars]
    .sort((a, b) => (sessionsTotalById.get(b.id) ?? 0) - (sessionsTotalById.get(a.id) ?? 0))
    .slice(0, cap);
}
