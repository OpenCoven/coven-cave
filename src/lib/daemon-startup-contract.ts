import { exactSemver } from "./exact-semver.ts";

/** The exact named daemon API contract Cave can safely adopt. */
export const COVEN_DAEMON_API_VERSION = "coven.daemon.v1";

export function isSupportedDaemonApiVersion(
  value: unknown,
): value is typeof COVEN_DAEMON_API_VERSION {
  return value === COVEN_DAEMON_API_VERSION;
}

export type DaemonStartupHealth = {
  ok?: unknown;
  apiVersion?: unknown;
  covenVersion?: unknown;
  daemon?: { pid?: unknown; startedAt?: unknown; socket?: unknown };
};

export type DaemonStartupCompatibility =
  | { ok: true; daemonVersion: string; apiVersion: string }
  | {
    ok: false;
    code: "invalid_health" | "unsupported_api" | "invalid_runtime_version" | "runtime_version_mismatch";
    diagnostic: string;
  };

/**
 * A listening socket is only a transport fact. Cave adopts a local daemon
 * only after the health document identifies a supported API and the same
 * executable version Cave is about to manage. This deliberately fails closed:
 * accepting a stale daemon can let an older runtime open newer persisted
 * state before its own migration guard gets a chance to refuse it.
 */
export function assessDaemonStartupCompatibility(
  health: DaemonStartupHealth | null | undefined,
  installedVersion: string | null,
): DaemonStartupCompatibility {
  if (!health || typeof health !== "object" || health.ok !== true) {
    return {
      ok: false,
      code: "invalid_health",
      diagnostic: "The local Coven daemon did not publish a usable readiness document. Restart Coven and try again.",
    };
  }

  const apiVersion = health.apiVersion;
  if (!isSupportedDaemonApiVersion(apiVersion)) {
    return {
      ok: false,
      code: "unsupported_api",
      diagnostic: "The running Coven daemon uses an incompatible API. Update Coven, then restart the daemon.",
    };
  }

  const daemonVersion = exactSemver(health.covenVersion);
  if (!daemonVersion) {
    return {
      ok: false,
      code: "invalid_runtime_version",
      diagnostic: "The running Coven daemon did not report a valid runtime version. Update Coven, then restart the daemon.",
    };
  }

  const expectedVersion = exactSemver(installedVersion);
  if (!expectedVersion) {
    return {
      ok: false,
      code: "invalid_runtime_version",
      diagnostic: "Cave could not verify the installed Coven runtime version. Repair or reinstall Coven before starting the daemon.",
    };
  }

  if (daemonVersion !== expectedVersion) {
    return {
      ok: false,
      code: "runtime_version_mismatch",
      diagnostic: "The running Coven daemon does not match the installed runtime. Restart the daemon after updating Coven.",
    };
  }

  return { ok: true, daemonVersion, apiVersion };
}
