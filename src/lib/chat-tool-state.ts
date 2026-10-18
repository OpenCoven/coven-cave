import type { ToolActivity } from "./chat-activity.ts";

/** Display states describe producer observations, never approval or committed
 * side effects. Missing results remain unknown even if the enclosing turn ends. */
export type ToolOutcome = "ok" | "error" | "rejected" | "policy-rejected" | "user-rejected" | "cancelled";
export type ToolStatus = "requested" | "approval-requested" | "cancel-requested" | "running" | ToolOutcome | "unknown";

export function isKnownToolOutcome(status: ToolStatus | undefined): status is ToolOutcome {
  return status === "ok" || status === "error" || status === "rejected" || status === "policy-rejected" || status === "user-rejected" || status === "cancelled";
}

export function normalizeToolStatus(value: unknown): ToolStatus {
  return value === "requested" || value === "approval-requested" || value === "cancel-requested" || value === "running" || value === "ok" || value === "error" || value === "rejected" || value === "policy-rejected" || value === "user-rejected" || value === "cancelled" ? value : "unknown";
}

export function isToolActive(status: ToolStatus): boolean {
  return status === "requested" || status === "approval-requested" || status === "cancel-requested" || status === "running";
}

export function toolStatusLabel(status: ToolStatus): string {
  status = normalizeToolStatus(status);
  if (status === "approval-requested") return "Approval requested";
  if (status === "cancel-requested") return "Cancellation requested";
  if (status === "cancelled") return "Cancelled";
  if (status === "policy-rejected") return "Rejected by policy";
  if (status === "user-rejected") return "Rejected by user";
  return status === "unknown" ? "Outcome unknown"
    : status === "requested" ? "Requested"
      : status === "running" ? "Running"
        : status === "ok" ? "Succeeded" : status === "rejected" ? "Rejected" : "Failed";
}

/** The first known outcome wins. An unknown outcome can be resolved by a
 * result, but a replayed request/start must not revive it. */
export function retainToolStatus(previous: ToolStatus | undefined, incoming: ToolStatus): ToolStatus {
  if (isKnownToolOutcome(previous)) return previous;
  if (previous === "unknown" && isToolActive(incoming)) return previous;
  if (previous === "cancel-requested" && isToolActive(incoming)) return previous;
  if (previous === "running" && incoming === "approval-requested") return previous;
  if ((previous === "running" || previous === "approval-requested") && incoming === "requested") return previous;
  return incoming;
}

/** Shared live/replay fold. A late argument snapshot can fill missing detail,
 * but retransmission cannot overwrite the first terminal output or duration. */
export function mergeToolObservation<T extends { status: ToolStatus; input?: string; output?: string; durationMs?: number; activity?: ToolActivity }>(previous: T, incoming: T): T {
  const status = retainToolStatus(previous.status, incoming.status);
  const retainOutcome = isKnownToolOutcome(previous.status) || status !== incoming.status;
  return {
    ...previous,
    ...incoming,
    status,
    input: previous.input ?? incoming.input,
    output: retainOutcome ? previous.output : incoming.output ?? previous.output,
    durationMs: retainOutcome ? previous.durationMs : incoming.durationMs ?? previous.durationMs,
    ...(previous.activity || incoming.activity ? {
      activity: retainOutcome ? previous.activity : incoming.activity?.phase === status ? incoming.activity : undefined,
    } : {}),
  };
}

/** Disconnect, cancellation, and turn completion stop activity indicators;
 * none is a tool result. Also normalizes legacy/future transcript statuses. */
export function settleToolObservations<T extends { status: ToolStatus; activity?: ToolActivity }>(tools: T[] | undefined): T[] | undefined {
  return tools?.map((tool) => {
    const status = normalizeToolStatus(tool.status);
    const settled = isToolActive(status) ? "unknown" : status;
    // A client-side disconnect is not a producer report. Do not rewrite or
    // attach the server's provenance to a locally inferred unknown outcome.
    return { ...tool, status: settled, ...(tool.activity && tool.activity.phase !== settled ? { activity: undefined } : {}) };
  });
}
