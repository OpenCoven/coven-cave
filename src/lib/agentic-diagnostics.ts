import type { AgenticSurface } from "./agentic-recommendations.ts";

export const AGENTIC_DIAGNOSTIC_CODES = [
  "stale_discarded",
  "verification_blocked",
  "vault_context_reduced",
  "apply_failed",
  "cancelled",
  "generation_validation_failed",
] as const;

export type AgenticDiagnosticCode = (typeof AGENTIC_DIAGNOSTIC_CODES)[number];
export type AgenticDiagnosticStatus =
  | "discarded"
  | "blocked"
  | "reduced"
  | "failed"
  | "cancelled"
  | "rejected";
export type AgenticDiagnosticCounts = Partial<Record<
  "recommendations" | "verificationChecks" | "contextItems" | "attempts",
  number
>>;

export type AgenticDiagnosticEvent = {
  schemaVersion: 1;
  surface: AgenticSurface;
  code: AgenticDiagnosticCode;
  status: AgenticDiagnosticStatus;
  timestamp: string;
  counts?: AgenticDiagnosticCounts;
};

export type AgenticDiagnosticInput = {
  surface: AgenticSurface;
  code: AgenticDiagnosticCode;
  timestamp?: string;
  counts?: AgenticDiagnosticCounts;
};

export type AgenticDiagnosticSink = (event: AgenticDiagnosticEvent) => void;

export type AgenticDiagnosticRing = {
  record(input: AgenticDiagnosticInput): AgenticDiagnosticEvent;
  events(): readonly AgenticDiagnosticEvent[];
};

const MAX_EVENTS = 64;
const MAX_COUNT = 256;
const diagnosticCodes = new Set<string>(AGENTIC_DIAGNOSTIC_CODES);
const statusForCode: Record<AgenticDiagnosticCode, AgenticDiagnosticStatus> = {
  stale_discarded: "discarded",
  verification_blocked: "blocked",
  vault_context_reduced: "reduced",
  apply_failed: "failed",
  cancelled: "cancelled",
  generation_validation_failed: "rejected",
};

function safeTimestamp(value: string | undefined): string {
  return value && Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString()
    : new Date().toISOString();
}

function safeCounts(value: AgenticDiagnosticCounts | undefined): AgenticDiagnosticCounts | undefined {
  const counts = Object.fromEntries(
    Object.entries(value ?? {})
      .filter(([key, count]) =>
        (key === "recommendations"
          || key === "verificationChecks"
          || key === "contextItems"
          || key === "attempts")
        && Number.isSafeInteger(count)
        && count >= 0,
      )
      .map(([key, count]) => [key, Math.min(count as number, MAX_COUNT)]),
  ) as AgenticDiagnosticCounts;
  return Object.keys(counts).length > 0 ? counts : undefined;
}

function eventFrom(input: AgenticDiagnosticInput): AgenticDiagnosticEvent {
  const code = diagnosticCodes.has(input.code) ? input.code : "generation_validation_failed";
  const event: AgenticDiagnosticEvent = {
    schemaVersion: 1,
    surface: input.surface,
    code,
    status: statusForCode[code],
    timestamp: safeTimestamp(input.timestamp),
  };
  const counts = safeCounts(input.counts);
  if (counts) event.counts = counts;
  return event;
}

function cloneEvent(event: AgenticDiagnosticEvent): AgenticDiagnosticEvent {
  return {
    ...event,
    ...(event.counts ? { counts: { ...event.counts } } : {}),
  };
}

export function createAgenticDiagnosticRing(
  sink?: AgenticDiagnosticSink,
  maximum = MAX_EVENTS,
): AgenticDiagnosticRing {
  const events: AgenticDiagnosticEvent[] = [];
  const boundedMaximum = Number.isFinite(maximum) && maximum > 0
    ? Math.min(Math.max(Math.trunc(maximum), 1), MAX_EVENTS)
    : MAX_EVENTS;

  return {
    record(input) {
      const event = eventFrom(input);
      events.push(event);
      if (events.length > boundedMaximum) events.splice(0, events.length - boundedMaximum);
      try {
        sink?.(cloneEvent(event));
      } catch {
        // Diagnostics must never affect recommendation lifecycle behavior.
      }
      return cloneEvent(event);
    },
    events() {
      return events.map(cloneEvent);
    },
  };
}

const processDiagnostics = createAgenticDiagnosticRing();

/** Records bounded metadata only; no prompt, source, excerpt, payload, reason, or external ID is retained. */
export function recordAgenticDiagnostic(input: AgenticDiagnosticInput): AgenticDiagnosticEvent {
  return processDiagnostics.record(input);
}

export function recentAgenticDiagnostics(): readonly AgenticDiagnosticEvent[] {
  return processDiagnostics.events();
}
