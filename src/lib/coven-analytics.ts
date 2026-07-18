/**
 * Coven-wide analytics for the insights dashboard. Rolls the per-familiar
 * signals the dashboard already derives (confidence, growth health, sessions,
 * contracts) up into coven vitals and a plain-language "so what" line — the
 * numbers that tell a beginner whether the coven is healthy at a glance, and
 * the week-over-week deltas a power user watches.
 *
 * Pure + clock-injected (no wall clock, no I/O) so it unit-tests cleanly. The
 * heavy per-familiar derivations stay in the component that fetches them; this
 * module only aggregates the compact rows it hands over.
 */

import type { SparkPoint } from "@/components/ui/sparkline";
import type { SessionRow } from "@/lib/types";
import { sessionsPerDay } from "@/lib/dashboard-analytics";

export type CovenTone = "good" | "warn" | "bad";
export type ConfidenceTier = "Low" | "Developing" | "Reliable" | "Trusted";
export type FamiliarHealth = "active" | "steady" | "quiet" | "stalled";

/** One familiar's compact analytics row — the unit the coven aggregators and
 *  the insights table both read. Confidence is thread-confidence (real thread
 *  self-reports) and reads null until reflections exist; contract may be
 *  absent when the familiar's contract wasn't fetched (the fetch is bounded);
 *  activity signals are always present since they derive from sessions alone. */
export type FamiliarInsightRow = {
  id: string;
  name: string;
  role: string;
  color: string;
  emoji: string | null;
  avatarUrl: string | null;
  active: boolean;
  /** 0–100 confidence, or null when the familiar wasn't scored. */
  confidenceScore: number | null;
  confidenceLabel: ConfidenceTier | null;
  /** Growth health bucket, or null when no growth report was derived. */
  health: FamiliarHealth | null;
  sessions7d: number;
  /** 7-point daily session sparkline, oldest→newest. */
  trend: SparkPoint[];
  contractPass: number;
  contractTotal: number;
  lastActiveAt: string | null;
};

export type CovenVitals = {
  familiarCount: number;
  /** Familiars that carry a confidence score (contract was fetched). */
  scoredCount: number;
  activeFamiliars: number;
  sessions7d: number;
  /** Days 8–14 back, for the week-over-week comparison. */
  sessionsPrev7d: number;
  sessionsWowDelta: number;
  /** Mean confidence across scored familiars (rounded), or null. */
  avgConfidence: number | null;
  confidenceTier: ConfidenceTier | null;
  contractPass: number;
  contractTotal: number;
  retroAccepted: number;
  retroReverted: number;
  /** accepted / (accepted + reverted), or null when there are no retro runs. */
  retroAcceptRate: number | null;
  stalledCount: number;
  quietCount: number;
};

export type CovenInsight = { headline: string; detail: string; tone: CovenTone };

/** Same tiering the per-familiar confidence score uses, applied to the coven mean. */
export function confidenceTier(score: number): ConfidenceTier {
  if (score >= 80) return "Trusted";
  if (score >= 60) return "Reliable";
  if (score >= 40) return "Developing";
  return "Low";
}

/** Coven-wide daily session counts over `days`, oldest→newest, as a labelled
 *  sparkline/trend series. Counts every familiar (archived sessions excluded). */
export function covenSessionsSeries(sessions: SessionRow[], nowMs: number, days = 14): SparkPoint[] {
  const counts = sessionsPerDay(sessions, null, nowMs, days);
  const today = new Date(nowMs);
  return counts.map((value, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - (days - 1 - i));
    return {
      label: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      value,
    };
  });
}

/** Roll the per-familiar rows + raw session/retro data up into coven vitals. */
export function deriveCovenVitals(input: {
  rows: FamiliarInsightRow[];
  sessions: SessionRow[];
  retro: { accepted: number; reverted: number } | null;
  nowMs: number;
}): CovenVitals {
  const { rows, sessions, retro, nowMs } = input;

  // 14-day window split in half → this-week vs last-week for the WoW delta.
  const daily = sessionsPerDay(sessions, null, nowMs, 14);
  const sessionsPrev7d = daily.slice(0, 7).reduce((a, b) => a + b, 0);
  const sessions7d = daily.slice(7).reduce((a, b) => a + b, 0);

  const scored = rows.filter((r) => r.confidenceScore != null);
  const avgConfidence = scored.length
    ? Math.round(scored.reduce((sum, r) => sum + (r.confidenceScore ?? 0), 0) / scored.length)
    : null;

  const contractPass = rows.reduce((sum, r) => sum + r.contractPass, 0);
  const contractTotal = rows.reduce((sum, r) => sum + r.contractTotal, 0);

  const retroAccepted = retro?.accepted ?? 0;
  const retroReverted = retro?.reverted ?? 0;
  const retroTotal = retroAccepted + retroReverted;

  return {
    familiarCount: rows.length,
    scoredCount: scored.length,
    activeFamiliars: rows.filter((r) => r.active).length,
    sessions7d,
    sessionsPrev7d,
    sessionsWowDelta: sessions7d - sessionsPrev7d,
    avgConfidence,
    confidenceTier: avgConfidence != null ? confidenceTier(avgConfidence) : null,
    contractPass,
    contractTotal,
    retroAccepted,
    retroReverted,
    retroAcceptRate: retroTotal ? retroAccepted / retroTotal : null,
    stalledCount: rows.filter((r) => r.health === "stalled").length,
    quietCount: rows.filter((r) => r.health === "quiet").length,
  };
}

