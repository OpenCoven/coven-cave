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

export type AutomationRunStatus = "queued" | "running" | "succeeded" | "failed";
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

