import { isKnownToolOutcome, normalizeToolStatus, type ToolStatus } from "./chat-tool-state.ts";

/** Observations are not authorization, policy, or committed-effect receipts. */
export type ToolActivity = {
  schemaVersion: 1;
  runId: string;
  attemptId: string;
  callId: string;
  phase: ToolStatus;
  source: "runtime-report" | "hook-report" | "application";
  producer: { harness: string; version: string | null; protocol: string | null };
  firstObservedAt: number;
  /** Cave's first-observation order within a turn; not execution order. */
  sequence?: number;
  updatedAt: number;
  executionObservedAt: number | null;
  terminalObservedAt: number | null;
  authority: { binding: "unavailable"; approval: "unavailable"; effect: "unavailable" };
};

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const TOKEN = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/;
const VERSION = /^v?\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/;
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const timestamp = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

/** Decode only server-owned stored/wire observations. This validator does not
 * authenticate a caller; client transcript writers must strip this field.
 * Unknown versions and contradictory metadata leave legacy/plain chat usable. */
export function normalizeToolActivity(value: unknown, callId: string, status: ToolStatus): ToolActivity | undefined {
  const data = record(value);
  const producer = record(data?.producer);
  const authority = record(data?.authority);
  if (!data || !producer || !authority || data.schemaVersion !== 1 || data.callId !== callId ||
    typeof data.runId !== "string" || !UUID.test(data.runId) ||
    typeof data.attemptId !== "string" || !UUID.test(data.attemptId) ||
    typeof callId !== "string" || callId.length === 0 || callId.length > 512 ||
    data.phase !== status || normalizeToolStatus(data.phase) !== data.phase ||
    typeof data.source !== "string" || !["runtime-report", "hook-report", "application"].includes(data.source) ||
    typeof producer.harness !== "string" || !TOKEN.test(producer.harness) ||
    !(producer.version === null || typeof producer.version === "string" && producer.version.length <= 128 && VERSION.test(producer.version)) ||
    !(producer.protocol === null || typeof producer.protocol === "string" && TOKEN.test(producer.protocol)) ||
    !timestamp(data.firstObservedAt) || !timestamp(data.updatedAt) || data.updatedAt < data.firstObservedAt ||
    (data.sequence !== undefined && !timestamp(data.sequence)) ||
    authority.binding !== "unavailable" || authority.approval !== "unavailable" || authority.effect !== "unavailable" ||
    Object.keys(authority).some((key) => !["binding", "approval", "effect"].includes(key))) return undefined;
  for (const key of ["executionObservedAt", "terminalObservedAt"] as const) {
    const time = data[key];
    if (time !== null && (!timestamp(time) || time < data.firstObservedAt || time > data.updatedAt)) return undefined;
  }
  if (isKnownToolOutcome(status) !== (data.terminalObservedAt !== null) ||
    (status === "requested" && data.executionObservedAt !== null) ||
    (status === "running" && data.executionObservedAt === null)) return undefined;
  if (typeof data.executionObservedAt === "number" && typeof data.terminalObservedAt === "number" &&
    data.executionObservedAt > data.terminalObservedAt) return undefined;
  return {
    schemaVersion: 1, runId: data.runId, attemptId: data.attemptId, callId,
    phase: status, source: data.source as ToolActivity["source"],
    producer: { harness: producer.harness, version: producer.version as string | null, protocol: producer.protocol as string | null },
    firstObservedAt: data.firstObservedAt, updatedAt: data.updatedAt,
    ...(data.sequence !== undefined ? { sequence: data.sequence as number } : {}),
    executionObservedAt: data.executionObservedAt as number | null,
    terminalObservedAt: data.terminalObservedAt as number | null,
    authority: { binding: "unavailable", approval: "unavailable", effect: "unavailable" },
  };
}