/** Join names naturally, capping the list: ["a","b","c","d"] → "a, b and 2 more". */
function listNames(rows: FamiliarInsightRow[], cap = 2): string {
  const names = rows.map((r) => r.name);
  if (names.length <= cap) {
    if (names.length <= 1) return names[0] ?? "";
    return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  }
  const shown = names.slice(0, cap).join(", ");
  return `${shown} and ${names.length - cap} more`;
}

function joinClauses(parts: string[]): string {
  const clean = parts.filter(Boolean);
  if (clean.length <= 1) return clean[0] ?? "";
  return `${clean.slice(0, -1).join(", ")}, and ${clean[clean.length - 1]}`;
}

function capitalize(text: string): string {
  return text ? text.slice(0, 1).toUpperCase() + text.slice(1) : text;
}

/**
 * Plain-language read of the whole coven — the one line a beginner can act on.
 * Leads with this week's activity, names the busiest familiar, and surfaces the
 * most pressing concern (stalled → quiet) or, when all is well, a positive.
 * Tone reflects the worst live signal.
 */
export function deriveCovenInsight(input: { vitals: CovenVitals; rows: FamiliarInsightRow[]; familiarsLoaded?: boolean }): CovenInsight {
  const { vitals, rows } = input;

  if (input.familiarsLoaded === false) {
    return {
      headline: "Loading familiars",
      detail: "Fetching the coven roster before reading activity, confidence, and contract health.",
      tone: "warn",
    };
  }

  if (vitals.familiarCount === 0) {
    return {
      headline: "No familiars yet",
      detail: "Summon a familiar to start tracking your coven's activity, confidence, and performance.",
      tone: "warn",
    };
  }

  const stalled = rows.filter((r) => r.health === "stalled");
  const quiet = rows.filter((r) => r.health === "quiet");
  const busiest = [...rows].sort((a, b) => b.sessions7d - a.sessions7d)[0];
  const retroRuns = vitals.retroAccepted + vitals.retroReverted;
  const lowAccept = vitals.retroAcceptRate != null && vitals.retroAcceptRate < 0.5 && retroRuns >= 3;

  const tone: CovenTone =
    stalled.length > 0 || (vitals.avgConfidence != null && vitals.avgConfidence < 40)
      ? "bad"
      : quiet.length > 0 || lowAccept
        ? "warn"
        : "good";

  const headline =
    tone === "bad"
      ? "Your coven needs a look"
      : tone === "warn"
        ? "Your coven is mostly on track"
        : "Your coven is running smoothly";

  const clauses: string[] = [];

  if (vitals.sessions7d > 0) {
    const wow = vitals.sessionsWowDelta;
    const trend = wow > 0 ? `up ${wow} from last week` : wow < 0 ? `down ${Math.abs(wow)} from last week` : "level with last week";
    clauses.push(`${vitals.sessions7d} session${vitals.sessions7d === 1 ? "" : "s"} this week, ${trend}`);
  } else {
    clauses.push("no sessions this week");
  }

  if (busiest && busiest.sessions7d > 0 && vitals.familiarCount > 1) {
    clauses.push(`${busiest.name} is leading the load`);
  }

  if (stalled.length > 0) {
    clauses.push(`${listNames(stalled)} ${stalled.length === 1 ? "has" : "have"} stalled`);
  } else if (quiet.length > 0) {
    clauses.push(`${listNames(quiet)} ${quiet.length === 1 ? "has" : "have"} gone quiet`);
  } else if (lowAccept) {
    clauses.push(`retro runs are reverting more than they land (${Math.round((vitals.retroAcceptRate ?? 0) * 100)}% accepted)`);
  } else if (vitals.avgConfidence != null) {
    clauses.push(`confidence sits at ${vitals.avgConfidence} (${vitals.confidenceTier})`);
  }

  return { headline, detail: `${capitalize(joinClauses(clauses))}.`, tone };
}
