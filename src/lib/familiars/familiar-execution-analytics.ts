import type { ModelControlFamily, ModelControlValues } from "../runtime/model-control-capabilities.ts";
import type { SessionOrigin } from "../types.ts";

export const EXECUTION_ATTEMPT_SCHEMA_VERSION = 1 as const;
export const EXECUTION_ATTEMPT_LEDGER_VERSION = 1 as const;
export const FAMILIAR_EXECUTION_ANALYTICS_VERSION = 1 as const;

export const EXECUTION_ANALYTICS_WINDOWS = ["7d", "14d", "8w", "all"] as const;
export type ExecutionAnalyticsWindowKey = (typeof EXECUTION_ANALYTICS_WINDOWS)[number];

export type ExecutionKind = "assistant-response";
export type ExecutionOutcomeStatus = "succeeded" | "error" | "cancelled";
export type ExecutionToolStatus = "running" | "ok" | "error";

export type ExecutionModelSelection =
  | { kind: "model"; id: string }
  | { kind: "runtime-default" };

export const EXECUTION_ATTEMPT_COVERAGE_FIELDS = [
  "harness.id",
  "harness.version",
  "models.requested",
  "models.forwarded",
  "models.confirmed",
  "controls.requested",
  "controls.forwarded",
  "controls.applied",
  "timing.durationMs",
  "usage.inputTokens",
  "usage.outputTokens",
  "usage.cacheReadTokens",
  "usage.cacheCreationTokens",
  "costUsd",
  "tools",
] as const;
export type ExecutionAttemptCoverageField =
  (typeof EXECUTION_ATTEMPT_COVERAGE_FIELDS)[number];

export type ExecutionAttemptSnapshotV1 = {
  schemaVersion: typeof EXECUTION_ATTEMPT_SCHEMA_VERSION;
  attemptId: string;
  /** Public drill-down alias retained alongside the explicit attempt identity. */
  id: string;
  familiarId: string;
  sessionId: string;
  turnId: string;
  attemptNumber: number;
  executionKind: string;
  occurredAt: string;
  origin?: SessionOrigin;
  harnessId?: string;
  harnessVersion?: string;
  requestedModel?: string;
  forwardedModel?: string;
  confirmedModel?: string;
  status: "completed" | "failed" | "cancelled";
  durationMs?: number;
  totalTokens?: number;
  toolCalls?: number;
  toolFailures?: number;
  execution: {
    kind: ExecutionKind;
    origin?: SessionOrigin;
  };
  harness?: {
    id?: string;
    version?: string;
  };
  models?: {
    requested?: ExecutionModelSelection;
    forwarded?: string;
    confirmed?: string;
  };
  controls?: {
    requested?: ModelControlValues;
    forwarded?: ModelControlValues;
    applied?: ModelControlValues;
    rejectedFamilies?: ModelControlFamily[];
  };
  timing: {
    completedAt: string;
    durationMs?: number;
  };
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
  };
  costUsd?: number;
  outcome: {
    status: ExecutionOutcomeStatus;
  };
  tools?: Array<{
    name: string;
    status: ExecutionToolStatus;
    durationMs?: number;
  }>;
  provenance: {
    source: "live" | "conversation-backfill";
    sourceSchema: "execution-attempt-v1" | "cave-conversation-v1";
    capturedAt: string;
  };
  coverage: {
    knownFields: ExecutionAttemptCoverageField[];
  };
};

export type ExecutionAttemptLedgerRecordV1 = {
  ledgerVersion: typeof EXECUTION_ATTEMPT_LEDGER_VERSION;
  snapshot: ExecutionAttemptSnapshotV1;
};

export type KnownDenominator = {
  known: number;
  total: number;
};

export type NumericAggregate = KnownDenominator & {
  sum?: number;
  average?: number;
  min?: number;
  max?: number;
};

export type DimensionAggregate = KnownDenominator & {
  values: Array<{ value: string; attempts: number }>;
};

