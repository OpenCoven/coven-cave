// The browser's view of one automation's occurrences, runs and attempts (#5217).
//
// Coven authors all of it. Cave reads it through the pinned SDK on the server
// (src/lib/server/automation-occurrences.ts), keeps only bounded facts, and
// re-validates that projection here before anything renders. Free-text
// reasons, logs, prompts, adoption keys, lease owners and digests stay in the
// daemon: a reason Coven recorded shows only as "recorded".
//
// Each state keeps its own label. A claimed occurrence, a run Coven still
// reports as running and a failed attempt are three different facts, and the
// surface never folds them into one spinner or infers what happens next.
//
// Client-safe: no node imports.

/** Coven v0.4.10's occurrence states (`OccurrenceState`). */
export const OCCURRENCE_STATES = [
  "planned", "eligible", "claimed", "dispatching", "running", "recovering", "recovery_required",
  "succeeded", "failed", "cancelled", "timed_out", "skipped", "superseded",
] as const;
/** Run statuses the compatibility run table records, plus the contract's `RunState`. */
export const RUN_STATUSES = [
  "created", "accepted", "running", "succeeded", "completed", "failed", "cancelled", "timed_out", "ambiguous", "orphaned",
] as const;
/** Coven v0.4.10's attempt states (`AttemptState`). */
export const ATTEMPT_STATES = [
  "adopted", "dispatching", "started", "observing", "succeeded", "failed", "cancelled", "timed_out", "ambiguous",
] as const;
export const ATTEMPT_FAILURE_CLASSES = [
  "transient_dispatch", "lease_expired", "runtime_unavailable", "launch_refused", "runtime_error", "timeout",
  "cancelled", "ambiguous_evidence", "runtime_authority_unsupported",
] as const;
export const ATTEMPT_RETRY_CLASSIFICATIONS = ["initial", "automatic_retry", "operator_retry", "operator_recovery"] as const;
export const ATTEMPT_PRIOR_DISPOSITIONS = ["failed", "timed_out", "cancelled", "ambiguous"] as const;

export type OccurrenceState = typeof OCCURRENCE_STATES[number] | "unrecognized";
export type RunStatus = typeof RUN_STATUSES[number] | "unrecognized";
export type AttemptState = typeof ATTEMPT_STATES[number] | "unrecognized";
export type AttemptFailureClass = typeof ATTEMPT_FAILURE_CLASSES[number] | "unrecognized";
export type AttemptRetryClassification = typeof ATTEMPT_RETRY_CLASSIFICATIONS[number] | "unrecognized";
export type AttemptPriorDisposition = typeof ATTEMPT_PRIOR_DISPOSITIONS[number] | "unrecognized";

