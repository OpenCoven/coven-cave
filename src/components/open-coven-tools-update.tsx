"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/lib/icon";
import { useShellBanners } from "@/lib/shell-banners";

type InstallTarget = "coven-cli" | "coven-code";

type ToolStatus = {
  id: InstallTarget;
  label: string;
  packageName: string;
  binary: string;
  installed: boolean;
  path: string | null;
  current: string | null;
  latest: string | null;
  outdated: boolean;
  compatible: boolean;
  minimumVersion: string;
  installCommand: string;
};

type InstallJobView = {
  status: "running" | "done";
  elapsedMs: number;
  tail: string;
  ok?: boolean;
  binaryPath?: string | null;
  error?: string;
};

type InstallResult = {
  ok: boolean;
  detail: string;
};

type NpmLaneState = {
  target: string;
  label: string;
};

const SIDECAR_TOKEN_STORAGE_KEY = "coven-cave:sidecar-auth-token";
const TOOL_UPDATE_BANNER_ID = "opencoven-tools-update";
const TOOL_DISMISS_KEY = (tools: ToolStatus[]) =>
  `coven-cave:tool-update:dismissed:${tools
    .map((tool) => `${tool.id}:${tool.latest ?? tool.current ?? tool.minimumVersion}`)
    .sort()
    .join("|")}`;

function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes > 0 ? `${minutes}m ${rest}s` : `${rest}s`;
}

function isInstallTarget(id: string): id is InstallTarget {
  return id === "coven-cli" || id === "coven-code";
}

function toolVersionText(tool: ToolStatus): string {
  if (!tool.installed) return "Not installed";
  if (!tool.current) return "Installed, version unknown";
  return tool.outdated ? `${tool.current} -> ${tool.latest}` : tool.current;
}

function toolStatusText(tool: ToolStatus): string {
  if (!tool.installed) return "Not found";
  if (!tool.current) return "Version unknown";
  if (!tool.compatible) return "Needs update";
  return "Up to date";
}

function toolNeedsCompatibilityUpdate(tool: ToolStatus): boolean {
  return tool.installed && Boolean(tool.current) && !tool.compatible;
}

function toolCompatibilityText(tool: ToolStatus): string | null {
  if (!toolNeedsCompatibilityUpdate(tool)) return null;
  return `Requires >= ${tool.minimumVersion}`;
}

function dismissedToolBanner(tools: ToolStatus[]): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(TOOL_DISMISS_KEY(tools)) === "1";
  } catch {
    return false;
  }
}

function dismissToolBanner(tools: ToolStatus[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TOOL_DISMISS_KEY(tools), "1");
  } catch {
    /* private mode */
  }
}

function buildDiagnosticsText({
  tools,
  checking,
  error,
  installJobs,
  installResults,
  href,
  userAgent,
  sidecarTokenPresent,
  tauriInternalsPresent,
}: {
  tools: ToolStatus[];
  checking: boolean;
  error: string | null;
  installJobs: Partial<Record<InstallTarget, InstallJobView>>;
  installResults: Partial<Record<InstallTarget, InstallResult>>;
  href: string;
  userAgent: string;
  sidecarTokenPresent: boolean;
  tauriInternalsPresent: boolean;
}): string {
  return JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      surface: "Settings/About/OpenCoven tools",
      location: href,
      userAgent,
      sidecarTokenPresent,
      tauriInternalsPresent,
      checking,
      error,
      tools,
      installJobs,
      installResults,
    },
    null,
    2,
  );
}