export type FamiliarExecutionSlice = {
  key: string;
  label?: string;
  attempts: number;
  completed: number;
  failed: number;
  cancelled: number;
  successRate: number | null;
  medianDurationMs?: number;
  totalTokens?: number;
  costUsd?: number;
  toolCalls: number;
  toolFailures: number;
};

export type FamiliarExecutionCoverage = KnownDenominator & {
  ratio: number;
};

export type FamiliarExecutionAnalyticsWindow = {
  attempts: number;
  completed: number;
  failed: number;
  cancelled: number;
  successRate: number | null;
  medianDurationMs?: number;
  p95DurationMs?: number;
  totalTokens?: number;
  costUsd?: number;
  toolCalls: number;
  toolFailures: number;
  models: FamiliarExecutionSlice[];
  harnesses: FamiliarExecutionSlice[];
  coverage: Record<string, FamiliarExecutionCoverage>;
};

export type ExecutionAnalyticsWindow = FamiliarExecutionAnalyticsWindow;

export type FamiliarExecutionAttemptProvenance = "live" | "backfilled";

export type FamiliarExecutionAttemptSummary = {
  id: string;
  sessionId?: string;
  turnId?: string;
  executionKind: string;
  occurredAt: string;
  harnessId: string;
  harnessVersion?: string;
  requestedModel?: string;
  forwardedModel?: string;
  confirmedModel?: string;
  status: "completed" | "failed" | "cancelled";
  durationMs?: number;
  totalTokens?: number;
  costUsd?: number;
  toolCalls: number;
  toolFailures: number;
  provenance: FamiliarExecutionAttemptProvenance;
};

export type FamiliarExecutionBackfillState = {
  state: "complete" | "partial" | "not-started";
  imported: number;
  remaining?: number;
};

export type FamiliarExecutionAnalyticsWindows = Record<
  ExecutionAnalyticsWindowKey,
  FamiliarExecutionAnalyticsWindow
>;

export type FamiliarExecutionAnalytics = {
  generatedAt: string;
  windows: FamiliarExecutionAnalyticsWindows;
  recentAttempts: FamiliarExecutionAttemptSummary[];
  backfill: FamiliarExecutionBackfillState;
};

export type FamiliarExecutionAnalyticsSuccessResponse = {
  ok: true;
  analytics: FamiliarExecutionAnalytics;
};

export type FamiliarExecutionAnalyticsErrorResponse = {
  ok: false;
  error: string;
};

export type FamiliarExecutionAnalyticsResponse =
  | FamiliarExecutionAnalyticsSuccessResponse
  | FamiliarExecutionAnalyticsErrorResponse;

const SESSION_ORIGINS = new Set<SessionOrigin>([
  "chat",
  "mention",
  "board",
  "cron",
  "heartbeat",
  "call",
  "canvas",
  "journal",
  "enhance",
]);
const OUTCOMES = new Set<ExecutionOutcomeStatus>(["succeeded", "error", "cancelled"]);
const TOOL_STATUSES = new Set<ExecutionToolStatus>(["running", "ok", "error"]);
const CONTROL_FAMILIES = new Set<ModelControlFamily>([
  "reasoning",
  "performance",
  "verbosity",
  "output-limit",
  "modalities",
  "tool-support",
]);
const COVERAGE_FIELDS = new Set<ExecutionAttemptCoverageField>(
  EXECUTION_ATTEMPT_COVERAGE_FIELDS,
);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function safeText(value: unknown, maxLength = 256): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLength);
}

function nonNegative(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : undefined;
}

function isoInstant(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}

function normalizeControls(value: unknown): ModelControlValues | undefined {
  const raw = record(value);
  if (!raw) return undefined;
  const controls: ModelControlValues = {};
  for (const family of CONTROL_FAMILIES) {
    const control = safeText(raw[family], 64);
    if (control) controls[family] = control;
  }
  return Object.keys(controls).length ? controls : undefined;
}

function normalizeModelSelection(value: unknown): ExecutionModelSelection | undefined {
  const raw = record(value);
  if (!raw) return undefined;
  if (raw.kind === "runtime-default") return { kind: "runtime-default" };
  if (raw.kind !== "model") return undefined;
  const id = safeText(raw.id);
  return id ? { kind: "model", id } : undefined;
}

