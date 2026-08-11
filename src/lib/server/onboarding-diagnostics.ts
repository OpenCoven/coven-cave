import { APP_VERSION } from "@/lib/app-version";
import { sanitizeAboutDiagnosticText } from "@/lib/about-diagnostics";
import type {
  OnboardingBootstrapStageId,
  OnboardingComponentReadiness,
  OnboardingSetupDiagnostics,
  OnboardingSetupFailureCode,
} from "@/lib/onboarding-bootstrap";
export { probeOwnedDirectoryWrite } from "@/lib/server/owned-directory-write";

const DIAGNOSTIC_LINE_CAP = 8;
const DIAGNOSTIC_TEXT_CAP = 1_600;
const SENSITIVE_HEADER_LINE =
  /^\s*(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-auth-token)\s*:/i;
const SAFE_INSTALL_ERROR_CODE =
  /\b(?:EACCES|EAGAIN|EAI_AGAIN|EBUSY|ECONNREFUSED|ECONNRESET|EEXIST|EHOSTUNREACH|EINTEGRITY|EISDIR|EMFILE|ENFILE|ENOENT|ENOSPC|ENOTDIR|ENETUNREACH|EPERM|EPIPE|EROFS|ETIMEDOUT|EXDEV|EUNKNOWN)\b/g;
const FAILURE_CODES = new Set<OnboardingSetupFailureCode>([
  "application_data_not_writable",
  "filesystem_failed",
  "download_failed",
  "integrity_check_failed",
  "archive_failed",
  "install_busy",
  "install_timeout",
  "verification_failed",
  "unsupported_platform",
  "installer_start_failed",
  "local_service_failed",
  "unknown_failure",
]);
const STAGES = new Set<OnboardingBootstrapStageId>([
  "core-tools",
  "workspace",
  "daemon",
]);
const READINESS = new Set<OnboardingComponentReadiness>([
  "ready",
  "missing",
  "incompatible",
  "unusable",
  "not_ready",
  "not_checked",
  "unknown",
]);

const FAILURE_COPY: Record<
  OnboardingSetupFailureCode,
  { summary: string; nextStep: string }
> = {
  application_data_not_writable: {
    summary: "Cave couldn’t write to its application-data folder.",
    nextStep: "Check that the folder is available to your user account, then retry setup.",
  },
  filesystem_failed: {
    summary: "Cave couldn’t update files needed for setup.",
    nextStep: "Close other setup or installer processes, check the affected user-scoped location, then retry setup.",
  },
  download_failed: {
    summary: "Cave couldn’t download its local components.",
    nextStep: "Check your connection, then retry setup.",
  },
  integrity_check_failed: {
    summary: "Cave rejected a local component because its integrity check failed.",
    nextStep: "Retry setup. If it happens again, copy these diagnostics for support.",
  },
  archive_failed: {
    summary: "Cave couldn’t unpack a verified local component.",
    nextStep: "Retry setup. If it happens again, copy these diagnostics for support.",
  },
  install_busy: {
    summary: "Another process or Cave window is preparing local components.",
    nextStep: "Wait for it to finish or close the conflicting process, then retry setup.",
  },
  install_timeout: {
    summary: "Preparing Cave’s local components timed out.",
    nextStep: "Retry setup. If the installer remains busy, restart Cave first.",
  },
  verification_failed: {
    summary: "Cave couldn’t verify the local components after installation.",
    nextStep: "Restart Cave, then retry setup.",
  },
  unsupported_platform: {
    summary: "This build can’t prepare Cave’s local components on this platform.",
    nextStep: "Use a supported desktop build, then retry setup.",
  },
  installer_start_failed: {
    summary: "Cave couldn’t start the local component installer.",
    nextStep: "Wait a moment, then retry setup.",
  },
  local_service_failed: {
    summary: "Cave couldn’t start its local service.",
    nextStep: "Restart Cave, then retry setup.",
  },
  unknown_failure: {
    summary: "Cave couldn’t finish this setup step.",
    nextStep: "Retry setup. If it happens again, copy these diagnostics for support.",
  },
};

