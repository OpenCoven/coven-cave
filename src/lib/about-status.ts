/** Small, client-safe state classifiers shared by Settings ▸ About. */

export type AboutDaemonState =
  | { kind: "checking" }
  | { kind: "running"; version: string | null; checkedAt: string }
  | { kind: "stopped"; reason: string | null; checkedAt: string }
  | { kind: "unreachable"; reason: string | null; checkedAt: string }
  | { kind: "failed-to-check"; reason: string; checkedAt: string };

type DaemonStatusBody = {
  running: boolean;
  covenVersion?: unknown;
  reason?: unknown;
  target?: { mode?: unknown };
};

function isDaemonStatusBody(value: unknown): value is DaemonStatusBody {
  if (!value || typeof value !== "object") return false;
  return "running" in value && typeof (value as { running?: unknown }).running === "boolean";
}

/**
 * The status route returns a structured `running: false` response when it can
 * reach Cave but the daemon cannot be reached. A failed HTTP/JSON request is a
 * distinct state: users should not be told that a daemon is definitely stopped
 * when Cave could not perform the check at all.
 */
export function classifyAboutDaemonStatus(input: {
  responseOk: boolean;
  payload: unknown;
  checkedAt: string;
  error?: string;
}): AboutDaemonState {
  const { responseOk, payload, checkedAt, error } = input;
  if (error) return { kind: "failed-to-check", reason: error, checkedAt };
  if (!responseOk) return { kind: "failed-to-check", reason: "status service returned an error", checkedAt };
  if (!isDaemonStatusBody(payload)) {
    return { kind: "failed-to-check", reason: "status service returned an invalid response", checkedAt };
  }

  if (payload.running) {
    return {
      kind: "running",
      version: typeof payload.covenVersion === "string" && payload.covenVersion.trim()
        ? payload.covenVersion
        : null,
      checkedAt,
    };
  }

  const reason = typeof payload.reason === "string" && payload.reason.trim()
    ? payload.reason.trim()
    : null;
  const targetMode = payload.target && typeof payload.target === "object"
    ? payload.target.mode
    : undefined;
  if (targetMode === "unconfigured-hub") {
    return { kind: "failed-to-check", reason: reason ?? "daemon target is not configured", checkedAt };
  }
  if (/\b(unauthorized|forbidden|invalid|misconfigured)\b/i.test(reason ?? "")) {
    return { kind: "failed-to-check", reason: reason ?? "daemon status could not be checked", checkedAt };
  }
  if (
    targetMode === "hub" ||
    /\b(unreachable|offline|timeout|timed out|econn|enet|network)\b/i.test(reason ?? "")
  ) {
    return { kind: "unreachable", reason, checkedAt };
  }
  return { kind: "stopped", reason, checkedAt };
}
