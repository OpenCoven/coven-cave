"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/lib/icon";
import {
  latestCheckText,
  toolFooterStatusText,
  toolStatusText,
  type LatestCheckDisplay,
} from "@/lib/opencoven-tools-status-display";
import { useShellBanners } from "@/lib/shell-banners";
import { buildSafeToolDiagnostics } from "@/lib/about-diagnostics";
import {
  openCovenToolActionLabel,
  openCovenToolPresentation,
  type OpenCovenToolAction,
  type OpenCovenToolState,
} from "@/lib/opencoven-tools-state";
import { relativeTime } from "@/lib/relative-time";

type InstallTarget = "coven-cli" | "coven-code";

type ToolStatus = {
  id: InstallTarget;
  label: string;
  packageName: string;
  binary: string;
  installed: boolean;
  path: string | null;
  executablePath: string | null;
  current: string | null;
  latest: string | null;
  latestCheck: LatestCheckDisplay;
  outdated: boolean;
  compatible: boolean;
  state: OpenCovenToolState;
  packageVerified: boolean;
  executableVerified: boolean;
  packagePath: string | null;
  discoveryError: "version-probe-failed" | "launcher-unreadable" | null;
  minimumVersion: string;
  installCommand: string;
  checkedAt: string;
};

type InstallVerification = {
  path: string | null;
  current: string | null;
  latest: string | null;
  packageVerified: boolean;
  compatible: boolean;
  latestSatisfied: boolean | null;
  ok: boolean;
  error?: string;
};

type InstallJobView = {
  status: "running" | "done";
  elapsedMs: number;
  tail: string;
  ok?: boolean;
  verification?: InstallVerification;
  error?: string;
  daemon?: {
    wasRunning: boolean;
    phase:
      | "checking"
      | "not-running"
      | "stopping"
      | "stopped"
      | "stop-failed"
      | "installing"
      | "restarting"
      | "healthy"
      | "recovery-failed";
    health: "running" | "stopped" | "unknown";
    detail?: string;
  };
  action?: OpenCovenToolAction;
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
const TOOL_UPDATE_RECHECK_EVENT = "coven-cave:opencoven-tools-status-changed";
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

function daemonLifecycleText(daemon: NonNullable<InstallJobView["daemon"]>): string {
  switch (daemon.phase) {
    case "checking":
      return "Checking local daemon health";
    case "not-running":
      return daemon.health === "stopped"
        ? "Local daemon was already stopped; it will remain stopped"
        : "Local daemon state was unavailable; Cave will not start it automatically";
    case "stopping":
      return "Stopping local daemon before the CLI update";
    case "stopped":
      return "Local daemon stopped; preparing the CLI update";
    case "stop-failed":
      return "Local daemon is still running; update was not started";
    case "installing":
      return "Updating CLI; local daemon will restart afterward";
    case "restarting":
      return "Refreshing CLI environment and restarting local daemon";
    case "healthy":
      return "Local daemon restarted and healthy";
    case "recovery-failed":
      return "Local daemon recovery failed";
  }
}

function successfulInstallDetail(
  target: InstallTarget,
  job: InstallJobView,
  result = "updated",
): string {
  if (target !== "coven-cli" || !job.daemon) return result;
  if (job.daemon.phase === "healthy") return `${result}; local daemon restarted and healthy`;
  if (job.daemon.phase === "not-running") return `${result}; local daemon remained stopped`;
  return `${result}; daemon health: ${job.daemon.health}`;
}

function isInstallTarget(id: string): id is InstallTarget {
  return id === "coven-cli" || id === "coven-code";
}

function toolNeedsCompatibilityUpdate(tool: ToolStatus): boolean {
  return tool.installed && (!tool.packageVerified || !tool.current || !tool.compatible);
}

function toolCompatibilityText(tool: ToolStatus): string | null {
  if (!tool.installed) return null;
  if (!tool.packageVerified) return `Expected ${tool.packageName}`;
  if (!tool.current) return "Version probe failed";
  if (!toolNeedsCompatibilityUpdate(tool)) return null;
  return `Requires >= ${tool.minimumVersion}`;
}

function installResultFromCompletion(
  target: InstallTarget,
  job: InstallJobView,
  rechecked: ToolStatus | undefined,
): InstallResult {
  if (!job.ok) return { ok: false, detail: job.error ?? "update failed" };
  const verification = job.verification;
  if (!verification || !verification.ok) {
    return { ok: false, detail: verification?.error ?? "post-install verification failed" };
  }
  if (!rechecked || rechecked.latestCheck.status !== "verified") {
    return {
      ok: false,
      detail: "Post-install recheck could not verify npm latest. Check the network or registry, then retry.",
    };
  }
  const consistent =
    rechecked.path === verification.path &&
    rechecked.current === verification.current &&
    rechecked.latest === verification.latest &&
    rechecked.packageVerified &&
    rechecked.compatible &&
    !rechecked.outdated;
  if (!consistent) {
    const current = rechecked.current ? ` (${rechecked.current})` : "";
    return {
      ok: false,
      detail: `Post-install recheck now resolves a different executable${current}. Retry after fixing PATH precedence.`,
    };
  }
  return {
    ok: true,
    detail: successfulInstallDetail(target, job, `Verified ${verification.current}`),
  };
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
  lastSuccessfulCheckedAt,
  installJobs,
  installResults,
  href,
  sidecarTokenPresent,
  tauriInternalsPresent,
}: {
  tools: ToolStatus[];
  checking: boolean;
  error: string | null;
  lastSuccessfulCheckedAt: string | null;
  installJobs: Partial<Record<InstallTarget, InstallJobView>>;
  installResults: Partial<Record<InstallTarget, InstallResult>>;
  href: string;
  sidecarTokenPresent: boolean;
  tauriInternalsPresent: boolean;
}): string {
  return buildSafeToolDiagnostics({
    tools,
    checking,
    error,
    lastSuccessfulCheckedAt,
    installJobs,
    installResults,
    href,
    sidecarTokenPresent,
    tauriInternalsPresent,
  });
}

