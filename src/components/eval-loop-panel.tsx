"use client";

/**
 * EvalLoopPanel — Coven-level skill surface for the eval-loop skill.
 *
 * Displays the evaluation loop state for a familiar: iteration history,
 * last run status, track breakdown, and a trigger button for manual runs.
 *
 * Reads from the daemon's /api/v1/skills/eval-loop/:familiarId endpoint
 * when available; gracefully degrades to empty state when offline.
 *
 * Skill: eval-loop (Coven harness skill)
 */

import { useEffect, useState } from "react";
import { Icon } from "@/lib/icon";
import type { IconName } from "@/lib/icon";
// Shared relative-time formatter, imported as `age` so the call sites read the
// same — standardizes this surface on the app-wide "2m ago / 3h ago / Jun 12" style.
import { relativeTime as age } from "@/lib/relative-time";
import { formatTimestamp, readDateTimePrefs, useDateTimePrefs } from "@/lib/datetime-format";
import { usePausablePoll } from "@/lib/use-pausable-poll";
import type { ResponseConfidenceRollup } from "@/lib/thread-self-report";

// ── Types ────────────────────────────────────────────────────────────────────

export type Track = "synthesis" | "prompt" | "memory";

export type LoopIteration = {
  id: string;
  timestamp: string;
  track: Track;
  iteration: number;
  change_summary?: string;
  changeSummary?: string;
  metric_before?: number;
  metricBefore?: number;
  metric_after?: number;
  metricAfter?: number;
  delta: number;
  outcome: "ACCEPT" | "REVERT";
  notes?: string;
};

export type EvalLoopLockState = {
  locked: boolean;
  runId?: string | null;
  run_id?: string | null;
  runJsonExists?: boolean;
  run_json_exists?: boolean;
  requestedAt?: string | null;
  requested_at?: string | null;
  lockUpdatedAt?: string | null;
  lock_updated_at?: string | null;
  stale: boolean;
};

export type EvalLoopState = {
  familiar_id?: string;
  familiarId?: string;
  last_run?: string | null;
  lastRun?: string | null;
  iterations: LoopIteration[];
  track_counts?: Record<Track, number>;
  trackCounts?: Record<Track, number>;
  total_accepted?: number;
  totalAccepted?: number;
  total_reverted?: number;
  totalReverted?: number;
  running: boolean;
  lock?: EvalLoopLockState;
};

