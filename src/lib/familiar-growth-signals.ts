import type { FamiliarCardStats } from "@/components/familiars-view-stats";
import type { RetroFamiliarState, RetroRun, RetroTrack } from "@/lib/retro-runs";
import type { Familiar } from "@/lib/types";

export type GrowthSignalKind =
  | "low-accept-rate"
  | "session-gap"
  | "no-memory"
  | "stale-memory"
  | "low-retro-volume"
  | "healthy";

export type GrowthSignal = {
  kind: GrowthSignalKind;
  track?: RetroTrack;
  label: string;
  detail: string;
  severity: "info" | "warn" | "crit";
};

export type FamiliarGrowthReport = {
  familiarId: string;
  healthLabel: "active" | "steady" | "quiet" | "stalled";
  sessionsLast7d: number;
  retroAcceptRate: number | null;
  lastActiveAt: string | null;
  signals: GrowthSignal[];
  recentRuns: RetroRun[];
  trackStats: Record<RetroTrack, { total: number; accepted: number }>;
};

export const GROWTH_THRESHOLDS = {
  lowAcceptRate: 0.5,
  lowAcceptMinimumRuns: 3,
  sessionGapWarnDays: 7,
  sessionGapCriticalDays: 14,
  staleMemoryDays: 21,
  lowRetroVolumeRuns: 3,
} as const;

const TRACKS: RetroTrack[] = ["synthesis", "prompt", "memory"];
const DAY_MS = 24 * 60 * 60_000;

function daysSince(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.floor((now - ms) / DAY_MS));
}

function trackLabel(track: RetroTrack): string {
  return track.slice(0, 1).toUpperCase() + track.slice(1);
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function emptyTrackStats(): FamiliarGrowthReport["trackStats"] {
  return {
    synthesis: { total: 0, accepted: 0 },
    prompt: { total: 0, accepted: 0 },
    memory: { total: 0, accepted: 0 },
  };
}

function buildTrackStats(runs: RetroRun[]): FamiliarGrowthReport["trackStats"] {
  const stats = emptyTrackStats();
  for (const run of runs) {
    stats[run.track].total += 1;
    if (run.outcome === "ACCEPT") stats[run.track].accepted += 1;
  }
  return stats;
}

function sortRunsNewestFirst(runs: RetroRun[]): RetroRun[] {
  return [...runs].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
}

function overallAcceptRate(runs: RetroRun[]): number | null {
  if (runs.length === 0) return null;
  return runs.filter((run) => run.outcome === "ACCEPT").length / runs.length;
}

function deriveHealth(args: {
  stats: FamiliarCardStats;
  retroAcceptRate: number | null;
  totalRuns: number;
  sessionGapDays: number | null;
}): FamiliarGrowthReport["healthLabel"] {
  const { stats, retroAcceptRate, totalRuns, sessionGapDays } = args;
  const hasRetroSignal = totalRuns >= GROWTH_THRESHOLDS.lowAcceptMinimumRuns;

  if (
    sessionGapDays == null ||
    sessionGapDays >= GROWTH_THRESHOLDS.sessionGapCriticalDays ||
    (hasRetroSignal && retroAcceptRate != null && retroAcceptRate < 0.35)
  ) {
    return "stalled";
  }

  if (sessionGapDays >= GROWTH_THRESHOLDS.sessionGapWarnDays || stats.sessionsLast7d === 0) {
    return "quiet";
  }

  if (stats.hasActiveSession || stats.sessionsLast7d >= 3) {
    return "active";
  }

  return "steady";
}

export function deriveGrowthReport(args: {
  familiar: Familiar;
  stats: FamiliarCardStats;
  retroState: RetroFamiliarState | null;
  now?: number;
}): FamiliarGrowthReport {
  const now = args.now ?? Date.now();
  const runs = sortRunsNewestFirst(args.retroState?.runs ?? []);
  const trackStats = buildTrackStats(runs);
  const retroAcceptRate = overallAcceptRate(runs);
  const sessionGapDays = daysSince(args.stats.lastSessionAt, now);
  const latestMemoryGapDays = daysSince(args.stats.latestMemory?.updatedAt, now);
  const signals: GrowthSignal[] = [];

  for (const track of TRACKS) {
    const stat = trackStats[track];
    if (stat.total < GROWTH_THRESHOLDS.lowAcceptMinimumRuns) continue;
    const acceptRate = stat.accepted / stat.total;
    if (acceptRate < GROWTH_THRESHOLDS.lowAcceptRate) {
      const revertRate = 1 - acceptRate;
      signals.push({
        kind: "low-accept-rate",
        track,
        label: `${trackLabel(track)} track is reverting often`,
        detail: `${trackLabel(track)} track shows a ${percent(revertRate)} revert rate and may need ${track} refinement.`,
        severity: "warn",
      });
    }
  }

  if (sessionGapDays == null) {
    signals.push({
      kind: "session-gap",
      label: "No recent sessions",
      detail: "No session activity is available for this familiar.",
      severity: "crit",
    });
  } else if (sessionGapDays >= GROWTH_THRESHOLDS.sessionGapCriticalDays) {
    signals.push({
      kind: "session-gap",
      label: "Session gap is critical",
      detail: `No active sessions in ${sessionGapDays} days. Familiar may be stalled or deprioritized.`,
      severity: "crit",
    });
  } else if (sessionGapDays >= GROWTH_THRESHOLDS.sessionGapWarnDays) {
    signals.push({
      kind: "session-gap",
      label: "Session gap",
      detail: `No active sessions in ${sessionGapDays} days. Familiar may be quiet or waiting for work.`,
      severity: "warn",
    });
  }

  if (args.stats.memoryCount === 0) {
    signals.push({
      kind: "no-memory",
      label: "No memory recorded",
      detail: "No memory recorded. Consider whether this familiar's context should be captured.",
      severity: "warn",
    });
  } else if (latestMemoryGapDays != null && latestMemoryGapDays >= GROWTH_THRESHOLDS.staleMemoryDays) {
    signals.push({
      kind: "stale-memory",
      label: "Memory is stale",
      detail: `Latest memory update is ${latestMemoryGapDays} days old. Review whether the familiar's context is still current.`,
      severity: "warn",
    });
  }

  if (runs.length < GROWTH_THRESHOLDS.lowRetroVolumeRuns) {
    signals.push({
      kind: "low-retro-volume",
      label: "Low retro volume",
      detail: `Fewer than ${GROWTH_THRESHOLDS.lowRetroVolumeRuns} retro runs are available, so eval performance is still directional.`,
      severity: "info",
    });
  }

  if (signals.length === 0) {
    signals.push({
      kind: "healthy",
      label: "No current growth flags",
      detail: "This familiar has healthy recent activity and no obvious growth stalls.",
      severity: "info",
    });
  }

  return {
    familiarId: args.familiar.id,
    healthLabel: deriveHealth({
      stats: args.stats,
      retroAcceptRate,
      totalRuns: runs.length,
      sessionGapDays,
    }),
    sessionsLast7d: args.stats.sessionsLast7d,
    retroAcceptRate,
    lastActiveAt: args.stats.lastSessionAt,
    signals,
    recentRuns: runs.slice(0, 5),
    trackStats,
  };
}