export type AutomationOccurrenceView = {
  id: string;
  /** The definition revision this occurrence was planned from. */
  automationRevision: number;
  scheduledFor: string;
  kind: "scheduled" | "manual" | "other";
  state: OccurrenceState;
  fenceGeneration: number;
  leaseExpiresAt: string | null;
  /** Coven recorded a reason; it stays in the daemon. */
  reasonRecorded: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AutomationAttemptView = {
  id: string;
  attemptNumber: number;
  state: AttemptState;
  failureClass: AttemptFailureClass | null;
  retryClassification: AttemptRetryClassification;
  priorDisposition: AttemptPriorDisposition | null;
  dispatchGeneration: number;
  notBefore: string;
  openedAt: string;
  settledAt: string | null;
  reasonRecorded: boolean;
};

export type AutomationRunView = {
  id: string;
  status: RunStatus;
  automationRevision: number;
  startedAt: string;
  finishedAt: string | null;
  /** The run's deadline, when Coven set one. */
  timeoutAt: string | null;
  exitCode: number | null;
  runtime: string | null;
  familiarId: string | null;
  sessionId: string | null;
  /** A receipt reference exists. Cave has not verified it. */
  receiptRecorded: boolean;
  attempts: AutomationAttemptView[];
};

export type AutomationOccurrenceDetailView = AutomationOccurrenceView & {
  /** Coven returns at most 20, oldest first, and says when there were more. */
  runs: AutomationRunView[];
  runsTruncated: boolean;
};

export type AutomationOccurrenceFailure = { kind: "invalid" | "unsupported" | "unavailable" };

export type AutomationOccurrencesResult =
  | { kind: "available"; readAt: string; occurrences: AutomationOccurrenceView[]; nextCursor: string | null }
  | AutomationOccurrenceFailure;

export type AutomationOccurrenceResult =
  | { kind: "available"; readAt: string; occurrence: AutomationOccurrenceDetailView | null }
  | AutomationOccurrenceFailure;

/** Occurrences one page shows. */
export const OCCURRENCE_PAGE_SIZE = 10;
/** Opaque ids Coven issues for occurrences, runs and attempts (`occ-…`, `run-…`, `attempt-…`). */
export const OCCURRENCE_ENTITY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
/** Keyset cursors Coven issues for history pages. */
export const OCCURRENCE_CURSOR_MAX_BYTES = 512;
/** Short identifiers shown as-is: runtime names, familiar ids, session ids. */
const LABEL_TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/;
const RUNS_MAX = 20;
const ATTEMPTS_MAX = 50;

const OCCURRENCE_STATE_LABEL: Record<OccurrenceState, string> = {
  planned: "Planned", eligible: "Eligible", claimed: "Claimed", dispatching: "Dispatching", running: "Running",
  recovering: "Recovering", recovery_required: "Recovery required", succeeded: "Succeeded", failed: "Failed",
  cancelled: "Cancelled", timed_out: "Timed out", skipped: "Skipped", superseded: "Superseded",
  unrecognized: "Unrecognized state",
};
const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  created: "Created", accepted: "Accepted", running: "Running", succeeded: "Succeeded", completed: "Completed",
  failed: "Failed", cancelled: "Cancelled", timed_out: "Timed out", ambiguous: "Ambiguous", orphaned: "Orphaned",
  unrecognized: "Unrecognized status",
};
const ATTEMPT_STATE_LABEL: Record<AttemptState, string> = {
  adopted: "Adopted", dispatching: "Dispatching", started: "Started", observing: "Observing", succeeded: "Succeeded",
  failed: "Failed", cancelled: "Cancelled", timed_out: "Timed out", ambiguous: "Ambiguous", unrecognized: "Unrecognized state",
};
const FAILURE_CLASS_LABEL: Record<AttemptFailureClass, string> = {
  transient_dispatch: "Transient dispatch failure", lease_expired: "Lease expired", runtime_unavailable: "Runtime unavailable",
  launch_refused: "Launch refused", runtime_error: "Runtime error", timeout: "Timed out", cancelled: "Cancelled",
  ambiguous_evidence: "Ambiguous evidence", runtime_authority_unsupported: "Runtime authority unsupported",
  unrecognized: "Unrecognized failure",
};
const RETRY_LABEL: Record<AttemptRetryClassification, string> = {
  initial: "First attempt", automatic_retry: "Automatic retry", operator_retry: "Operator retry",
  operator_recovery: "Operator recovery", unrecognized: "Unrecognized retry kind",
};

/** Terminal occurrence states: nothing further happens to them. */
const OCCURRENCE_TERMINAL = new Set<OccurrenceState>(["succeeded", "failed", "cancelled", "timed_out", "skipped", "superseded"]);
const ATTEMPT_SETTLED = new Set<AttemptState>(["succeeded", "failed", "cancelled", "timed_out", "ambiguous"]);

export function occurrenceStateLabel(state: OccurrenceState): string {
  return OCCURRENCE_STATE_LABEL[state];
}
export function runStatusLabel(status: RunStatus): string {
  return RUN_STATUS_LABEL[status];
}
export function attemptStateLabel(state: AttemptState): string {
  return ATTEMPT_STATE_LABEL[state];
}
export function attemptFailureLabel(failureClass: AttemptFailureClass): string {
  return FAILURE_CLASS_LABEL[failureClass];
}
export function attemptRetryLabel(classification: AttemptRetryClassification): string {
  return RETRY_LABEL[classification];
}
export function occurrenceKindLabel(kind: AutomationOccurrenceView["kind"]): string {
  return kind === "manual" ? "Run now" : kind === "scheduled" ? "Scheduled" : "Other trigger";
}
/** An occurrence Coven may still change. Unrecognized states count as open: Cave does not assume an ending. */
export function occurrenceIsOpen(state: OccurrenceState): boolean {
  return !OCCURRENCE_TERMINAL.has(state);
}
/** A run Coven has not finished, by its own `finishedAt`. */
export function runIsOpen(run: Pick<AutomationRunView, "finishedAt">): boolean {
  return run.finishedAt === null;
}
/**
 * Coven reports the run open, yet every attempt it lists has settled. Both
 * facts are shown as they are; the surface does not guess what comes next.
 */
