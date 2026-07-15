"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { PulseBars } from "@/components/ui/pulse-bars";
import { SkeletonRows } from "@/components/ui/skeleton";
import { useAnnouncer } from "@/components/ui/live-region";
import { AuthedImage } from "@/components/ui/authed-image";
import { RelativeTime } from "@/components/ui/relative-time";
import {
  buildFamiliarCardStats,
  type CovenMemoryEntry,
  type FamiliarCardStats,
} from "@/components/familiars-view-stats";
import { FamiliarGrowthReport } from "@/components/familiar-growth-report";
import { deriveGrowthReport, type FamiliarGrowthReport as GrowthReportModel } from "@/lib/familiar-growth-signals";
import { buildSessionPulse, type PulseDay } from "@/lib/session-pulse";
import { usePausablePoll } from "@/lib/use-pausable-poll";
import { Icon } from "@/lib/icon";
import type { RetroFamiliarState, RetroRunsSnapshot } from "@/lib/retro-runs";
import type { Familiar, SessionRow } from "@/lib/types";

type FamiliarsResponse =
  | { ok: true; familiars: Familiar[] }
  | { ok: false; familiars?: Familiar[]; error?: string };

type SessionsResponse =
  | { ok: true; sessions: SessionRow[] }
  | { ok: false; sessions?: SessionRow[]; error?: string };

type CovenMemoryResponse =
  | { ok: true; entries: CovenMemoryEntry[] }
  | { ok: false; entries?: CovenMemoryEntry[]; error?: string };

type RetroApiResponse =
  | { ok: true; snapshot: RetroRunsSnapshot }
  | { ok: false; snapshot?: RetroRunsSnapshot; error?: string };

export type FamiliarGrowthInitialData = {
  familiars: Familiar[];
  sessions: SessionRow[];
  covenEntries: CovenMemoryEntry[];
  retroSnapshot: RetroRunsSnapshot;
};

const EMPTY_SNAPSHOT: RetroRunsSnapshot = {
  generatedAt: new Date(0).toISOString(),
  summary: {
    totalRuns: 0,
    accepted: 0,
    reverted: 0,
    runningFamiliars: 0,
    familiarsWithData: 0,
    trackCounts: { synthesis: 0, prompt: 0, memory: 0 },
    lastRun: null,
  },
  familiars: [],
  runs: [],
};

const EMPTY_DATA: FamiliarGrowthInitialData = {
  familiars: [],
  sessions: [],
  covenEntries: [],
  retroSnapshot: EMPTY_SNAPSHOT,
};

/** Attention-first roster order — the familiars that need nurturing come first. */
const HEALTH_ORDER: Record<GrowthReportModel["healthLabel"], number> = {
  stalled: 0,
  quiet: 1,
  steady: 2,
  active: 3,
};

const HEALTH_KEYS = ["stalled", "quiet", "steady", "active"] as const;

type RosterRow = {
  familiar: Familiar;
  stats: FamiliarCardStats;
  retro: RetroFamiliarState | null;
  report: GrowthReportModel;
  pulse: PulseDay[];
};

function emptyStats(): FamiliarCardStats {
  return {
    memoryCount: 0,
    latestMemory: null,
    lastSessionAt: null,
    sessionsLast7d: 0,
    hasActiveSession: false,
  };
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  return (await res.json()) as T;
}

function stateByFamiliar(snapshot: RetroRunsSnapshot): Map<string, RetroFamiliarState> {
  return new Map(snapshot.familiars.map((state) => [state.familiarId, state]));
}

function reportSummary(stats: FamiliarCardStats, retro: RetroFamiliarState | null): string {
  const totalRuns = retro?.runs.length ?? 0;
  const memory = stats.memoryCount === 1 ? "1 memory" : `${stats.memoryCount} memories`;
  return `${stats.sessionsLast7d} sessions · ${memory} · ${totalRuns} retro runs`;
}

