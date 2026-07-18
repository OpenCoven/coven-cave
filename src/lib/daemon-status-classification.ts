export type DaemonAvailability =
  | "online"
  | "offline"
  | "unreachable"
  | "unhealthy"
  | "unauthorized"
  | "misconfigured";

export type DaemonTargetMode = "local" | "hub" | "unconfigured-hub";

const AVAILABILITY_VALUES = new Set<DaemonAvailability>([
  "online",
  "offline",
  "unreachable",
  "unhealthy",
  "unauthorized",
  "misconfigured",
]);

export function classifyDaemonFailureAvailability(input: {
  targetMode: DaemonTargetMode;
  responseStatus: number;
  reason: string | null;
}): Exclude<DaemonAvailability, "online"> {
  const { targetMode, responseStatus, reason } = input;
  if (targetMode === "unconfigured-hub") return "misconfigured";
  if (targetMode === "hub" && (responseStatus === 401 || responseStatus === 403)) {
    return "unauthorized";
  }
  if (responseStatus > 0) return "unhealthy";
  if (targetMode === "local" && reason?.trim().toLowerCase() === "daemon offline") {
    return "offline";
  }
  return "unreachable";
}

type DaemonStatusPayload = {
  running?: unknown;
  availability?: unknown;
  reason?: unknown;
  target?: { mode?: unknown };
};

export type DaemonStatusPollResult =
  | { kind: "running" }
  | { kind: "offline"; targetMode: "local" }
  | { kind: "auth-expired" }
  | { kind: "unavailable"; reason: string };

function statusPayload(value: unknown): DaemonStatusPayload | null {
  if (!value || typeof value !== "object") return null;
  return value as DaemonStatusPayload;
}

function payloadReason(payload: DaemonStatusPayload): string | null {
  return typeof payload.reason === "string" && payload.reason.trim()
    ? payload.reason.trim()
    : null;
}

function payloadAvailability(payload: DaemonStatusPayload): DaemonAvailability | null {
  return typeof payload.availability === "string" &&
    AVAILABILITY_VALUES.has(payload.availability as DaemonAvailability)
    ? payload.availability as DaemonAvailability
    : null;
}

/**
 * Classify the shell's status poll without converting "could not check" into
 * "the local daemon is stopped". The legacy fallback keeps rolling upgrades
 * honest when an older status route returns the exact local-offline response.
 */
export function classifyDaemonStatusPoll(input: {
  responseStatus: number;
  responseOk: boolean;
  payload: unknown;
  error?: string;
}): DaemonStatusPollResult {
  const { responseStatus, responseOk, error } = input;
  if (responseStatus === 401) return { kind: "auth-expired" };
  if (error) return { kind: "unavailable", reason: error };
  if (!responseOk) {
    return { kind: "unavailable", reason: `status service returned http ${responseStatus}` };
  }

  const payload = statusPayload(input.payload);
  if (!payload || typeof payload.running !== "boolean") {
    return { kind: "unavailable", reason: "status service returned an invalid response" };
  }
  if (payload.running) return { kind: "running" };

  const reason = payloadReason(payload);
  const availability = payloadAvailability(payload);
  const legacyLocalOffline =
    availability === null &&
    payload.target?.mode === "local" &&
    reason?.toLowerCase() === "daemon offline";
  const explicitLocalOffline =
    availability === "offline" && payload.target?.mode === "local";
  if (explicitLocalOffline || legacyLocalOffline) {
    return { kind: "offline", targetMode: "local" };
  }

  return {
    kind: "unavailable",
    reason: reason ?? "daemon status could not be confirmed",
  };
}