export function runHasNoAttemptInProgress(run: AutomationRunView): boolean {
  return runIsOpen(run) && run.attempts.length > 0 &&
    run.attempts.every((attempt) => attempt.settledAt !== null && ATTEMPT_SETTLED.has(attempt.state));
}

function member<T extends string>(values: readonly T[], value: unknown): T | "unrecognized" {
  return typeof value === "string" && (values as readonly string[]).includes(value) ? value as T : "unrecognized";
}

/** Coven writes nanosecond instants; the browser gets millisecond ISO strings. */
function instant(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 40) return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
}
function optionalInstant(value: unknown): string | null | undefined {
  return value === null ? null : instant(value);
}
function count(value: unknown, min = 0): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min ? value : undefined;
}
function token(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === "string" && LABEL_TOKEN_PATTERN.test(value) ? value : undefined;
}
function entityId(value: unknown): value is string {
  return typeof value === "string" && OCCURRENCE_ENTITY_ID_PATTERN.test(value);
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Bound one occurrence to the facts Cave shows. Used on the server against the
 * SDK's validated wire, and again in the browser against Cave's own answer.
 * `undefined` means the value does not have the expected shape.
 */
export function projectOccurrence(value: unknown): AutomationOccurrenceView | undefined {
  if (!record(value) || !entityId(value.id)) return undefined;
  const automationRevision = count(value.automationRevision, 1);
  const fenceGeneration = count(value.fenceGeneration);
  const scheduledFor = instant(value.scheduledFor);
  const createdAt = instant(value.createdAt);
  const updatedAt = instant(value.updatedAt);
  const leaseExpiresAt = optionalInstant(value.leaseExpiresAt ?? null);
  if (automationRevision === undefined || fenceGeneration === undefined || !scheduledFor || !createdAt || !updatedAt || leaseExpiresAt === undefined) {
    return undefined;
  }
  // Server side the SDK hands over `failureReason` text; browser side only the flag.
  const reasonRecorded = "reasonRecorded" in value
    ? value.reasonRecorded === true
    : typeof value.failureReason === "string" && value.failureReason.length > 0;
  return {
    id: value.id,
    automationRevision,
    scheduledFor,
    kind: value.kind === "scheduled" || value.kind === "manual" ? value.kind : "other",
    state: member(OCCURRENCE_STATES, value.state),
    fenceGeneration,
    leaseExpiresAt,
    reasonRecorded,
    createdAt,
    updatedAt,
  };
}

export function projectAttempt(value: unknown): AutomationAttemptView | undefined {
  if (!record(value) || !entityId(value.id)) return undefined;
  const attemptNumber = count(value.attemptNumber, 1);
  const dispatchGeneration = count(value.dispatchGeneration);
  const notBefore = instant(value.notBefore);
  const openedAt = instant(value.openedAt);
  const settledAt = optionalInstant(value.settledAt ?? null);
  if (attemptNumber === undefined || dispatchGeneration === undefined || !notBefore || !openedAt || settledAt === undefined) return undefined;
  const reasonRecorded = "reasonRecorded" in value
    ? value.reasonRecorded === true
    : typeof value.stateReason === "string" && value.stateReason.length > 0;
  return {
    id: value.id,
    attemptNumber,
    state: member(ATTEMPT_STATES, value.state),
    failureClass: value.failureClass === null || value.failureClass === undefined ? null : member(ATTEMPT_FAILURE_CLASSES, value.failureClass),
    retryClassification: member(ATTEMPT_RETRY_CLASSIFICATIONS, value.retryClassification),
    priorDisposition: value.priorDisposition === null || value.priorDisposition === undefined ? null : member(ATTEMPT_PRIOR_DISPOSITIONS, value.priorDisposition),
    dispatchGeneration,
    notBefore,
    openedAt,
    settledAt,
    reasonRecorded,
  };
}

export function projectRun(value: unknown): AutomationRunView | undefined {
  if (!record(value) || !entityId(value.id) || !Array.isArray(value.attempts) || value.attempts.length > ATTEMPTS_MAX) return undefined;
  const automationRevision = count(value.automationRevision, 1);
  const startedAt = instant(value.startedAt);
  const finishedAt = optionalInstant(value.finishedAt ?? null);
  const timeoutAt = optionalInstant(value.timeoutAt ?? null);
  const exitCode = value.exitCode === null || value.exitCode === undefined ? null
    : typeof value.exitCode === "number" && Number.isSafeInteger(value.exitCode) ? value.exitCode : undefined;
  const runtime = token(value.runtime ?? null);
  const familiarId = token(value.familiarId ?? null);
  const sessionId = token(value.sessionId ?? null);
  if (automationRevision === undefined || !startedAt || finishedAt === undefined || timeoutAt === undefined ||
    exitCode === undefined || runtime === undefined || familiarId === undefined || sessionId === undefined) return undefined;
  const attempts: AutomationAttemptView[] = [];
  for (const attempt of value.attempts) {
    const projected = projectAttempt(attempt);
    if (!projected) return undefined;
    attempts.push(projected);
  }
  const receiptRecorded = "receiptRecorded" in value
    ? value.receiptRecorded === true
    : typeof value.receiptId === "string" && value.receiptId.length > 0;
  return {
    id: value.id,
    status: member(RUN_STATUSES, value.status),
    automationRevision,
    startedAt,
    finishedAt,
    timeoutAt,
    exitCode,
    runtime,
    familiarId,
    sessionId,
    receiptRecorded,
    attempts,
  };
}

export function projectOccurrenceDetail(value: unknown): AutomationOccurrenceDetailView | undefined {
  const occurrence = projectOccurrence(value);
  if (!occurrence || !record(value) || !Array.isArray(value.runs) || value.runs.length > RUNS_MAX || typeof value.runsTruncated !== "boolean") {
    return undefined;
  }
  const runs: AutomationRunView[] = [];
  for (const run of value.runs) {
    const projected = projectRun(run);
    if (!projected) return undefined;
    runs.push(projected);
  }
  return { ...occurrence, runs, runsTruncated: value.runsTruncated };
}

function failure(value: Record<string, unknown>): AutomationOccurrenceFailure | undefined {
  return value.kind === "invalid" || value.kind === "unsupported" || value.kind === "unavailable" ? { kind: value.kind } : undefined;
}

export function validOccurrenceCursor(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.isWellFormed() &&
    new TextEncoder().encode(value).length <= OCCURRENCE_CURSOR_MAX_BYTES;
}

/** Validate Cave's occurrence page before rendering; anything unexpected reads as unavailable. */
export function parseOccurrencesResult(value: unknown): AutomationOccurrencesResult {
  const unavailable = { kind: "unavailable" as const };
  if (!record(value)) return unavailable;
  const failed = failure(value);
  if (failed) return failed;
  if (value.kind !== "available" || !instant(value.readAt) || !Array.isArray(value.occurrences) ||
    value.occurrences.length > OCCURRENCE_PAGE_SIZE || !(value.nextCursor === null || validOccurrenceCursor(value.nextCursor))) return unavailable;
  const occurrences: AutomationOccurrenceView[] = [];
  const ids = new Set<string>();
  for (const entry of value.occurrences) {
    const projected = projectOccurrence(entry);
    if (!projected || ids.has(projected.id)) return unavailable;
    ids.add(projected.id);
    occurrences.push(projected);
  }
  return { kind: "available", readAt: value.readAt as string, occurrences, nextCursor: value.nextCursor };
}

export function parseOccurrenceResult(value: unknown): AutomationOccurrenceResult {
  const unavailable = { kind: "unavailable" as const };
  if (!record(value)) return unavailable;
  const failed = failure(value);
  if (failed) return failed;
  if (value.kind !== "available" || !instant(value.readAt)) return unavailable;
  if (value.occurrence === null) return { kind: "available", readAt: value.readAt as string, occurrence: null };
  const occurrence = projectOccurrenceDetail(value.occurrence);
  return occurrence ? { kind: "available", readAt: value.readAt as string, occurrence } : unavailable;
}

/**
 * The run-status glyph family a state belongs to, for the shape and tint
 * beside its label (src/lib/automations/run-status.ts). The label always says
 * the exact state; the glyph only groups.
 */
export function occurrenceGlyphStatus(state: OccurrenceState | RunStatus | AttemptState): "succeeded" | "failed" | "running" | "queued" | "cancelled" | "unknown" {
  switch (state) {
    case "succeeded": case "completed":
      return "succeeded";
    case "failed": case "timed_out": case "ambiguous": case "recovery_required": case "orphaned":
      return "failed";
    case "claimed": case "dispatching": case "running": case "recovering": case "accepted": case "adopted": case "started": case "observing":
      return "running";
    case "planned": case "eligible": case "created":
      return "queued";
    case "cancelled": case "skipped": case "superseded":
      return "cancelled";
    default:
      return "unknown";
  }
}