export function isOnboardingSetupFailureCode(
  value: unknown,
): value is OnboardingSetupFailureCode {
  return typeof value === "string" &&
    FAILURE_CODES.has(value as OnboardingSetupFailureCode);
}

export function onboardingFailureCopy(code: OnboardingSetupFailureCode): {
  summary: string;
  nextStep: string;
} {
  return FAILURE_COPY[code];
}

function sanitizedDiagnosticLines(
  value: unknown,
  lineCap: number,
  textCap: number,
): string[] {
  if (typeof value !== "string") return [];
  const sanitized = value
    .split(/\r?\n/)
    .filter((line) => !SENSITIVE_HEADER_LINE.test(line))
    .map((line) => {
      const safeCodes = [...new Set(line.match(SAFE_INSTALL_ERROR_CODE) ?? [])];
      const safeText = sanitizeAboutDiagnosticText(line).trim();
      const missingCodes = safeCodes.filter((code) => !safeText.includes(code));
      return `${missingCodes.join(" ")}${missingCodes.length > 0 && safeText ? " " : ""}${safeText}`
        .slice(0, 280);
    })
    .filter(Boolean)
    .slice(-lineCap);
  const retained: string[] = [];
  let remaining = textCap;
  for (const line of sanitized.reverse()) {
    if (remaining <= 0) break;
    const separatorLength = retained.length > 0 ? 1 : 0;
    const next = line.slice(0, Math.max(0, remaining - separatorLength));
    if (!next) break;
    retained.unshift(next);
    remaining -= next.length + separatorLength;
  }
  return retained;
}

export function sanitizeOnboardingDiagnosticLines(value: unknown): string[] {
  return sanitizedDiagnosticLines(
    value,
    DIAGNOSTIC_LINE_CAP,
    DIAGNOSTIC_TEXT_CAP,
  );
}

function safePlatform(): OnboardingSetupDiagnostics["environment"]["platform"] {
  return process.platform === "win32" ||
    process.platform === "darwin" ||
    process.platform === "linux"
    ? process.platform
    : "unsupported";
}

function safeArchitecture(): OnboardingSetupDiagnostics["environment"]["architecture"] {
  return process.arch === "x64" || process.arch === "arm64"
    ? process.arch
    : "other";
}

function finiteNonnegative(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : null;
}

function installerStatus(
  value: unknown,
): NonNullable<OnboardingSetupDiagnostics["installer"]>["status"] {
  return value === "idle" || value === "running" || value === "done"
    ? value
    : "unavailable";
}

export type OnboardingInstallerDiagnosticSource = {
  status?: unknown;
  code?: unknown;
  exitCode?: unknown;
  elapsedMs?: unknown;
  tail?: unknown;
  outputTail?: unknown;
  diagnosticTrace?: unknown;
};

export function diagnosticInstaller(
  target: "managed-node" | "coven-cli",
  view: OnboardingInstallerDiagnosticSource | null,
  statusOverride?: "busy",
): NonNullable<OnboardingSetupDiagnostics["installer"]> {
  const exitCode =
    target === "coven-cli" &&
    typeof (view?.code ?? view?.exitCode) === "number" &&
    Number.isInteger(view?.code ?? view?.exitCode)
      ? (view?.code ?? view?.exitCode) as number
      : null;
  const output = Array.isArray(view?.outputTail)
    ? view.outputTail.filter((line): line is string => typeof line === "string").join("\n")
    : view?.tail;
  const trace = Array.isArray(view?.diagnosticTrace)
    ? view.diagnosticTrace
        .filter((line): line is string => typeof line === "string")
        .join("\n")
    : "";
  const traceLines = sanitizedDiagnosticLines(trace, 4, 600);
  const traceLength = traceLines.join("\n").length;
  const outputTextCap = traceLines.length > 0
    ? Math.max(0, DIAGNOSTIC_TEXT_CAP - traceLength - 1)
    : DIAGNOSTIC_TEXT_CAP;
  const outputLines = sanitizedDiagnosticLines(
    output,
    traceLines.length > 0 ? 4 : DIAGNOSTIC_LINE_CAP,
    outputTextCap,
  );
  return {
    target,
    status: statusOverride ?? installerStatus(view?.status),
    elapsedMs: finiteNonnegative(view?.elapsedMs),
    exitCode,
    outputTail: [...traceLines, ...outputLines],
  };
}

