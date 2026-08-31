import type {
  ResearchRunStatusV1,
  ResearchRunV1,
  RunEventV1,
} from "./research-protocol/research-run.ts";

/** The phases named by the v1 run protocol. */
export const RESEARCH_RUN_PHASES = [
  "scope",
  "challenge",
  "synthesize",
  "control",
] as const;

export type ResearchRunPhaseV1 = (typeof RESEARCH_RUN_PHASES)[number];

export type ResearchRunPhaseState = "pending" | "active" | "completed";

export type ResearchRunActivity = {
  label: string;
  detail?: string;
};

export type ResearchRunEventEvidence = {
  sources?: number;
  reviewed?: number;
  retained?: number;
  rejected?: number;
  cited?: number;
  artifacts?: number;
};

export type ResearchRunEventSync =
  | { status: "synced" }
  | {
      status: "gap";
      expectedSequence: number;
      receivedSequence: number;
    }
  | { status: "conflict"; sequence: number }
  | {
      status: "invalid";
      reason: "malformed" | "wrong-run";
      message: string;
    };

export type ResearchRunEventState = {
  /** The latest canonical run projection after the applied event prefix. */
  run: ResearchRunV1;
  /** The highest contiguous event sequence applied to `run`. */
  lastEventSequence: number;
  lastEventAt: string;
  /** Applied events are retained for same-sequence replay comparison. */
  appliedEvents: readonly RunEventV1[];
  /** Future events stay buffered until the missing prefix arrives. */
  pendingEvents: readonly RunEventV1[];
  sync: ResearchRunEventSync;
  phaseStates: Readonly<Record<ResearchRunPhaseV1, ResearchRunPhaseState>>;
  activePhase?: ResearchRunPhaseV1;
  activity?: ResearchRunActivity;
  evidence: ResearchRunEventEvidence;
};

export type ResearchRunEventDisposition =
  | "applied"
  | "buffered"
  | "duplicate"
  | "stale"
  | "rejected"
  | "conflict";

export type ResearchRunEventConsumption = {
  state: ResearchRunEventState;
  disposition: ResearchRunEventDisposition;
};

export type ResearchRunRehydrationOptions = {
  afterSequence?: number;
  previousState?: ResearchRunEventState;
};

const RUN_EVENT_TYPES: ReadonlySet<RunEventV1["type"]> = new Set([
  "run.created",
  "run.status",
  "phase.started",
  "phase.completed",
  "model-task.available",
  "model-task.leased",
  "model-task.completed",
  "checkpoint.required",
  "artifact.registered",
  "run.completed",
  "run.failed",
  "run.cancelled",
  "retention.changed",
  "content.deleted",
]);

const RUN_STATUSES: ReadonlySet<ResearchRunStatusV1> = new Set([
  "queued",
  "scoping",
  "gathering_public_sources",
  "waiting_for_executor",
  "challenging",
  "synthesizing",
  "controlling",
  "awaiting_checkpoint",
  "publishing",
  "completed",
  "failed",
  "cancelled",
  "expired",
]);

const WAITING_REASONS = new Set(["executor", "checkpoint", "provider-attention"]);
const WAITING_PHASES: ReadonlySet<string> = new Set(RESEARCH_RUN_PHASES);
const EVIDENCE_KEYS = [
  "sources",
  "reviewed",
  "retained",
  "rejected",
  "cited",
  "artifacts",
] as const;
const MAX_SAFE_SEQUENCE = Number.MAX_SAFE_INTEGER;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 1;
}

/**
 * The protocol parser runs at the server/API boundary and imports the
 * protocol digest implementation. This small wire guard keeps the browser
 * consumer client-safe while still refusing malformed stream frames before
 * they can affect the reducer.
 */
export function isCanonicalResearchRunEvent(value: unknown): value is RunEventV1 {
  if (!isRecord(value)) return false;
  return value.schema === "opencoven.run-event/v1"
    && typeof value.runId === "string"
    && /^run_[A-Za-z0-9_-]+$/.test(value.runId)
    && isPositiveSafeInteger(value.sequence)
    && typeof value.type === "string"
    && RUN_EVENT_TYPES.has(value.type as RunEventV1["type"])
    && typeof value.at === "string"
    && isRecord(value.data);
}

