import { createFamiliarLivenessPolicy } from "@/lib/familiar-liveness";
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
 * Retained for the surfaces that describe the restart cadence to the user. The
 * schedule itself now comes from createFamiliarLivenessPolicy, which spends the
 * same budget and then COOLS OFF rather than stopping for good.
 *
 * The finite list was the bug: `restartAttempts >= DAEMON_RESTART_BACKOFF_MS
 * .length` gave up permanently, and the only thing that cleared the counter was
 * a `running` poll — which, for a daemon that is genuinely gone and cannot
 * return on its own, never arrives. Four failures inside six minutes and the
 * familiar was down for the rest of the session.
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
  // One policy owns the schedule, the burst budget and its refill. See
  // src/lib/familiar-liveness.ts for why "N attempts then never" was wrong.
  const liveness = options
    ? createFamiliarLivenessPolicy({
        now: options.now,
        burstAttempts: DAEMON_RESTART_BACKOFF_MS.length,
      })
    : null;

  const reconcile = () => {
    if (consumed) return;
    const decision = daemonDesktopAutoStartDecision({ platform, firstStatus });
    if (decision === "wait") return;
    consumed = true;
    if (decision === "start") {
      // The boot start is unconditional and spends the burst's first attempt,
      // so a daemon that is still absent a moment later waits out the backoff
      // rather than being started twice in a row.
      liveness?.observe("absent");
      start();
    }
  };

  /**
   * Runs only after the boot decision is consumed. Deliberately re-reads the
   * preference and re-checks the platform every time rather than trusting the
   * state captured at boot.
   */
  const considerRestart = (status: DaemonStatusPollResult) => {
    if (!options || !liveness || !consumed) return;
    if (status.kind === "running") {
      // Proof the daemon is back: the policy forgets the attempt history so a
      // later, unrelated outage gets a full budget rather than the tail of this
      // one.
      liveness.observe("healthy");
      return;
    }
    if (platform !== "desktop") return;
    if (status.kind !== "offline" || status.targetMode !== "local") return;
    // Re-read, never captured: the user can turn the preference off mid-session
    // and the very next poll must respect that. Note this is checked BEFORE the
    // policy is told anything, so a disabled preference never consumes budget.
    if (!options.autoRestartEnabled()) return;

    // Scope note (cave-9pqt9): only `offline` + `local` reaches here, which is
    // the status service's own confirmation that nothing is running. Widening
    // this to hangs would mean issuing a stop, and stopping a daemon an external
    // supervisor owns is precisely the contention that gate exists to avoid.
    const decision = liveness.observe("absent");
    if (decision.action === "revive") start();
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
  code?: unknown;
  error?: unknown;
  stderr?: unknown;
};

export type WorkspaceDaemonStartOutcome = "started" | "deferred" | "failed";

function daemonStartPayload(value: unknown): DaemonStartPayload {
  return value && typeof value === "object" ? value as DaemonStartPayload : {};
}

/** Shared automatic/manual Workspace start behavior with injectable effects. */
export async function runWorkspaceDaemonStart(input: {
  automatic?: boolean;
  fetchImpl: typeof fetch;
  dismissError(): void;
  reportError(message: string): void;
  refreshStatus(opts?: { trusted?: boolean; fresh?: boolean }): Promise<void>;
}): Promise<WorkspaceDaemonStartOutcome> {
  try {
    // Keep the injected function unbound. Calling `input.fetchImpl(...)`
    // supplies `input` as the receiver, which WebView2's native fetch rejects
    // with "Illegal invocation".
    const { fetchImpl } = input;
    const response = await fetchImpl(
      "/api/daemon/start",
      input.automatic
        ? {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ automatic: true }),
        }
        : { method: "POST" },
    );
    const payload = daemonStartPayload(await response.json().catch(() => ({})));
    if (!response.ok || payload.ok === false) {
      if (input.automatic && payload.code === "owner_unreachable") {
        await input.refreshStatus();
        return "deferred";
      }
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
    return "started";
  } catch (error) {
    input.reportError(error instanceof Error ? error.message : "daemon did not start");
    await input.refreshStatus();
    return "failed";
  }
}
