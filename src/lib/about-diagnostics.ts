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
  executablePath?: string | null;
  packagePath?: string | null;
  installCommand?: string;
};

type InstallJobDiagnostic = {
  status: "running" | "done";
  elapsedMs: number;
  tail: string;
};

type InstallResultDiagnostic = { ok: boolean; detail: string };

const SAFE_WEB_URL = /https?:\/\/[^\s"'<>]+/gi;
const LOCAL_PATH =
  /(^|[\s"'`(<\[])(?:file:\/{2,3}(?:[A-Za-z]:[\\/]|\/)[^\s"'`<>\])}]+|\\\\[^\s"'`<>\])}]+[\\/][^\s"'`<>\])}]+|[A-Za-z]:[\\/][^\s"'`<>\])}]+|\/(?!\/)[^\s/"'`<>\])}]+(?:\/[^\s"'`<>\])}]+)*)/i;
const LOCAL_PATH_START =
  /(^|[\s"'`(<\[])(?:file:\/{2,3}(?:[A-Za-z]:[\\/]|\/)|\\\\[^\s"'`<>\])}]+[\\/]|[A-Za-z]:[\\/]|\/(?!\/)[^\s/"'`<>\])}]+\/)/i;

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

function redactLocalPaths(value: string): string {
  let remaining = value;
  let redacted = "";

  while (remaining) {
    const localPath = LOCAL_PATH.exec(remaining);
    const pathStart = LOCAL_PATH_START.exec(remaining);
    if (!localPath || !pathStart || localPath.index !== pathStart.index) {
      return redacted + remaining;
    }

    const afterStart = remaining.slice(pathStart.index + pathStart[0].length);
    const firstWhitespace = afterStart.search(/\s/);
    const nextTokenHasSlash =
      firstWhitespace >= 0 && /^\s+[^\s]*[\\/][^\s]*/.test(afterStart.slice(firstWhitespace));
    redacted += remaining.slice(0, localPath.index) + (localPath[1] ?? "") + "[local path omitted]";

    if (nextTokenHasSlash) {
      // A literal space can be part of a local path, so its end cannot be
      // inferred from prose. Deliberately sacrifice the rest of this line
      // rather than risk copying a user or directory name.
      return redacted;
    }
    remaining = remaining.slice(localPath.index + localPath[0].length);
  }

  return redacted;
}

/** Remove secrets, URL query values, and machine-local paths from short status text. */
export function sanitizeAboutDiagnosticText(value: string): string {
  const webUrls: string[] = [];
  const querySafe = value.replace(SAFE_WEB_URL, (url) => {
    webUrls.push(withoutQueryOrFragment(url));
    return `__ABOUT_WEB_URL_${webUrls.length - 1}__`;
  });

  const pathSafe = redactLocalPaths(querySafe);
  const urlSafe = pathSafe.replace(/__ABOUT_WEB_URL_(\d+)__/g, (_placeholder, index: string) => webUrls[Number(index)] ?? "unavailable");
  return redactSecretText(urlSafe).slice(0, 280);
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
    outdated: tool.outdated,
    compatible: tool.compatible,
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
