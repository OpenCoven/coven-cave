// The visible half of a cron run you started.
//
// Clicking "Run now" calls `announce()`, which writes into an `sr-only` live
// region: assistive tech hears "Run started for X" and a sighted user sees
// nothing but a button that stops being busy. That asymmetry is a defect this
// repository has already paid for once — `cave-06qka` on the Review Deck, where
// every verdict was announced and none was shown.
//
// So this models what a run card can HONESTLY say. Deliberately absent, because
// `AutomationRunRecord` carries none of it:
//
//   • a progress percentage — nothing knows a run's total duration, so a bar
//     would advance on invented data;
//   • a stage breakdown — there are no stages recorded, at all;
//   • structured outputs — there is one free-text `summary`, not a set of
//     produced artifacts.
//
// Building those would be a card that lies about a run in flight, which is
// worse than a card that simply says "running, 40s".

import type { AutomationRunRecord } from "../automation-runs.ts";

export type LiveRunPhase = "running" | "succeeded" | "failed" | "cancelled";

export type LiveRunView = {
  runId: string;
  automationId: string;
  name: string;
  phase: LiveRunPhase;
  /** Wall-clock so far (running) or total (finished), in ms. */
  elapsedMs: number;
  /** One short line describing where the run stands. */
  headline: string;
  /** The run's own summary, when it left one. */
  summary: string | null;
  /** True once the run has settled — the card can be dismissed and stops polling. */
  settled: boolean;
};

/** Compact elapsed readout: 8s, 1m 04s, 1h 12m. Seconds are zero-padded past a
 *  minute so the number does not jitter in width while a run is in flight. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes < 60) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
}

function phaseOf(status: AutomationRunRecord["status"]): LiveRunPhase {
  if (status === "failed") return "failed";
  if (status === "succeeded") return "succeeded";
  if (status === "cancelled") return "cancelled";
  // `queued` is not yet running, but from the card's point of view the run is
  // in flight and has not settled — collapsing it into "running" keeps the
  // card's contract (settled or not) rather than inventing a fourth state the
  // dismiss/poll logic would have to special-case.
  return "running";
}

/**
 * Build the card's view of a run, or null when there is nothing to show.
 *
 * `nowMs` is injected so elapsed time is testable and so the caller owns the
 * ticking rather than the model reading the clock behind its back.
 */
export function liveRunView(
  run: AutomationRunRecord | null | undefined,
  nowMs: number,
): LiveRunView | null {
  if (!run) return null;
  const startedMs = new Date(run.startedAt).getTime();
  if (!Number.isFinite(startedMs)) return null;

  const phase = phaseOf(run.status);
  const settled = phase !== "running";
  const endMs = settled && run.finishedAt ? new Date(run.finishedAt).getTime() : nowMs;
  // A finishedAt that is unparseable or before the start would render a
  // negative or absurd duration; fall back to wall clock rather than show it.
  const elapsedMs =
    Number.isFinite(endMs) && endMs >= startedMs ? endMs - startedMs : Math.max(0, nowMs - startedMs);

  const summary = run.summary?.trim() ? run.summary.trim() : null;
  let headline: string;
  if (phase === "running") {
    headline = "Running…";
  } else if (phase === "succeeded") {
    headline = `Finished in ${formatElapsed(elapsedMs)}`;
  } else if (phase === "failed") {
    // Name the exit code when there is one: "failed" alone sends the reader to
    // the log for something the record already knows.
    headline =
      run.exitCode != null && run.exitCode !== 0
        ? `Failed (exit ${run.exitCode}) after ${formatElapsed(elapsedMs)}`
        : `Failed after ${formatElapsed(elapsedMs)}`;
  } else {
    // Cancelled is its own settled outcome — a deliberate stop, never a
    // success and never an endless "Running…". Without this branch a
    // cancelled run used to keep the card in the running phase forever.
    headline = `Cancelled after ${formatElapsed(elapsedMs)}`;
  }

  return {
    runId: run.id,
    automationId: run.automationId,
    name: run.automationName,
    phase,
    elapsedMs,
    headline,
    summary,
    settled,
  };
}

/**
 * Pick the run a card should follow after a manual trigger: the newest run
 * belonging to `automationId`.
 *
 * Runs arrive newest-first from the store, but that is the store's ordering
 * contract rather than this module's, so it is re-established here instead of
 * assumed — a card following the wrong run would report someone else's outcome.
 */
export function newestRunFor(
  runs: readonly AutomationRunRecord[],
  automationId: string,
): AutomationRunRecord | null {
  let best: AutomationRunRecord | null = null;
  let bestMs = -Infinity;
  for (const run of runs) {
    if (run.automationId !== automationId) continue;
    const ms = new Date(run.startedAt).getTime();
    if (!Number.isFinite(ms)) continue;
    if (ms > bestMs) {
      best = run;
      bestMs = ms;
    }
  }
  return best;
}
