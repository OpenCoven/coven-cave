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
  return (await tauriInvoke<DesktopReachabilityStatus>("desktop_reachability_status")) ?? UNSUPPORTED;
}

export async function writeDesktopReachability(
  config: DesktopReachabilityConfig,
): Promise<DesktopReachabilityStatus> {
  const result = await tauriInvoke<DesktopReachabilityStatus>("desktop_reachability_configure", {
    config,
  });
  if (!result) throw new Error(UNSUPPORTED.detail ?? "Desktop reachability is unavailable.");
  return result;
}