function stableSerialize(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "undefined") return "undefined";
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (!isRecord(value)) return JSON.stringify(String(value));
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`)
    .join(",")}}`;
}

function sameEvent(left: RunEventV1, right: RunEventV1): boolean {
  return stableSerialize(left) === stableSerialize(right);
}

function emptyPhaseStates(): Record<ResearchRunPhaseV1, ResearchRunPhaseState> {
  return {
    scope: "pending",
    challenge: "pending",
    synthesize: "pending",
    control: "pending",
  };
}

function initialSequence(run: ResearchRunV1): number {
  if (!Number.isSafeInteger(run.nextEventSequence) || run.nextEventSequence < 1) return 0;
  return run.nextEventSequence - 1;
}

function createResearchRunEventStateAtSequence(
  run: ResearchRunV1,
  lastEventSequence: number,
): ResearchRunEventState {
  return {
    run,
    lastEventSequence,
    lastEventAt: run.updatedAt,
    appliedEvents: [],
    pendingEvents: [],
    sync: { status: "synced" },
    phaseStates: emptyPhaseStates(),
    evidence: {
      ...(run.artifactManifest ? { artifacts: run.artifactManifest.artifacts.length } : {}),
    },
  };
}

/** Start a reducer from a canonical snapshot after its included event prefix. */
export function createResearchRunEventState(run: ResearchRunV1): ResearchRunEventState {
  return createResearchRunEventStateAtSequence(run, initialSequence(run));
}

function nextExpectedSequence(sequence: number): number {
  return sequence >= MAX_SAFE_SEQUENCE ? MAX_SAFE_SEQUENCE : sequence + 1;
}

function advanceRun(run: ResearchRunV1, event: RunEventV1): ResearchRunV1 {
  const nextEventSequence = event.sequence >= MAX_SAFE_SEQUENCE
    ? run.nextEventSequence
    : Math.max(run.nextEventSequence, event.sequence + 1);
  return {
    ...run,
    updatedAt: event.at,
    nextEventSequence,
  };
}

function statusFrom(value: unknown): ResearchRunStatusV1 | undefined {
  return typeof value === "string" && RUN_STATUSES.has(value as ResearchRunStatusV1)
    ? value as ResearchRunStatusV1
    : undefined;
}

function waitingReasonFrom(value: unknown): "executor" | "checkpoint" | "provider-attention" | undefined {
  return typeof value === "string" && WAITING_REASONS.has(value)
    ? value as "executor" | "checkpoint" | "provider-attention"
    : undefined;
}

function phaseFrom(value: unknown): ResearchRunPhaseV1 | undefined {
  return typeof value === "string" && WAITING_PHASES.has(value)
    ? value as ResearchRunPhaseV1
    : undefined;
}

function nonNegativeSafeInteger(value: unknown): number | undefined {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0
    ? value
    : undefined;
}

function boundedText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text.length > 0 && text.length <= 512 ? text : undefined;
}

function applyStatus(run: ResearchRunV1, event: RunEventV1): ResearchRunV1 {
  let next = advanceRun(run, event);
  let status: ResearchRunStatusV1 | undefined = statusFrom(event.data.status);
  if (event.type === "checkpoint.required") status = "awaiting_checkpoint";
  if (event.type === "run.completed") status = "completed";
  if (event.type === "run.failed") status = "failed";
  if (event.type === "run.cancelled") status = "cancelled";

  if (status !== undefined) {
    next = { ...next, status };
    if (status === "waiting_for_executor") {
      const waitingReason = waitingReasonFrom(event.data.waitingReason);
      const waitingForPhase = phaseFrom(event.data.waitingForPhase);
      if (waitingReason) next.waitingReason = waitingReason;
      if (waitingForPhase) next.waitingForPhase = waitingForPhase;
    } else if (status === "awaiting_checkpoint") {
      next.waitingReason = "checkpoint";
      delete next.waitingForPhase;
    } else {
      delete next.waitingReason;
      delete next.waitingForPhase;
    }

    if (status !== "failed") delete next.failure;
  }

  if (event.type === "run.failed") {
    const candidate = isRecord(event.data.failure) ? event.data.failure : event.data;
    if (
      typeof candidate.code === "string"
      && typeof candidate.message === "string"
      && typeof candidate.retryable === "boolean"
    ) {
      next.failure = {
        code: candidate.code,
        message: candidate.message,
        retryable: candidate.retryable,
      };
    }
  }

  if (event.type === "retention.changed") {
    const retention = event.data.retention ?? event.data.policy;
    if (retention === "run-only" || retention === "7-days" || retention === "project") {
      next.privacy = { ...next.privacy, retention };
    }
  }

  return next;
}

