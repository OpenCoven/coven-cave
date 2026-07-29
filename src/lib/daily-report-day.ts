// The "chaptered day" model behind the redesigned daily report.
//
// Everything here is DERIVED from facts the report already freezes
// (`media.report`: merged PRs, session groups, completed cards), the day's
// inbox breakdown, and the recent-reports series. No new storage, no LLM
// contract change — chapters, the spine, swimlanes, the hour histogram and the
// streak are all computed from timestamps we already have.
//
// Pure (no node: imports, no fetches) so the page, the client view and
// loaderless tests share one implementation.

import type { InboxItem } from "./cave-inbox";
import type { DailyReportBreakdown, DailyReportStats, RecentReport } from "./daily-report";
import { dateSlug, isSameLocalDay } from "./daily-report.ts";
import type { DailyReportPayload, MergedPr, SessionGroup } from "./daily-report-facts";

// ── shapes ──────────────────────────────────────────────────────────────────

/** Semantic tone — resolved to a foundations token by the view, never a hex. */
export type DayTone = "accent" | "success" | "warning" | "danger" | "muted";

export type DayEventKind = "reminder" | "response" | "familiar" | "merge" | "card";

export type DayEvent = {
  id: string;
  kind: DayEventKind;
  /** ISO instant. Every event in the model is timestamped — untimed facts are
   *  counted elsewhere rather than placed on the spine. */
  at: string;
  /** Local hour 0–23, precomputed so the view never re-parses. */
  hour: number;
  /** Minutes since local midnight — drives horizontal placement. */
  minute: number;
  label: string;
  detail?: string;
  tone: DayTone;
  href?: string;
  familiarId?: string | null;
};

export type Chapter = {
  index: number;
  /** "01", "02"… — the rail's kicker number. */
  ordinal: string;
  title: string;
  /** "08:14 · reminder" — the rail's second line. */
  kicker: string;
  startAt: string;
  endAt: string;
  events: DayEvent[];
  /** Deterministic prose: one sentence naming what the chapter contains. */
  summary: string;
  merges: number;
  sessions: number;
};

export type Swimlane = {
  familiarId: string;
  name: string;
  tone: DayTone;
  sessionCount: number;
  mergeCount: number;
  additions: number;
  deletions: number;
  /** Percent-of-day span between the familiar's first and last timestamped
   *  event. Absent when none of its work carries a timestamp. */
  span: { leftPct: number; widthPct: number } | null;
  /** Percent-of-day positions of this familiar's merges. */
  marks: { pct: number; tone: DayTone; label: string }[];
};

export type ShippedRow = {
  key: string;
  repo: string;
  /** Repo basename — "coven-cave" from "OpenCoven/coven-cave". */
  repoLabel: string;
  number: number;
  title: string;
  url: string;
  mergedAt: string;
  /** Local "HH:MM". */
  time: string;
  additions: number | null;
  deletions: number | null;
};

export type RepoFacet = { key: string; label: string; count: number };

export type ProjectLines = {
  key: string;
  label: string;
  additions: number;
  deletions: number;
  /** Share of the day's largest project total, 0–1 — drives the bar widths. */
  share: number;
};

export type DayWindow = {
  firstAt: string | null;
  lastAt: string | null;
  spanMinutes: number;
  /** Distinct local hours carrying at least one event. */
  coverageHours: number;
  busiestHour: number | null;
  peakLabel: string | null;
  longestRunHours: number;
  mergesPerHour: number;
};

export type DayStreak = {
  current: number;
  best: number;
  /** Trailing 7 days ending on the report date — true = shipped that day. */
  days: boolean[];
};

export type DayDelta = { value: number; label: string; tone: DayTone } | null;

/** One point in the trailing-week series behind the "last 7 days" chart. */
export type TrendPoint = {
  slug: string;
  /** "JUL 21" */
  label: string;
  merges: number;
  sessions: number;
  /** False when no report exists for that day — charted as a gap, not a zero. */
  hasReport: boolean;
};