function modelSelectionLabel(value: ExecutionModelSelection): string {
  return value.kind === "runtime-default" ? "runtime-default" : value.id;
}

function normalizeSnapshotTools(value: unknown): ExecutionAttemptSnapshotV1["tools"] {
  if (!Array.isArray(value)) return undefined;
  const tools: NonNullable<ExecutionAttemptSnapshotV1["tools"]> = [];
  for (const item of value.slice(0, 100)) {
    const raw = record(item);
    if (!raw) continue;
    const name = safeText(raw.name, 128);
    const status = typeof raw.status === "string" &&
      TOOL_STATUSES.has(raw.status as ExecutionToolStatus)
      ? raw.status as ExecutionToolStatus
      : undefined;
    if (!name || !status) continue;
    const durationMs = nonNegative(raw.durationMs);
    tools.push({
      name,
      status,
      ...(durationMs !== undefined ? { durationMs } : {}),
    });
  }
  return tools;
}

function coverageForSnapshot(
  snapshot: Omit<ExecutionAttemptSnapshotV1, "coverage">,
): ExecutionAttemptCoverageField[] {
  const known = new Set<ExecutionAttemptCoverageField>();
  if (snapshot.harness?.id) known.add("harness.id");
  if (snapshot.harness?.version) known.add("harness.version");
  if (snapshot.models?.requested) known.add("models.requested");
  if (snapshot.models?.forwarded) known.add("models.forwarded");
  if (snapshot.models?.confirmed) known.add("models.confirmed");
  if (snapshot.controls?.requested) known.add("controls.requested");
  if (snapshot.controls?.forwarded) known.add("controls.forwarded");
  if (snapshot.controls?.applied) known.add("controls.applied");
  if (snapshot.timing.durationMs !== undefined) known.add("timing.durationMs");
  if (snapshot.usage?.inputTokens !== undefined) known.add("usage.inputTokens");
  if (snapshot.usage?.outputTokens !== undefined) known.add("usage.outputTokens");
  if (snapshot.usage?.cacheReadTokens !== undefined) known.add("usage.cacheReadTokens");
  if (snapshot.usage?.cacheCreationTokens !== undefined) known.add("usage.cacheCreationTokens");
  if (snapshot.costUsd !== undefined) known.add("costUsd");
  if (snapshot.tools !== undefined) known.add("tools");
  return EXECUTION_ATTEMPT_COVERAGE_FIELDS.filter((field) => known.has(field));
}

/**
 * Copy an untrusted value into the metadata-only execution snapshot contract.
 * The allowlist is deliberate: transcript content, tool payloads, paths, raw
 * errors, and unknown future payload fields cannot survive this boundary.
 */
