/**
 * Pure derivations for the dashboard cockpit's deeper views. Operates on the
 * data the cockpit already fetches (familiars + session rows) — no extra API
 * calls — and is clock-injected so it unit-tests without a wall clock.
 */

import type { Familiar, SessionRow } from "@/lib/types";
import type { GitHubItem } from "@/lib/github-tasks";
import type { SparkPoint } from "@/components/ui/sparkline";
import type { TrendSeries } from "@/components/ui/charts/trend-chart";
import type { FamiliarInsightRow } from "@/lib/coven-analytics";
import type { SpaceUsageArea } from "@/lib/server/space-usage";

const DAY_MS = 86_400_000;

function startOfDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function sessionDayMs(s: SessionRow): number | null {
  const raw = s.created_at ?? s.updated_at;
  if (!raw) return null;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : null;
}

/** Count of non-archived sessions per day over the last `days`, oldest-first.
 *  `familiarId === null` counts across all familiars. */
export function sessionsPerDay(
  sessions: SessionRow[],
  familiarId: string | null,
  nowMs: number,
  days = 7,
): number[] {
  const todayStart = startOfDay(nowMs);
  const buckets = new Array(days).fill(0);
  for (const s of sessions) {
    if (s.archived_at) continue;
    if (familiarId !== null && s.familiarId !== familiarId) continue;
    const t = sessionDayMs(s);
    if (t === null) continue;
    const idx = days - 1 - Math.round((todayStart - startOfDay(t)) / DAY_MS);
    if (idx >= 0 && idx < days) buckets[idx] += 1;
  }
  return buckets;
}

export type FamiliarMiniProfile = {
  id: string;
  name: string;
  color: string;
  active: boolean;
  sessionsLast7d: number;
  lastActiveAt: string | null;
  /** 7-point sparkline series (daily session counts), oldest-first. */
  trend: SparkPoint[];
};

/** Per-familiar mini-profile for the Agents panel, derived from sessions. */
export function familiarMiniProfiles(
  familiars: Familiar[],
  sessions: SessionRow[],
  nowMs: number,
  days = 7,
): FamiliarMiniProfile[] {
  const lastByFamiliar = new Map<string, number>();
  for (const s of sessions) {
    if (s.archived_at) continue;
    const t = sessionDayMs(s);
    if (t === null || !s.familiarId) continue;
    lastByFamiliar.set(s.familiarId, Math.max(lastByFamiliar.get(s.familiarId) ?? 0, t));
  }
  return familiars.map((f) => {
    const counts = sessionsPerDay(sessions, f.id, nowMs, days);
    const last = lastByFamiliar.get(f.id);
    return {
      id: f.id,
      name: f.display_name,
      color: f.color || "var(--accent-presence)",
      active: (f.active_sessions ?? 0) > 0,
      sessionsLast7d: counts.reduce((a, b) => a + b, 0),
      lastActiveAt: last ? new Date(last).toISOString() : null,
      trend: counts.map((value, i) => ({ label: `${days - 1 - i}d`, value })),
    };
  });
}

// ─── Predictive signals ──────────────────────────────────────────────────────────

export type DashboardSignal = {
  id: string;
  severity: "warn" | "info";
  text: string;
  /** Where acting on the signal takes you (the stalled PR or the familiar's
   *  analytics). Signals without a destination render as plain rows. */
  href?: string;
  /** True when href leaves the app (opened via the external-URL helper). */
  external?: boolean;
};

const STALE_PR_DAYS = 7;
/** Cheap, pure, clock-injected "things drifting" detector for the cockpit's
 *  Signals strip. Reads only what the cockpit already fetches — no extra calls.
 *
 *  - PR stalled: an open PR / review request untouched for > 7 days.
 *  - Familiar trending down: had sessions in the prior 4-day window (days 3–7
 *    ago) but none in the last 3 days. */
