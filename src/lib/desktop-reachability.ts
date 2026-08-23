"use client";

export type DesktopReachabilityConfig = {
  preventSleep: boolean;
  preventSleepOnAcOnly: boolean;
  daemonMode: boolean;
};

export type DesktopReachabilityStatus = {
  supported: boolean;
  backgroundAvailabilitySupported?: boolean;
  config: DesktopReachabilityConfig;
  pairedPhoneSeen: boolean;
  launchAgentInstalled: boolean;
  preventSleepActive: boolean;
  detail?: string | null;
};

export type BackgroundAvailabilityReadiness =
  | "not-applicable"
  | "ready"
  | "needs-consent";

type DesktopReachabilityListener = (status: DesktopReachabilityStatus) => void;

const desktopReachabilityListeners = new Set<DesktopReachabilityListener>();
let latestDesktopReachability: DesktopReachabilityStatus | null = null;

function publishDesktopReachability(status: DesktopReachabilityStatus): void {
  if (latestDesktopReachability === status) return;
  latestDesktopReachability = status;
  for (const listener of desktopReachabilityListeners) listener(status);
}

/** Keep every mounted desktop-availability surface on one native status. */
export function subscribeDesktopReachability(
  listener: DesktopReachabilityListener,
): () => void {
  desktopReachabilityListeners.add(listener);
  if (latestDesktopReachability) listener(latestDesktopReachability);
  return () => desktopReachabilityListeners.delete(listener);
}

/** Whether packaged macOS pairing can promise that Cave survives its window.
 * Plain web/development shells are not blocked because they cannot install the
 * per-user helper; their pairing remains explicitly session-only. */
export function backgroundAvailabilityReadiness(
  status: DesktopReachabilityStatus,
): BackgroundAvailabilityReadiness {
  if (!status.supported || status.backgroundAvailabilitySupported === false) {
    return "not-applicable";
  }
  return status.config.daemonMode && status.launchAgentInstalled
    ? "ready"
    : "needs-consent";
}

const UNSUPPORTED: DesktopReachabilityStatus = {
  supported: false,
  config: {
    preventSleep: false,
    preventSleepOnAcOnly: true,
    daemonMode: false,
  },
  pairedPhoneSeen: false,
  launchAgentInstalled: false,
  preventSleepActive: false,
  detail: "Desktop reachability controls are available in the macOS app.",
};

async function tauriInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T | null> {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return null;
  try {
    const { platform } = await import("@tauri-apps/plugin-os");
    const os = platform();
    if (os === "ios" || os === "android") return null;
  } catch {
    // Older desktop builds or minimal shells may not have the OS plugin; assume desktop.
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

export async function readDesktopReachability(): Promise<DesktopReachabilityStatus> {
  const status =
    (await tauriInvoke<DesktopReachabilityStatus>("desktop_reachability_status")) ?? UNSUPPORTED;
  publishDesktopReachability(status);
  return status;
}

export async function writeDesktopReachability(
  config: DesktopReachabilityConfig,
): Promise<DesktopReachabilityStatus> {
  const result = await tauriInvoke<DesktopReachabilityStatus>("desktop_reachability_configure", {
    config,
  });
  if (!result) throw new Error(UNSUPPORTED.detail ?? "Desktop reachability is unavailable.");
  publishDesktopReachability(result);
  return result;
}

/** Enable/repair the background server without changing either sleep policy.
 * The returned status is verified so a missing/failed LaunchAgent blocks a QR
 * from claiming durable remote availability. */
export async function enableDesktopBackgroundAvailability(
  status: DesktopReachabilityStatus,
  write: (
    config: DesktopReachabilityConfig,
  ) => Promise<DesktopReachabilityStatus> = writeDesktopReachability,
): Promise<DesktopReachabilityStatus> {
  const readiness = backgroundAvailabilityReadiness(status);
  if (readiness === "not-applicable" || readiness === "ready") return status;

  const next = await write({ ...status.config, daemonMode: true });
  // Custom writers keep the helper independently testable; publish their
  // verified native result through the same channel as the production writer.
  publishDesktopReachability(next);
  if (backgroundAvailabilityReadiness(next) !== "ready") {
    throw new Error(
      "Background availability could not be verified. Keep Cave open and try again.",
    );
  }
  return next;
}