/** A line on the spine. Merges collapse per chapter so a 33-merge day reads
 *  as a story rather than a changelog; everything else stays individual. */
export type SpineEntry = {
  id: string;
  at: string;
  tone: DayTone;
  label: string;
  detail?: string;
  /** The chapter this line belongs to — clicking it selects that chapter. */
  chapterIndex: number;
  /** >1 when this line stands for several merges. */
  count: number;
};

export type DayModel = {
  stats: DailyReportStats;
  additions: number;
  deletions: number;
  projectCount: number;
  deltas: { sessions: DayDelta; prsMerged: DayDelta };
  streak: DayStreak;
  /** 24 buckets, each 0–1 relative to the busiest hour. */
  hours: number[];
  /** Raw event count per hour — the tooltip's truth. */
  hourCounts: number[];
  window: DayWindow;
  chapters: Chapter[];
  /** Every timestamped event, oldest first — the chapter views read this. */
  events: DayEvent[];
  /** The curated timeline: merges collapsed per chapter. */
  spine: SpineEntry[];
  trend: TrendPoint[];
  swimlanes: Swimlane[];
  shipped: {
    rows: ShippedRow[];
    repos: RepoFacet[];
    total: number;
    additions: number;
    deletions: number;
    firstTime: string | null;
    lastTime: string | null;
  };
  projects: ProjectLines[];
  carries: {
    openItems: InboxItem[];
    nextReminder: InboxItem | null;
  };
  /** True when the day carries no timestamped activity at all — the view
   *  swaps to its quiet-day presentation instead of drawing empty charts. */
  quiet: boolean;
};

// ── helpers ─────────────────────────────────────────────────────────────────

const MINUTES_PER_DAY = 1440;

/** Chapters break on a gap this long. Tuned so a working day yields ~4–6
 *  chapters rather than one blob or one-per-merge. */
