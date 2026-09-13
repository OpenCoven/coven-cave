import stateMachines from "../../../conformance/automations-v1-artifact/coven-automations-v1/state-machines.json" with { type: "json" };

const AUTOMATIONS_V1_SCHEMA_VERSION = "coven.automations.v1";
const OCCURRENCE_STREAM_KIND = "occurrence";
const OCCURRENCE_TRANSITIONED_KIND = "occurrence.transitioned";
const OCCURRENCE_ENTITY = "occurrence";
const occurrenceMachine = stateMachines.machines.find((machine) => machine.id === "occurrence.v1");
if (occurrenceMachine === undefined) {
  throw new Error("The pinned occurrence state machine is missing.");
}
const occurrenceInitialState = occurrenceMachine.initial;
const occurrenceTransitions = new Set(
  occurrenceMachine.transitions.map(({ from, to }) => `${from}\0${to}`),
);

export const SCHEMA_VERSION_UNSUPPORTED = "SCHEMA_VERSION_UNSUPPORTED";
export const STREAM_KIND_UNSUPPORTED = "STREAM_KIND_UNSUPPORTED";
export const EVENT_KIND_UNSUPPORTED = "EVENT_KIND_UNSUPPORTED";
export const STREAM_MISMATCH = "STREAM_MISMATCH";
export const EVENT_SHAPE_INVALID = "EVENT_SHAPE_INVALID";
export const STREAM_OUT_OF_ORDER = "STREAM_OUT_OF_ORDER";
export const STATE_TRANSITION_INVALID = "STATE_TRANSITION_INVALID";

export interface AutomationsV1OccurrenceStream {
  kind: "occurrence";
  id: string;
}

export interface AutomationsV1OccurrenceTransitionEvent {
  schemaVersion: "coven.automations.v1";
  eventId: string;
  stream: AutomationsV1OccurrenceStream;
  sequence: number;
  kind: "occurrence.transitioned";
  payload: {
    entity: "occurrence";
    from: string;
    to: string;
    reason: string;
    fenceGeneration?: number;
  };
}

export interface AutomationsV1OccurrenceProjection {
  stream: AutomationsV1OccurrenceStream;
  cursor: number;
  state: string;
  firstSequence: number | null;
  lastSequence: number | null;
  appliedEventIds: ReadonlySet<string>;
}

export interface AutomationsV1OccurrenceProjectionSeed {
  cursor?: number;
  state?: string;
  firstSequence?: number | null;
  lastSequence?: number | null;
  appliedEventIds?: Iterable<string>;
}

export interface AutomationsV1OccurrenceProjectionSnapshot {
  cursor: number;
  state: string;
  firstSequence: number | null;
  lastSequence: number | null;
}

export class AutomationsV1ConsumerError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "AutomationsV1ConsumerError";
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new AutomationsV1ConsumerError(code, message);
}

function assertRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(EVENT_SHAPE_INVALID, `${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function assertString(
  value: unknown,
  label: string,
  code: string = EVENT_SHAPE_INVALID,
): string {
  if (typeof value !== "string" || value.length === 0) {
    fail(code, `${label} must be a non-empty string.`);
  }
  return value;
}

function assertNonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    fail(EVENT_SHAPE_INVALID, `${label} must be a non-negative safe integer.`);
  }
  return value;
}

function assertPositiveInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    fail(EVENT_SHAPE_INVALID, `${label} must be a positive safe integer.`);
  }
  return value;
}

export function createAutomationsV1OccurrenceProjection(
  stream: AutomationsV1OccurrenceStream,
  seed: AutomationsV1OccurrenceProjectionSeed = {},
): AutomationsV1OccurrenceProjection {
  if (stream.kind !== OCCURRENCE_STREAM_KIND) {
    fail(
      STREAM_KIND_UNSUPPORTED,
      `Unsupported automations stream kind: ${JSON.stringify(stream.kind)}.`,
    );
  }
  return {
    stream: {
      kind: OCCURRENCE_STREAM_KIND,
      id: assertString(stream.id, "stream.id"),
    },
    cursor: seed.cursor ?? -1,
    state: seed.state ?? "none",
    firstSequence: seed.firstSequence ?? null,
    lastSequence: seed.lastSequence ?? null,
    appliedEventIds: new Set(seed.appliedEventIds ?? []),
  };
}

export function parseAutomationsV1OccurrenceTransitionEvent(
  value: unknown,
  expectedStream?: AutomationsV1OccurrenceStream,
): AutomationsV1OccurrenceTransitionEvent {
  const event = assertRecord(value, "event");
  const schemaVersion = assertString(
    event.schemaVersion,
    "event.schemaVersion",
    SCHEMA_VERSION_UNSUPPORTED,
  );
  if (schemaVersion !== AUTOMATIONS_V1_SCHEMA_VERSION) {
    fail(
      SCHEMA_VERSION_UNSUPPORTED,
      `Unsupported automations schema version: ${JSON.stringify(schemaVersion)}.`,
    );
  }

  const stream = assertRecord(event.stream, "event.stream");
  const streamKind = assertString(
    stream.kind,
    "event.stream.kind",
    STREAM_KIND_UNSUPPORTED,
  );
  if (streamKind !== OCCURRENCE_STREAM_KIND) {
    fail(
      STREAM_KIND_UNSUPPORTED,
      `Unsupported automations stream kind: ${JSON.stringify(streamKind)}.`,
    );
  }

  const streamId = assertString(stream.id, "event.stream.id");
  if (
    expectedStream !== undefined &&
    (expectedStream.kind !== OCCURRENCE_STREAM_KIND || expectedStream.id !== streamId)
  ) {
    fail(
      STREAM_MISMATCH,
      `Event stream ${JSON.stringify(streamId)} does not match the requested occurrence stream ${JSON.stringify(expectedStream.id)}.`,
    );
  }

  const eventKind = assertString(
    event.kind,
    "event.kind",
    EVENT_KIND_UNSUPPORTED,
  );
  if (eventKind !== OCCURRENCE_TRANSITIONED_KIND) {
    fail(
      EVENT_KIND_UNSUPPORTED,
      `Unsupported automations event kind: ${JSON.stringify(eventKind)}.`,
    );
  }

  const payload = assertRecord(event.payload, "event.payload");
  const entity = assertString(payload.entity, "event.payload.entity");
  if (entity !== OCCURRENCE_ENTITY) {
    fail(
      EVENT_SHAPE_INVALID,
      `Unsupported automations payload entity: ${JSON.stringify(entity)}.`,
    );
  }

  return {
    schemaVersion: AUTOMATIONS_V1_SCHEMA_VERSION,
    eventId: assertString(event.eventId, "event.eventId"),
    stream: {
      kind: OCCURRENCE_STREAM_KIND,
      id: streamId,
    },
    sequence: assertNonNegativeInteger(event.sequence, "event.sequence"),
    kind: OCCURRENCE_TRANSITIONED_KIND,
    payload: {
      entity: OCCURRENCE_ENTITY,
      from: assertString(payload.from, "event.payload.from"),
      to: assertString(payload.to, "event.payload.to"),
      reason: assertString(payload.reason, "event.payload.reason"),
      ...(Object.hasOwn(payload, "fenceGeneration")
        ? {
            fenceGeneration: assertPositiveInteger(
              payload.fenceGeneration,
              "event.payload.fenceGeneration",
            ),
          }
        : {}),
    },
  };
}

export function applyAutomationsV1OccurrenceTransitionEvent(
  projection: AutomationsV1OccurrenceProjection,
  value: unknown,
): AutomationsV1OccurrenceProjection {
  const event = parseAutomationsV1OccurrenceTransitionEvent(value, projection.stream);
  if (projection.appliedEventIds.has(event.eventId)) {
    return projection;
  }
  const expectedSequence = projection.cursor + 1;
  if (event.sequence !== expectedSequence) {
    fail(
      STREAM_OUT_OF_ORDER,
      `Event sequence ${event.sequence} does not advance the consumer cursor ${projection.cursor}.`,
    );
  }
  const initializesOccurrence =
    projection.cursor === -1 &&
    event.payload.from === "none" &&
    event.payload.to === occurrenceInitialState;
  if (
    event.payload.from !== projection.state ||
    (!initializesOccurrence &&
      !occurrenceTransitions.has(`${event.payload.from}\0${event.payload.to}`))
  ) {
    fail(
      STATE_TRANSITION_INVALID,
      `Event transition ${JSON.stringify(event.payload.from)} -> ${JSON.stringify(event.payload.to)} does not match projected state ${JSON.stringify(projection.state)}.`,
    );
  }

  const appliedEventIds = new Set(projection.appliedEventIds);
  appliedEventIds.add(event.eventId);
  return {
    stream: projection.stream,
    cursor: event.sequence,
    state: event.payload.to,
    firstSequence: projection.firstSequence ?? event.sequence,
    lastSequence: event.sequence,
    appliedEventIds,
  };
}

export function replayAutomationsV1OccurrenceTransitionEvents(
  stream: AutomationsV1OccurrenceStream,
  deliveries: Iterable<unknown>,
  seed?: AutomationsV1OccurrenceProjectionSeed,
): AutomationsV1OccurrenceProjection {
  let projection = createAutomationsV1OccurrenceProjection(stream, seed);
  for (const value of deliveries) {
    projection = applyAutomationsV1OccurrenceTransitionEvent(projection, value);
  }
  return projection;
}

export function snapshotAutomationsV1OccurrenceProjection(
  projection: AutomationsV1OccurrenceProjection,
): AutomationsV1OccurrenceProjectionSnapshot {
  return {
    cursor: projection.cursor,
    state: projection.state,
    firstSequence: projection.firstSequence,
    lastSequence: projection.lastSequence,
  };
}
