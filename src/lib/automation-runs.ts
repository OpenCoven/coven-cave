/**
 * Compatibility run-history types for the Automations surface.
 *
 * The authoritative run ledger now lives in the Coven daemon
 * (coven#816: automation_runs, surfaced through
 * /api/codex-automations/[id]/runs). These types remain so the UI and its
 * state helpers keep one vocabulary while they migrate; the local JSON
 * store that used to back them is retired (coven-cave#4990).
 */
export const AUTOMATION_RUNS_CAP = 200;

// `cancelled` is part of the daemon's RoutineRun vocabulary
// (coven.automations.runs), and the runs route passes statuses through
// untouched — so it belongs here: a cancelled run must render as what it is,
// never as "unknown status" (coven-cave#5217: authoritative state mapping for
// every run state).
export type AutomationRunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type AutomationRunRecord = {
  id: string;
  automationId: string;
  automationName: string;
  startedAt: string;
  finishedAt?: string;
  status: AutomationRunStatus;
  exitCode?: number;
  summary?: string;
  logPath?: string;
};

