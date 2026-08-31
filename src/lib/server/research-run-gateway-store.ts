import { lstat, mkdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";

import { caveHome } from "../coven-paths.ts";
import {
  isValidResearchMissionId,
  researchMissionsRoot,
} from "./research-mission-store.ts";
import { withResearchMissionActionLock } from "./research-mission-lock.ts";
import { writeFileAtomic } from "./atomic-write.ts";
import {
  parseRunEventV1,
  validateRunEventSequence,
  type ResearchRunStatusV1,
  type RunEventV1,
} from "../research-protocol/research-run.ts";
import { isUtcTimestamp } from "../research-protocol/common.ts";
import { canonicalJson } from "../research-protocol/digest.ts";

const EVENT_LOG_VERSION = 1 as const;
const MAX_EVENT_LOG_BYTES = 4 * 1024 * 1024;
const MAX_EVENT_COUNT = 20_000;
const RUN_ID_RE = /^run_[A-Za-z0-9_-]+$/;
const EVENT_FIELDS = new Set(["schema", "runId", "sequence", "type", "at", "data"]);
const SAFE_EVENT_DATA_FIELDS = new Set([
  "status",
  "waitingReason",
  "waitingForPhase",
  "phase",
  "sources",
  "reviewed",
  "retained",
  "rejected",
  "cited",
  "artifacts",
  "artifactCount",
  "sourceCount",
  "iterations",
  "retention",
  "policy",
  "deletedObjectCount",
  "manifestStatus",
  "code",
  "message",
  "retryable",
  "failure",
]);
const STATUS_SET: ReadonlySet<ResearchRunStatusV1> = new Set([
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
const WAITING_REASON_SET = new Set(["executor", "checkpoint", "provider-attention"]);
const PHASE_SET = new Set(["scope", "challenge", "synthesize", "control"]);
const RETENTION_SET = new Set(["run-only", "7-days", "project"]);

export const RESEARCH_RUN_EVENT_LOG_ROOT_ENV = "COVEN_RESEARCH_RUN_EVENTS_DIR";

export type ResearchRunObservedProjection = {
  status: ResearchRunStatusV1;
  missionUpdatedAt: string;
  iterationCount: number;
  sourceCount: number;
  artifactCount: number;
};

export type ResearchRunEventLog = {
  version: typeof EVENT_LOG_VERSION;
  runId: string;
  events: RunEventV1[];
  projection?: ResearchRunObservedProjection;
};

export class ResearchRunEventLogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResearchRunEventLogError";
  }
}

function isWithin(candidate: string, root: string): boolean {
  const left = process.platform === "win32" ? candidate.toLowerCase() : candidate;
  const right = process.platform === "win32" ? root.toLowerCase() : root;
  return left === right || left.startsWith(`${right}${path.sep}`);
}

function assertRunId(runId: string): void {
  if (!RUN_ID_RE.test(runId)) throw new ResearchRunEventLogError("invalid research run id");
  const missionId = runId.slice("run_".length);
  if (!isValidResearchMissionId(missionId)) {
    throw new ResearchRunEventLogError("research run id is not bound to a mission");
  }
}

export function missionIdForResearchRunId(runId: string): string {
  assertRunId(runId);
  return runId.slice("run_".length);
}

export function researchRunIdForMissionId(missionId: string): string {
  if (!isValidResearchMissionId(missionId)) {
    throw new ResearchRunEventLogError("invalid research mission id");
  }
  return `run_${missionId}`;
}

export function researchRunEventLogRoot(): string {
  const configured = process.env[RESEARCH_RUN_EVENT_LOG_ROOT_ENV]?.trim();
  if (configured && !path.isAbsolute(configured)) {
    throw new ResearchRunEventLogError("Research Run event log directory must be absolute");
  }
  const root = path.resolve(
    configured || path.join(/* turbopackIgnore: true */ caveHome(), "research-run-events"),
  );
  const missions = path.resolve(researchMissionsRoot());
  if (isWithin(root, missions) || isWithin(missions, root)) {
    throw new ResearchRunEventLogError(
      "Research Run event log directory must be outside mission workspaces",
    );
  }
  return root;
}

export function researchRunEventLogPath(runId: string): string {
  assertRunId(runId);
  return path.join(/* turbopackIgnore: true */ researchRunEventLogRoot(), `${runId}.json`);
}

async function assertEventLogRoot(): Promise<string> {
  const root = researchRunEventLogRoot();
  await mkdir(/* turbopackIgnore: true */ root, { recursive: true });
  const info = await lstat(/* turbopackIgnore: true */ root);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new ResearchRunEventLogError("Research Run event log directory must be a real directory");
  }
  const resolved = await realpath(/* turbopackIgnore: true */ root);
  try {
    const missions = await realpath(/* turbopackIgnore: true */ researchMissionsRoot());
    if (isWithin(resolved, missions) || isWithin(missions, resolved)) {
      throw new ResearchRunEventLogError(
        "Research Run event log directory resolves inside mission workspaces",
      );
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return resolved;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0;
}

function parseProjection(value: unknown): ResearchRunObservedProjection | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)
    || !STATUS_SET.has(value.status as ResearchRunStatusV1)
    || !isUtcTimestamp(value.missionUpdatedAt)
    || !nonNegativeSafeInteger(value.iterationCount)
    || !nonNegativeSafeInteger(value.sourceCount)
    || !nonNegativeSafeInteger(value.artifactCount)) {
    throw new ResearchRunEventLogError("research Run event log projection is malformed");
  }
  return {
    status: value.status as ResearchRunStatusV1,
    missionUpdatedAt: value.missionUpdatedAt,
    iterationCount: value.iterationCount,
    sourceCount: value.sourceCount,
    artifactCount: value.artifactCount,
  };
}

