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

// ── Types ────────────────────────────────────────────────────────────────────

type Track = "synthesis" | "prompt" | "memory";

type LoopIteration = {
  id: string;
  timestamp: string;
  track: Track;
  iteration: number;
  change_summary: string;
  metric_before: number;
  metric_after: number;
  delta: number;
  outcome: "ACCEPT" | "REVERT";
  notes?: string;
};

type EvalLoopState = {
  familiar_id: string;
  last_run: string | null;
  iterations: LoopIteration[];
  track_counts: Record<Track, number>;
  total_accepted: number;
  total_reverted: number;
  running: boolean;
};

type Props = {
  familiarId: string;
  familiarName: string;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function age(iso: string): string {
  const ms = Math.abs(Date.now() - new Date(iso).getTime());
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + "s ago";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m ago";
  const h = Math.floor(m / 60);
  if (h < 48) return h + "h ago";
  return Math.floor(h / 24) + "d ago";
}

function deltaColor(delta: number): string {
  if (delta > 0) return "text-[var(--color-success)]";
  if (delta < 0) return "text-[var(--color-danger)]";
  return "text-[var(--text-muted)]";
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

export function EvalLoopPanel({ familiarId, familiarName }: Props) {
  const [state, setState] = useState<EvalLoopState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [triggering, setTriggering] = useState(false);
  const [activeTrack, setActiveTrack] = useState<Track | "all">("all");

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

  async function refreshState() {
    const res = await fetch("/api/skills/eval-loop/" + familiarId, { cache: "no-store" });
    const json = await res.json();
    if (json.ok) {
      setState(json.state as EvalLoopState);
      setError(null);
      return;
    }
    setError(json.error ?? "eval-loop data unavailable");
  }

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

  const visibleIterations = state?.iterations
    .filter((i) => activeTrack === "all" || i.track === activeTrack)
    .slice(0, 20) ?? [];

  return (
    <div className="flex flex-col gap-4 p-3 text-xs">

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon name="ph:arrows-clockwise-bold" className="text-[var(--accent-presence)]" width="0.85rem" />
          <span className="text-[11px] font-medium uppercase tracking-widest text-[var(--text-secondary)]">
            eval-loop
          </span>
          {state?.running ? (
            <span className="rounded-full bg-[color-mix(in_oklch,var(--color-warning)_20%,transparent)] px-1.5 py-px text-[9px] uppercase tracking-widest text-[var(--color-warning)]">
              running
            </span>
          ) : null}
        </div>
        {state?.last_run ? (
          <span className="text-[10px] text-[var(--text-muted)]">
            last run {age(state.last_run)}
          </span>
        ) : null}
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
              <Stat label="Accepted" value={state.total_accepted} accent="text-[var(--color-success)]" />
              <Stat label="Reverted" value={state.total_reverted} accent="text-[var(--color-danger)]" />
              <Stat label="Total" value={state.total_accepted + state.total_reverted} />
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
                      <span className="truncate text-[var(--text-primary)]">
                        {it.change_summary}
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
                      {it.metric_before.toFixed(1)} → {it.metric_after.toFixed(1)}
                    </span>
                    <span className="ml-auto text-[var(--text-muted)]">
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
