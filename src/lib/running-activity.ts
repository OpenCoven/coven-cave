// Shared types + pure aggregation for GET /api/running-activity (cave-21rp).
//
// The top-bar running-count pill becomes a live activity popover backed by one
// endpoint that aggregates every "actually running" thing the Cave knows about:
// chat sessions, Board cards, ritual/automation runs, Flow runs, and Workflow
// runs. This module is client-safe (no node imports) so the popover component
// and the route share the same vocabulary; the route's per-source loaders live
// in the route file, while this module only maps records → items and assembles
// the partial-source payload.
//
// Partial-source status: a source that errors must not kill the whole response.
// `buildRunningActivityPayload` marks it `unavailable` and continues, so a
// missing/corrupt flow-runs file never hides the live chats and board tasks.

import { sessionStatusTone } from "@/lib/session-status";
import type { SessionRow } from "@/lib/types";
import type { Card } from "@/lib/cave-board-types";
import type { AutomationRunRecord } from "@/lib/automation-runs";
import type { FlowRunRecord } from "@/lib/flows";
import type { WorkflowRunRecord } from "@/lib/workflows";

export type RunningActivityKind =
  | "session"
  | "board-task"
  | "automation"
  | "flow"
  | "workflow";

export const RUNNING_ACTIVITY_SOURCES = [
  "sessions",
  "board",
  "automations",
  "flows",
  "workflows",
] as const;

export type RunningActivitySourceId = (typeof RUNNING_ACTIVITY_SOURCES)[number];

/** One deduplicated, navigable running item across all sources. */
export type RunningActivityItem = {
  /** `${kind}:${id}` — unique within a response. */
  id: string;
  kind: RunningActivityKind;
  title: string;
  status: "running" | "queued";
  startedAt?: string;
  familiarId?: string | null;
  /** Live chat session backing this item (task/flow/workflow-backed sessions). */
  sessionId?: string | null;
  /** Domain id to navigate to (session id, card id, automation id, flow id, workflow id). */
  targetId: string;
};

export type RunningActivitySourceState = {
  ok: boolean;
  count: number;
  error?: string;
};

export type RunningActivityPayload = {
  ok: true;
  generatedAt: string;
  /** Post-dedup flattened item count (may be below the sum of source counts). */
  total: number;
  items: RunningActivityItem[];
  sources: Record<RunningActivitySourceId, RunningActivitySourceState>;
  /** Sources that failed and were omitted from `items` (partial-source status). */
  unavailable: RunningActivitySourceId[];
};

/** One source's contribution to the payload: ok+items, or an error. */
export type RunningActivitySourceInput =
  | { ok: true; items: RunningActivityItem[] }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isRunningActivityKind(value: unknown): value is RunningActivityKind {
  return value === "session"
    || value === "board-task"
    || value === "automation"
    || value === "flow"
    || value === "workflow";
}

function isRunningActivityStatus(value: unknown): value is RunningActivityItem["status"] {
  return value === "running" || value === "queued";
}