type Props = {
  familiarId: string;
  familiarName: string;
  responseConfidenceRollup?: ResponseConfidenceRollup;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function deltaColor(delta: number): string {
  if (delta > 0) return "text-[var(--color-success)]";
  if (delta < 0) return "text-[var(--color-danger)]";
  return "text-[var(--text-muted)]";
}

function lastRun(state: EvalLoopState | null): string | null {
  return state?.last_run ?? state?.lastRun ?? null;
}

function totalAccepted(state: EvalLoopState): number {
  return state.total_accepted ?? state.totalAccepted ?? 0;
}

function totalReverted(state: EvalLoopState): number {
  return state.total_reverted ?? state.totalReverted ?? 0;
}

function iterationSummary(iteration: LoopIteration): string {
  return iteration.change_summary ?? iteration.changeSummary ?? "Iteration recorded";
}

function metricBefore(iteration: LoopIteration): number {
  return iteration.metric_before ?? iteration.metricBefore ?? 0;
}

function metricAfter(iteration: LoopIteration): number {
  return iteration.metric_after ?? iteration.metricAfter ?? 0;
}

function lockRunId(lock: EvalLoopLockState): string | null {
  return lock.runId ?? lock.run_id ?? null;
}

function lockRequestedAt(lock: EvalLoopLockState): string | null {
  return lock.requestedAt ?? lock.requested_at ?? null;
}

function lockUpdatedAt(lock: EvalLoopLockState): string | null {
  return lock.lockUpdatedAt ?? lock.lock_updated_at ?? null;
}

function lockHasRunJson(lock: EvalLoopLockState): boolean {
  return lock.runJsonExists ?? lock.run_json_exists ?? false;
}

/** "0:07" / "4:32" / "1:02:05" — elapsed time, anchored to a run's start. */
function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const ss = String(s).padStart(2, "0");
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${ss}`;
  return `${m}:${ss}`;
}

/** Short, ticking "freshness" label for the live poll: "just now" / "12s ago" / "3m ago". */
function freshnessLabel(deltaMs: number): string {
  const s = Math.max(0, Math.floor(deltaMs / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

/** Parse an ISO/loose timestamp to epoch ms, or null if unparseable. */
function toMs(ts: string | null | undefined): number | null {
  if (!ts) return null;
  const n = Date.parse(ts);
  return Number.isNaN(n) ? null : n;
}

const TRACK_ICON: Record<Track, IconName> = {
  synthesis: "ph:book-open-bold",
  prompt:    "ph:pencil-line-bold",
  memory:    "ph:brain-bold",
};

const TRACK_LABEL: Record<Track, string> = {
  synthesis: "Synthesis",
  prompt:    "Prompt",
  memory:    "Memory",
};

// ── Component ────────────────────────────────────────────────────────────────

export function EvalLoopPanel({ familiarId, familiarName, responseConfidenceRollup }: Props) {
  useDateTimePrefs(); // subscribe: re-render when the date/time density pref changes
  const [state, setState] = useState<EvalLoopState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [triggering, setTriggering] = useState(false);
  const [clearingLock, setClearingLock] = useState(false);
  const [activeTrack, setActiveTrack] = useState<Track | "all">("all");
  // Epoch ms of the last successful state read — drives the "updated Ns ago"
  // freshness label so a polling panel visibly proves it is live, not frozen.
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  // A ticking clock so relative labels (elapsed timer, freshness) advance
  // between data refreshes. Ticks every second while a run is active, otherwise
  // once a minute — cheap, and enough to keep idle labels current.
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Epoch ms when we first observed the current run as active — a fallback
  // anchor for the elapsed timer when the run lock carries no requested-at.
  const [runObservedAt, setRunObservedAt] = useState<number | null>(null);

  const running = state?.running ?? false;

  useEffect(() => {
    const interval = running ? 1000 : 60_000;
    const id = setInterval(() => setNowMs(Date.now()), interval);
    return () => clearInterval(id);
  }, [running]);

  useEffect(() => {
    setRunObservedAt((prev) => (running ? prev ?? Date.now() : null));
  }, [running]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/skills/eval-loop/" + familiarId, {
          cache: "no-store",
        });
        const json = await res.json();
        if (!cancelled) {
          if (json.ok) {
            setState(json.state as EvalLoopState);
            setLastUpdatedAt(Date.now());
          } else {
            setError(json.error ?? "eval-loop data unavailable");
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "fetch failed");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [familiarId]);

  // Live polling: refresh fast while a run is active so iterations, lock state,
  // and the running badge update without a manual reload; back off when idle so
  // the panel stays current but light. usePausablePoll suspends on hidden tabs
  // and fires an immediate refresh when the window regains focus.
  async function refreshState(opts?: { quiet?: boolean }) {
    try {
      const res = await fetch("/api/skills/eval-loop/" + familiarId, { cache: "no-store" });
      const json = await res.json();
      if (json.ok) {
        setState(json.state as EvalLoopState);
        setLastUpdatedAt(Date.now());
        setError(null);
        return;
      }
      // A failed poll shouldn't blank a panel that already has good data.
      if (!opts?.quiet) setError(json.error ?? "eval-loop data unavailable");
    } catch (err) {
      if (!opts?.quiet) setError(err instanceof Error ? err.message : "fetch failed");
    }
  }

  usePausablePoll(() => { void refreshState({ quiet: true }); }, running ? 5000 : 30_000);

  async function triggerRun(track: Track) {
    setTriggering(true);
    setError(null);
    try {
      const res = await fetch("/api/skills/eval-loop/" + familiarId + "/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ track }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setError(json?.error ?? "failed to start eval-loop");
        setTriggering(false);
        return;
      }
      setState((prev) => prev ? { ...prev, running: true } : prev);
      setTimeout(() => {
        void (async () => {
          try {
            await refreshState();
          } finally {
            setTriggering(false);
          }
        })();
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to start eval-loop");
      setTriggering(false);
    }
  }

  async function clearRunLock(force = false) {
    setClearingLock(true);
    setError(null);
    try {
      const res = await fetch("/api/skills/eval-loop/" + familiarId + "/run-lock", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ force }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setError(json?.error ?? "failed to clear eval-loop lock");
        return;
      }
      await refreshState();
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to clear eval-loop lock");
    } finally {
      setClearingLock(false);
    }
  }

  const visibleIterations = state?.iterations
    ?.filter((i) => activeTrack === "all" || i.track === activeTrack)
    .slice(0, 20) ?? [];
  const currentLastRun = lastRun(state);
  const currentLock = state?.lock?.locked ? state.lock : null;

  // Anchor the live elapsed timer to the run's lock timestamp when present
  // (survives remounts/refreshes); otherwise to the moment we first saw it run.
  const lockReqMs = currentLock ? toMs(lockRequestedAt(currentLock)) : null;
  const runStartMs = running ? (lockReqMs ?? runObservedAt) : null;
  const elapsedLabel = runStartMs != null ? formatElapsed(nowMs - runStartMs) : null;
  const freshness = lastUpdatedAt != null ? freshnessLabel(nowMs - lastUpdatedAt) : null;

  return (
    <div className="eval-loop-panel flex flex-col gap-4 p-3 text-xs">

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon
            name="ph:arrows-clockwise-bold"
            className={"text-[var(--accent-presence)]" + (running ? " animate-spin [animation-duration:2.4s]" : "")}
            width="0.85rem"
          />
          <span className="text-[11px] font-medium uppercase tracking-widest text-[var(--text-secondary)]">
            eval-loop
          </span>
          {running ? (
            <span
              role="status"
              aria-live="polite"
              className="inline-flex items-center gap-1 rounded-full bg-[color-mix(in_oklch,var(--color-warning)_20%,transparent)] px-1.5 py-px text-[9px] uppercase tracking-widest text-[var(--color-warning)]"
            >
              <span className="h-1 w-1 animate-pulse rounded-full bg-[var(--color-warning)]" aria-hidden />
              running
              {elapsedLabel ? <span className="font-mono tabular-nums tracking-normal lowercase">{elapsedLabel}</span> : null}
            </span>
          ) : null}
        </div>
        <div className="flex flex-col items-end gap-0.5">
          {currentLastRun ? (
            <span className="text-[10px] text-[var(--text-muted)]">
              last run {age(currentLastRun)}
            </span>
          ) : null}
          {freshness ? (
            <span className="inline-flex items-center gap-1 text-[9px] text-[var(--text-muted)]" title="Panel auto-refreshes; time since the last successful update.">
              <span className={"h-1 w-1 rounded-full " + (running ? "animate-pulse bg-[var(--color-success)]" : "bg-[var(--text-muted)]")} aria-hidden />
              updated {freshness}
            </span>
          ) : null}
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-8 animate-pulse rounded-md bg-[var(--bg-raised)]" />
          ))}
        </div>
      ) : error ? (
        <button
          type="button"
          disabled={triggering}
          onClick={() => void triggerRun("synthesis")}
          className="rounded-md border border-dashed border-[var(--border-hairline)] px-3 py-4 text-center text-[var(--text-muted)] transition-colors hover:border-[var(--accent-presence)] hover:bg-[var(--bg-raised)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-presence)] disabled:cursor-not-allowed disabled:opacity-60"
          aria-label={`Start eval-loop for ${familiarName}`}
        >
          <p className="mb-1">eval-loop not active for {familiarName}</p>
          <p className="text-[10px]">{error}</p>
          <span className="mt-2 inline-flex items-center justify-center gap-1 rounded border border-[var(--border-strong)] px-2 py-1 text-[10px] uppercase tracking-widest text-[var(--text-secondary)]">
            <Icon name={triggering ? "ph:arrows-clockwise-bold" : TRACK_ICON.synthesis} width="0.7rem" />
            {triggering ? "starting" : "start synthesis"}
          </span>
        </button>
      ) : (
        <>
          {state ? (
            <div className="grid grid-cols-3 gap-2 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)]/40 px-3 py-2">
              <Stat label="Accepted" value={totalAccepted(state)} accent="text-[var(--color-success)]" />
              <Stat label="Reverted" value={totalReverted(state)} accent="text-[var(--color-danger)]" />
              <Stat label="Total" value={totalAccepted(state) + totalReverted(state)} />
            </div>
          ) : null}

          {responseConfidenceRollup && responseConfidenceRollup.eventCount > 0 ? (
            <div className="rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)]/40 px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[10px] uppercase tracking-widest text-[var(--text-secondary)]">
                  response confidence
                </span>
                <b className="font-mono text-[var(--text-primary)]">{responseConfidenceRollup.averageConfidence}</b>
              </div>
              <p className="mt-1 text-[10px] text-[var(--text-muted)]">
                {responseConfidenceRollup.lowConfidenceCount} low-confidence turns from {responseConfidenceRollup.eventCount} events
              </p>
            </div>
          ) : null}

          {currentLock ? (
            <div className="rounded-md border border-[color-mix(in_oklch,var(--color-warning)_35%,transparent)] bg-[color-mix(in_oklch,var(--color-warning)_8%,transparent)] px-3 py-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] uppercase tracking-widest text-[var(--color-warning)]">
                    Run lock {currentLock.stale ? "stale" : "active"}
                  </p>
                  <p className="mt-1 truncate font-mono text-[10px] text-[var(--text-secondary)]">
                    {lockRunId(currentLock) ?? "unknown run"}
                  </p>
                  <p className="mt-1 text-[10px] text-[var(--text-muted)]">
                    {lockHasRunJson(currentLock) ? "run.json present" : "run.json missing"}
                    {lockRequestedAt(currentLock) ? ` · requested ${age(lockRequestedAt(currentLock)!)}` : ""}
                    {lockUpdatedAt(currentLock) ? ` · lock ${age(lockUpdatedAt(currentLock)!)}` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={clearingLock}
                  onClick={() => void clearRunLock(!currentLock.stale)}
                  aria-label={`Clear eval-loop lock for ${familiarName}`}
                  className="shrink-0 rounded border border-[var(--border-strong)] px-2 py-1 text-[10px] uppercase tracking-widest text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-raised)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {clearingLock ? "clearing" : "clear lock"}
                </button>
              </div>
            </div>
          ) : null}

          <div className="flex items-center gap-1 border-b border-[var(--border-hairline)] pb-2">
            {(["all", "synthesis", "prompt", "memory"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setActiveTrack(t)}
                className={
                  "rounded px-2 py-0.5 text-[10px] uppercase tracking-widest transition-colors " +
                  (activeTrack === t
                    ? "bg-[color-mix(in_oklch,var(--accent-presence)_80%,transparent)] text-white"
                    : "border border-[var(--border-strong)] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]")
                }
              >
                {t}
              </button>
            ))}
          </div>

          {visibleIterations.length === 0 ? (
            <div className="rounded-md border border-dashed border-[var(--border-hairline)] px-3 py-4 text-center text-[var(--text-muted)]">
              No iterations yet{activeTrack !== "all" ? " for " + TRACK_LABEL[activeTrack as Track] : ""}.
            </div>
          ) : (
            <ul className="space-y-1.5">
              {visibleIterations.map((it) => (
                <li
                  key={it.id}
                  className="rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)]/40 px-2 py-1.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <Icon
                        name={TRACK_ICON[it.track]}
                        className="mt-px shrink-0 text-[var(--text-muted)]"
                        width="0.7rem"
                      />
                      <span className="truncate text-[var(--text-primary)]" title={iterationSummary(it)}>
                        {iterationSummary(it)}
                      </span>
                    </div>
                    <span
                      className={
                        "shrink-0 rounded px-1 py-px text-[9px] uppercase tracking-widest " +
                        (it.outcome === "ACCEPT"
                          ? "bg-[color-mix(in_oklch,var(--color-success)_20%,transparent)] text-[var(--color-success)]"
                          : "bg-[color-mix(in_oklch,var(--color-danger)_20%,transparent)] text-[var(--color-danger)]")
                      }
                    >
                      {it.outcome}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-3 text-[10px]">
                    <span className={"font-mono font-medium " + deltaColor(it.delta)}>
                      {it.delta > 0 ? "+" : ""}{it.delta.toFixed(1)}
                    </span>
                    <span className="text-[var(--text-muted)]">
                      {metricBefore(it).toFixed(1)} → {metricAfter(it).toFixed(1)}
                    </span>
                    <span className="ml-auto text-[var(--text-muted)]" title={formatTimestamp(it.timestamp, readDateTimePrefs())}>
                      {age(it.timestamp)}
                    </span>
                  </div>
                  {it.notes ? (
                    <p className="mt-0.5 text-[10px] text-[var(--text-muted)]">{it.notes}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          <div className="border-t border-[var(--border-hairline)] pt-2">
            <p className="mb-1.5 text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
              Run iteration
            </p>
            <div className="flex flex-wrap gap-1.5">
              {(["synthesis", "prompt", "memory"] as const).map((track) => (
                <button
                  key={track}
                  disabled={triggering || (state?.running ?? false)}
                  onClick={() => void triggerRun(track)}
                  className="flex items-center gap-1 rounded border border-[var(--border-strong)] px-2 py-1 text-[10px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-raised)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Icon name={TRACK_ICON[track]} width="0.7rem" />
                  {TRACK_LABEL[track]}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className={"text-base font-medium tabular-nums " + (accent ?? "text-[var(--text-primary)]")}>
        {value}
      </span>
      <span className="text-[9px] uppercase tracking-widest text-[var(--text-muted)]">
        {label}
      </span>
    </div>
  );
}
