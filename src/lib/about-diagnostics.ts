import { redactSecretText } from "./secret-redaction.ts";
import type {
  NpmLatestCheck,
  NpmLatestCheckError,
  OpenCovenToolStatus,
} from "./opencoven-tools-status.ts";
import type { OpenCovenToolProbe } from "./opencoven-tool-verification.ts";

type ToolDiagnostic = Pick<
  OpenCovenToolStatus,
  | "id"
  | "label"
  | "packageName"
  | "binary"
  | "installed"
  | "current"
  | "latest"
  | "latestCheck"
  | "outdated"
  | "compatible"
  | "packageVerified"
  | "executableVerified"
  | "discoveryError"
  | "minimumVersion"
> & {
  path?: string | null;
  executablePath?: string | null;
  packagePath?: string | null;
  installCommand?: string;
};

const NPM_LATEST_CHECK_ERRORS = new Set<NpmLatestCheckError>([
  "npm_unavailable",
  "timeout",
  "registry_error",
  "malformed_version",
]);
const DISCOVERY_ERRORS = new Set<NonNullable<OpenCovenToolProbe["error"]>>([
  "version-probe-failed",
  "launcher-unreadable",
]);
const SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

function safeLatestCheck(value: NpmLatestCheck): NpmLatestCheck | null {
  if (!value || typeof value !== "object") return null;
  const checkedAt = value.checkedAt;
  if (typeof checkedAt !== "string" || !Number.isFinite(Date.parse(checkedAt))) return null;
  const normalizedCheckedAt = new Date(checkedAt).toISOString();
  if (value.status === "verified" && typeof value.latest === "string" && SEMVER.test(value.latest)) {
    return { status: "verified", checkedAt: normalizedCheckedAt, latest: value.latest };
  }
  if (value.status === "failed" && NPM_LATEST_CHECK_ERRORS.has(value.error)) {
    return { status: "failed", checkedAt: normalizedCheckedAt, error: value.error };
  }
  return null;
}

function safeDiscoveryError(value: OpenCovenToolProbe["error"] | null): OpenCovenToolProbe["error"] | null {
  return value && DISCOVERY_ERRORS.has(value) ? value : null;
}

type InstallJobDiagnostic = {
  status: "running" | "done";
  elapsedMs: number;
  tail: string;
};

type InstallResultDiagnostic = { ok: boolean; detail: string };

const LOCAL_PATH_START = /(^|[\s"'`(<\[])(?:[A-Za-z]:\\|\/(?:Users|home|private|var|tmp)\/)/i;

function withoutQueryOrFragment(value: string): string {
  try {
    const url = new URL(value);
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "unavailable";
  }
}

/** Remove secrets, URL query values, and machine-local paths from short status text. */
export function sanitizeAboutDiagnosticText(value: string): string {
  const querySafe = value.replace(/https?:\/\/[^\s"'<>]+/gi, (url) => withoutQueryOrFragment(url));
  const localPath = LOCAL_PATH_START.exec(querySafe);
  const pathSafe = localPath
    ? `${querySafe.slice(0, localPath.index)}${/\s/.test(localPath[1] ?? "") ? localPath[1] : ""}[local path omitted]`
    : querySafe;
  return redactSecretText(pathSafe).slice(0, 280);
}

/**
 * Build a support-ready snapshot without copying command output, full local
 * paths, URL query values, or credentials. The `included` and `excluded`
 * fields intentionally travel with the payload so a person can see exactly
 * what the Copy diagnostics button did before they paste it elsewhere.
 */
export function buildSafeToolDiagnostics(input: {
  tools: ToolDiagnostic[];
  checking: boolean;
  error: string | null;
  lastSuccessfulCheckedAt: string | null;
  installJobs: Partial<Record<string, InstallJobDiagnostic>>;
  installResults: Partial<Record<string, InstallResultDiagnostic>>;
  href: string;
  sidecarTokenPresent: boolean;
  tauriInternalsPresent: boolean;
}): string {
  const tools = input.tools.map((tool) => ({
    id: tool.id,
    label: tool.label,
    packageName: tool.packageName,
    binary: tool.binary,
    installed: tool.installed,
    current: tool.current,
    latest: tool.latest,
    latestCheck: safeLatestCheck(tool.latestCheck),
    outdated: tool.outdated,
    compatible: tool.compatible,
    packageVerified: tool.packageVerified === true,
    executableVerified: tool.executableVerified === true,
    discoveryError: safeDiscoveryError(tool.discoveryError),
    minimumVersion: tool.minimumVersion,
  }));
  const installJobs = Object.fromEntries(
    Object.entries(input.installJobs).map(([id, job]) => [
      id,
      job ? { status: job.status, elapsedMs: job.elapsedMs, outputCaptured: Boolean(job.tail) } : undefined,
    ]),
  );
  const installResults = Object.fromEntries(
    Object.entries(input.installResults).map(([id, result]) => [
      id,
      result ? { ok: result.ok, detail: sanitizeAboutDiagnosticText(result.detail) } : undefined,
    ]),
  );

  return JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      surface: "Settings/About/OpenCoven tools",
      included: [
        "sanitized Settings route",
        "tool version, npm freshness, compatibility, and verification states",
        "check and installer outcome summaries",
        "desktop-shell and sidecar-token presence flags",
      ],
      excluded: [
        "token values and other secret-like values",
        "URL query and fragment values",
        "local paths and install commands",
        "raw installer stdout and stderr",
      ],
      location: withoutQueryOrFragment(input.href),
      environment: {
        sidecarTokenPresent: input.sidecarTokenPresent,
        tauriInternalsPresent: input.tauriInternalsPresent,
      },
      check: {
        checking: input.checking,
        lastSuccessfulCheckedAt: input.lastSuccessfulCheckedAt,
        error: input.error ? sanitizeAboutDiagnosticText(input.error) : null,
      },
      tools,
      installJobs,
      installResults,
    },
    null,
    2,
  );
}
