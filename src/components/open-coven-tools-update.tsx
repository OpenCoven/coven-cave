"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/lib/icon";

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

function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes > 0 ? `${minutes}m ${rest}s` : `${rest}s`;
}

function isInstallTarget(id: string): id is InstallTarget {
  return id === "coven-cli" || id === "coven-code";
}

export function OpenCovenToolsUpdate() {
  const [tools, setTools] = useState<ToolStatus[]>([]);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [installJobs, setInstallJobs] = useState<
    Partial<Record<InstallTarget, InstallJobView>>
  >({});
  const [installResults, setInstallResults] = useState<
    Partial<Record<InstallTarget, InstallResult>>
  >({});
  const mounted = useRef(true);

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
    return () => {
      mounted.current = false;
    };
  }, [load]);

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
      };
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

  const accentBtn =
    "focus-ring inline-flex items-center gap-1.5 rounded-md bg-[var(--accent-presence)] px-3 py-1 text-[11px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50";
  const ghostBtn =
    "focus-ring rounded-md border border-[var(--border-hairline)] px-2.5 py-1 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]";

  return (
    <>
      {tools.map((tool) => {
        const job = installJobs[tool.id];
        const busy = job?.status === "running";
        const result = installResults[tool.id];
        return (
          <div key={tool.id} className="flex items-center justify-between gap-4 px-4 py-3">
            <div className="min-w-0">
              <p className="text-[12px] text-[var(--text-secondary)]">{tool.label}</p>
              <p className="truncate font-mono text-[11px] text-[var(--text-muted)]">
                {tool.installed
                  ? `${tool.current ?? "unknown"}${tool.latest ? ` -> ${tool.latest}` : ""}`
                  : "Not installed"}
              </p>
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
                <pre className="mt-2 max-h-24 overflow-auto whitespace-pre-wrap break-all rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] px-3 py-2 font-mono text-[11px] leading-4 text-[var(--text-muted)]">
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
              ) : tool.outdated ? (
                <button
                  type="button"
                  onClick={() => void updateTool(tool.id)}
                  className={accentBtn}
                >
                  <Icon name="ph:arrow-down-bold" width={12} />
                  Update {tool.label}
                </button>
              ) : (
                <span className="text-[12px] text-[var(--text-muted)]">
                  {tool.installed ? "Up to date" : "Not found"}
                </span>
              )}
            </div>
          </div>
        );
      })}
      <div className="flex items-center justify-between gap-4 px-4 py-3">
        <span className="text-[12px] text-[var(--text-secondary)]">
          {error ? `Check failed: ${error}` : checking ? "Checking tools..." : "Version source: npm latest"}
        </span>
        <button type="button" onClick={() => void load()} className={ghostBtn} disabled={checking}>
          Check tools
        </button>
      </div>
    </>
  );
}