const CHAPTER_GAP_MINUTES = 75;
const MAX_CHAPTERS = 6;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Local "HH:MM" for an ISO instant; "" when unparseable. */
export function clockLabel(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function minutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

function repoBasename(repo: string): string {
  const cut = repo.lastIndexOf("/");
  return cut === -1 ? repo : repo.slice(cut + 1);
}

function prKey(repo: string | undefined | null, number: number | undefined | null): string {
  return `${(repo ?? "").toLowerCase()}#${number ?? ""}`;
}

// ── events ──────────────────────────────────────────────────────────────────

const KIND_TONE: Record<DayEventKind, DayTone> = {
  reminder: "warning",
  response: "warning",
  familiar: "accent",
  merge: "success",
  card: "accent",
};

function pushEvent(
  out: DayEvent[],
  seed: Omit<DayEvent, "hour" | "minute" | "tone"> & { tone?: DayTone },
): void {
  const d = new Date(seed.at);
  if (Number.isNaN(d.getTime())) return;
  out.push({
    ...seed,
    hour: d.getHours(),
    minute: minutesOfDay(d),
    tone: seed.tone ?? KIND_TONE[seed.kind],
  });
}

/** Every timestamped thing that happened on the day, oldest first. */
export function dayEvents(
  payload: DailyReportPayload | null,
  breakdown: DailyReportBreakdown,
  day: Date,
): DayEvent[] {
  const out: DayEvent[] = [];

  for (const item of breakdown.reminders) {
    if (!isSameLocalDay(item.firedAt, day)) continue;
    pushEvent(out, {
      id: `reminder:${item.id}`,
      kind: "reminder",
      at: item.firedAt as string,
      label: item.title,
      detail: item.body?.split("\n")[0] ?? undefined,
      familiarId: item.familiarId ?? null,
    });
  }
  for (const item of breakdown.responses) {
    if (!isSameLocalDay(item.firedAt, day)) continue;
    pushEvent(out, {
      id: `response:${item.id}`,
      kind: "response",
      at: item.firedAt as string,
      label: item.title,
      familiarId: item.familiarId ?? null,
    });
  }
  for (const item of breakdown.familiars) {
    if (!isSameLocalDay(item.firedAt, day)) continue;
    pushEvent(out, {
      id: `familiar:${item.id}`,
      kind: "familiar",
      at: item.firedAt as string,
      label: item.title,
      familiarId: item.familiarId ?? null,
    });
  }

  // A merged PR's familiar is only knowable through the session that carried
  // it — sessions hold familiarId, PRs hold the timestamp.
  const familiarByPr = new Map<string, string>();
  for (const group of payload?.sessionGroups ?? []) {
    for (const session of group.sessions) {
      if (!session.pr || !session.familiarId) continue;
      familiarByPr.set(prKey(session.pr.repo, session.pr.number), session.familiarId);
    }
  }

  for (const pr of payload?.prsMerged ?? []) {
    pushEvent(out, {
      id: `merge:${pr.repo}#${pr.number}`,
      kind: "merge",
      at: pr.mergedAt,
      label: pr.title,
      detail: `${repoBasename(pr.repo)}#${pr.number}`,
      href: pr.url,
      familiarId: familiarByPr.get(prKey(pr.repo, pr.number)) ?? null,
    });
  }

  for (const card of payload?.cardsCompleted ?? []) {
    pushEvent(out, {
      id: `card:${card.id}`,
      kind: "card",
      at: card.completedAt,
      label: card.title,
      href: `/#card-${card.id}`,
      familiarId: card.familiarId ?? null,
    });
  }

  out.sort((a, b) => a.at.localeCompare(b.at));
  return out;
}

// ── chapters ────────────────────────────────────────────────────────────────

function chapterTitle(events: DayEvent[], index: number, total: number): string {
  const merges = events.filter((e) => e.kind === "merge");
  const first = events[0];

  // The opening and closing chapters get the day's bookend names; the middle
  // is named for whatever dominates it.
  if (index === 0 && first?.kind === "reminder") return "First light";
  if (index === total - 1 && merges.length === 0) return "Last light";

  if (merges.length >= 3) {
    const repos = new Set(merges.map((m) => repoBasename(m.detail?.split("#")[0] ?? "")));
    if (repos.size >= 2) return "The sweep";
    return "The push";
  }
  if (merges.length > 0) return merges.length === 1 ? "Shipped" : "The merges";
  if (events.some((e) => e.kind === "card")) return "Cleared the board";
  if (events.some((e) => e.kind === "familiar")) return "The familiars report";
  if (index === 0) return "First light";
  return "The quiet stretch";
}

function chapterSummary(events: DayEvent[]): string {
  const merges = events.filter((e) => e.kind === "merge").length;
  const cards = events.filter((e) => e.kind === "card").length;
  const reminders = events.filter((e) => e.kind === "reminder").length;
  const parts: string[] = [];
  if (merges) parts.push(`${merges} ${merges === 1 ? "merge" : "merges"}`);
  if (cards) parts.push(`${cards} ${cards === 1 ? "card" : "cards"}`);
  if (reminders) parts.push(`${reminders} ${reminders === 1 ? "reminder" : "reminders"}`);
  const window = `${clockLabel(events[0]?.at)} — ${clockLabel(events[events.length - 1]?.at)}`;
  if (!parts.length) return `Quiet between ${window}.`;
  return `${parts.join(" · ")} between ${window}.`;
}

/** Split the day's events into chapters on activity gaps, then fold the
 *  smallest neighbours together until at most MAX_CHAPTERS remain. */
export function deriveChapters(events: DayEvent[], sessionsTotal = 0): Chapter[] {
  if (!events.length) return [];

  const buckets: DayEvent[][] = [[events[0]]];
  for (let i = 1; i < events.length; i++) {
    const prev = events[i - 1];
    const cur = events[i];
    if (cur.minute - prev.minute >= CHAPTER_GAP_MINUTES) buckets.push([cur]);
    else buckets[buckets.length - 1].push(cur);
  }

  // Fold: repeatedly merge the smallest bucket into its smaller neighbour, so
  // a burst-heavy day collapses its stragglers rather than its main threads.
  while (buckets.length > MAX_CHAPTERS) {
    let smallest = 0;
    for (let i = 1; i < buckets.length; i++) {
      if (buckets[i].length < buckets[smallest].length) smallest = i;
    }
    const left = smallest > 0 ? buckets[smallest - 1] : null;
    const right = smallest < buckets.length - 1 ? buckets[smallest + 1] : null;
    const intoLeft = left && (!right || left.length <= right.length);
    if (intoLeft) {
      buckets[smallest - 1] = [...left, ...buckets[smallest]];
    } else if (right) {
      buckets[smallest + 1] = [...buckets[smallest], ...right];
    } else break;
    buckets.splice(smallest, 1);
  }

  // Sessions have no timestamps of their own; spread the day's total across
  // chapters in proportion to the merges each one carries so the rail's
  // per-chapter counts still add up to the day.
  const totalMerges = events.filter((e) => e.kind === "merge").length;

  return buckets.map((bucket, index) => {
    const merges = bucket.filter((e) => e.kind === "merge").length;
    const first = bucket[0];
    const last = bucket[bucket.length - 1];
    return {
      index,
      ordinal: pad2(index + 1),
      title: chapterTitle(bucket, index, buckets.length),
      kicker: `${clockLabel(first.at)} · ${chapterKicker(bucket)}`,
      startAt: first.at,
      endAt: last.at,
      events: bucket,
      summary: chapterSummary(bucket),
      merges,
      sessions:
        totalMerges > 0 ? Math.round((merges / totalMerges) * sessionsTotal) : 0,
    };
  });
}

function chapterKicker(events: DayEvent[]): string {
  const merges = events.filter((e) => e.kind === "merge").length;
  if (merges) return `${merges} ${merges === 1 ? "merge" : "merges"}`;
  const kind = events[0]?.kind;
  if (kind === "reminder") return "reminder";
  if (kind === "card") return "card";
  if (kind === "familiar") return "familiar";
  return "quiet";
}

// ── the spine ───────────────────────────────────────────────────────────────

/** A chapter's merges are worth naming one by one only while there are few of
 *  them; past that the line reports the shape ("6 merges across coven ·
 *  coven-runtimes") and the shipped table carries the detail. */
const SPINE_MERGE_DETAIL_LIMIT = 2;

export function deriveSpine(chapters: Chapter[]): SpineEntry[] {
  const out: SpineEntry[] = [];

  for (const chapter of chapters) {
    const merges = chapter.events.filter((e) => e.kind === "merge");
    const others = chapter.events.filter((e) => e.kind !== "merge");

    for (const e of others) {
      out.push({
        id: e.id,
        at: e.at,
        tone: e.tone,
        label: e.label,
        detail: e.detail,
        chapterIndex: chapter.index,
        count: 1,
      });
    }

    if (merges.length === 0) continue;

    if (merges.length <= SPINE_MERGE_DETAIL_LIMIT) {
      for (const e of merges) {
        out.push({
          id: e.id,
          at: e.at,
          tone: e.tone,
          label: e.label,
          detail: e.detail,
          chapterIndex: chapter.index,
          count: 1,
        });
      }
      continue;
    }

    const repos = [...new Set(merges.map((m) => (m.detail ?? "").split("#")[0]).filter(Boolean))];
    const where =
      repos.length === 0
        ? ""
        : repos.length <= 3
          ? repos.join(" · ")
          : `${repos.slice(0, 3).join(" · ")} +${repos.length - 3}`;
    out.push({
      id: `chapter-merges:${chapter.index}`,
      at: merges[0].at,
      tone: "success",
      label: `${merges.length} merges${repos.length ? ` across ${repos.length} ${repos.length === 1 ? "repo" : "repos"}` : ""}`,
      detail: where || undefined,
      chapterIndex: chapter.index,
      count: merges.length,
    });
  }

  out.sort((a, b) => a.at.localeCompare(b.at));
  return out;
}

// ── the trailing week ───────────────────────────────────────────────────────

export function deriveTrend(recent: RecentReport[], day: Date): TrendPoint[] {
  const bySlug = new Map(recent.map((r) => [r.slug, r.stats]));
  const out: TrendPoint[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(day);
    d.setDate(day.getDate() - i);
    const slug = dateSlug(d);
    const stats = bySlug.get(slug);
    out.push({
      slug,
      label: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }).toUpperCase(),
      merges: stats?.prsMerged ?? 0,
      sessions: stats?.sessions ?? 0,
      hasReport: Boolean(stats),
    });
  }
  return out;
}

