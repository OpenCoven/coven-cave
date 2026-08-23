import type { PairingStep } from "./surfaces/mobile-handoff.ts";
import { classifyTailscaleFailureKind, type TailscaleFailureKind } from "./tailscale-failure.ts";
import { isTauri } from "./tauri-platform.ts";

export type PairingRecoveryAttempt = {
  ok: boolean;
  error?: string;
  stderr?: string;
  steps?: PairingStep[];
};

type LaunchDependencies = {
  tauri?: boolean;
  invoke?: (command: string) => Promise<unknown>;
};

const RECOVERABLE_TAILSCALE_FAILURES = new Set<TailscaleFailureKind>([
  "not-running",
  "signed-out",
]);

export const TAILSCALE_DOWNLOAD_URL = "https://tailscale.com/download";
export const TAILSCALE_RECOVERY_DELAYS_MS = [750, 1_250, 2_000, 3_000, 4_000, 5_000];

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === "string" && error.trim()) return error.trim();
  return "The desktop could not open Tailscale.";
}

export function pairingRecoveryFailureText(attempt: PairingRecoveryAttempt): string {
  const failedStep = attempt.steps?.find((step) => step.state === "fail");
  return [attempt.stderr, attempt.error, failedStep?.detail].filter(Boolean).join(" ");
}

export function pairingRecoveryFailureKind(
  attempt: PairingRecoveryAttempt,
): TailscaleFailureKind {
  const textKind = classifyTailscaleFailureKind(pairingRecoveryFailureText(attempt));
  if (textKind !== "unknown") return textKind;

  const failedStep = attempt.steps?.find((step) => step.state === "fail");
  if (failedStep?.id !== "tailscale") return "unknown";
  const detail = failedStep.detail?.toLowerCase() ?? "";
  if (detail.includes("install")) return "not-installed";
  if (detail.includes("sign in") || detail.includes("login")) return "signed-out";
  return "not-running";
}

export function isRecoverableTailscaleFailure(attempt: PairingRecoveryAttempt): boolean {
  return RECOVERABLE_TAILSCALE_FAILURES.has(pairingRecoveryFailureKind(attempt));
}

export async function launchTailscaleDesktopApp(
  dependencies: LaunchDependencies = {},
): Promise<{ ok: true } | { ok: false; error: string }> {
  const tauri = dependencies.tauri ?? isTauri();
  if (!tauri) {
    return {
      ok: false,
      error: "Open Tailscale from the desktop app, then retry pairing.",
    };
  }

  try {
    const invoke = dependencies.invoke ?? (await import("@tauri-apps/api/core")).invoke;
    await invoke("open_tailscale_app");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function retryPairingAfterTailscaleLaunch({
  attempt,
  delaysMs = TAILSCALE_RECOVERY_DELAYS_MS,
  sleep = wait,
}: {
  attempt: () => Promise<PairingRecoveryAttempt>;
  delaysMs?: number[];
  sleep?: (ms: number) => Promise<void>;
}): Promise<PairingRecoveryAttempt> {
  let latest: PairingRecoveryAttempt = {
    ok: false,
    error: "Tailscale did not become ready before the pairing retry window ended.",
  };

  for (const delayMs of delaysMs) {
    await sleep(delayMs);
    latest = await attempt();
    if (latest.ok || !isRecoverableTailscaleFailure(latest)) return latest;
  }

  return latest;
}
