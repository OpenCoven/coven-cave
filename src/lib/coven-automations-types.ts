// Coven routine automation types — the Cave-side mirror of the daemon's
// RoutineDefinition (coven#816) and its run ledger. Supersedes
// codex-automations-types.ts for anything the facade reads or writes.

export type CovenantAutomation = {
  schemaVersion: number;
  id: string;
  name: string;
  status: "ACTIVE" | "PAUSED";
  rrule: string;
  timezone: "local" | "utc";
  misfire: "latest";
  overlap: "forbid";
  timeoutMinutes: number;
  runtime: string;
  familiarId?: string;
  cwd?: string;
  outputTarget?: string;
  prompt: string;
  model?: string;
  tags: string[];
};

export type CovenantAutomationDraft = Omit<
  CovenantAutomation,
  "schemaVersion" | "misfire" | "overlap" | "timezone"
> &
  Partial<Pick<CovenantAutomation, "misfire" | "overlap" | "timezone">>;

export type RoutineRun = {
  id: string;
  automationId: string;
  occurrenceId?: string;
  sessionId?: string;
  familiarId?: string;
  runtime: string;
  status: "running" | "succeeded" | "failed" | "cancelled";
  exitCode?: number;
  logJson?: string;
  outputCommit?: string;
  startedAt: string;
  finishedAt?: string;
};

/** Daemon-side action router response, minus the payload. */
export type CovenAutomationActionResult<T> = {
  ok: boolean;
  accepted: boolean;
  action: string;
  status: "completed" | "rejected";
  reason?: string;
  event?: {
    kind: string;
    action: string;
    payload: T;
  };
};

export type CovenAutomationsListPayload = { routines?: CovenantAutomation[]; error?: string };
export type CovenAutomationsGetPayload = { routine?: CovenantAutomation | null; error?: string };
export type CovenAutomationsRunPayload = {
  runId?: string;
  status?: string;
  sessionId?: string;
  error?: string;
};
export type CovenAutomationsRunsPayload = { runs?: RoutineRun[]; error?: string };
export type CovenAutomationsImportPayload = {
  imported?: string[];
  skipped?: string[];
  failures?: string[];
  error?: string;
};

/** Raised when the automations daemon cannot serve a request. `degraded`
 * distinguishes "daemon offline / old daemon" from a validation rejection,
 * so callers never fall back to direct Codex execution. */
export class CovenAutomationsUnavailableError extends Error {
  readonly degraded: boolean;

  constructor(message: string, degraded = false) {
    super(message);
    this.name = "CovenAutomationsUnavailableError";
    this.degraded = degraded;
  }
}