export function OpenCovenToolsBannerTrigger() {
  const { pushBanner, dismissBanner } = useShellBanners();

  useEffect(() => {
    let cancelled = false;
    const refreshBanner = () => {
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
          if (bannerTools.length === 0) {
            dismissBanner(TOOL_UPDATE_BANNER_ID);
            return;
          }
          if (dismissedToolBanner(bannerTools)) return;
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
    };
    refreshBanner();
    window.addEventListener(TOOL_UPDATE_RECHECK_EVENT, refreshBanner);
    return () => {
      cancelled = true;
      window.removeEventListener(TOOL_UPDATE_RECHECK_EVENT, refreshBanner);
      dismissBanner(TOOL_UPDATE_BANNER_ID);
    };
  }, [pushBanner, dismissBanner]);

  return null;
}

export function OpenCovenToolsUpdate() {
  const { dismissBanner } = useShellBanners();
  const [tools, setTools] = useState<ToolStatus[]>([]);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [lastSuccessfulCheckedAt, setLastSuccessfulCheckedAt] = useState<string | null>(null);
  const [lastCheckError, setLastCheckError] = useState<string | null>(null);
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

  const load = useCallback(async (): Promise<ToolStatus[] | null> => {
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
      const nextTools = (json.tools ?? []).filter((tool) => isInstallTarget(tool.id));
      if (mounted.current) {
        setTools(nextTools);
        setStale(false);
        setLastSuccessfulCheckedAt(nextTools[0]?.checkedAt ?? new Date().toISOString());
        setLastCheckError(null);
        if (!nextTools.some((tool) => tool.outdated || toolNeedsCompatibilityUpdate(tool))) {
          dismissBanner(TOOL_UPDATE_BANNER_ID);
        }
      }
      return nextTools;
    } catch (err) {
      if (mounted.current) {
        const message = err instanceof Error ? err.message : "tool check failed";
        setError(message);
        setLastCheckError(message);
        // A failed refresh cannot leave prior rows looking fresh.
        setStale(true);
      }
      return null;
    } finally {
      if (mounted.current) setChecking(false);
    }
  }, [dismissBanner]);

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
          setInstallJobs((prev) => ({
            ...prev,
            [target]: { ...json, action: prev[target]?.action },
          }));
          if (json.status === "done") {
            const refreshed = await load();
            const result = installResultFromCompletion(
              target,
              json,
              refreshed?.find((tool) => tool.id === target),
            );
            setInstallResults((prev) => ({
              ...prev,
              [target]: result,
            }));
            if (result.ok && refreshed) {
              window.dispatchEvent(new Event(TOOL_UPDATE_RECHECK_EVENT));
            }
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

  const updateTool = async (target: InstallTarget, action: OpenCovenToolAction) => {
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
            ? {
                status: "running",
                elapsedMs: json.elapsedMs,
                tail: json.tail ?? "",
                action,
              }
            : { status: "running", elapsedMs: 0, tail: "", action },
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
        lastSuccessfulCheckedAt,
        installJobs,
        installResults,
        href: window.location.href,
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
        : checking
          ? lastSuccessfulCheckedAt
            ? `Checking tools — last known ${relativeTime(lastSuccessfulCheckedAt)}`
            : "Checking tools..."
          : lastCheckError
            ? lastSuccessfulCheckedAt
              ? `Stale data from ${relativeTime(lastSuccessfulCheckedAt)} — check failed: ${lastCheckError}`
              : `Couldn't check tools: ${lastCheckError}`
            : toolFooterStatusText({ tools, checking, error, stale });

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
        const presentation = openCovenToolPresentation(tool);
        const stateStatusText =
          presentation.state === "current" || presentation.state === "latest-unknown"
            ? toolStatusText(tool, stale)
            : presentation.statusText;
        const job = installJobs[tool.id];
        const busy = job?.status === "running";
        const updatingElsewhere = !busy && npmLane?.target === tool.id;
        const blockedByGlobalNpm = Boolean(npmLane && npmLane.target !== tool.id);
        const result = installResults[tool.id];
        const daemon = job?.daemon;
        return (
          <div
            key={tool.id}
            data-tool-state={presentation.state}
            className="flex items-center justify-between gap-4 px-4 py-3"
          >
            <div className="min-w-0">
              <p className="text-[12px] text-[var(--text-secondary)]">{tool.label}</p>
              <p className="truncate font-mono text-[11px] text-[var(--text-muted)]">
                {presentation.versionText}
              </p>
              <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                {stateStatusText}
              </p>
              {toolCompatibilityText(tool) ? (
                <p className="mt-1 text-[11px] text-[var(--color-warning)]">
                  {toolCompatibilityText(tool)}
                </p>
              ) : null}
              <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                {latestCheckText(tool, stale)}
              </p>
              {stale && lastSuccessfulCheckedAt ? (
                <p className="mt-1 text-[11px] text-[var(--color-warning)]">
                  Last known · {relativeTime(lastSuccessfulCheckedAt)}
                </p>
              ) : null}
              {result ? (
                <p
                  aria-live="polite"
                  className={`mt-1 text-[11px] ${
                    result.ok ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"
                  }`}
                >
                  {result.detail}
                </p>
              ) : null}
              {daemon ? (
                <p
                  className={`mt-1 text-[11px] ${
                    daemon.health === "running"
                      ? "text-[var(--color-success)]"
                      : daemon.phase === "recovery-failed" || daemon.phase === "stop-failed"
                        ? "text-[var(--color-danger)]"
                        : "text-[var(--text-muted)]"
                  }`}
                >
                  Daemon: {daemonLifecycleText(daemon)}
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
                  {job.action === "install"
                    ? "Installing"
                    : job.action === "repair"
                      ? "Repairing"
                      : "Updating"}
                  {daemon ? `; ${daemonLifecycleText(daemon)}` : ""}... {formatElapsed(job.elapsedMs)}
                </span>
              ) : updatingElsewhere ? (
                <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--text-muted)]">
                  <Icon name="ph:circle-notch-bold" className="animate-spin" width={12} />
                  Updating in another Cave window
                </span>
              ) : presentation.action ? (
                <Button
                  variant="primary"
                  size="xs"
                  onClick={() => void updateTool(tool.id, presentation.action!)}
                  disabled={blockedByGlobalNpm}
                  title={
                    blockedByGlobalNpm
                      ? `Wait for ${npmLane?.label} to finish updating npm.`
                      : undefined
                  }
                  className={accentBtn}
                  leadingIcon={
                    presentation.action === "repair" ? "ph:wrench-bold" : "ph:arrow-down-bold"
                  }
                >
                  {blockedByGlobalNpm
                    ? `Waiting for ${npmLane?.label}`
                    : openCovenToolActionLabel(presentation.action, tool.label)}
                </Button>
              ) : null}
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
        <div className="min-w-0">
          <p className="text-[12px] text-[var(--text-secondary)]">{footerStatusText}</p>
          <p className="mt-1 text-[11px] text-[var(--text-muted)]">
            Diagnostics include tool/check summaries; paths, raw output, URL queries, and secrets are omitted or redacted.
          </p>
        </div>
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
                : "Copy diagnostics (safe)"}
          </Button>
          <Button variant="secondary" size="xs" onClick={() => void load()} className={ghostBtn} disabled={checking}>
            Check tools
          </Button>
        </div>
      </div>
    </>
  );
}