function assertSafeEventData(event: RunEventV1): void {
  if (Object.keys(event).some((key) => !EVENT_FIELDS.has(key))) {
    throw new ResearchRunEventLogError("research Run event contains an unsafe top-level field");
  }
  const data = event.data;
  for (const key of Object.keys(data)) {
    if (!SAFE_EVENT_DATA_FIELDS.has(key)) {
      throw new ResearchRunEventLogError(
        `research Run event data field ${key} is not safe for the gateway projection`,
      );
    }
  }
  for (const key of [
    "sources",
    "reviewed",
    "retained",
    "rejected",
    "cited",
    "artifacts",
    "artifactCount",
    "sourceCount",
    "iterations",
    "deletedObjectCount",
  ]) {
    if (data[key] !== undefined && !nonNegativeSafeInteger(data[key])) {
      throw new ResearchRunEventLogError(`research Run event data field ${key} is invalid`);
    }
  }
  for (const key of ["status", "waitingReason", "waitingForPhase", "phase", "retention", "policy", "manifestStatus", "code"]) {
    if (data[key] !== undefined && (typeof data[key] !== "string" || data[key].length > 128 || data[key].includes("\0"))) {
      throw new ResearchRunEventLogError(`research Run event data field ${key} is invalid`);
    }
  }
  if (data.status !== undefined && !STATUS_SET.has(data.status as ResearchRunStatusV1)) {
    throw new ResearchRunEventLogError("research Run event status is invalid");
  }
  if (data.waitingReason !== undefined
    && !WAITING_REASON_SET.has(data.waitingReason as string)) {
    throw new ResearchRunEventLogError("research Run event waitingReason is invalid");
  }
  if (data.waitingForPhase !== undefined
    && !PHASE_SET.has(data.waitingForPhase as string)) {
    throw new ResearchRunEventLogError("research Run event waitingForPhase is invalid");
  }
  if (data.phase !== undefined && !PHASE_SET.has(data.phase as string)) {
    throw new ResearchRunEventLogError("research Run event phase is invalid");
  }
  for (const key of ["retention", "policy"]) {
    if (data[key] !== undefined && !RETENTION_SET.has(data[key] as string)) {
      throw new ResearchRunEventLogError(`research Run event ${key} is invalid`);
    }
  }
  if (data.manifestStatus !== undefined && data.manifestStatus !== "deleted") {
    throw new ResearchRunEventLogError("research Run event manifestStatus is invalid");
  }
  if (data.message !== undefined
    && (typeof data.message !== "string" || data.message.length > 256 || data.message.includes("\0"))) {
    throw new ResearchRunEventLogError("research Run event failure message is invalid");
  }
  if (data.retryable !== undefined && typeof data.retryable !== "boolean") {
    throw new ResearchRunEventLogError("research Run event retryable field is invalid");
  }
  if (data.failure !== undefined) {
    if (!isRecord(data.failure)) throw new ResearchRunEventLogError("research Run event failure is invalid");
    const failure = data.failure;
    if (Object.keys(failure).some((key) => !["code", "message", "retryable"].includes(key))) {
      throw new ResearchRunEventLogError("research Run event failure contains an unsafe field");
    }
    if (typeof failure.code !== "string" || failure.code.length > 128 || failure.code.includes("\0")
      || typeof failure.message !== "string" || failure.message.length > 256 || failure.message.includes("\0")
      || typeof failure.retryable !== "boolean") {
      throw new ResearchRunEventLogError("research Run event failure is invalid");
    }
  }
}