export function normalizeExecutionAttemptSnapshot(
  value: unknown,
): ExecutionAttemptSnapshotV1 | null {
  const raw = record(value);
  if (!raw || raw.schemaVersion !== EXECUTION_ATTEMPT_SCHEMA_VERSION) return null;
  const attemptId = safeText(raw.attemptId);
  const familiarId = safeText(raw.familiarId, 64);
  const sessionId = safeText(raw.sessionId);
  const turnId = safeText(raw.turnId);
  const attemptNumber = positiveInteger(raw.attemptNumber);
  const executionRaw = record(raw.execution);
  const timingRaw = record(raw.timing);
  const outcomeRaw = record(raw.outcome);
  const provenanceRaw = record(raw.provenance);
  if (
    !attemptId ||
    !familiarId ||
    !sessionId ||
    !turnId ||
    !attemptNumber ||
    executionRaw?.kind !== "assistant-response" ||
    !timingRaw ||
    !outcomeRaw ||
    !provenanceRaw
  ) return null;

  const completedAt = isoInstant(timingRaw.completedAt);
  const capturedAt = isoInstant(provenanceRaw.capturedAt);
  const outcomeStatus = typeof outcomeRaw.status === "string" &&
    OUTCOMES.has(outcomeRaw.status as ExecutionOutcomeStatus)
    ? outcomeRaw.status as ExecutionOutcomeStatus
    : undefined;
  const provenanceSource = provenanceRaw.source === "live" ||
    provenanceRaw.source === "conversation-backfill"
    ? provenanceRaw.source
    : undefined;
  const sourceSchema = provenanceRaw.sourceSchema === "execution-attempt-v1" ||
    provenanceRaw.sourceSchema === "cave-conversation-v1"
    ? provenanceRaw.sourceSchema
    : undefined;
  if (!completedAt || !capturedAt || !outcomeStatus || !provenanceSource || !sourceSchema) {
    return null;
  }

  const origin = typeof executionRaw.origin === "string" &&
    SESSION_ORIGINS.has(executionRaw.origin as SessionOrigin)
    ? executionRaw.origin as SessionOrigin
    : undefined;
  const harnessRaw = record(raw.harness);
  const harnessId = safeText(harnessRaw?.id, 128);
  const harnessVersion = safeText(harnessRaw?.version, 128);
  const harness = harnessId || harnessVersion
    ? {
        ...(harnessId ? { id: harnessId } : {}),
        ...(harnessVersion ? { version: harnessVersion } : {}),
      }
    : undefined;

  const modelsRaw = record(raw.models);
  const requested = normalizeModelSelection(modelsRaw?.requested);
  const forwarded = safeText(modelsRaw?.forwarded);
  const confirmed = safeText(modelsRaw?.confirmed);
  const models = requested || forwarded || confirmed
    ? {
        ...(requested ? { requested } : {}),
        ...(forwarded ? { forwarded } : {}),
        ...(confirmed ? { confirmed } : {}),
      }
    : undefined;

  const controlsRaw = record(raw.controls);
  const requestedControls = normalizeControls(controlsRaw?.requested);
  const forwardedControls = normalizeControls(controlsRaw?.forwarded);
  const appliedControls = normalizeControls(controlsRaw?.applied);
  const rejectedFamilies = Array.isArray(controlsRaw?.rejectedFamilies)
    ? [...new Set(controlsRaw.rejectedFamilies.filter(
        (family): family is ModelControlFamily =>
          typeof family === "string" && CONTROL_FAMILIES.has(family as ModelControlFamily),
      ))]
    : undefined;
  const controls = requestedControls || forwardedControls || appliedControls ||
    rejectedFamilies?.length
    ? {
        ...(requestedControls ? { requested: requestedControls } : {}),
        ...(forwardedControls ? { forwarded: forwardedControls } : {}),
        ...(appliedControls ? { applied: appliedControls } : {}),
        ...(rejectedFamilies?.length ? { rejectedFamilies } : {}),
      }
    : undefined;

  const usageRaw = record(raw.usage);
  const inputTokens = nonNegative(usageRaw?.inputTokens);
  const outputTokens = nonNegative(usageRaw?.outputTokens);
  const cacheReadTokens = nonNegative(usageRaw?.cacheReadTokens);
  const cacheCreationTokens = nonNegative(usageRaw?.cacheCreationTokens);
  const usage = inputTokens !== undefined || outputTokens !== undefined ||
    cacheReadTokens !== undefined || cacheCreationTokens !== undefined
    ? {
        ...(inputTokens !== undefined ? { inputTokens } : {}),
        ...(outputTokens !== undefined ? { outputTokens } : {}),
        ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
        ...(cacheCreationTokens !== undefined ? { cacheCreationTokens } : {}),
      }
    : undefined;
  const durationMs = nonNegative(timingRaw.durationMs);
  const costUsd = nonNegative(raw.costUsd);
  const tools = normalizeSnapshotTools(raw.tools);
  const totalTokens = usage &&
    (usage.inputTokens !== undefined || usage.outputTokens !== undefined)
    ? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)
    : undefined;
  const publicStatus = outcomeStatus === "succeeded"
    ? "completed"
    : outcomeStatus === "error"
      ? "failed"
      : "cancelled";

  const snapshotWithoutCoverage: Omit<ExecutionAttemptSnapshotV1, "coverage"> = {
    schemaVersion: EXECUTION_ATTEMPT_SCHEMA_VERSION,
    attemptId,
    id: attemptId,
    familiarId,
    sessionId,
    turnId,
    attemptNumber,
    executionKind: origin ?? "assistant-response",
    occurredAt: completedAt,
    ...(origin ? { origin } : {}),
    ...(harnessId ? { harnessId } : {}),
    ...(harnessVersion ? { harnessVersion } : {}),
    ...(requested ? { requestedModel: modelSelectionLabel(requested) } : {}),
    ...(forwarded ? { forwardedModel: forwarded } : {}),
    ...(confirmed ? { confirmedModel: confirmed } : {}),
    status: publicStatus,
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
    ...(tools !== undefined
      ? {
          toolCalls: tools.length,
          toolFailures: tools.filter((tool) => tool.status === "error").length,
        }
      : {}),
    execution: {
      kind: "assistant-response",
      ...(origin ? { origin } : {}),
    },
    ...(harness ? { harness } : {}),
    ...(models ? { models } : {}),
    ...(controls ? { controls } : {}),
    timing: {
      completedAt,
      ...(durationMs !== undefined ? { durationMs } : {}),
    },
    ...(usage ? { usage } : {}),
    ...(costUsd !== undefined ? { costUsd } : {}),
    outcome: { status: outcomeStatus },
    ...(tools !== undefined ? { tools } : {}),
    provenance: {
      source: provenanceSource,
      sourceSchema,
      capturedAt,
    },
  };
  return {
    ...snapshotWithoutCoverage,
    coverage: { knownFields: coverageForSnapshot(snapshotWithoutCoverage) },
  };
}

