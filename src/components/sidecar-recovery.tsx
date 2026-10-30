"use client";

import { useEffect } from "react";
import { useAnnouncer } from "@/components/ui/live-region";
import { useShellBanners } from "@/lib/shell-banners";
import { isTauri } from "@/lib/tauri-platform";

const BANNER_ID = "sidecar-recovery";
const PHASES = new Set(["idle", "preparing", "starting", "waiting", "ready", "failed", "cancelled", "cancelling"]);
type StartupStatus = { phase: string; progress: number; message: string; canRetry: boolean; canCancel: boolean };

function readStatus(value: unknown): StartupStatus | null {
  if (!value || typeof value !== "object") return null;
  const status = value as Partial<StartupStatus>;
  return typeof status.phase === "string" && PHASES.has(status.phase)
    && typeof status.progress === "number" && Number.isFinite(status.progress)
    && typeof status.message === "string" && typeof status.canRetry === "boolean"
    && typeof status.canCancel === "boolean" ? status as StartupStatus : null;
}

/** Windows startup/revival belongs to the native host, including while the
 * Next sidecar is unavailable. Never replace this IPC with an HTTP retry loop. */
export function SidecarRecoveryTrigger() {
  const { pushBanner, dismissBanner } = useShellBanners();
  const { announce } = useAnnouncer();
  useEffect(() => {
    if (!isTauri()) return;
    let active = true;
    let windows = false;
    let unlisten: (() => void) | undefined;
    let revision = 0;
    let current: StartupStatus | null = null;
    let retryPending = false;

    function disposeListener(dispose: () => void) {
      // Tauri types this callback as void, but its adapter returns a promise.
      // The native host may already be gone during teardown.
      void Promise.resolve().then(dispose).catch(() => {});
    }

    function show(status: StartupStatus) {
      if (!active) return;
      current = status;
      if (status.phase === "ready" || status.phase === "idle") {
        dismissBanner(BANNER_ID);
        return;
      }
      const failed = status.phase === "failed" || status.phase === "cancelled";
      pushBanner({
        id: BANNER_ID,
        severity: failed ? "warning" : "info",
        title: failed ? "Local services stopped. Retry to reconnect." : "Starting local services…",
        detail: status.message,
        // The last native failure stays actionable during supervisor cooldown.
        // We do not infer cooldown duration or readiness from elapsed time.
        cta: failed && status.canRetry && !retryPending
          ? { label: "Retry", onClick: () => { void retryStartup(); } } : undefined,
      });
    }

    function receive(value: unknown) {
      const status = readStatus(value);
      if (!active || !status) return;
      revision += 1;
      show(status);
    }

    async function refresh(invoke: typeof import("@tauri-apps/api/core").invoke) {
      const before = revision;
      const snapshot = await invoke<unknown>("sidecar_startup_status");
      // An event delivered while the query was outstanding is newer evidence.
      if (active && revision === before) receive(snapshot);
    }

    async function retryStartup() {
      if (!active || retryPending || !current?.canRetry
        || !["failed", "cancelled"].includes(current.phase)) return;
      retryPending = true;
      const before = revision;
      show(current);
      announce("Retrying local services…");
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        if (!active) return;
        await invoke("retry_sidecar_startup");
        if (!active) return;
        // Accepted means a worker was started, not that services are ready.
        await refresh(invoke);
      } catch (error) {
        if (active && revision === before && current) {
          current = { ...current, message: error instanceof Error ? error.message : String(error) };
          announce("Couldn't restart local services. Retry or reopen Cave.", "assertive");
        }
      } finally {
        retryPending = false;
        if (active && current) show(current);
      }
    }

    void (async () => {
      const { platform } = await import("@tauri-apps/plugin-os");
      if (!active || platform() !== "windows") return;
      windows = true;
      const [{ listen }, { invoke }] = await Promise.all([
        import("@tauri-apps/api/event"), import("@tauri-apps/api/core"),
      ]);
      if (!active) return;
      const dispose = await listen<unknown>("sidecar-startup-progress", event => receive(event.payload));
      if (!active) { disposeListener(dispose); return; }
      unlisten = dispose;
      await refresh(invoke);
    })().catch(() => {
      if (active && windows && !current) pushBanner({
        id: BANNER_ID, severity: "warning",
        title: "Couldn't monitor local services. Reopen Cave to reconnect.",
      });
    });
    return () => {
      active = false;
      if (unlisten) disposeListener(unlisten);
      dismissBanner(BANNER_ID);
    };
  }, [announce, dismissBanner, pushBanner]);
  return null;
}