export function OpenCovenToolsBannerTrigger() {
  const { pushBanner, dismissBanner } = useShellBanners();

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/opencoven-tools/status", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) return null;
        return (await res.json()) as { ok?: boolean; tools?: ToolStatus[] };
      })
      .then((json) => {
        if (cancelled || !json?.ok) return;
        const tools = (json.tools ?? []).filter((tool) => isInstallTarget(tool.id));
        const incompatibleTools = tools.filter(toolNeedsCompatibilityUpdate);
        const outdatedTools = tools.filter((tool) => tool.compatible && tool.outdated);
        const bannerTools = incompatibleTools.length > 0 ? incompatibleTools : outdatedTools;
        if (bannerTools.length === 0 || dismissedToolBanner(bannerTools)) return;
        const label = bannerTools.map((tool) => tool.label).join(", ");
        const detail =
          incompatibleTools.length > 0
            ? `${label} must be updated for this Cave build.`
            : `New ${label} release available.`;
        pushBanner({
          id: TOOL_UPDATE_BANNER_ID,
          severity: incompatibleTools.length > 0 ? "warning" : "info",
          title: detail,
          cta: {
            label: "Review tools",
            onClick: () => {
              window.location.assign("/settings#about");
            },
          },
          onDismiss: () => dismissToolBanner(bannerTools),
        });
      })
      .catch(() => {
        /* Update checks are best-effort. */
      });
    return () => {
      cancelled = true;
      dismissBanner(TOOL_UPDATE_BANNER_ID);
    };
  }, [pushBanner, dismissBanner]);

  return null;
}

