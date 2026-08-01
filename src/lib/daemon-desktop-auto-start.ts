import type { DaemonStatusPollResult } from "@/lib/daemon-status-classification";
import type { TauriPlatform } from "@/lib/tauri-platform";

export type DaemonDesktopAutoStartDecision = "wait" | "start" | "skip";

/**
 * Decide only after both independent boot facts are known. Tauri platform
 * detection is asynchronous, so the first accepted daemon result must remain
 * pinned while the native shell resolves desktop versus mobile.
 */
export function daemonDesktopAutoStartDecision(input: {
  platform: TauriPlatform;
  firstStatus: DaemonStatusPollResult | null;
}): DaemonDesktopAutoStartDecision {
  if (input.platform === "unknown" || input.firstStatus === null) return "wait";
  return input.platform === "desktop" &&
    input.firstStatus.kind === "offline" &&
    input.firstStatus.targetMode === "local"
    ? "start"
    : "skip";
}

export type DaemonDesktopAutoStartCoordinator = {
  observePlatform(platform: TauriPlatform): void;
  observeStatus(status: DaemonStatusPollResult): void;
};

/**
 * Backoff for unattended restarts, in ms since the previous attempt. A daemon
 * that cannot start must not be relaunched every 5 seconds forever: the list
 * is finite, so after the last entry the coordinator gives up and leaves the
 * offline banner to say so. A single observed `running` result resets it.
 */
export const DAEMON_RESTART_BACKOFF_MS = [0, 15_000, 60_000, 300_000] as const;

export type DaemonAutoRestartOptions = {
  /**
   * Read at each decision, never captured: the user can turn the preference
   * off mid-session and the very next poll must respect that.
   */
  autoRestartEnabled: () => boolean;
  now: () => number;
};

/**
 * Rendezvous the first accepted status decision with the resolved platform.
 * The decision is consumed synchronously before `start` is called, so even a
 * re-entrant status observation cannot issue a duplicate request.
 *
 * Boot behaviour is unchanged and unconditional — a daemon that is already
 * offline when the app opens is still started once, with no preference
 * involved. `options` adds the opt-in second half (cave-bqywj): after that
 * first decision, keep watching, and relaunch a local daemon that goes offline
 * mid-session. Without `options` the coordinator is exactly the one-shot it
 * has always been.
 */
export function createDaemonDesktopAutoStartCoordinator(
  start: () => void,
  options?: DaemonAutoRestartOptions,
): DaemonDesktopAutoStartCoordinator {
  let platform: TauriPlatform = "unknown";
  let firstStatus: DaemonStatusPollResult | null = null;
  let consumed = false;
  let restartAttempts = 0;
  let lastAttemptAt: number | null = null;

  const reconcile = () => {
    if (consumed) return;
    const decision = daemonDesktopAutoStartDecision({ platform, firstStatus });
    if (decision === "wait") return;
    consumed = true;
    if (decision === "start") {
      lastAttemptAt = options ? options.now() : null;
      restartAttempts = 1;
      start();
    }
  };

  /**
   * Runs only after the boot decision is consumed. Deliberately re-reads the
   * preference and re-checks the platform every time rather than trusting the
   * state captured at boot.
   */
  const considerRestart = (status: DaemonStatusPollResult) => {
    if (!options || !consumed) return;
    if (status.kind === "running") {
      // Proof the daemon is back: forget the attempt history so a later,
      // unrelated outage gets a full budget rather than the tail of this one.
      restartAttempts = 0;
      lastAttemptAt = null;
      return;
    }
    if (platform !== "desktop") return;
    if (status.kind !== "offline" || status.targetMode !== "local") return;
    if (!options.autoRestartEnabled()) return;
    if (restartAttempts >= DAEMON_RESTART_BACKOFF_MS.length) return;

    const wait = DAEMON_RESTART_BACKOFF_MS[restartAttempts];
    const at = options.now();
    if (lastAttemptAt !== null && at - lastAttemptAt < wait) return;

    restartAttempts += 1;
    lastAttemptAt = at;
    start();
  };

  return {
    observePlatform(nextPlatform) {
      platform = nextPlatform;
      reconcile();
    },
    observeStatus(status) {
      if (firstStatus === null) firstStatus = status;
      reconcile();
      considerRestart(status);
    },
  };
}

/** Monotonic guard shared by background and trusted post-start status reads. */
export function createDaemonStatusRequestGate() {
  let latestRequestId = 0;
  return {
    begin() {
      latestRequestId += 1;
      return latestRequestId;
    },
    isLatest(requestId: number) {
      return requestId === latestRequestId;
    },
  };
}

type DaemonStartPayload = {
  ok?: unknown;
  error?: unknown;
  stderr?: unknown;
};

function daemonStartPayload(value: unknown): DaemonStartPayload {
  return value && typeof value === "object" ? value as DaemonStartPayload : {};
}

/** Shared automatic/manual Workspace start behavior with injectable effects. */
export async function runWorkspaceDaemonStart(input: {
  fetchImpl: typeof fetch;
  dismissError(): void;
  reportError(message: string): void;
  refreshStatus(opts?: { trusted?: boolean }): Promise<void>;
}): Promise<boolean> {
  try {
    // Keep the injected function unbound. Calling `input.fetchImpl(...)`
    // supplies `input` as the receiver, which WebView2's native fetch rejects
    // with "Illegal invocation".
    const { fetchImpl } = input;
    const response = await fetchImpl("/api/daemon/start", { method: "POST" });
    const payload = daemonStartPayload(await response.json().catch(() => ({})));
    if (!response.ok || payload.ok === false) {
      const message =
        typeof payload.error === "string" && payload.error.trim()
          ? payload.error
          : typeof payload.stderr === "string" && payload.stderr.trim()
            ? payload.stderr
            : "daemon did not start";
      throw new Error(message);
    }
    input.dismissError();
    await input.refreshStatus({ trusted: true });
    return true;
  } catch (error) {
    input.reportError(error instanceof Error ? error.message : "daemon did not start");
    await input.refreshStatus();
    return false;
  }
}
