"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonRows } from "@/components/ui/skeleton";
import {
  buildFamiliarCardStats,
  type CovenMemoryEntry,
  type FamiliarCardStats,
} from "@/components/familiars-view-stats";
import { FamiliarGrowthReport } from "@/components/familiar-growth-report";
import { deriveGrowthReport } from "@/lib/familiar-growth-signals";
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

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    try {
      const [familiarsJson, sessionsJson, memoryJson, retroJson] = await Promise.all([
        getJson<FamiliarsResponse>("/api/familiars"),
        getJson<SessionsResponse>("/api/sessions/list"),
        getJson<CovenMemoryResponse>("/api/coven-memory"),
        getJson<RetroApiResponse>("/api/retro-runs"),
      ]);

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
      setError(errors.length > 0 ? errors.join(" · ") : null);
      setSelectedFamiliarId((current) => current ?? nextData.familiars[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "growth data unavailable");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (initialData) return;
    void load();
  }, [initialData, load]);

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

  useEffect(() => {
    if (!selectedFamiliarId && data.familiars.length > 0) {
      setSelectedFamiliarId(data.familiars[0].id);
    } else if (selectedFamiliarId && !data.familiars.some((familiar) => familiar.id === selectedFamiliarId)) {
      setSelectedFamiliarId(data.familiars[0]?.id ?? null);
    }
  }, [data.familiars, selectedFamiliarId]);

  const reports = useMemo(
    () =>
      data.familiars.map((familiar) => ({
        familiar,
        stats: stats.get(familiar.id) ?? emptyStats(),
        retro: retroStates.get(familiar.id) ?? null,
      })),
    [data.familiars, retroStates, stats],
  );

  const selected = reports.find((item) => item.familiar.id === selectedFamiliarId) ?? reports[0] ?? null;
  const selectedReport = selected
    ? deriveGrowthReport({
        familiar: selected.familiar,
        stats: selected.stats,
        retroState: selected.retro,
        now,
      })
    : null;

  const shellClass = `growth-surface${standalone ? " growth-surface--standalone" : ""}`;

  return (
    <section className={shellClass} aria-label="Familiar Growth & Performance">
      <header className="retro-hero growth-hero">
        <div className="retro-hero__copy">
          <p className="retro-eyebrow">
            <Icon name="ph:chart-bar-bold" aria-hidden />
            Familiar Growth &amp; Performance
          </p>
          <h2>Spot growth patterns before they stall.</h2>
          <p>
            Review familiar activity, retro acceptance, memory freshness, and rule-based growth opportunities in one place.
          </p>
        </div>
        <div className="retro-hero__actions">
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
          <a className="retro-btn" href="/dashboard?view=evals">
            <Icon name="ph:arrows-clockwise-bold" aria-hidden />
            Evals
          </a>
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
            <p className="retro-muted">No familiars available.</p>
          ) : (
            <ul>
              {reports.map(({ familiar, stats: familiarStats, retro }) => {
                const report = deriveGrowthReport({
                  familiar,
                  stats: familiarStats,
                  retroState: retro,
                  now,
                });
                const selectedItem = selected?.familiar.id === familiar.id;
                return (
                  <li key={familiar.id}>
                    <button
                      type="button"
                      className={`growth-familiar${selectedItem ? " is-selected" : ""}`}
                      onClick={() => setSelectedFamiliarId(familiar.id)}
                    >
                      <span className="retro-avatar growth-familiar__avatar">
                        {familiar.display_name.slice(0, 1).toUpperCase()}
                      </span>
                      <span className="growth-familiar__copy">
                        <b>{familiar.display_name}</b>
                        <small>{familiar.role || familiar.harness || "familiar"}</small>
                        <small>{reportSummary(familiarStats, retro)}</small>
                      </span>
                      <i className={`growth-dot growth-dot--${report.healthLabel}`} aria-label={report.healthLabel} />
                    </button>
                    <Link
                      href={`/dashboard/familiars/${encodeURIComponent(familiar.id)}/analytics`}
                      className="ml-[54px] mt-1 inline-flex text-[10px] text-[var(--text-muted)] hover:text-[var(--accent-presence)]"
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
          ) : selected && selectedReport ? (
            <FamiliarGrowthReport
              familiar={selected.familiar}
              report={selectedReport}
              sessions={data.sessions}
              stats={selected.stats}
              now={now}
            />
          ) : (
            <EmptyState compact icon="ph:users-three-bold" headline="No familiars available." />
          )}
        </div>
      </div>
    </section>
  );
}