export function dashboardSignals(input: {
  github: GitHubItem[];
  reading?: { status?: string }[];
  sessions: SessionRow[];
  familiars: Familiar[];
  nowMs: number;
}): DashboardSignal[] {
  const { github, sessions, familiars, nowMs } = input;
  const out: DashboardSignal[] = [];

  // PR stalled > 7 days (open PRs / review requests with a stale updatedAt).
  for (const g of github) {
    if (g.kind !== "pr" && g.kind !== "review_request") continue;
    if (g.state === "closed") continue;
    const t = Date.parse(g.updatedAt);
    if (!Number.isFinite(t)) continue;
    const days = Math.floor((nowMs - t) / DAY_MS);
    if (days > STALE_PR_DAYS) {
      out.push({
        id: `pr-stalled-${g.id}`,
        severity: "warn",
        text: `PR stalled ${days}d: ${g.title}`,
        href: g.url,
        external: true,
      });
    }
  }

  // Familiar trending down: active in the prior window, quiet in the last 3 days.
  const last3Start = startOfDay(nowMs) - 2 * DAY_MS; // today + previous 2 days
  const priorStart = startOfDay(nowMs) - (STALE_PR_DAYS - 1) * DAY_MS; // 7-day window start
  for (const f of familiars) {
    let recent = 0;
    let prior = 0;
    for (const s of sessions) {
      if (s.archived_at || s.familiarId !== f.id) continue;
      const t = sessionDayMs(s);
      if (t === null) continue;
      const dayStart = startOfDay(t);
      if (dayStart >= last3Start) recent += 1;
      else if (dayStart >= priorStart) prior += 1;
    }
    if (recent === 0 && prior > 0) {
      out.push({
        id: `familiar-down-${f.id}`,
        severity: "warn",
        text: `${f.display_name} is trending down — no sessions in 3 days`,
        href: `/dashboard/familiars/${encodeURIComponent(f.id)}/analytics`,
      });
    }
  }

  // Surface warnings ahead of info.
  return out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "warn" ? -1 : 1));
}

/** Multi-series session-load over time for the top-N busiest familiars (by
 *  total sessions in the window); familiars with zero load are dropped. */
export function familiarLoadSeries(
  familiars: Familiar[],
  sessions: SessionRow[],
  nowMs: number,
  days = 7,
  topN = 4,
): TrendSeries[] {
  return familiars
    .map((f) => {
      const counts = sessionsPerDay(sessions, f.id, nowMs, days);
      const total = counts.reduce((a, b) => a + b, 0);
      return {
        id: f.id,
        label: f.display_name,
        color: f.color || "var(--accent-presence)",
        total,
        points: counts.map((y, x) => ({ x, y })),
      };
    })
    .filter((s) => s.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, topN)
    .map(({ id, label, color, points }) => ({ id, label, color, points }));
}

// ─── Familiar insights table: sort + filter (pure, DOM-free) ─────────────────────

export type InsightSortKey = "name" | "confidence" | "sessions" | "contract" | "lastActive";
export type SortDir = "asc" | "desc";

function contractRatio(r: FamiliarInsightRow): number {
  return r.contractTotal > 0 ? r.contractPass / r.contractTotal : -1;
}

function lastActiveMs(r: FamiliarInsightRow): number {
  if (!r.lastActiveAt) return -1;
  const t = Date.parse(r.lastActiveAt);
  return Number.isFinite(t) ? t : -1;
}

/** Default cockpit ordering: scored familiars first (highest confidence), then
 *  by recent activity — what the table shows before any header is clicked. */
export function defaultInsightOrder(rows: FamiliarInsightRow[]): FamiliarInsightRow[] {
  return [...rows].sort((a, b) => {
    const ca = a.confidenceScore ?? -1, cb = b.confidenceScore ?? -1;
    if (cb !== ca) return cb - ca;
    return b.sessions7d - a.sessions7d;
  });
}

/** Stable sort by a column. Unscored/never rows always sink to the bottom in
 *  either direction — "sort by confidence asc" should rank real scores, not
 *  lead with a wall of dashes. */