// ── hours / window ──────────────────────────────────────────────────────────

export function hourHistogram(events: DayEvent[]): { hours: number[]; counts: number[] } {
  const counts = new Array(24).fill(0) as number[];
  for (const e of events) counts[e.hour] += 1;
  const peak = Math.max(...counts, 0);
  const hours = counts.map((c) => (peak > 0 ? c / peak : 0));
  return { hours, counts };
}

export function deriveWindow(events: DayEvent[], counts: number[]): DayWindow {
  if (!events.length) {
    return {
      firstAt: null,
      lastAt: null,
      spanMinutes: 0,
      coverageHours: 0,
      busiestHour: null,
      peakLabel: null,
      longestRunHours: 0,
      mergesPerHour: 0,
    };
  }
  const first = events[0];
  const last = events[events.length - 1];
  const coverageHours = counts.filter((c) => c > 0).length;

  let busiestHour = 0;
  for (let h = 1; h < 24; h++) if (counts[h] > counts[busiestHour]) busiestHour = h;

  let longestRunHours = 0;
  let run = 0;
  for (let h = 0; h < 24; h++) {
    if (counts[h] > 0) {
      run += 1;
      longestRunHours = Math.max(longestRunHours, run);
    } else run = 0;
  }

  const merges = events.filter((e) => e.kind === "merge").length;
  const spanMinutes = Math.max(0, last.minute - first.minute);

  return {
    firstAt: first.at,
    lastAt: last.at,
    spanMinutes,
    coverageHours,
    busiestHour,
    peakLabel: `${pad2(busiestHour)}:00`,
    longestRunHours,
    mergesPerHour:
      coverageHours > 0 ? Math.round((merges / coverageHours) * 10) / 10 : 0,
  };
}

