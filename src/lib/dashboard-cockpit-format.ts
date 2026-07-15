// Pure formatting + vocab helpers for the dashboard cockpit — extracted from
// dashboard-cockpit.tsx (cave-tsoz) so the pieces that the KPI tiles, panels,
// and layout persistence share are testable without a React tree.

import type { SparkPoint } from "@/components/ui/sparkline";
import type { CardStatus } from "@/lib/cave-board-types";
import type { CovenVitals, FamiliarInsightRow } from "@/lib/coven-analytics";

// ─── Draggable panel layout ──────────────────────────────────────────────────

export type Layout = { main: string[]; rail: string[] };

export const DEFAULT_LAYOUT: Layout = {
  main: ["usage", "signals", "needs", "board", "today"],
  rail: ["confidence", "agents", "load", "space", "github", "agenda"],
};

// Human titles for drag-and-drop announcements + grip labels (mirrors each
// widget's <Panel title>). dnd-kit's defaults read the raw ids, which are
// semantic but terse — screen readers should hear the visible panel names.
export const PANEL_TITLES: Record<string, string> = {
  usage: "Activity over time",
  signals: "Signals",
  needs: "Needs you",
  board: "Board",
  today: "Today summary",
  confidence: "Performance matrix",
  agents: "Familiars",
  load: "Familiar load",
  space: "Space usage",
  github: "GitHub",
  agenda: "Up next",
};

export const panelTitle = (id: unknown): string => PANEL_TITLES[String(id)] ?? String(id);

/** Merge a saved order with the defaults: keep known ids in saved order, append
 *  any new defaults, drop anything unknown (survives version changes). */
export function reconcileLayout(stored: Partial<Layout>): Layout {
  const fix = (saved: string[] | undefined, def: string[]) => {
    const s = (saved ?? []).filter((id) => def.includes(id));
    for (const id of def) if (!s.includes(id)) s.push(id);
    return s;
  };
  return { main: fix(stored.main, DEFAULT_LAYOUT.main), rail: fix(stored.rail, DEFAULT_LAYOUT.rail) };
}

// ─── 7-day vitals trends (persisted client-side, keyed by day) ────────────────

export const TREND_DAYS = 7;
export type TrendKey = "confidence" | "active" | "sessions" | "accept" | "contract" | "needs";
// Persisted JSON can legitimately miss keys for a day (older snapshots predate
// newer metrics) — seriesFor already reads missing values as gaps.
export type DaySnap = Partial<Record<TrendKey, number>>;
export type TrendStore = Record<string, DaySnap>; // "YYYY-MM-DD" -> snapshot

export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Last `TREND_DAYS` points for one metric, oldest→newest; null value for missing days. */
export function seriesFor(store: TrendStore, key: TrendKey, now: Date): SparkPoint[] {
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

export const STATUS_META: Record<CardStatus, { label: string; color: string }> = {
  running: { label: "In progress", color: "var(--color-success)" },
  review: { label: "In review", color: "var(--color-info)" },
  blocked: { label: "Blocked", color: "var(--color-danger)" },
  inbox: { label: "Inbox", color: "var(--accent-presence)" },
  backlog: { label: "Backlog", color: "var(--text-muted)" },
  done: { label: "Done", color: "color-mix(in oklch, var(--color-success) 55%, var(--text-muted))" },
};
export const STATUS_ORDER: CardStatus[] = ["running", "review", "blocked", "inbox", "backlog", "done"];

export const HEALTH_META: Record<NonNullable<FamiliarInsightRow["health"]>, { label: string; tone: "good" | "warn" | "bad" | "calm" }> = {
  active: { label: "Active", tone: "good" },
  steady: { label: "Steady", tone: "calm" },
  quiet: { label: "Quiet", tone: "warn" },
  stalled: { label: "Stalled", tone: "bad" },
};

export const TIER_TONE: Record<string, "good" | "warn" | "bad" | "calm"> = {
  Trusted: "good", Reliable: "calm", Developing: "warn", Low: "bad",
};

// ─── KPI sub-lines ─────────────────────────────────────────────────────────────

export function wowSub(delta: number): string {
  if (delta > 0) return `▲ ${delta} vs last week`;
  if (delta < 0) return `▼ ${Math.abs(delta)} vs last week`;
  return "level with last week";
}

export function retroSub(v: CovenVitals): string {
  const runs = v.retroAccepted + v.retroReverted;
  // Teach, don't shrug: name the action that fills the tile (cave-m4oq).
  if (runs === 0) return "fills in after the first retro run";
  return `${v.retroAccepted}/${runs} accepted`;
}

export function contractSub(v: CovenVitals): string {
  if (v.contractTotal === 0) return "fills in once familiars have contracts";
  return `${v.contractPass}/${v.contractTotal} passing`;
}

export function coverageSub(base: string, fetched: number, total: number, verb: "scored" | "checked"): string {
  if (total <= fetched) return base;
  return `${base} · first ${fetched}/${total} ${verb}`;
}

// ─── Small formatters ──────────────────────────────────────────────────────────

/** Calendar-relative label for an upcoming reminder: "Today 3:00 PM",
 *  "Tmrw 9:15 AM", then "Jul 18 9:15 AM" past tomorrow. */
export function whenLabel(iso: string, now: Date): string {
  const d = new Date(iso);
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (sameDay) return `Today ${time}`;
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  if (d.toDateString() === tomorrow.toDateString()) return `Tmrw ${time}`;
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${time}`;
}

export function shortRepo(repo: string): string {
  const slash = repo.lastIndexOf("/");
  return slash >= 0 ? repo.slice(slash + 1) : repo;
}

/** Pretty label for a confidence factor key (e.g. "accept_rate" → "Accept"). */
export function prettyFactor(label: string): string {
  const base = label.replace(/_score$/, "").replace(/_rate$/, "");
  return base.split("_").map((w) => w.slice(0, 1).toUpperCase() + w.slice(1)).join(" ");
}

/** 0 → danger, 1 → success, ramped through color-mix in oklch. */
export function confidenceColor(value: number): string {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return `color-mix(in oklch, var(--color-success) ${pct}%, var(--color-danger))`;
}

export function longDate(now: Date): string {
  return now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

/** Truthful empty state for the GitHub panel, keyed on the token probe
 *  (`GET /api/github/pat` → hasPat). `null` = the probe itself failed, so
 *  neither "connected" nor "not connected" can honestly be claimed — keep the
 *  ambiguous copy rather than fabricate certainty. Only the known-disconnected
 *  branch offers the connect affordance; showing it to a connected user whose
 *  feed is merely quiet would name the wrong fix. */
export function githubEmptyState(connected: boolean | null): { copy: string; showConnect: boolean } {
  if (connected === false) return { copy: "GitHub isn't connected.", showConnect: true };
  if (connected === true) return { copy: "No GitHub activity right now.", showConnect: false };
  return { copy: "No GitHub activity, or no token configured.", showConnect: false };
}
