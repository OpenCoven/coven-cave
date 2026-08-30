// The *state* half of a cron's detail pane: what this cron is doing, when it
// will next do it, and how the runs we have recorded went.
//
// The existing panel is entirely configuration — name, prompt, model,
// environment, working directories. `Scheduling Spec.dc.html` states the
// contract it misses: *every schedule surface says what will happen and when it
// will next happen*. A pane that can describe a cron in nine fields without
// ever saying when it next fires is exactly that gap.
//
// Pure and client-safe.

import type { AutomationRunRecord } from "../automation-runs.ts";
import type { CodexAutomation } from "../codex-automations-types.ts";
import { nextOccurrences } from "../schedule-plan.ts";
import { recurrenceFromRrule } from "../schedule-plan-model.ts";
import { cronHealth, type CronHealth } from "./cron-health.ts";

/**
 * Upcoming fires for a cron, or [] when its rule cannot be read.
 *
 * Shares `recurrenceFromRrule` with the create dialog's plan preview and the
 * calendar's projection, so all three answer "when does this run" identically.
 */
export function cronNextRuns(
  auto: Pick<CodexAutomation, "rrule" | "status">,
  fromMs: number,
  count: number,
): string[] {
  // A paused cron has no upcoming runs — it is not going to fire. Listing the
  // times it *would have* fired is a pane describing a schedule that is off.
  if (auto.status !== "ACTIVE") return [];
  if (!auto.rrule) return [];
  const rec = recurrenceFromRrule(auto.rrule);
  if (!rec) return [];
  return nextOccurrences(rec, fromMs, count);
}

export type RecordedRunStats = {
  /** Runs that finished and carry a usable duration. */
  sampled: number;
  medianMs: number | null;
  maxMs: number | null;
};

/**
 * Duration statistics over the runs THIS APP RECORDED.
 *
 * Deliberately named `recorded` rather than anything implying completeness:
 * `automation-runs.json` holds app-triggered "run now" executions only, so
 * these describe manual runs, never the daemon's schedule. Every surface that
 * renders them has to say so — the same reason the crons list refuses to
 * report a `stale` status it cannot know.
 *
 * That is also why there is no reliability percentage here. A "96% reliable"
 * figure computed from this store would be a claim about the handful of runs
 * someone kicked off by hand, presented as the health of the cron itself.
 */
export function recordedRunStats(runs: readonly AutomationRunRecord[]): RecordedRunStats {
  const durations: number[] = [];
  for (const run of runs) {
    if (!run.startedAt || !run.finishedAt) continue;
    const ms = new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime();
    if (Number.isFinite(ms) && ms >= 0) durations.push(ms);
  }
  if (durations.length === 0) return { sampled: 0, medianMs: null, maxMs: null };
  durations.sort((a, b) => a - b);
  const mid = Math.floor(durations.length / 2);
  const medianMs =
    durations.length % 2 === 0
      ? Math.round((durations[mid - 1]! + durations[mid]!) / 2)
      : durations[mid]!;
  return { sampled: durations.length, medianMs, maxMs: durations[durations.length - 1]! };
}

/**
 * One sentence that explains the cron's current state.
 *
 * The frame leads its detail pane with this, and the value is that a reader
 * gets the answer without assembling it from a status dot, a timestamp and a
 * schedule string. Every branch says only what the data supports — a cron with
 * no recorded run says so, rather than implying it has never run at all.
 */
export function cronInsight(
  auto: Pick<CodexAutomation, "status" | "scheduleHuman">,
  lastRun: AutomationRunRecord | undefined,
  nextRunIso: string | null,
): string {
  const health: CronHealth = cronHealth(auto, lastRun);

  if (health === "paused") {
    return "Paused — it will not run until you resume it.";
  }
  if (health === "running") {
    return "Running now.";
  }
  if (health === "failed") {
    const why = lastRun?.summary?.trim();
    return why
      ? `The last recorded run failed: ${why}`
      : "The last recorded run failed.";
  }
  // Healthy. Say when it next fires if we can, and be explicit that an absent
  // run history means "nothing recorded here", not "never ran" — the daemon's
  // scheduled runs never reach this store.
  const cadence = auto.scheduleHuman ? ` Runs ${auto.scheduleHuman}.` : "";
  // An unreadable rule is worth saying out loud: the pane cannot tell the
  // reader when this fires next, and silence would read as "nothing upcoming"
  // rather than "we could not work it out".
  const unreadable = !nextRunIso ? " Its schedule rule can't be read, so the next run is unknown." : "";
  if (!lastRun) {
    return `No runs recorded in Cave yet — scheduled runs happen on the daemon.${cadence}${unreadable}`;
  }
  return `Healthy.${cadence}${unreadable}`;
}
