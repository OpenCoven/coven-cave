"use client";

import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/lib/icon";
import type { RetroOutcome, RetroRun, RetroRunsSnapshot, RetroTrack } from "@/lib/retro-runs";

type RetroApiResponse = {
  ok: boolean;
  error?: string;
  snapshot: RetroRunsSnapshot;
};

type TrackFilter = "all" | RetroTrack;
type OutcomeFilter = "all" | RetroOutcome;

const TRACKS: Array<{ id: TrackFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "synthesis", label: "Synthesis" },
  { id: "prompt", label: "Prompt" },
  { id: "memory", label: "Memory" },
];

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

function relativeTime(iso: string | null): string {
  if (!iso) return "never";
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) return "unknown";
  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function scoreLabel(delta: number): string {
  if (delta > 0) return `+${delta.toFixed(2)}`;
  return delta.toFixed(2);
}

function downloadRetroSnapshot(snapshot: RetroRunsSnapshot) {
  const payload = JSON.stringify(snapshot, null, 2);
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `coven-retro-runs-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function OutcomePill({ outcome }: { outcome: RetroOutcome }) {
  return (
    <span className={`retro-pill retro-pill--${outcome.toLowerCase()}`}>
      {outcome === "ACCEPT" ? "Accepted" : "Reverted"}
    </span>
  );
}

function RunRow({ run }: { run: RetroRun }) {
  return (
    <article className="retro-run-row">
      <div className="retro-run-row__rail" aria-hidden />
      <div className="retro-run-row__main">
        <div className="retro-run-row__top">
          <div className="retro-run-row__identity">
            <span className="retro-avatar">{run.familiarName.slice(0, 1).toUpperCase()}</span>
            <span className="retro-run-row__names">
              <span className="retro-run-row__familiar">{run.familiarName}</span>
              <span className="retro-run-row__meta">
                {run.familiarRole ? `${run.familiarRole} · ` : ""}
                {run.track} · iteration {run.iteration}
              </span>
            </span>
          </div>
          <OutcomePill outcome={run.outcome} />
        </div>

        <p className="retro-run-row__summary">{run.changeSummary}</p>

        <div className="retro-run-row__stats">
          <span className={`retro-delta ${run.delta >= 0 ? "retro-delta--good" : "retro-delta--bad"}`}>
            {scoreLabel(run.delta)}
          </span>
          <span>{run.metricBefore.toFixed(2)} -&gt; {run.metricAfter.toFixed(2)}</span>
          <span>{relativeTime(run.timestamp)}</span>
        </div>

        {run.notes ? <p className="retro-run-row__notes">{run.notes}</p> : null}

        <details className="retro-run-row__raw">
          <summary>Sanitized snapshot</summary>
          <pre>{JSON.stringify(run.raw, null, 2)}</pre>
        </details>
      </div>
    </article>
  );
}

export function RetroRunsView({ standalone = false }: { standalone?: boolean }) {
  const [snapshot, setSnapshot] = useState<RetroRunsSnapshot>(EMPTY_SNAPSHOT);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [track, setTrack] = useState<TrackFilter>("all");
  const [outcome, setOutcome] = useState<OutcomeFilter>("all");

  async function load({ quiet = false } = {}) {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    try {
      const res = await fetch("/api/retro-runs", { cache: "no-store" });
      const json = (await res.json()) as RetroApiResponse;
      setSnapshot(json.snapshot ?? EMPTY_SNAPSHOT);
      setError(json.ok ? null : json.error ?? "retro runs unavailable");
    } catch (err) {
      setError(err instanceof Error ? err.message : "retro runs unavailable");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const filteredRuns = useMemo(() => {
    const q = query.trim().toLowerCase();
    return snapshot.runs.filter((run) => {
      if (track !== "all" && run.track !== track) return false;
      if (outcome !== "all" && run.outcome !== outcome) return false;
      if (!q) return true;
      return [
        run.familiarName,
        run.familiarRole ?? "",
        run.track,
        run.outcome,
        run.changeSummary,
        run.notes ?? "",
      ].some((value) => value.toLowerCase().includes(q));
    });
  }, [outcome, query, snapshot.runs, track]);

  const shellClass = `retro-surface${standalone ? " retro-surface--standalone" : ""}`;

  return (
    <section className={shellClass} aria-label="Retro Runs">
      <header className="retro-hero">
        <div className="retro-hero__copy">
          <p className="retro-eyebrow">
            <Icon name="ph:arrows-clockwise-bold" aria-hidden />
            Retro Runs
          </p>
          <h2>Eval-loop retros, scrubbed clean.</h2>
          <p>
            Inspect synthesis, prompt, and memory iterations across familiars with secrets redacted before they reach the surface.
          </p>
        </div>
        <div className="retro-hero__actions">
          <button
            type="button"
            className="retro-icon-btn"
            aria-label="Refresh retro runs"
            title="Refresh retro runs"
            onClick={() => void load({ quiet: true })}
            disabled={refreshing}
          >
            <Icon name="ph:arrows-clockwise-bold" aria-hidden />
          </button>
          <button
            type="button"
            className="retro-btn retro-btn--primary"
            onClick={() => downloadRetroSnapshot(snapshot)}
            disabled={snapshot.runs.length === 0}
          >
            <Icon name="ph:floppy-disk-bold" aria-hidden />
            Export
          </button>
        </div>
      </header>

      <div className="retro-metrics" aria-label="Retro run metrics">
        <div className="retro-metric">
          <Icon name="ph:database-bold" aria-hidden />
          <span>{snapshot.summary.totalRuns}</span>
          <p>Total runs</p>
        </div>
        <div className="retro-metric">
          <Icon name="ph:check-circle-bold" aria-hidden />
          <span>{snapshot.summary.accepted}</span>
          <p>Accepted</p>
        </div>
        <div className="retro-metric">
          <Icon name="ph:arrow-counter-clockwise" aria-hidden />
          <span>{snapshot.summary.reverted}</span>
          <p>Reverted</p>
        </div>
        <div className="retro-metric">
          <Icon name="ph:clock-countdown" aria-hidden />
          <span>{relativeTime(snapshot.summary.lastRun)}</span>
          <p>Latest run</p>
        </div>
      </div>

      <div className="retro-controls">
        <label className="retro-search">
          <Icon name="ph:magnifying-glass" aria-hidden />
          <span className="sr-only">Search retro runs</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search familiar, track, summary..."
          />
        </label>

        <div className="retro-tabs" role="tablist" aria-label="Retro track filter">
          {TRACKS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={track === item.id}
              className={track === item.id ? "is-active" : ""}
              onClick={() => setTrack(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <select
          className="retro-select"
          value={outcome}
          onChange={(event) => setOutcome(event.target.value as OutcomeFilter)}
          aria-label="Outcome filter"
        >
          <option value="all">All outcomes</option>
          <option value="ACCEPT">Accepted</option>
          <option value="REVERT">Reverted</option>
        </select>
      </div>

      {error ? (
        <div className="retro-callout" role="status">
          <Icon name="ph:warning-circle" aria-hidden />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="retro-content">
        <aside className="retro-familiar-panel" aria-label="Familiar coverage">
          <div className="retro-panel-title">
            <Icon name="ph:users-three-bold" aria-hidden />
            Coverage
          </div>
          {snapshot.familiars.length === 0 ? (
            <p className="retro-muted">No familiars reported yet.</p>
          ) : (
            <ul>
              {snapshot.familiars.map((familiar) => (
                <li key={familiar.familiarId}>
                  <span>
                    <b>{familiar.familiarName}</b>
                    <small>{familiar.runs.length} runs · {familiar.running ? "running" : relativeTime(familiar.lastRun)}</small>
                  </span>
                  <i aria-hidden={familiar.running ? "false" : "true"} className={familiar.running ? "is-running" : ""} />
                </li>
              ))}
            </ul>
          )}
        </aside>

        <div className="retro-runs-list" aria-busy={loading || refreshing}>
          {loading ? (
            Array.from({ length: 4 }, (_, index) => (
              <div key={index} className="retro-skeleton" />
            ))
          ) : filteredRuns.length > 0 ? (
            filteredRuns.map((run) => <RunRow key={run.id} run={run} />)
          ) : (
            <div className="retro-empty">
              <Icon name="ph:lock-simple-bold" aria-hidden />
              <span>No matching retro runs.</span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
