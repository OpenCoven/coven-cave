import type { WorkspaceDaemonStartOutcome } from "./daemon-desktop-auto-start.ts";

export type DaemonRecoveryPresentation = {
  phase: "idle" | "recovering" | "deferred" | "failed";
  quiet: boolean;
  offlinePollsRemaining: number;
};

export type DaemonRecoveryPresentationEvent =
  | { type: "automatic-start" }
  | { type: "manual-start" }
  | { type: "start-outcome"; outcome: WorkspaceDaemonStartOutcome }
  | { type: "running" }
  | { type: "offline" };

export const initialDaemonRecoveryPresentation: DaemonRecoveryPresentation = {
  phase: "idle",
  quiet: false,
  offlinePollsRemaining: 0,
};

/** Pure UI state: quiet only while ownership-safe recovery can still heal. */
export function daemonRecoveryPresentation(
  current: DaemonRecoveryPresentation,
  event: DaemonRecoveryPresentationEvent,
): DaemonRecoveryPresentation {
  if (event.type === "running") return initialDaemonRecoveryPresentation;
  if (event.type === "manual-start") return initialDaemonRecoveryPresentation;
  if (event.type === "automatic-start") {
    return { phase: "recovering", quiet: true, offlinePollsRemaining: 0 };
  }
  if (event.type === "start-outcome") {
    // A trusted running poll can win while the start request is settling.
    if (current.phase !== "recovering") return current;
    if (event.outcome === "failed") {
      return { phase: "failed", quiet: false, offlinePollsRemaining: 0 };
    }
    return {
      phase: "deferred",
      quiet: true,
      offlinePollsRemaining: event.outcome === "deferred" ? 2 : 1,
    };
  }
  if (current.phase !== "deferred") return current;
  const remaining = current.offlinePollsRemaining - 1;
  return remaining > 0
    ? { ...current, offlinePollsRemaining: remaining }
    : { phase: "failed", quiet: false, offlinePollsRemaining: 0 };
}