function applyEvidence(
  evidence: ResearchRunEventEvidence,
  event: RunEventV1,
): ResearchRunEventEvidence {
  let next = evidence;
  for (const key of EVIDENCE_KEYS) {
    const count = nonNegativeSafeInteger(event.data[key]);
    if (count !== undefined) next = { ...next, [key]: count };
  }

  if (
    event.type === "artifact.registered"
    && nonNegativeSafeInteger(event.data.artifacts) === undefined
    && nonNegativeSafeInteger(event.data.artifactCount) === undefined
  ) {
    next = { ...next, artifacts: (next.artifacts ?? 0) + 1 };
  }
  const artifactCount = nonNegativeSafeInteger(event.data.artifactCount);
  if (artifactCount !== undefined) next = { ...next, artifacts: artifactCount };
  return next;
}

function applyPhase(
  phaseStates: Readonly<Record<ResearchRunPhaseV1, ResearchRunPhaseState>>,
  activePhase: ResearchRunPhaseV1 | undefined,
  event: RunEventV1,
): {
  phaseStates: Readonly<Record<ResearchRunPhaseV1, ResearchRunPhaseState>>;
  activePhase?: ResearchRunPhaseV1;
} {
  if (event.type !== "phase.started" && event.type !== "phase.completed") {
    return { phaseStates, ...(activePhase ? { activePhase } : {}) };
  }
  const phase = phaseFrom(event.data.phase);
  if (!phase) return { phaseStates, ...(activePhase ? { activePhase } : {}) };
  const nextPhaseStates = { ...phaseStates };
  if (event.type === "phase.started") nextPhaseStates[phase] = "active";
  else nextPhaseStates[phase] = "completed";
  return {
    phaseStates: nextPhaseStates,
    ...(event.type === "phase.started"
      ? { activePhase: phase }
      : activePhase === phase ? {} : activePhase ? { activePhase } : {}),
  };
}

function applyActivity(
  activity: ResearchRunActivity | undefined,
  event: RunEventV1,
): ResearchRunActivity | undefined {
  const label = boundedText(event.data.activity) ?? boundedText(event.data.summary);
  const detail = boundedText(event.data.activityDetail);
  if (!label && !detail) return activity;
  return {
    label: label ?? activity?.label ?? event.type,
    ...(detail ?? activity?.detail ? { detail: detail ?? activity?.detail } : {}),
  };
}

function applyEvent(state: ResearchRunEventState, event: RunEventV1): ResearchRunEventState {
  const phase = applyPhase(state.phaseStates, state.activePhase, event);
  const next: ResearchRunEventState = {
    ...state,
    run: applyStatus(state.run, event),
    lastEventSequence: event.sequence,
    lastEventAt: event.at,
    appliedEvents: [...state.appliedEvents, event],
    phaseStates: phase.phaseStates,
    activity: applyActivity(state.activity, event),
    evidence: applyEvidence(state.evidence, event),
  };
  if (phase.activePhase) next.activePhase = phase.activePhase;
  else delete next.activePhase;
  return next;
}

function syncForPending(
  state: ResearchRunEventState,
  pendingEvents: readonly RunEventV1[],
): ResearchRunEventSync {
  const first = pendingEvents[0];
  if (!first) return { status: "synced" };
  return {
    status: "gap",
    expectedSequence: nextExpectedSequence(state.lastEventSequence),
    receivedSequence: first.sequence,
  };
}

function drainPending(state: ResearchRunEventState): ResearchRunEventState {
  let next = state;
  let pending = state.pendingEvents;
  while (pending[0]?.sequence === nextExpectedSequence(next.lastEventSequence)) {
    const event = pending[0];
    pending = pending.slice(1);
    next = applyEvent(next, event);
  }
  return {
    ...next,
    pendingEvents: pending,
    sync: syncForPending(next, pending),
  };
}