export function normalizeExecutionAttemptLedgerRecord(
  value: unknown,
): ExecutionAttemptLedgerRecordV1 | null {
  const raw = record(value);
  if (!raw || raw.ledgerVersion !== EXECUTION_ATTEMPT_LEDGER_VERSION) return null;
  const snapshot = normalizeExecutionAttemptSnapshot(raw.snapshot);
  return snapshot
    ? { ledgerVersion: EXECUTION_ATTEMPT_LEDGER_VERSION, snapshot }
    : null;
}

export function executionAttemptLedgerRecord(
  snapshot: ExecutionAttemptSnapshotV1,
): ExecutionAttemptLedgerRecordV1 {
  return {
    ledgerVersion: EXECUTION_ATTEMPT_LEDGER_VERSION,
    snapshot,
  };
}

function knownDenominator(
  attempts: ExecutionAttemptSnapshotV1[],
  known: (attempt: ExecutionAttemptSnapshotV1) => boolean,
): KnownDenominator {
  return {
    known: attempts.filter(known).length,
    total: attempts.length,
  };
}

function reportedNumber(
  attempts: ExecutionAttemptSnapshotV1[],
  value: (attempt: ExecutionAttemptSnapshotV1) => number | undefined,
): number | undefined {
  const values = attempts
    .map(value)
    .filter((item): item is number => item !== undefined);
  return values.length
    ? values.reduce((total, item) => total + item, 0)
    : undefined;
}

function percentile(values: number[], quantile: number): number | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1);
  return sorted[Math.max(0, index)];
}

function coverageRatio(value: KnownDenominator): FamiliarExecutionCoverage {
  return {
    ...value,
    ratio: value.total > 0 ? value.known / value.total : 0,
  };
}

