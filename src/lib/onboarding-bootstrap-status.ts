"use client";

import { useSyncExternalStore } from "react";
import type { OnboardingBootstrapState } from "./onboarding-bootstrap";

/**
 * Client-side view of the setup bootstrap state (#5982).
 *
 * The "Set up Cave" dialog used to be the only reader of
 * `/api/onboarding/bootstrap`. The background-progress banner and the
 * Settings › General › Setup row now read the same state, so every fetch
 * publishes here and each consumer renders from one snapshot instead of
 * racing its own copy. `dialogOpen` lets the banner hide while the dialog is
 * showing the same progress.
 *
 * Copy lives here, not in `onboarding-bootstrap.ts`: that module is the
 * server/client model and its test pins the dialog's exact action copy.
 */

export type OnboardingBootstrapStatusSnapshot = {
  state: OnboardingBootstrapState | null;
  dialogOpen: boolean;
};

const SERVER_SNAPSHOT: OnboardingBootstrapStatusSnapshot = {
  state: null,
  dialogOpen: false,
};

let snapshot: OnboardingBootstrapStatusSnapshot = SERVER_SNAPSHOT;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function publishOnboardingBootstrapState(
  state: OnboardingBootstrapState | null,
): void {
  if (snapshot.state === state) return;
  snapshot = { ...snapshot, state };
  emit();
}

export function setOnboardingDialogOpen(open: boolean): void {
  if (snapshot.dialogOpen === open) return;
  snapshot = { ...snapshot, dialogOpen: open };
  emit();
}

export function getOnboardingBootstrapStatusSnapshot(): OnboardingBootstrapStatusSnapshot {
  return snapshot;
}

export function subscribeOnboardingBootstrapStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Observe new successful completions without replaying a retained snapshot. */
export function subscribeOnboardingBootstrapCompletion(listener: () => void): () => void {
  const isComplete = () => snapshot.state?.status === "complete" && snapshot.state.complete === true;
  let wasComplete = isComplete();
  return subscribeOnboardingBootstrapStatus(() => {
    const complete = isComplete();
    const becameComplete = complete && !wasComplete;
    // Consume the edge first, including when a listener republishes state.
    wasComplete = complete;
    if (becameComplete) listener();
  });
}

/** Test seam: drop every published value. */
export function resetOnboardingBootstrapStatus(): void {
  snapshot = SERVER_SNAPSHOT;
  emit();
}

export function useOnboardingBootstrapStatus(): OnboardingBootstrapStatusSnapshot {
  return useSyncExternalStore(
    subscribeOnboardingBootstrapStatus,
    getOnboardingBootstrapStatusSnapshot,
    () => SERVER_SNAPSHOT,
  );
}

const STATUS_TIMEOUT_MS = 5_000;

type BootstrapResponse = OnboardingBootstrapState & { ok: true };

/** One bounded GET. Publishes and returns the state, or null on any failure
 *  (timeout, network, non-ok payload) without disturbing the last good value. */
export async function fetchOnboardingBootstrapStatus(): Promise<OnboardingBootstrapState | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), STATUS_TIMEOUT_MS);
  try {
    const response = await fetch("/api/onboarding/bootstrap", {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });
    const json = (await response.json().catch(() => null)) as
      | BootstrapResponse
      | { error?: string }
      | null;
    if (!response.ok || !json || !("ok" in json) || json.ok !== true) return null;
    publishOnboardingBootstrapState(json);
    return json;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export type OnboardingBootstrapSummaryTone = "muted" | "info" | "success" | "warning";

export type OnboardingBootstrapSummary = {
  tone: OnboardingBootstrapSummaryTone;
  /** Short status words shown beside the status dot. */
  label: string;
  /** One sentence of context or the live stage detail. */
  detail: string;
  actionLabel: "Open setup" | "View setup" | "Retry setup";
};

const SETUP_SCOPE =
  "Setup prepares Cave’s local components, creates your defaults, and starts the local service.";

/** Pure presentation matrix shared by the Settings row and the banner. */
export function summarizeOnboardingBootstrap(
  state: OnboardingBootstrapState | null,
): OnboardingBootstrapSummary {
  if (!state || (state.status === "idle" && !state.confirmed)) {
    return { tone: "muted", label: "Not run yet", detail: SETUP_SCOPE, actionLabel: "Open setup" };
  }
  if (state.status === "running") {
    const active = state.activeStage
      ? state.stages.find((stage) => stage.id === state.activeStage) ?? null
      : null;
    return {
      tone: "info",
      label: active ? `Setting up — ${active.label}…` : "Setting up…",
      detail: active?.detail ?? "Cave is finishing its local setup.",
      actionLabel: "View setup",
    };
  }
  if (state.status === "failed") {
    const stageLabel = state.failure?.stageLabel
      ?? state.stages.find((stage) => stage.status === "failed")?.label
      ?? "setup";
    return {
      tone: "warning",
      label: `Stopped at ${stageLabel}`,
      detail: state.failure?.message ?? "Setup stopped before it finished. Retry setup to continue.",
      actionLabel: "Retry setup",
    };
  }
  if (state.status === "complete" || state.complete) {
    return {
      tone: "success",
      label: "Complete",
      detail: "Local components, Cave defaults, and the local service are ready.",
      actionLabel: "View setup",
    };
  }
  // Confirmed but idle: an interrupted run the dialog resumes on open.
  return {
    tone: "info",
    label: "Paused",
    detail: "Setup stopped before it finished. Open setup to resume where it left off.",
    actionLabel: "Open setup",
  };
}
