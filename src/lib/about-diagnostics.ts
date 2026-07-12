import { redactSecretText } from "./secret-redaction.ts";

type ToolDiagnostic = {
  id: string;
  label: string;
  packageName: string;
  binary: string;
  installed: boolean;
  current: string | null;
  latest: string | null;
  outdated: boolean;
  compatible: boolean;
  minimumVersion: string;
  path?: string | null;
  installCommand?: string;
};

type InstallJobDiagnostic = {
  status: "running" | "done";
  elapsedMs: number;
  tail: string;
};

type InstallResultDiagnostic = { ok: boolean; detail: string };

const LOCAL_PATH = /(?:\b[A-Za-z]:\\|(?:\/Users|\/home|\/private|\/var|\/tmp)\/)[^\s"'`<>{}\]\[,)]+/g;

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
  return redactSecretText(querySafe.replace(LOCAL_PATH, "[local path omitted]")).slice(0, 280);
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
  const tools = input.tools.map(({ path: _path, installCommand: _installCommand, ...tool }) => tool);
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
        "tool version and compatibility states",
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
