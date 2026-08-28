import { exactSemver } from "./exact-semver.ts";

/** The daemon API contract this build requires — the "wanted" side of every compatibility diagnostic. */
export const COVEN_DAEMON_API_VERSION = "coven.daemon.v1";

/**
 * The daemon API contracts this build of Cave can adopt. Pinned in source by
 * hand: adding a contract here is the only way a daemon becomes adoptable, and
 * each entry asserts that Cave's own daemon call surface has been verified
 * against that contract.
 *
 * The gate is membership in this set, not a "minimum contract" comparison
 * (accept any `coven.daemon.vN` with N >= 1). A newer contract may add, rename,
 * or remove surface, so adopting one on the strength of a higher number would
 * let an unverified daemon through — the exact failure this gate exists to
 * prevent. An unknown-newer contract therefore stays a refusal until every
 * daemon-backed surface gates on the capability it actually requires (see
 * afs.ts and canonical-memory-client.ts); only then can it degrade to reduced
 * function instead of refusing adoption. Until that lands, fail-closed is the
 * only correct behaviour, and the diagnostic names both sides of the mismatch
 * so the refusal stays actionable.
 */
export const SUPPORTED_DAEMON_API_VERSIONS: ReadonlySet<string> = new Set([
  COVEN_DAEMON_API_VERSION,
]);

export function isSupportedDaemonApiVersion(value: unknown): value is string {
  return typeof value === "string" && SUPPORTED_DAEMON_API_VERSIONS.has(value);
}

const DAEMON_CONTRACT_RE = /^coven\.daemon\.v(\d+)$/;

/** The highest contract major this build has verified; used to classify newer contracts for diagnostics. */
const MAX_SUPPORTED_DAEMON_API_MAJOR = [...SUPPORTED_DAEMON_API_VERSIONS].reduce(
  (max, version) => {
    const match = DAEMON_CONTRACT_RE.exec(version);
    return match ? Math.max(max, Number(match[1])) : max;
  },
  0,
);

function isNewerDaemonContract(value: string): boolean {
  const match = DAEMON_CONTRACT_RE.exec(value);
  return match !== null && Number(match[1]) > MAX_SUPPORTED_DAEMON_API_MAJOR;
}

function describeGotApiContract(value: unknown): string {
  if (value === undefined) return "no apiVersion field at all";
  if (typeof value === "string") return JSON.stringify(value);
  try {
    const rendered = JSON.stringify(value);
    return rendered === undefined ? String(value) : rendered;
  } catch {
    return String(value);
  }
}

const NEWER_DAEMON_API_DIAGNOSTIC_ADVICE =
  "This build of Cave predates that daemon contract. Update Cave, then try again.";

const DAEMON_API_UPDATE_DIAGNOSTIC_ADVICE =
  "Update Coven, then restart the daemon.";

/**
 * The `unsupported_api` diagnostic names both sides of the mismatch: the
 * contract Cave requires and the contract (or absence) the daemon published.
 * A well-formed but newer contract points the user at the client, since the
 * daemon is ahead of this build; anything else points at the daemon.
 */
export function unsupportedDaemonApiDiagnostic(got: unknown): string {
  const advice = typeof got === "string" && isNewerDaemonContract(got)
    ? NEWER_DAEMON_API_DIAGNOSTIC_ADVICE
    : DAEMON_API_UPDATE_DIAGNOSTIC_ADVICE;
  return `Cave requires the Coven daemon API contract ${JSON.stringify(COVEN_DAEMON_API_VERSION)}, but the running daemon published ${describeGotApiContract(got)}. ${advice}`;
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
    code: "invalid_health" | "unsupported_api" | "invalid_runtime_version";
    diagnostic: string;
  };

/**
 * A listening socket is only a transport fact. Cave adopts a local daemon
 * only after the health document identifies a supported API and a valid
 * runtime version. The CLI package and daemon runtime have independent release
 * lines, so comparing their version strings would reject a healthy daemon
 * (for example CLI 0.2.5 with daemon runtime 0.0.0). API compatibility is
 * decided against SUPPORTED_DAEMON_API_VERSIONS; any other contract is refused
 * with a diagnostic naming the wanted-versus-got contracts.
 */
export function assessDaemonStartupCompatibility(
  health: DaemonStartupHealth | null | undefined,
  _installedVersion?: string | null,
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
      diagnostic: unsupportedDaemonApiDiagnostic(apiVersion),
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

  return { ok: true, daemonVersion, apiVersion };
}
