import type { AdapterReport } from "./harness-adapters.ts";
import {
  onboardingContinuationDecision,
  onboardingStepState,
  type OnboardingReadinessStep,
} from "./onboarding-readiness.ts";

export type OnboardingStatusStep = OnboardingReadinessStep & { ok: boolean };

export type DeadlineResult<T> =
  | { state: "ready"; value: T }
  | { state: "unavailable"; value: null };

type DeadlineOptions = {
  now?: () => number;
  schedule?: (callback: () => void, delayMs: number) => unknown;
  cancel?: (handle: unknown) => void;
};

export async function withinDeadline<T>(
  work: (signal: AbortSignal) => Promise<T>,
  deadline: number,
  options: DeadlineOptions = {},
): Promise<DeadlineResult<T>> {
  const now = options.now ?? Date.now;
  const remaining = Math.max(0, deadline - now());
  if (remaining === 0) return { state: "unavailable", value: null };

  const controller = new AbortController();
  const schedule = options.schedule ??
    ((callback: () => void, delayMs: number) => setTimeout(callback, delayMs));
  const cancel = options.cancel ??
    ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  let timer: unknown;
  try {
    const timeout = new Promise<DeadlineResult<T>>((resolve) => {
      timer = schedule(() => {
        controller.abort();
        resolve({ state: "unavailable", value: null });
      }, remaining);
    });
    const result = Promise.resolve()
      .then(() => work(controller.signal))
      .then<DeadlineResult<T>, DeadlineResult<T>>(
        (value) => ({ state: "ready", value }),
        () => ({ state: "unavailable", value: null }),
      );
    return await Promise.race([result, timeout]);
  } finally {
    if (timer !== undefined) cancel(timer);
  }
}

export function isConfirmedCommandMissing(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: unknown; killed?: unknown; signal?: unknown };
  return value.code === 1 && value.killed !== true && !value.signal;
}

export type EnvironmentDiscoveryState = "ready" | "unavailable";

export function environmentDiscoveryState(
  completedAt: number,
  deadline: number,
): EnvironmentDiscoveryState {
  return completedAt < deadline ? "ready" : "unavailable";
}

export function classifyCommandPathFailure(
  error: unknown,
  discoveryState: EnvironmentDiscoveryState,
): "absent" | "unavailable" {
  return discoveryState === "ready" && isConfirmedCommandMissing(error)
    ? "absent"
    : "unavailable";
}

export function isConfirmedMissingPath(error: unknown): boolean {
  return !!error && typeof error === "object" &&
    (error as { code?: unknown }).code === "ENOENT";
}

type BindingReadinessInput = {
  defaults: { harness?: string | null; model?: string | null };
  familiarsAvailable: boolean;
  daemonState: "ready" | "offline" | "unavailable";
  reports: AdapterReport[];
  openClawAgentCount: number;
  runtimeEvidenceState: "ready" | "unavailable";
};

function defaultHarnessAvailable(
  harness: string,
  reports: AdapterReport[],
  openClawAgentCount: number,
): boolean {
  if (harness === "openclaw" && openClawAgentCount > 0) return true;
  return reports.some((report) => report.id === harness && report.installed);
}

function availableRuntimeLabels(
  reports: AdapterReport[],
  openClawAgentCount: number,
): string[] {
  const labels = reports
    .filter((report) => report.installed)
    .map((report) => report.label);
  if (openClawAgentCount > 0 && !labels.includes("OpenClaw")) {
    labels.push(
      `OpenClaw (${openClawAgentCount} agent${openClawAgentCount === 1 ? "" : "s"})`,
    );
  }
  return labels;
}

export function bindingReadinessStep({
  defaults,
  familiarsAvailable,
  daemonState,
  reports,
  openClawAgentCount,
  runtimeEvidenceState,
}: BindingReadinessInput): OnboardingStatusStep {
  const { harness, model } = defaults;
  if (!harness || !model) {
    return {
      ok: false,
      state: "action-required",
      hint: "Summon a familiar inside Cave (Familiars → Summon familiar) from Codex, Claude Code, Hermes, or an OpenClaw agent.",
    };
  }
  if (!familiarsAvailable) {
    if (daemonState === "unavailable") {
      return {
        ok: false,
        state: "unavailable",
        hint: "Couldn’t verify familiar bindings. You can continue and retry later.",
      };
    }
    return {
      ok: false,
      state: "action-required",
      hint: daemonState === "ready"
        ? "Bindings set but no familiars to bind."
        : "Waiting for the daemon — familiars load once it starts.",
    };
  }
  if (defaultHarnessAvailable(harness, reports, openClawAgentCount)) {
    return {
      ok: true,
      state: "ready",
      detail: `${harness} · ${model}`,
    };
  }
  if (runtimeEvidenceState === "unavailable") {
    return {
      ok: false,
      state: "unavailable",
      hint: "Couldn’t verify the runtime for your default binding. You can continue and retry later.",
    };
  }

  const report = reports.find((entry) => entry.id === harness);
  const label = report?.label ?? harness;
  const available = availableRuntimeLabels(reports, openClawAgentCount);
  if (available.length > 0) {
    return {
      ok: false,
      state: "action-required",
      hint: `Default binding "${harness} · ${model}" points at ${label}, which has no installed runtime or agent. Summon a familiar from ${available.join(", ")} to update your default.`,
    };
  }
  return {
    ok: false,
    state: "action-required",
    hint: `Default binding "${harness} · ${model}" has no installed runtime or OpenClaw agent.${
      report?.installHint ? ` ${report.installHint}` : ""
    }`,
  };
}

export function onboardingStatusPayload<TTools>(
  steps: Record<string, OnboardingStatusStep>,
  tools: TTools,
) {
  const decision = onboardingContinuationDecision(steps);
  const covenCliState = onboardingStepState(steps.covenCli);
  const safeTools = covenCliState === "checking" || covenCliState === "unavailable"
    ? null
    : tools;
  return {
    ok: true as const,
    complete: decision.complete,
    mayContinue: decision.mayContinue,
    steps,
    tools: safeTools,
  };
}