export function createOnboardingSetupDiagnostics(input: {
  stage: OnboardingBootstrapStageId;
  code: OnboardingSetupFailureCode;
  capturedAt?: string;
  applicationData?: {
    exists: boolean | null;
    writeProbe: "passed" | "failed" | "not_run";
  };
  components?: Partial<{
    managedNode: OnboardingComponentReadiness;
    covenCli: OnboardingComponentReadiness;
    localService: OnboardingComponentReadiness;
  }>;
  installer?: NonNullable<OnboardingSetupDiagnostics["installer"]>;
}): OnboardingSetupDiagnostics {
  const copy = onboardingFailureCopy(input.code);
  return {
    version: 1,
    capturedAt: input.capturedAt ?? new Date().toISOString(),
    stage: input.stage,
    code: input.code,
    summary: copy.summary,
    nextStep: copy.nextStep,
    environment: {
      appVersion: APP_VERSION,
      platform: safePlatform(),
      architecture: safeArchitecture(),
    },
    applicationData: {
      displayLocation: "Cave application data",
      exists: input.applicationData?.exists ?? null,
      writeProbe: input.applicationData?.writeProbe ?? "not_run",
    },
    components: {
      managedNode: input.components?.managedNode ?? "unknown",
      covenCli: input.components?.covenCli ?? "unknown",
      localService: input.components?.localService ?? "not_checked",
    },
    ...(input.installer ? { installer: input.installer } : {}),
  };
}

function safeReadiness(value: unknown): OnboardingComponentReadiness {
  return typeof value === "string" &&
    READINESS.has(value as OnboardingComponentReadiness)
    ? (value as OnboardingComponentReadiness)
    : "unknown";
}

/**
 * Persisted bootstrap state is user-writable. Rebuild diagnostics from a strict
 * allowlist before returning it through the local status API so hand-edited or
 * legacy state can never smuggle raw paths, environment values, or unbounded
 * output into the display/copy surface.
 */
export function normalizePersistedOnboardingSetupDiagnostics(
  value: unknown,
): OnboardingSetupDiagnostics | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (source.version !== 1) return null;
  if (
    typeof source.stage !== "string" ||
    !STAGES.has(source.stage as OnboardingBootstrapStageId) ||
    typeof source.code !== "string" ||
    !FAILURE_CODES.has(source.code as OnboardingSetupFailureCode)
  ) {
    return null;
  }

  const environment = statusBody(source.environment);
  const applicationData = statusBody(source.applicationData);
  const components = statusBody(source.components);
  if (!environment || !applicationData || !components) return null;
  if (
    typeof source.capturedAt !== "string" ||
    !Number.isFinite(Date.parse(source.capturedAt))
  ) {
    return null;
  }
  const captured = new Date(source.capturedAt).toISOString();
  const writeProbe =
    applicationData.writeProbe === "passed" ||
    applicationData.writeProbe === "failed" ||
    applicationData.writeProbe === "not_run"
      ? applicationData.writeProbe
      : "not_run";
  const exists =
    typeof applicationData.exists === "boolean"
      ? applicationData.exists
      : null;
  const installerSource = statusBody(source.installer);
  const target =
    installerSource?.target === "managed-node" ||
    installerSource?.target === "coven-cli"
      ? installerSource.target
      : null;
  const installer = target
    ? diagnosticInstaller(target, installerSource, installerSource?.status === "busy" ? "busy" : undefined)
    : undefined;

  const code = source.code === "application_data_not_writable" && writeProbe !== "failed"
    ? "filesystem_failed"
    : source.code as OnboardingSetupFailureCode;

  return createOnboardingSetupDiagnostics({
    stage: source.stage as OnboardingBootstrapStageId,
    code,
    capturedAt: captured,
    applicationData: { exists, writeProbe },
    components: {
      managedNode: safeReadiness(components.managedNode),
      covenCli: safeReadiness(components.covenCli),
      localService: safeReadiness(components.localService),
    },
    ...(installer ? { installer } : {}),
  });
}

function statusBody(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