function isRunningActivitySourceId(value: unknown): value is RunningActivitySourceId {
  return RUNNING_ACTIVITY_SOURCES.some((source) => source === value);
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isOptionalNullableString(value: unknown): boolean {
  return value === undefined || value === null || typeof value === "string";
}

function isRunningActivityItem(value: unknown): value is RunningActivityItem {
  if (!isRecord(value)) return false;
  if (!isRunningActivityKind(value.kind) || !isRunningActivityStatus(value.status)) return false;
  return typeof value.id === "string"
    && value.id.startsWith(`${value.kind}:`)
    && value.id.length > value.kind.length + 1
    && typeof value.title === "string"
    && typeof value.targetId === "string"
    && value.targetId.length > 0
    && isOptionalString(value.startedAt)
    && isOptionalNullableString(value.familiarId)
    && isOptionalNullableString(value.sessionId);
}

function isRunningActivitySourceState(value: unknown): value is RunningActivitySourceState {
  if (!isRecord(value)) return false;
  return typeof value.ok === "boolean"
    && typeof value.count === "number"
    && Number.isInteger(value.count)
    && value.count >= 0
    && isOptionalString(value.error);
}

/** Validate the complete wire payload before any field reaches React state. */
export function isRunningActivityPayload(value: unknown): value is RunningActivityPayload {
  if (
    !isRecord(value)
    || value.ok !== true
    || typeof value.generatedAt !== "string"
    || typeof value.total !== "number"
    || !Number.isInteger(value.total)
    || value.total < 0
    || !Array.isArray(value.items)
    || !Array.isArray(value.unavailable)
    || !isRecord(value.sources)
  ) return false;

  const itemIds = new Set<string>();
  for (const item of value.items) {
    if (!isRunningActivityItem(item) || itemIds.has(item.id)) return false;
    itemIds.add(item.id);
  }
  if (value.total !== value.items.length) return false;

  const unavailable = new Set<RunningActivitySourceId>();
  for (const source of value.unavailable) {
    if (!isRunningActivitySourceId(source) || unavailable.has(source)) return false;
    unavailable.add(source);
  }

  for (const source of RUNNING_ACTIVITY_SOURCES) {
    const state = value.sources[source];
    if (!isRunningActivitySourceState(state)) return false;
    if (state.ok === unavailable.has(source)) return false;
  }
  return true;
}

const RUNNING_OR_QUEUED = new Set(["running", "queued"]);

export function sessionActivityItems(rows: SessionRow[]): RunningActivityItem[] {
  return rows
    .filter((s) => !s.archived_at && sessionStatusTone(s.status) === "running")
    .map((s) => ({
      id: `session:${s.id}`,
      kind: "session" as const,
      title: s.title || "Untitled session",
      status: "running" as const,
      startedAt: s.created_at || undefined,
      familiarId: s.familiarId,
      targetId: s.id,
    }));
}

export function boardTaskActivityItems(cards: Card[]): RunningActivityItem[] {
  return cards
    .filter((c) => c.status === "running")
    .map((c) => ({
      id: `board-task:${c.id}`,
      kind: "board-task" as const,
      title: c.title,
      status: "running" as const,
      startedAt: c.runningSince || c.updatedAt || undefined,
      familiarId: c.familiarId,
      sessionId: c.sessionId,
      targetId: c.id,
    }));
}

export function automationActivityItems(runs: AutomationRunRecord[]): RunningActivityItem[] {
  return runs
    .filter((r) => RUNNING_OR_QUEUED.has(r.status))
    .map((r) => ({
      id: `automation:${r.id}`,
      kind: "automation" as const,
      title: r.automationName || r.automationId,
      status: (r.status === "running" ? "running" : "queued") as "running" | "queued",
      startedAt: r.startedAt,
      targetId: r.automationId,
    }));
}

export function flowActivityItems(runs: FlowRunRecord[]): RunningActivityItem[] {
  return runs
    .filter((r) => RUNNING_OR_QUEUED.has(r.status))
    .map((r) => ({
      id: `flow:${r.id}`,
      kind: "flow" as const,
      title: r.flowName || r.flowId,
      status: (r.status === "running" ? "running" : "queued") as "running" | "queued",
      startedAt: r.startedAt,
      sessionId: r.sessionId,
      targetId: r.flowId,
    }));
}

export function workflowActivityItems(runs: WorkflowRunRecord[]): RunningActivityItem[] {
  return runs
    .filter((r) => RUNNING_OR_QUEUED.has(r.status))
    .map((r) => ({
      id: `workflow:${r.id}`,
      kind: "workflow" as const,
      title: r.workflowId,
      status: (r.status === "running" ? "running" : "queued") as "running" | "queued",
      startedAt: r.startedAt,
      sessionId: r.sessionId,
      targetId: r.workflowId,
    }));
}

function byStartedAtDesc(a: RunningActivityItem, b: RunningActivityItem): number {
  if (a.startedAt && b.startedAt) return b.startedAt.localeCompare(a.startedAt);
  if (a.startedAt) return -1;
  if (b.startedAt) return 1;
  return 0;
}

/**
 * Assemble the payload from per-source inputs. A source whose input is
 * `{ ok: false }` is recorded as unavailable and contributes no items; the
 * remaining sources still produce a complete, navigable list.
 *
 * Task-backed session dedup: a running Board card already names its live chat
 * via `sessionId`, so that chat is not also emitted as a standalone session
 * item — the task row is the single, truthful representation.
 */
export function buildRunningActivityPayload(
  sources: Record<RunningActivitySourceId, RunningActivitySourceInput>,
  generatedAt = new Date().toISOString(),
): RunningActivityPayload {
  const state = {} as Record<RunningActivitySourceId, RunningActivitySourceState>;
  const unavailable: RunningActivitySourceId[] = [];
  const collected: RunningActivityItem[] = [];

  for (const id of RUNNING_ACTIVITY_SOURCES) {
    const source = sources[id];
    if (!source.ok) {
      state[id] = { ok: false, count: 0, error: source.error };
      unavailable.push(id);
      continue;
    }
    state[id] = { ok: true, count: source.items.length };
    collected.push(...source.items);
  }

  const taskBackedSessionIds = new Set(
    collected
      .filter((item) => item.kind === "board-task" && item.sessionId)
      .map((item) => item.sessionId as string),
  );
  const items = collected
    .filter((item) => !(item.kind === "session" && taskBackedSessionIds.has(item.targetId)))
    .sort(byStartedAtDesc);

  return { ok: true, generatedAt, total: items.length, items, sources: state, unavailable };
}

/** A complete, schema-valid idle response for daemon-less callers. */
export function emptyRunningActivityPayload(
  generatedAt = new Date().toISOString(),
): RunningActivityPayload {
  return buildRunningActivityPayload(
    {
      sessions: { ok: true, items: [] },
      board: { ok: true, items: [] },
      automations: { ok: true, items: [] },
      flows: { ok: true, items: [] },
      workflows: { ok: true, items: [] },
    },
    generatedAt,
  );
}

/** Fetch the aggregated running activity; resolves null on any failure. */
export async function fetchRunningActivity(
  fetchImpl: typeof fetch = fetch,
): Promise<RunningActivityPayload | null> {
  try {
    const res = await fetchImpl("/api/running-activity", { cache: "no-store" });
    if (!res.ok) return null;
    const json: unknown = await res.json();
    return isRunningActivityPayload(json) ? json : null;
  } catch {
    return null;
  }
}