// ── swimlanes ───────────────────────────────────────────────────────────────

const LANE_TONES: DayTone[] = ["accent", "success", "warning", "muted"];

export function deriveSwimlanes(
  payload: DailyReportPayload | null,
  events: DayEvent[],
  familiarName: (id: string) => string,
): Swimlane[] {
  const byFamiliar = new Map<
    string,
    { sessions: number; additions: number; deletions: number }
  >();

  for (const group of payload?.sessionGroups ?? []) {
    for (const session of group.sessions) {
      const id = session.familiarId;
      if (!id) continue;
      const acc = byFamiliar.get(id) ?? { sessions: 0, additions: 0, deletions: 0 };
      acc.sessions += 1;
      acc.additions += session.additions ?? 0;
      acc.deletions += session.deletions ?? 0;
      byFamiliar.set(id, acc);
    }
  }

  // Familiars that only show up through timestamped events still get a lane.
  for (const e of events) {
    if (!e.familiarId) continue;
    if (!byFamiliar.has(e.familiarId)) {
      byFamiliar.set(e.familiarId, { sessions: 0, additions: 0, deletions: 0 });
    }
  }

  const lanes: Swimlane[] = [];
  let toneIndex = 0;
  for (const [familiarId, acc] of byFamiliar) {
    const mine = events.filter((e) => e.familiarId === familiarId);
    const merges = mine.filter((e) => e.kind === "merge");
    const span =
      mine.length > 0
        ? {
            leftPct: (mine[0].minute / MINUTES_PER_DAY) * 100,
            widthPct: Math.max(
              0.6,
              ((mine[mine.length - 1].minute - mine[0].minute) / MINUTES_PER_DAY) * 100,
            ),
          }
        : null;
    lanes.push({
      familiarId,
      name: familiarName(familiarId),
      tone: LANE_TONES[toneIndex % LANE_TONES.length],
      sessionCount: acc.sessions,
      mergeCount: merges.length,
      additions: acc.additions,
      deletions: acc.deletions,
      span,
      marks: merges.map((m) => ({
        pct: (m.minute / MINUTES_PER_DAY) * 100,
        tone: "success" as DayTone,
        label: `${clockLabel(m.at)} · ${m.detail ?? m.label}`,
      })),
    });
    toneIndex += 1;
  }

  lanes.sort((a, b) => b.mergeCount - a.mergeCount || b.sessionCount - a.sessionCount);
  return lanes;
}