function invalidState(
  state: ResearchRunEventState,
  sync: Extract<ResearchRunEventSync, { status: "invalid" }>,
): ResearchRunEventState {
  if (state.sync.status === "invalid" || state.sync.status === "conflict") return state;
  return { ...state, sync };
}

/**
 * Apply one already-delivered event. Events are not applied until they extend
 * the contiguous prefix, which makes reconnect replay and out-of-order
 * delivery deterministic instead of allowing a later event to overwrite an
 * earlier projection.
 */
export function reduceResearchRunEvent(
  state: ResearchRunEventState,
  event: RunEventV1,
): ResearchRunEventState {
  if (state.sync.status === "invalid" || state.sync.status === "conflict") return state;
  if (!isCanonicalResearchRunEvent(event)) {
    return invalidState(state, {
      status: "invalid",
      reason: "malformed",
      message: "Research run event is not a canonical v1 event",
    });
  }
  if (event.runId !== state.run.id) {
    return invalidState(state, {
      status: "invalid",
      reason: "wrong-run",
      message: "Research run event belongs to a different run",
    });
  }

  const applied = state.appliedEvents.find((candidate) => candidate.sequence === event.sequence);
  if (event.sequence <= state.lastEventSequence) {
    if (applied && !sameEvent(applied, event)) {
      return { ...state, sync: { status: "conflict", sequence: event.sequence } };
    }
    return state;
  }

  const pending = state.pendingEvents.find((candidate) => candidate.sequence === event.sequence);
  if (pending) {
    if (!sameEvent(pending, event)) {
      return { ...state, sync: { status: "conflict", sequence: event.sequence } };
    }
    return state;
  }

  const pendingEvents = [...state.pendingEvents, event].sort(
    (left, right) => left.sequence - right.sequence,
  );
  return drainPending({ ...state, pendingEvents });
}

/**
 * Consume an untrusted stream value at the UI transport boundary and expose
 * the outcome for callers that need to request a reconnect or full snapshot.
 */
export function consumeResearchRunEvent(
  state: ResearchRunEventState,
  value: unknown,
): ResearchRunEventConsumption {
  if (state.sync.status === "conflict") return { state, disposition: "conflict" };
  if (state.sync.status === "invalid") return { state, disposition: "rejected" };
  const event = isCanonicalResearchRunEvent(value) ? value : undefined;
  const next = reduceResearchRunEvent(state, value as RunEventV1);
  if (!event) return { state: next, disposition: "rejected" };
  if (next.sync.status === "conflict") {
    return { state: next, disposition: "conflict" };
  }
  if (next.sync.status === "invalid") return { state: next, disposition: "rejected" };
  if (event.sequence <= state.lastEventSequence) {
    const applied = state.appliedEvents.find((candidate) => candidate.sequence === event.sequence);
    return {
      state: next,
      disposition: applied && sameEvent(applied, event) ? "duplicate" : "stale",
    };
  }
  return {
    state: next,
    disposition: next.lastEventSequence > state.lastEventSequence ? "applied" : "buffered",
  };
}

/** Rebuild a projection from a snapshot and any replay page in any delivery order. */
export function rehydrateResearchRun(
  run: ResearchRunV1,
  events: readonly RunEventV1[],
  options: ResearchRunRehydrationOptions = {},
): ResearchRunEventState {
  const afterSequence = options.afterSequence
    ?? (events.length > 0
      ? Math.max(0, Math.min(...events.map((event) => event.sequence)) - 1)
      : initialSequence(run));
  const previous = options.previousState;
  const initial = previous
    && previous.run.id === run.id
    && previous.lastEventSequence === afterSequence
    && previous.sync.status === "synced"
    && previous.pendingEvents.length === 0
    ? { ...previous, run }
    : createResearchRunEventStateAtSequence(run, afterSequence);
  return events.reduce(reduceResearchRunEvent, initial);
}

export function researchRunNeedsResync(state: ResearchRunEventState): boolean {
  return state.sync.status !== "synced";
}