export function sortInsightRows(
  rows: FamiliarInsightRow[],
  key: InsightSortKey,
  dir: SortDir,
): FamiliarInsightRow[] {
  const sign = dir === "asc" ? 1 : -1;
  const val = (r: FamiliarInsightRow): number | string | null => {
    switch (key) {
      case "name": return r.name.toLocaleLowerCase();
      case "confidence": return r.confidenceScore;
      case "sessions": return r.sessions7d;
      case "contract": {
        const ratio = contractRatio(r);
        return ratio < 0 ? null : ratio;
      }
      case "lastActive": {
        const t = lastActiveMs(r);
        return t < 0 ? null : t;
      }
    }
  };
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const va = val(a.r), vb = val(b.r);
      if (va === null && vb === null) return a.i - b.i;
      if (va === null) return 1; // missing values sink regardless of direction
      if (vb === null) return -1;
      if (va < vb) return -1 * sign;
      if (va > vb) return 1 * sign;
      return a.i - b.i; // stable
    })
    .map((x) => x.r);
}

/** Case-insensitive substring filter over name / role / health label. */
export function filterInsightRows(rows: FamiliarInsightRow[], query: string): FamiliarInsightRow[] {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return rows;
  return rows.filter((r) =>
    r.name.toLocaleLowerCase().includes(q) ||
    r.role.toLocaleLowerCase().includes(q) ||
    (r.health ?? "").toLocaleLowerCase().includes(q),
  );
}

// ─── Space usage (rows for the cockpit panel) ────────────────────────────────────

export type SpaceUsageRow = {
  id: string;
  label: string;
  relPath: string;
  bytes: number;
  files: number;
  lastModifiedMs: number | null;
  truncated: boolean;
  /** 0–100 share of the total scanned bytes (for the inline bar). */
  sharePct: number;
  /** Where cleaning this area up happens, when a surface owns it. */
  href: string | null;
  actionLabel: string | null;
};

export type SpaceSortKey = "label" | "bytes" | "files" | "lastModified";

/** Cleanup destinations per area — the surface where the data is managed. */
const SPACE_ACTIONS: Record<string, { href: string; label: string }> = {
  conversations: { href: "/?mode=agents", label: "Review sessions" },
  workspaces: { href: "/?mode=agents", label: "Open familiars" },
  memory: { href: "/?mode=agents", label: "Manage memory" },
  knowledge: { href: "/?mode=agents", label: "Open vault" },
  journal: { href: "/?mode=journal", label: "Open journal" },
  flows: { href: "/?mode=flow", label: "Open flows" },
  prompts: { href: "/?mode=marketplace", label: "Manage prompts" },
  skills: { href: "/?mode=marketplace", label: "Manage skills" },
};

/** Turn scanned areas into display rows: drop missing/empty areas, compute the
 *  share of the total, and attach each area's cleanup destination. */
export function spaceUsageRows(areas: SpaceUsageArea[]): SpaceUsageRow[] {
  const present = areas.filter((a) => a.exists && a.files > 0);
  const total = present.reduce((sum, a) => sum + a.bytes, 0);
  return present.map((a) => ({
    id: a.id,
    label: a.label,
    relPath: a.relPath,
    bytes: a.bytes,
    files: a.files,
    lastModifiedMs: a.lastModifiedMs,
    truncated: a.truncated,
    sharePct: total > 0 ? Math.round((a.bytes / total) * 100) : 0,
    href: SPACE_ACTIONS[a.id]?.href ?? null,
    actionLabel: SPACE_ACTIONS[a.id]?.label ?? null,
  }));
}

/** Stable sort for the space-usage table (default: biggest first). */
export function sortSpaceRows(rows: SpaceUsageRow[], key: SpaceSortKey, dir: SortDir): SpaceUsageRow[] {
  const sign = dir === "asc" ? 1 : -1;
  const val = (r: SpaceUsageRow): number | string =>
    key === "label" ? r.label.toLocaleLowerCase()
    : key === "bytes" ? r.bytes
    : key === "files" ? r.files
    : r.lastModifiedMs ?? -1;
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const va = val(a.r), vb = val(b.r);
      if (va < vb) return -1 * sign;
      if (va > vb) return 1 * sign;
      return a.i - b.i;
    })
    .map((x) => x.r);
}

/** Human byte size: 0 B, 512 B, 1.2 KB, 34 MB, 1.5 GB. One decimal under 10. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u += 1; }
  const text = u === 0 ? String(Math.round(v)) : v < 10 ? v.toFixed(1) : String(Math.round(v));
  return `${text} ${units[u]}`;
}