function executionSlice(
  key: string,
  label: string,
  attempts: ExecutionAttemptSnapshotV1[],
): FamiliarExecutionSlice {
  const completed = attempts.filter((attempt) => attempt.outcome.status === "succeeded").length;
  const failed = attempts.filter((attempt) => attempt.outcome.status === "error").length;
  const cancelled = attempts.filter((attempt) => attempt.outcome.status === "cancelled").length;
  const settled = completed + failed;
  const durations = attempts
    .map((attempt) => attempt.durationMs)
    .filter((value): value is number => value !== undefined);
  const tools = attempts.flatMap((attempt) => attempt.tools ?? []);
  const medianDurationMs = percentile(durations, 0.5);
  const totalTokens = reportedNumber(attempts, (attempt) => attempt.totalTokens);
  const costUsd = reportedNumber(attempts, (attempt) => attempt.costUsd);
  return {
    key,
    label,
    attempts: attempts.length,
    completed,
    failed,
    cancelled,
    successRate: settled > 0 ? completed / settled : null,
    ...(medianDurationMs !== undefined ? { medianDurationMs } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
    ...(costUsd !== undefined ? { costUsd } : {}),
    toolCalls: tools.length,
    toolFailures: tools.filter((tool) => tool.status === "error").length,
  };
}

function slices(
  attempts: ExecutionAttemptSnapshotV1[],
  keyFor: (attempt: ExecutionAttemptSnapshotV1) => string | undefined,
  labelFor: (key: string) => string = (key) => key,
): FamiliarExecutionSlice[] {
  const groups = new Map<string, ExecutionAttemptSnapshotV1[]>();
  for (const attempt of attempts) {
    const key = keyFor(attempt);
    if (!key) continue;
    const group = groups.get(key) ?? [];
    group.push(attempt);
    groups.set(key, group);
  }
  return [...groups.entries()]
    .map(([key, group]) => executionSlice(key, labelFor(key), group))
    .sort((a, b) => b.attempts - a.attempts || a.key.localeCompare(b.key));
}

function aggregateWindow(
  attempts: ExecutionAttemptSnapshotV1[],
): FamiliarExecutionAnalyticsWindow {
  const outcomeCounts = new Map<ExecutionOutcomeStatus, number>();
  const toolStatuses = new Map<ExecutionToolStatus, number>();
  let toolCalls = 0;
  for (const attempt of attempts) {
    outcomeCounts.set(
      attempt.outcome.status,
      (outcomeCounts.get(attempt.outcome.status) ?? 0) + 1,
    );
    for (const tool of attempt.tools ?? []) {
      toolCalls += 1;
      toolStatuses.set(tool.status, (toolStatuses.get(tool.status) ?? 0) + 1);
    }
  }
  const completed = outcomeCounts.get("succeeded") ?? 0;
  const failed = outcomeCounts.get("error") ?? 0;
  const cancelled = outcomeCounts.get("cancelled") ?? 0;
  const settled = completed + failed;
  const durations = attempts
    .map((attempt) => attempt.durationMs)
    .filter((value): value is number => value !== undefined);
  const totalTokens = reportedNumber(attempts, (attempt) => attempt.totalTokens);
  const totalCost = reportedNumber(attempts, (attempt) => attempt.costUsd);
  const medianDurationMs = percentile(durations, 0.5);
  const p95DurationMs = percentile(durations, 0.95);

  return {
    attempts: attempts.length,
    completed,
    failed,
    cancelled,
    successRate: settled > 0 ? completed / settled : null,
    ...(medianDurationMs !== undefined ? { medianDurationMs } : {}),
    ...(p95DurationMs !== undefined ? { p95DurationMs } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
    ...(totalCost !== undefined ? { costUsd: totalCost } : {}),
    toolCalls,
    toolFailures: toolStatuses.get("error") ?? 0,
    models: slices(
      attempts,
      (attempt) => attempt.confirmedModel ??
        attempt.forwardedModel ??
        attempt.requestedModel,
    ),
    harnesses: slices(
      attempts,
      (attempt) => attempt.harnessId
        ? `${attempt.harnessId}${attempt.harnessVersion ? `@${attempt.harnessVersion}` : ""}`
        : undefined,
      (key) => key.replace("@", " "),
    ),
    coverage: {
      harnessVersion: coverageRatio(
        knownDenominator(attempts, (attempt) => attempt.harnessVersion !== undefined),
      ),
      confirmedModel: coverageRatio(
        knownDenominator(attempts, (attempt) => attempt.confirmedModel !== undefined),
      ),
      usage: coverageRatio(
        knownDenominator(attempts, (attempt) => attempt.totalTokens !== undefined),
      ),
      cost: coverageRatio(
        knownDenominator(attempts, (attempt) => attempt.costUsd !== undefined),
      ),
      duration: coverageRatio(
        knownDenominator(attempts, (attempt) => attempt.durationMs !== undefined),
      ),
      tools: coverageRatio(
        knownDenominator(attempts, (attempt) => attempt.tools !== undefined),
      ),
    },
  };
}

function windowStart(nowMs: number, key: ExecutionAnalyticsWindowKey): number | undefined {
  if (key === "all") return undefined;
  const days = key === "7d" ? 7 : key === "14d" ? 14 : 56;
  return nowMs - days * 24 * 60 * 60 * 1000;
}

function publicExecutionAttempt(
  attempt: ExecutionAttemptSnapshotV1,
): FamiliarExecutionAttemptSummary {
  return {
    id: attempt.attemptId,
    ...(attempt.sessionId ? { sessionId: attempt.sessionId } : {}),
    ...(attempt.turnId ? { turnId: attempt.turnId } : {}),
    executionKind: attempt.executionKind,
    occurredAt: attempt.occurredAt,
    harnessId: attempt.harnessId ?? "unreported",
    ...(attempt.harnessVersion ? { harnessVersion: attempt.harnessVersion } : {}),
    ...(attempt.requestedModel ? { requestedModel: attempt.requestedModel } : {}),
    ...(attempt.forwardedModel ? { forwardedModel: attempt.forwardedModel } : {}),
    ...(attempt.confirmedModel ? { confirmedModel: attempt.confirmedModel } : {}),
    status: attempt.status,
    ...(attempt.durationMs !== undefined ? { durationMs: attempt.durationMs } : {}),
    ...(attempt.totalTokens !== undefined ? { totalTokens: attempt.totalTokens } : {}),
    ...(attempt.costUsd !== undefined ? { costUsd: attempt.costUsd } : {}),
    toolCalls: attempt.toolCalls ?? 0,
    toolFailures: attempt.toolFailures ?? 0,
    provenance: attempt.provenance.source === "live" ? "live" : "backfilled",
  };
}

export function buildFamiliarExecutionAnalytics(args: {
  familiarId: string;
  attempts: ExecutionAttemptSnapshotV1[];
  now?: Date;
  recentLimit?: number;
  backfill?: FamiliarExecutionBackfillState;
}): FamiliarExecutionAnalytics {
  const now = args.now ?? new Date();
  const nowMs = now.getTime();
  const generatedAt = now.toISOString();
  const attempts = args.attempts
    .filter((attempt) => attempt.familiarId === args.familiarId)
    .filter((attempt) => Date.parse(attempt.timing.completedAt) <= nowMs)
    .sort((a, b) => (
      Date.parse(b.timing.completedAt) - Date.parse(a.timing.completedAt) ||
      a.attemptId.localeCompare(b.attemptId)
    ));
  const recentLimit = Math.max(0, Math.min(100, Math.floor(args.recentLimit ?? 50)));
  const windows = Object.fromEntries(
    EXECUTION_ANALYTICS_WINDOWS.map((key) => {
      const startsAtMs = windowStart(nowMs, key);
      const windowAttempts = startsAtMs === undefined
        ? attempts
        : attempts.filter((attempt) => Date.parse(attempt.timing.completedAt) >= startsAtMs);
      return [key, aggregateWindow(windowAttempts)];
    }),
  ) as Record<ExecutionAnalyticsWindowKey, FamiliarExecutionAnalyticsWindow>;
  return {
    generatedAt,
    windows,
    recentAttempts: attempts.slice(0, recentLimit).map(publicExecutionAttempt),
    backfill: args.backfill ?? { state: "not-started", imported: 0 },
  };
}

export function isExecutionAttemptCoverageField(
  value: unknown,
): value is ExecutionAttemptCoverageField {
  return typeof value === "string" &&
    COVERAGE_FIELDS.has(value as ExecutionAttemptCoverageField);
}