export function FamiliarGrowthView({
  standalone = false,
  initialData,
}: {
  standalone?: boolean;
  initialData?: FamiliarGrowthInitialData;
}) {
  const [data, setData] = useState<FamiliarGrowthInitialData>(initialData ?? EMPTY_DATA);
  const [selectedFamiliarId, setSelectedFamiliarId] = useState<string | null>(initialData?.familiars[0]?.id ?? null);
  const [loading, setLoading] = useState(!initialData);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // Truthful freshness stamp — set when a load actually lands (server-provided
  // initial data is stamped at mount), never faked at render time.
  const [updatedAt, setUpdatedAt] = useState<string | null>(() => (initialData ? new Date().toISOString() : null));
  const { announce } = useAnnouncer();

  // Loads interleave (mount, manual refresh, 60s poll, on-focus refresh):
  // only the latest issued load may write state, so a slower stale response
  // can't overwrite fresher data — or raise a stale error over it.
  const generation = useRef(0);

  // `silent` marks the recurring background poll — refresh without announcing.
  const load = useCallback(async ({ quiet = false, silent = false } = {}) => {
    const gen = ++generation.current;
    if (quiet) setRefreshing(true);
    else setLoading(true);
    try {
      const [familiarsJson, sessionsJson, memoryJson, retroJson] = await Promise.all([
        getJson<FamiliarsResponse>("/api/familiars"),
        getJson<SessionsResponse>("/api/sessions/list"),
        getJson<CovenMemoryResponse>("/api/coven-memory"),
        getJson<RetroApiResponse>("/api/retro-runs"),
      ]);
      if (generation.current !== gen) return;

      const nextData: FamiliarGrowthInitialData = {
        familiars: familiarsJson.familiars ?? [],
        sessions: sessionsJson.sessions ?? [],
        covenEntries: memoryJson.entries ?? [],
        retroSnapshot: retroJson.snapshot ?? EMPTY_SNAPSHOT,
      };
      const errors = [
        familiarsJson.ok ? null : familiarsJson.error ?? "familiars unavailable",
        sessionsJson.ok ? null : sessionsJson.error ?? "sessions unavailable",
        memoryJson.ok ? null : memoryJson.error ?? "memory unavailable",
        retroJson.ok ? null : retroJson.error ?? "retro runs unavailable",
      ].filter(Boolean);

      setData(nextData);
      setNow(Date.now());
      setUpdatedAt(new Date().toISOString());
      setError(errors.length > 0 ? errors.join(" · ") : null);
      // Selection is reconciled against the attention-sorted roster below, so
      // a fresh load lands on the familiar that most needs attention.
      if (quiet && !silent) announce("Growth data refreshed.");
    } catch (err) {
      if (generation.current !== gen) return;
      setError(err instanceof Error ? err.message : "growth data unavailable");
    } finally {
      if (generation.current === gen) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [announce]);

  useEffect(() => {
    if (initialData) return;
    void load();
  }, [initialData, load]);

  // Growth is a live triage surface — keep health labels, pulses, and
  // last-active stamps current without a manual refresh. Hidden tabs pause.
  usePausablePoll(() => void load({ quiet: true, silent: true }), 60_000);

  const stats = useMemo(
    () => buildFamiliarCardStats({
      familiars: data.familiars,
      sessions: data.sessions,
      covenEntries: data.covenEntries,
      now,
    }),
    [data.covenEntries, data.familiars, data.sessions, now],
  );
  const retroStates = useMemo(() => stateByFamiliar(data.retroSnapshot), [data.retroSnapshot]);

  /** Roster rows, derived once and sorted attention-first (stalled → active). */
  const reports = useMemo<RosterRow[]>(
    () =>
      data.familiars
        .map((familiar) => {
          const familiarStats = stats.get(familiar.id) ?? emptyStats();
          const retro = retroStates.get(familiar.id) ?? null;
          return {
            familiar,
            stats: familiarStats,
            retro,
            report: deriveGrowthReport({ familiar, stats: familiarStats, retroState: retro, now }),
            pulse: buildSessionPulse(data.sessions, familiar.id, now),
          };
        })
        .sort(
          (a, b) =>
            HEALTH_ORDER[a.report.healthLabel] - HEALTH_ORDER[b.report.healthLabel] ||
            a.familiar.display_name.localeCompare(b.familiar.display_name),
        ),
    [data.familiars, data.sessions, now, retroStates, stats],
  );

  const triage = useMemo(() => {
    const counts = { stalled: 0, quiet: 0, steady: 0, active: 0 };
    for (const row of reports) counts[row.report.healthLabel] += 1;
    return counts;
  }, [reports]);

  useEffect(() => {
    if (!selectedFamiliarId && reports.length > 0) {
      setSelectedFamiliarId(reports[0].familiar.id);
    } else if (selectedFamiliarId && !reports.some((row) => row.familiar.id === selectedFamiliarId)) {
      setSelectedFamiliarId(reports[0]?.familiar.id ?? null);
    }
  }, [reports, selectedFamiliarId]);

  const selected = reports.find((item) => item.familiar.id === selectedFamiliarId) ?? reports[0] ?? null;

  const shellClass = `growth-surface${standalone ? " growth-surface--standalone" : ""}`;

  return (
    <section className={shellClass} aria-label="Familiar Growth & Performance">
      <header className="retro-hero growth-hero">
        <div className="retro-hero__copy">
          <p className="retro-eyebrow">
            <Icon name="ph:chart-bar-bold" aria-hidden />
            Familiar Growth &amp; Performance
          </p>
          <h2>Spot growth patterns</h2>
          <p>
            Review familiar activity, retro acceptance, memory freshness, and rule-based growth opportunities in one place.
          </p>
          {reports.length > 0 ? (
            <ul className="growth-triage" aria-label="Roster health summary">
              {HEALTH_KEYS.map((key) =>
                triage[key] > 0 ? (
                  <li key={key} className={`growth-triage__chip growth-triage__chip--${key}`}>
                    <i className={`growth-dot growth-dot--${key}`} aria-hidden />
                    {triage[key]} {key}
                  </li>
                ) : null,
              )}
            </ul>
          ) : null}
        </div>
        <div className="retro-hero__actions">
          {updatedAt ? (
            <span className="growth-hero__updated">
              Updated <RelativeTime iso={updatedAt} />
            </span>
          ) : null}
          <button
            type="button"
            className="retro-icon-btn"
            aria-label="Refresh familiar growth"
            title="Refresh familiar growth"
            disabled={refreshing}
            onClick={() => void load({ quiet: true })}
          >
            <Icon name="ph:arrows-clockwise-bold" aria-hidden />
          </button>
          {selected ? (
            <a className="retro-btn" href={`/dashboard/familiars/${encodeURIComponent(selected.familiar.id)}/analytics`}>
              <Icon name="ph:chart-bar-bold" aria-hidden />
              Analytics
            </a>
          ) : null}
        </div>
      </header>

      {error ? (
        <div className="retro-callout" role="alert">
          <Icon name="ph:warning-circle" aria-hidden />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="growth-layout">
        <aside className="growth-sidebar" aria-label="Familiar roster">
          <div className="retro-panel-title">
            <Icon name="ph:users-three-bold" aria-hidden />
            Familiar roster
          </div>
          {loading ? (
            <SkeletonRows count={4} />
          ) : reports.length === 0 ? (
            <EmptyState
              compact
              icon="ph:users-three-bold"
              headline="No familiars yet."
              subtitle="Create a familiar to start tracking growth."
            />
          ) : (
            <ul>
              {reports.map(({ familiar, stats: familiarStats, retro, report, pulse }) => {
                const selectedItem = selected?.familiar.id === familiar.id;
                return (
                  <li key={familiar.id}>
                    <button
                      type="button"
                      className={`growth-familiar${selectedItem ? " is-selected" : ""}`}
                      aria-pressed={selectedItem}
                      onClick={() => setSelectedFamiliarId(familiar.id)}
                    >
                      <AuthedImage
                        className="retro-avatar growth-familiar__avatar"
                        src={familiar.avatarUrl}
                        alt=""
                        fallback={
                          <span className="retro-avatar growth-familiar__avatar">
                            {familiar.display_name.slice(0, 1).toUpperCase()}
                          </span>
                        }
                      />
                      <span className="growth-familiar__copy">
                        <b>{familiar.display_name}</b>
                        <small>{familiar.role || familiar.harness || "familiar"}</small>
                        <small>{reportSummary(familiarStats, retro)}</small>
                        <PulseBars pulse={pulse} size="sm" />
                      </span>
                      <i className={`growth-dot growth-dot--${report.healthLabel}`} aria-label={report.healthLabel} />
                    </button>
                    <Link
                      href={`/dashboard/familiars/${encodeURIComponent(familiar.id)}/analytics`}
                      className="growth-familiar__analytics focus-ring"
                    >
                      Analytics →
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        <div className="growth-main" aria-busy={loading || refreshing}>
          {loading ? (
            <SkeletonRows count={5} />
          ) : selected ? (
            <FamiliarGrowthReport
              familiar={selected.familiar}
              report={selected.report}
              sessions={data.sessions}
              stats={selected.stats}
              now={now}
            />
          ) : (
            <EmptyState
              compact
              icon="ph:users-three-bold"
              headline="No familiars available."
              subtitle="Growth reports appear once a familiar exists."
            />
          )}
        </div>
      </div>
    </section>
  );
}