function parseEventLog(value: unknown, runId: string): ResearchRunEventLog {
  if (!isRecord(value)
    || value.version !== EVENT_LOG_VERSION
    || value.runId !== runId
    || !Array.isArray(value.events)
    || value.events.length < 1
    || value.events.length > MAX_EVENT_COUNT) {
    throw new ResearchRunEventLogError("research Run event log is malformed");
  }
  const events: RunEventV1[] = [];
  for (const candidate of value.events) {
    const parsed = parseRunEventV1(candidate);
    if (!parsed.ok || parsed.value.runId !== runId) {
      throw new ResearchRunEventLogError("research Run event log contains a malformed event");
    }
    assertSafeEventData(parsed.value);
    events.push(parsed.value);
  }
  const sequence = validateRunEventSequence(events);
  if (!sequence.ok) {
    throw new ResearchRunEventLogError(
      `research Run event log sequence is invalid: ${sequence.error.message}`,
    );
  }
  const projection = parseProjection(value.projection);
  return {
    version: EVENT_LOG_VERSION,
    runId,
    events,
    ...(projection ? { projection } : {}),
  };
}

async function readResearchRunEventLogUnlocked(runId: string): Promise<ResearchRunEventLog | null> {
  assertRunId(runId);
  await assertEventLogRoot();
  const target = researchRunEventLogPath(runId);
  let raw: string;
  try {
    const info = await lstat(/* turbopackIgnore: true */ target);
    if (info.isSymbolicLink() || !info.isFile()) {
      throw new ResearchRunEventLogError("research Run event log is not a regular file");
    }
    if (info.size > MAX_EVENT_LOG_BYTES) {
      throw new ResearchRunEventLogError("research Run event log is too large");
    }
    raw = await readFile(/* turbopackIgnore: true */ target, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ResearchRunEventLogError("research Run event log is not valid JSON");
  }
  return parseEventLog(parsed, runId);
}

export async function loadResearchRunEventLog(runId: string): Promise<ResearchRunEventLog | null> {
  return readResearchRunEventLogUnlocked(runId);
}

function sameEvent(left: RunEventV1, right: RunEventV1): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function canonicalProjection(value: ResearchRunObservedProjection | undefined): string {
  return value === undefined ? "<absent>" : canonicalJson(value);
}

function validateProjection(projection: ResearchRunObservedProjection | undefined): void {
  if (projection === undefined) return;
  if (!STATUS_SET.has(projection.status)
    || !isUtcTimestamp(projection.missionUpdatedAt)
    || !nonNegativeSafeInteger(projection.iterationCount)
    || !nonNegativeSafeInteger(projection.sourceCount)
    || !nonNegativeSafeInteger(projection.artifactCount)) {
    throw new ResearchRunEventLogError("research Run event log projection is invalid");
  }
}

/**
 * Append server-observed events under the same per-mission action lock used by
 * mission mutations. Callers cannot choose a sequence: the durable ledger
 * accepts only the next contiguous sequence, and a replay of the exact event
 * is idempotent while a same-sequence mutation fails closed.
 */
export async function appendResearchRunEvents(
  runId: string,
  events: readonly RunEventV1[],
  projection?: ResearchRunObservedProjection,
): Promise<ResearchRunEventLog> {
  const missionId = missionIdForResearchRunId(runId);
  validateProjection(projection);
  for (const event of events) {
    const parsed = parseRunEventV1(event);
    if (!parsed.ok || parsed.value.runId !== runId) {
      throw new ResearchRunEventLogError("cannot append a malformed or foreign research Run event");
    }
    assertSafeEventData(parsed.value);
  }
  if (events.length === 0 && projection === undefined) {
    throw new ResearchRunEventLogError("at least one event or projection is required");
  }

  return withResearchMissionActionLock(missionId, async () => {
    const current = await readResearchRunEventLogUnlocked(runId);
    const existingEvents = current?.events ?? [];
    const nextEvents = [...existingEvents];
    for (const event of events) {
      const expected = nextEvents.length + 1;
      if (event.sequence < expected) {
        const existing = nextEvents[event.sequence - 1];
        if (!existing || !sameEvent(existing, event)) {
          throw new ResearchRunEventLogError(
            `research Run event sequence ${event.sequence} conflicts with the durable ledger`,
          );
        }
        continue;
      }
      if (event.sequence !== expected) {
        throw new ResearchRunEventLogError(
          `research Run event sequence must equal ${expected}`,
        );
      }
      nextEvents.push(event);
    }
    if (nextEvents.length === 0) {
      throw new ResearchRunEventLogError("research Run event log cannot be empty");
    }
    if (nextEvents.length > MAX_EVENT_COUNT) {
      throw new ResearchRunEventLogError("research Run event log has reached its event limit");
    }
    const next: ResearchRunEventLog = {
      version: EVENT_LOG_VERSION,
      runId,
      events: nextEvents,
      ...(projection !== undefined
        ? { projection }
        : current?.projection !== undefined
          ? { projection: current.projection }
          : {}),
    };
    const changed = current === null
      || nextEvents.length !== current.events.length
      || canonicalProjection(next.projection) !== canonicalProjection(current.projection);
    if (changed) {
      const serialized = JSON.stringify(next, null, 2);
      if (Buffer.byteLength(serialized, "utf8") > MAX_EVENT_LOG_BYTES) {
        throw new ResearchRunEventLogError("research Run event log is too large");
      }
      await writeFileAtomic(researchRunEventLogPath(runId), serialized);
    }
    return next;
  });
}

export function replayResearchRunEvents(
  log: ResearchRunEventLog,
  afterSequence: number,
  limit: number,
): { events: RunEventV1[]; hasMore: boolean; lastEventSequence: number } {
  if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
    throw new ResearchRunEventLogError("after sequence must be a safe integer >= 0");
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
    throw new ResearchRunEventLogError("event limit must be between 1 and 500");
  }
  const lastEventSequence = log.events.at(-1)?.sequence ?? 0;
  if (afterSequence > lastEventSequence) {
    throw new ResearchRunEventLogError("requested event sequence is ahead of the durable ledger");
  }
  const events = log.events
    .filter((event) => event.sequence > afterSequence)
    .slice(0, limit);
  return {
    events,
    hasMore: events.at(-1)?.sequence !== undefined
      && events.at(-1)!.sequence < lastEventSequence,
    lastEventSequence,
  };
}
