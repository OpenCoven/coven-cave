import type {
  ResearchRunV1,
  RunEventV1,
} from "./research-protocol/research-run.ts";
import { isCanonicalResearchRunEvent } from "./research-run-event-reducer.ts";

export type ResearchRunGatewayResponse =
  | {
    ok: true;
    run: ResearchRunV1;
    lastEventSequence: number;
    nextEventSequence: number;
  }
  | { ok: false; error?: string };

export type ResearchRunGatewayEventsResponse =
  | {
    ok: true;
    run: ResearchRunV1;
    events: RunEventV1[];
    afterSeq: number;
    lastEventSequence: number;
    nextEventSequence: number;
    hasMore: boolean;
  }
  | { ok: false; error?: string };

export type ResearchRunGatewaySseFrame =
  | {
    kind: "snapshot";
    run: ResearchRunV1;
    lastEventSequence: number;
    nextEventSequence: number;
    afterSeq: number;
  }
  | { kind: "event"; event: RunEventV1 }
  | { kind: "error"; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const RUN_STATUSES = new Set([
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

function isSafeSequence(value: unknown, allowZero = false): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && (allowZero ? value >= 0 : value >= 1);
}

/** A shallow browser guard. The server has already run the full protocol parser. */
export function isCanonicalResearchRunSnapshot(value: unknown): value is ResearchRunV1 {
  if (!isRecord(value)
    || value.schema !== "opencoven.research-run/v1"
    || typeof value.id !== "string"
    || !/^run_[A-Za-z0-9_-]+$/.test(value.id)
    || !isRecord(value.acceptedTopic)
    || typeof value.acceptedTopic.question !== "string"
    || !isRecord(value.execution)
    || !isRecord(value.privacy)
    || !isRecord(value.bounds)
    || typeof value.status !== "string"
    || !RUN_STATUSES.has(value.status)
    || typeof value.createdAt !== "string"
    || typeof value.updatedAt !== "string"
    || !isSafeSequence(value.nextEventSequence)) {
    return false;
  }
  return true;
}

function parseError(value: unknown): string {
  return isRecord(value) && typeof value.error === "string"
    ? value.error
    : "Research Run gateway request failed";
}

function parseGatewayResponse(value: unknown): ResearchRunGatewayResponse {
  if (!isRecord(value) || value.ok !== true || !isCanonicalResearchRunSnapshot(value.run)
    || !isSafeSequence(value.lastEventSequence, true)
    || !isSafeSequence(value.nextEventSequence)) {
    return { ok: false, error: parseError(value) };
  }
  return {
    ok: true,
    run: value.run,
    lastEventSequence: value.lastEventSequence,
    nextEventSequence: value.nextEventSequence,
  };
}

function parseGatewayEventsResponse(value: unknown): ResearchRunGatewayEventsResponse {
  const events = isRecord(value) && Array.isArray(value.events) ? value.events : null;
  if (!isRecord(value) || value.ok !== true || !isCanonicalResearchRunSnapshot(value.run)
    || !events
    || events.some((event) => !isCanonicalResearchRunEvent(event))
    || !isSafeSequence(value.afterSeq, true)
    || !isSafeSequence(value.lastEventSequence, true)
    || !isSafeSequence(value.nextEventSequence)
    || typeof value.hasMore !== "boolean") {
    return { ok: false, error: parseError(value) };
  }
  return {
    ok: true,
    run: value.run,
    events: events as RunEventV1[],
    afterSeq: value.afterSeq,
    lastEventSequence: value.lastEventSequence,
    nextEventSequence: value.nextEventSequence,
    hasMore: value.hasMore,
  };
}

export async function getResearchRunGateway(
  missionOrRunId: string,
  familiarId: string,
  signal?: AbortSignal,
): Promise<ResearchRunGatewayResponse> {
  try {
    const response = await fetch(
      `/api/research/runs/${encodeURIComponent(missionOrRunId)}?familiarId=${encodeURIComponent(familiarId)}`,
      { cache: "no-store", signal },
    );
    return parseGatewayResponse(await response.json());
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    return { ok: false, error: "Research Run gateway request failed" };
  }
}

export async function getResearchRunGatewayEvents(
  missionOrRunId: string,
  familiarId: string,
  afterSeq: number,
  limit = 200,
  signal?: AbortSignal,
): Promise<ResearchRunGatewayEventsResponse> {
  try {
    const query = new URLSearchParams({
      familiarId,
      afterSeq: String(afterSeq),
      limit: String(limit),
    });
    const response = await fetch(
      `/api/research/runs/${encodeURIComponent(missionOrRunId)}/events?${query}`,
      { cache: "no-store", signal },
    );
    return parseGatewayEventsResponse(await response.json());
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    return { ok: false, error: "Research Run event replay failed" };
  }
}

export function researchRunGatewayStreamUrl(
  missionOrRunId: string,
  familiarId: string,
  afterSeq: number,
): string {
  const query = new URLSearchParams({
    familiarId,
    afterSeq: String(afterSeq),
  });
  return `/api/research/runs/${encodeURIComponent(missionOrRunId)}/stream?${query}`;
}

export function parseResearchRunGatewaySseFrame(
  eventName: string,
  rawData: string,
): ResearchRunGatewaySseFrame | null {
  let value: unknown;
  try {
    value = JSON.parse(rawData);
  } catch {
    return { kind: "error", message: "Research Run gateway sent malformed JSON" };
  }
  if (eventName === "snapshot"
    && isRecord(value)
    && isCanonicalResearchRunSnapshot(value.run)
    && isSafeSequence(value.lastEventSequence, true)
    && isSafeSequence(value.nextEventSequence)
    && isSafeSequence(value.afterSeq, true)) {
    return {
      kind: "snapshot",
      run: value.run,
      lastEventSequence: value.lastEventSequence,
      nextEventSequence: value.nextEventSequence,
      afterSeq: value.afterSeq,
    };
  }
  if (eventName === "run-event" && isCanonicalResearchRunEvent(value)) {
    return { kind: "event", event: value };
  }
  if (eventName === "error" && isRecord(value) && typeof value.message === "string") {
    return { kind: "error", message: value.message };
  }
  return { kind: "error", message: "Research Run gateway sent an invalid frame" };
}
