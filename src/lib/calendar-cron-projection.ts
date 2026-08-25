// Cron occurrences, projected onto the calendar's visible window.
//
// `Scheduling Spec.dc.html` files the calendar's silence about crons as a P1:
// *"Agenda with 2 items = 80% void; crons invisible; no link back to Rituals"*,
// with the fix being that cron occurrences project as toggleable ritual rows so
// the surface is never a void. Until now `calendar-view.tsx` contained no
// mention of a cron at all.
//
// Pure and client-safe. It reads a schedule through `recurrenceFromRrule` — the
// same definition the create dialog's plan preview uses — so the calendar can
// never draw a cadence the dialog did not promise.

import type { CodexAutomation } from "./codex-automations-types.ts";
import type { Recurrence } from "./inbox-recurrence.ts";
import { computeNextOccurrence } from "./inbox-recurrence.ts";
import { recurrenceFromRrule } from "./schedule-plan-model.ts";

export type ProjectedCronRun = {
  automationId: string;
  name: string;
  /** ISO instant this cron is expected to fire. */
  atIso: string;
};

export type CronProjection = {
  runs: ProjectedCronRun[];
  /** Active crons that contributed at least one run to this window. */
  projectedCount: number;
  /**
   * True when the cap stopped the walk before the window was exhausted, so the
   * caller can say the view is partial instead of implying it is complete.
   */
  truncated: boolean;
};

/**
 * Ceiling on how many occurrences one window may hold.
 *
 * Occurrences over a window are unbounded: an `every 5 minutes` cron across a
 * month view is ~8,600 of them, which is both useless to read and slow to
 * render. The cap is not the interesting part — `truncated` is. A surface that
 * silently drops the tail tells the reader the month is quieter than it is,
 * which is the same class of lie as a status that cannot be known.
 */
export const CRON_PROJECTION_CAP = 400;

/** Per-cron ceiling, so one pathological schedule cannot consume the budget
 *  and hide every other cron in the window. */
export const CRON_PROJECTION_PER_CRON_CAP = 120;

function walkWindow(
  rec: Recurrence,
  startMs: number,
  endMs: number,
  cap: number,
): { times: string[]; hitCap: boolean } {
  const times: string[] = [];
  // Seed one step behind the window so an occurrence landing exactly on
  // `startMs` is included rather than skipped.
  let cursor = startMs - 1;
  for (let i = 0; i < cap; i += 1) {
    const next = computeNextOccurrence(rec, cursor);
    if (!next) break;
    const t = new Date(next).getTime();
    // Never loop: a recurrence that fails to advance would spin the cap.
    if (!Number.isFinite(t) || t <= cursor) break;
    if (t > endMs) return { times, hitCap: false };
    times.push(next);
    cursor = t;
  }
  // Ran out of budget rather than out of window — the caller has a partial view.
  return { times, hitCap: times.length >= cap };
}

/**
 * Project every ACTIVE cron onto `[startMs, endMs]`.
 *
 * Paused crons are excluded, not dimmed: a paused cron is not going to fire,
 * and drawing its occurrences would put events on a calendar that will never
 * happen. Same reasoning as the crons list refusing to invent a `stale` status
 * it cannot know.
 */
export function projectCronRuns(
  automations: readonly CodexAutomation[],
  startMs: number,
  endMs: number,
): CronProjection {
  if (!(endMs > startMs)) return { runs: [], projectedCount: 0, truncated: false };

  const runs: ProjectedCronRun[] = [];
  const contributors = new Set<string>();
  let truncated = false;

  for (const auto of automations) {
    if (auto.status !== "ACTIVE") continue;
    if (!auto.rrule) continue;
    const rec = recurrenceFromRrule(auto.rrule);
    if (!rec) continue;

    const remaining = CRON_PROJECTION_CAP - runs.length;
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    const { times, hitCap } = walkWindow(
      rec,
      startMs,
      endMs,
      Math.min(CRON_PROJECTION_PER_CRON_CAP, remaining),
    );
    if (hitCap) truncated = true;
    for (const atIso of times) {
      runs.push({ automationId: auto.id, name: auto.name, atIso });
      contributors.add(auto.id);
    }
  }

  runs.sort((a, b) => a.atIso.localeCompare(b.atIso) || a.name.localeCompare(b.name));
  return { runs, projectedCount: contributors.size, truncated };
}

/** Group projected runs by local calendar day (`YYYY-MM-DD`), which is the key
 *  every calendar view already buckets by. */
export function groupProjectedRunsByDay(
  runs: readonly ProjectedCronRun[],
): Map<string, ProjectedCronRun[]> {
  const byDay = new Map<string, ProjectedCronRun[]>();
  for (const run of runs) {
    const d = new Date(run.atIso);
    if (Number.isNaN(d.getTime())) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const bucket = byDay.get(key);
    if (bucket) bucket.push(run);
    else byDay.set(key, [run]);
  }
  return byDay;
}

/**
 * The frame's footer sentence: *"13 active crons project onto this calendar"*.
 * Returns null when nothing projects, so the caller renders no footer rather
 * than a "0 active crons" line that draws attention to an absence.
 */
export function projectionSummary(projection: CronProjection): string | null {
  if (projection.projectedCount === 0) return null;
  // Verb agrees with the subject: one cron *projects*, several crons *project*.
  const one = projection.projectedCount === 1;
  const base = `${projection.projectedCount} active ${one ? "cron projects" : "crons project"} onto this calendar`;
  return projection.truncated ? `${base} · showing the first ${projection.runs.length}` : base;
}
