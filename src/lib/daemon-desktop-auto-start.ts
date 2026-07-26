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
 * Rendezvous the first accepted status decision with the resolved platform.
 * The decision is consumed synchronously before `start` is called, so even a
 * re-entrant status observation cannot issue a duplicate request.
 */
export function createDaemonDesktopAutoStartCoordinator(
  start: () => void,
): DaemonDesktopAutoStartCoordinator {
  let platform: TauriPlatform = "unknown";
  let firstStatus: DaemonStatusPollResult | null = null;
  let consumed = false;

  const reconcile = () => {
    if (consumed) return;
    const decision = daemonDesktopAutoStartDecision({ platform, firstStatus });
    if (decision === "wait") return;
    consumed = true;
    if (decision === "start") start();
  };

  return {
    observePlatform(nextPlatform) {
      platform = nextPlatform;
      reconcile();
    },
    observeStatus(status) {
      if (firstStatus === null) firstStatus = status;
      reconcile();
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