export function OpenCovenToolsUpdate() {
  const [tools, setTools] = useState<ToolStatus[]>([]);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [diagnosticsStatus, setDiagnosticsStatus] = useState<
    "idle" | "copied" | "failed"
  >("idle");
  const [copiedCommand, setCopiedCommand] = useState<InstallTarget | null>(null);
  const [installJobs, setInstallJobs] = useState<
    Partial<Record<InstallTarget, InstallJobView>>
  >({});
  const [installResults, setInstallResults] = useState<
    Partial<Record<InstallTarget, InstallResult>>
  >({});
  const [npmLane, setNpmLane] = useState<NpmLaneState | null>(null);
  const mounted = useRef(true);

  const refreshNpmLane = useCallback(async () => {
    try {
      const res = await fetch("/api/onboarding/install", { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as {
        npmBusy?: boolean;
        npmBusyTarget?: string | null;
        npmBusyLabel?: string | null;
      };
      if (!mounted.current) return;
      setNpmLane(
        json.npmBusy && json.npmBusyTarget
          ? {
              target: json.npmBusyTarget,
              label: json.npmBusyLabel ?? json.npmBusyTarget,
            }
          : null,
      );
    } catch {
      /* A later poll will reconcile the shared lane. */
    }
  }, []);

  const load = useCallback(async () => {
    setChecking(true);
    setError(null);
    try {
      const res = await fetch("/api/opencoven-tools/status", { cache: "no-store" });
      const json = (await res.json()) as {
        ok?: boolean;
        tools?: ToolStatus[];
        error?: string;
      };
      if (!res.ok || json.ok === false) {
        throw new Error(json.error ?? "tool check failed");
      }
      if (mounted.current) {
        setTools((json.tools ?? []).filter((tool) => isInstallTarget(tool.id)));
      }
    } catch (err) {
      if (mounted.current) {
        setError(err instanceof Error ? err.message : "tool check failed");
      }
    } finally {
      if (mounted.current) setChecking(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void load();
    void refreshNpmLane();
    const pollLane = setInterval(() => void refreshNpmLane(), 2000);
    return () => {
      mounted.current = false;
      clearInterval(pollLane);
    };
  }, [load, refreshNpmLane]);

  const runningInstallKey = useMemo(
    () =>
      (Object.entries(installJobs) as [InstallTarget, InstallJobView][])
        .filter(([, job]) => job.status === "running")
        .map(([target]) => target)
        .sort()
        .join(","),
    [installJobs],
  );

  useEffect(() => {
    if (!runningInstallKey) return;
    const targets = runningInstallKey.split(",") as InstallTarget[];
    let cancelled = false;
    const tick = async () => {
      for (const target of targets) {
        try {
          const res = await fetch(
            `/api/onboarding/install?target=${encodeURIComponent(target)}`,
          );
          if (!res.ok || cancelled) continue;
          const json = (await res.json()) as { status: "idle" } | InstallJobView;
          if (cancelled) return;
          if (json.status === "idle") {
            setInstallJobs((prev) => {
              const next = { ...prev };
              delete next[target];
              return next;
            });
            await load();
            continue;
          }
          setInstallJobs((prev) => ({ ...prev, [target]: json }));
          if (json.status === "done") {
            setInstallResults((prev) => ({
              ...prev,
              [target]: json.ok
                ? {
                    ok: true,
                    detail: json.binaryPath
                      ? `updated at ${json.binaryPath}`
                      : "updated",
                  }
                : { ok: false, detail: json.error ?? "update failed" },
            }));
            await load();
          }
        } catch {
          /* transient poll failure; next tick retries */
        }
      }
    };
    void tick();
    const id = setInterval(() => void tick(), 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [load, runningInstallKey]);

  const updateTool = async (target: InstallTarget) => {
    setError(null);
    setInstallResults((prev) => {
      const next = { ...prev };
      delete next[target];
      return next;
    });
    try {
      const res = await fetch("/api/onboarding/install", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        status?: string;
        elapsedMs?: number;
        tail?: string;
        npmMissing?: boolean;
        hint?: string;
        error?: string;
        npmBusy?: boolean;
        npmBusyTarget?: string | null;
        npmBusyLabel?: string | null;
      };
      if (json.npmBusy && json.npmBusyTarget) {
        setNpmLane({
          target: json.npmBusyTarget,
          label: json.npmBusyLabel ?? json.npmBusyTarget,
        });
      }
      if (!res.ok || json.npmMissing) {
        setInstallResults((prev) => ({
          ...prev,
          [target]: {
            ok: false,
            detail:
              json.hint ??
              json.error ??
              "update failed to start",
          },
        }));
        return;
      }
      setInstallJobs((prev) => ({
        ...prev,
        [target]:
          json.status === "running" && typeof json.elapsedMs === "number"
            ? { status: "running", elapsedMs: json.elapsedMs, tail: json.tail ?? "" }
            : { status: "running", elapsedMs: 0, tail: "" },
      }));
    } catch (err) {
      setInstallResults((prev) => ({
        ...prev,
        [target]: {
          ok: false,
          detail: err instanceof Error ? err.message : "update failed",
        },
      }));
    }
  };

  const copyCommand = async (tool: ToolStatus) => {
    try {
      await navigator.clipboard.writeText(tool.installCommand);
      setCopiedCommand(tool.id);
      window.setTimeout(() => setCopiedCommand(null), 1800);
    } catch {
      setInstallResults((prev) => ({
        ...prev,
        [tool.id]: { ok: false, detail: "command copy failed" },
      }));
    }
  };

  const copyDiagnostics = async () => {
    try {
      const text = buildDiagnosticsText({
        tools,
        checking,
        error,
        installJobs,
        installResults,
        href: window.location.href,
        userAgent: navigator.userAgent,
        sidecarTokenPresent: Boolean(
          window.sessionStorage.getItem(SIDECAR_TOKEN_STORAGE_KEY),
        ),
        tauriInternalsPresent: "__TAURI_INTERNALS__" in window,
      });
      await navigator.clipboard.writeText(text);
      setDiagnosticsStatus("copied");
      window.setTimeout(() => setDiagnosticsStatus("idle"), 1800);
    } catch {
      setDiagnosticsStatus("failed");
      window.setTimeout(() => setDiagnosticsStatus("idle"), 1800);
    }
  };

  const toolActionBtn =
    "settings-tool-action gap-1.5 rounded-[var(--radius-control)] text-[11px]";
  const accentBtn =
    `${toolActionBtn} settings-tool-action--primary bg-[var(--accent-presence)] px-3 font-semibold text-[var(--accent-presence-foreground)] disabled:opacity-50`;
  const ghostBtn =
    `${toolActionBtn} border border-[var(--border-hairline)] px-2.5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]`;
  const footerStatusText =
    diagnosticsStatus === "copied"
      ? "Diagnostics copied"
      : diagnosticsStatus === "failed"
        ? "Diagnostics copy failed"
        : error
          ? `Check failed: ${error}`
          : checking
            ? "Checking tools..."
            : "Version source: npm latest";

  return (
    <>
      {npmLane ? (
        <p
          role="status"
          className="px-4 pt-3 text-[11px] text-[var(--text-secondary)]"
        >
          {npmLane.label} is updating the shared global npm directory. Other npm updates are disabled until it finishes.
        </p>
      ) : null}
      {tools.map((tool) => {
        const job = installJobs[tool.id];
        const busy = job?.status === "running";
        const updatingElsewhere = !busy && npmLane?.target === tool.id;
        const blockedByGlobalNpm = Boolean(npmLane && npmLane.target !== tool.id);
        const result = installResults[tool.id];
        return (
          <div key={tool.id} className="flex items-center justify-between gap-4 px-4 py-3">
            <div className="min-w-0">
              <p className="text-[12px] text-[var(--text-secondary)]">{tool.label}</p>
              <p className="truncate font-mono text-[11px] text-[var(--text-muted)]">
                {toolVersionText(tool)}
              </p>
              {toolCompatibilityText(tool) ? (
                <p className="mt-1 text-[11px] text-[var(--color-warning)]">
                  {toolCompatibilityText(tool)}
                </p>
              ) : null}
              {result ? (
                <p
                  className={`mt-1 text-[11px] ${
                    result.ok ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"
                  }`}
                >
                  {result.detail}
                </p>
              ) : null}
              {busy && job?.tail ? (
                <pre className="mt-2 max-h-24 overflow-auto whitespace-pre-wrap break-all rounded-[var(--radius-control)] border border-[var(--border-hairline)] bg-[var(--bg-base)] px-3 py-2 font-mono text-[11px] leading-4 text-[var(--text-muted)]">
                  {job.tail}
                </pre>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {busy ? (
                <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--text-muted)]">
                  <Icon name="ph:circle-notch-bold" className="animate-spin" width={12} />
                  Updating... {formatElapsed(job.elapsedMs)}
                </span>
              ) : updatingElsewhere ? (
                <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--text-muted)]">
                  <Icon name="ph:circle-notch-bold" className="animate-spin" width={12} />
                  Updating in another Cave window
                </span>
              ) : tool.outdated || toolNeedsCompatibilityUpdate(tool) ? (
                <Button
                  variant="primary"
                  size="xs"
                  onClick={() => void updateTool(tool.id)}
                  disabled={blockedByGlobalNpm}
                  title={
                    blockedByGlobalNpm
                      ? `Wait for ${npmLane?.label} to finish updating npm.`
                      : undefined
                  }
                  className={accentBtn}
                  leadingIcon="ph:arrow-down-bold"
                >
                  {blockedByGlobalNpm ? `Waiting for ${npmLane?.label}` : `Update ${tool.label}`}
                </Button>
              ) : (
                <span className="text-[12px] text-[var(--text-muted)]">
                  {toolStatusText(tool)}
                </span>
              )}
              {!busy && !updatingElsewhere ? (
                <Button
                  variant="secondary"
                  size="xs"
                  onClick={() => void copyCommand(tool)}
                  className={ghostBtn}
                  aria-live="polite"
                  leadingIcon={copiedCommand === tool.id ? "ph:check-bold" : "ph:terminal-window"}
                >
                  {copiedCommand === tool.id ? "Copied" : "Copy command"}
                </Button>
              ) : null}
            </div>
          </div>
        );
      })}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <span className="text-[12px] text-[var(--text-secondary)]">
          {footerStatusText}
        </span>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="xs"
            onClick={() => void copyDiagnostics()}
            className={`${ghostBtn} cave-fill-btn`}
            data-state={diagnosticsStatus}
            aria-live="polite"
            leadingIcon={
              diagnosticsStatus === "copied"
                ? "ph:check-bold"
                : diagnosticsStatus === "failed"
                  ? "ph:warning"
                  : "ph:copy"
            }
          >
            {diagnosticsStatus === "copied"
              ? "Copied"
              : diagnosticsStatus === "failed"
                ? "Copy failed"
                : "Copy diagnostics"}
          </Button>
          <Button variant="secondary" size="xs" onClick={() => void load()} className={ghostBtn} disabled={checking}>
            Check tools
          </Button>
        </div>
      </div>
    </>
  );
}