// ── shipped ─────────────────────────────────────────────────────────────────

export function deriveShipped(payload: DailyReportPayload | null): DayModel["shipped"] {
  const prs: MergedPr[] = payload?.prsMerged ?? [];

  // Per-PR line counts only exist on the session that produced the PR.
  const linesByPr = new Map<string, { additions: number; deletions: number }>();
  for (const group of payload?.sessionGroups ?? []) {
    for (const session of group.sessions) {
      if (!session.pr) continue;
      const key = prKey(session.pr.repo, session.pr.number);
      const acc = linesByPr.get(key) ?? { additions: 0, deletions: 0 };
      acc.additions += session.additions ?? 0;
      acc.deletions += session.deletions ?? 0;
      linesByPr.set(key, acc);
    }
  }

  const rows: ShippedRow[] = prs
    .slice()
    .sort((a, b) => a.mergedAt.localeCompare(b.mergedAt))
    .map((pr) => {
      const lines = linesByPr.get(prKey(pr.repo, pr.number)) ?? null;
      return {
        key: `${pr.repo}#${pr.number}`,
        repo: pr.repo,
        repoLabel: repoBasename(pr.repo),
        number: pr.number,
        title: pr.title,
        url: pr.url,
        mergedAt: pr.mergedAt,
        time: clockLabel(pr.mergedAt),
        additions: lines ? lines.additions : null,
        deletions: lines ? lines.deletions : null,
      };
    });

  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.repoLabel, (counts.get(row.repoLabel) ?? 0) + 1);
  const repos: RepoFacet[] = [...counts.entries()]
    .map(([label, count]) => ({ key: label, label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  // Day totals come from the session groups (every session counts, not just
  // the ones that produced a PR).
  let additions = 0;
  let deletions = 0;
  for (const group of payload?.sessionGroups ?? []) {
    additions += group.additions;
    deletions += group.deletions;
  }

  return {
    rows,
    repos,
    total: rows.length,
    additions,
    deletions,
    firstTime: rows.length ? rows[0].time : null,
    lastTime: rows.length ? rows[rows.length - 1].time : null,
  };
}

export function deriveProjects(groups: SessionGroup[] | undefined): ProjectLines[] {
  const list = (groups ?? []).map((g) => ({
    key: g.key,
    label: g.label,
    additions: g.additions,
    deletions: g.deletions,
    share: 0,
  }));
  const max = Math.max(...list.map((p) => p.additions + p.deletions), 0);
  for (const p of list) p.share = max > 0 ? (p.additions + p.deletions) / max : 0;
  list.sort((a, b) => b.additions + b.deletions - (a.additions + a.deletions));
  return list;
}

// ── streak / deltas ─────────────────────────────────────────────────────────

function shipped(stats: DailyReportStats | null | undefined): boolean {
  if (!stats) return false;
  return (
    stats.sessions > 0 ||
    (stats.prsMerged ?? 0) > 0 ||
    (stats.cardsCompleted ?? 0) > 0 ||
    stats.familiars > 0
  );
}

export function deriveStreak(recent: RecentReport[], day: Date): DayStreak {
  const bySlug = new Map(recent.map((r) => [r.slug, r.stats]));
  const dayAt = (offset: number) => {
    const d = new Date(day);
    d.setDate(day.getDate() + offset);
    return bySlug.get(dateSlug(d));
  };

  let current = 0;
  for (let i = 0; i >= -365; i--) {
    if (!shipped(dayAt(i))) break;
    current += 1;
  }

  // Best run across whatever history the inbox still holds.
  const slugs = recent
    .map((r) => r.slug)
    .filter((s) => bySlug.get(s) && shipped(bySlug.get(s)))
    .sort();
  let best = 0;
  let run = 0;
  let prev: Date | null = null;
  for (const slug of slugs) {
    const d = new Date(`${slug}T00:00:00`);
    if (prev) {
      const gapDays = Math.round((d.getTime() - prev.getTime()) / 86_400_000);
      run = gapDays === 1 ? run + 1 : 1;
    } else run = 1;
    best = Math.max(best, run);
    prev = d;
  }

  const days: boolean[] = [];
  for (let i = 6; i >= 0; i--) days.push(shipped(dayAt(-i)));

  return { current, best: Math.max(best, current), days };
}

function delta(today: number, yesterday: number | null | undefined, noun: string): DayDelta {
  if (yesterday == null) return null;
  const diff = today - yesterday;
  if (diff === 0) return { value: 0, label: `same as ${noun}`, tone: "muted" };
  const sign = diff > 0 ? "+" : "−";
  return {
    value: diff,
    label: `${sign}${Math.abs(diff)} vs ${noun}`,
    tone: diff > 0 ? "success" : "muted",
  };
}

// ── the model ───────────────────────────────────────────────────────────────

export type BuildDayModelInput = {
  stats: DailyReportStats;
  payload: DailyReportPayload | null;
  breakdown: DailyReportBreakdown;
  recent: RecentReport[];
  day: Date;
  items: InboxItem[];
  /** Resolves a familiar id to its display name; defaults to the id. */
  familiarName?: (id: string) => string;
  now?: Date;
};

export function buildDayModel(input: BuildDayModelInput): DayModel {
  const { stats, payload, breakdown, recent, day, items } = input;
  const familiarName = input.familiarName ?? ((id: string) => id);
  const now = input.now ?? new Date();

  const events = dayEvents(payload, breakdown, day);
  const { hours, counts } = hourHistogram(events);
  const shippedModel = deriveShipped(payload);
  const projects = deriveProjects(payload?.sessionGroups);
  const chapters = deriveChapters(events, stats.sessions);

  const yesterday = new Date(day);
  yesterday.setDate(day.getDate() - 1);
  const prevStats = recent.find((r) => r.slug === dateSlug(yesterday))?.stats ?? null;

  const nextReminder =
    items
      .filter((i) => i.kind === "reminder" && i.status === "pending" && i.fireAt)
      .filter((i) => new Date(i.fireAt as string).getTime() > now.getTime())
      .sort((a, b) => (a.fireAt as string).localeCompare(b.fireAt as string))[0] ?? null;

  return {
    stats,
    additions: shippedModel.additions,
    deletions: shippedModel.deletions,
    projectCount: projects.length,
    deltas: {
      sessions: delta(stats.sessions, prevStats?.sessions, "yesterday"),
      prsMerged: delta(stats.prsMerged ?? 0, prevStats?.prsMerged, "yesterday"),
    },
    streak: deriveStreak(recent, day),
    hours,
    hourCounts: counts,
    window: deriveWindow(events, counts),
    chapters,
    events,
    spine: deriveSpine(chapters),
    trend: deriveTrend(recent, day),
    swimlanes: deriveSwimlanes(payload, events, familiarName),
    shipped: shippedModel,
    projects,
    carries: { openItems: breakdown.openItems, nextReminder },
    quiet: events.length === 0,
  };
}
