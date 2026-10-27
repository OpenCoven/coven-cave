import type { DaemonAvailability, DaemonTargetMode } from "./daemon-status-classification.ts";

/**
 * One projected daemon lifecycle state (#6298). Every state is derived from
 * recorded evidence; nothing here reads a PID, a socket file, or an HTTP
 * status on its own, and `ready` needs the health probe to have succeeded.
 */
export const DAEMON_LIFECYCLE_STATES = [
  "missing",
  "stopped",
  "starting",
  "recovering",
  "ready",
  "unreachable",
  "unauthorized",
  "incompatible",
  "unhealthy",
  "foreign-owned",
  "misconfigured",
  "unknown",
] as const;

export type DaemonLifecycleState = (typeof DAEMON_LIFECYCLE_STATES)[number];

/** Whether the local Coven runtime (the CLI the daemon is launched from) exists. */
export type DaemonRuntimeEvidence = "present" | "missing" | "unknown";

export type DaemonLifecycleOperation = {
  kind: "start" | "recovery";
  startedAt: string;
};

export type DaemonLifecycleEvidence = {
  /** `unknown` when config never loaded, so no target was resolved. */
  targetMode: DaemonTargetMode | "unknown";
  /** Result of the health probe, already classified by the caller. */
  availability: DaemonAvailability;
  runtime: DaemonRuntimeEvidence;
  /** A healthy local daemon that the system service does not own (#5730). */
  serviceConflict: { label: string } | null;
  /** The one start or recovery mutation in flight, if any. */
  operation: DaemonLifecycleOperation | null;
  /** This process has observed a ready daemon before. */
  previouslyReady: boolean;
  reason: string | null;
};

export type DaemonLifecycleProjection = {
  state: DaemonLifecycleState;
  evidence: DaemonLifecycleEvidence;
  reason?: string;
};

export type DaemonLifecycle = DaemonLifecycleProjection & {
  /** Monotonic per process; results from an older generation cannot win. */
  generation: number;
  observedAt: string;
};

export type DaemonLifecyclePresentation = {
  label: string;
  tone: "danger" | "success" | "warning" | "neutral";
};

function projectState(evidence: DaemonLifecycleEvidence): DaemonLifecycleState {
  const { availability } = evidence;
  if (evidence.targetMode === "unconfigured-hub" || availability === "misconfigured") {
    return "misconfigured";
  }
  if (availability === "status-unavailable") return "unknown";
  if (availability === "incompatible") return "incompatible";
  if (availability === "online") {
    return evidence.serviceConflict ? "foreign-owned" : "ready";
  }
  if (evidence.operation) {
    return evidence.operation.kind === "recovery" || evidence.previouslyReady
      ? "recovering"
      : "starting";
  }
  if (availability === "unauthorized") return "unauthorized";
  if (availability === "unhealthy") return "unhealthy";
  if (availability === "offline") {
    return evidence.runtime === "missing" ? "missing" : "stopped";
  }
  return "unreachable";
}

export function projectDaemonLifecycle(evidence: DaemonLifecycleEvidence): DaemonLifecycleProjection {
  const state = projectState(evidence);
  const reason = state === "ready" ? null : evidence.reason?.trim() || null;
  return {
    state,
    evidence,
    ...(reason ? { reason } : {}),
  };
}

/**
 * Keep whichever observation is newer. A result that belongs to an older
 * generation is evidence about a daemon that no longer exists in that form.
 */
export function mergeDaemonLifecycle(
  current: DaemonLifecycle | null,
  next: DaemonLifecycle,
): DaemonLifecycle {
  if (current && next.generation < current.generation) return current;
  return next;
}

export function describeDaemonLifecycle(
  lifecycle: Pick<DaemonLifecycle, "state">,
): DaemonLifecyclePresentation {
  switch (lifecycle.state) {
    case "ready":
      return { label: "Running", tone: "success" };
    case "foreign-owned":
      return { label: "Running outside the service", tone: "warning" };
    case "starting":
      return { label: "Starting…", tone: "warning" };
    case "recovering":
      return { label: "Reconnecting…", tone: "warning" };
    case "missing":
      return { label: "Runtime missing", tone: "danger" };
    case "stopped":
      return { label: "Offline", tone: "danger" };
    case "unreachable":
      return { label: "Unreachable", tone: "danger" };
    case "unauthorized":
      return { label: "Authorization required", tone: "danger" };
    case "incompatible":
      return { label: "Incompatible", tone: "danger" };
    case "unhealthy":
      return { label: "Unhealthy", tone: "danger" };
    case "misconfigured":
      return { label: "Configuration required", tone: "warning" };
    case "unknown":
      return { label: "Status unavailable", tone: "warning" };
  }
}

const LIFECYCLE_STATE_SET: ReadonlySet<string> = new Set(DAEMON_LIFECYCLE_STATES);

export function isDaemonLifecycleState(value: unknown): value is DaemonLifecycleState {
  return typeof value === "string" && LIFECYCLE_STATE_SET.has(value);
}
