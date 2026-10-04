import { normalizeToolActivity, type ToolActivity } from "../chat-activity.ts";
import { isKnownToolOutcome, type ToolStatus } from "../chat-tool-state.ts";

/** Supplied by the launch/compatibility path, never a runtime frame or request
 * body. runId is a Cave-minted observation correlation ID, not an engine lease. */
export type ToolObservationContext = ToolActivity["producer"] & {
  runId: string;
  /** Shared with reasoning and retry attempts; supplied only by Cave. */
  nextSequence?: () => number;
};

export function projectToolObservation(args: {
  context: ToolObservationContext;
  attemptId: string;
  callId: string;
  status: ToolStatus;
  source: ToolActivity["source"];
  now: number;
  previous?: ToolActivity;
}): ToolActivity | undefined {
  const previous = args.previous?.runId === args.context.runId && args.previous.attemptId === args.attemptId
    ? normalizeToolActivity(args.previous, args.callId, args.previous.phase) : undefined;
  if (isKnownToolOutcome(previous?.phase)) return previous;
  const observedAt = Math.max(args.now, previous?.updatedAt ?? 0);
  const sequence = previous ? previous.sequence : args.context.nextSequence?.();
  return normalizeToolActivity({
    schemaVersion: 1,
    runId: args.context.runId,
    attemptId: args.attemptId,
    callId: args.callId,
    phase: args.status,
    source: args.source,
    producer: { harness: args.context.harness, version: args.context.version, protocol: args.context.protocol },
    firstObservedAt: previous?.firstObservedAt ?? observedAt,
    ...(sequence !== undefined ? { sequence } : {}),
    updatedAt: observedAt,
    executionObservedAt: previous?.executionObservedAt ?? (args.status === "running" ? observedAt : null),
    terminalObservedAt: isKnownToolOutcome(args.status) ? observedAt : null,
    authority: { binding: "unavailable", approval: "unavailable", effect: "unavailable" },
  }, args.callId, args.status);
}
