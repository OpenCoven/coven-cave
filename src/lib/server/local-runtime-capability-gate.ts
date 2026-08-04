import type {
  DirectRunnerId,
  RuntimeAvailability,
  RuntimeRunnerId,
} from "../runtime-availability.ts";

export type LocalRuntimeCapabilityPlan = {
  runner: DirectRunnerId;
  availability: RuntimeAvailability;
  /**
   * Set when the plan's availability was verified through a wrapper runner.
   * `coven run claude` checks BOTH the outer Coven command and the Claude
   * command Coven resolves in the same scoped environment, and the resulting
   * record is deliberately tagged with the BACKED runner ("claude") so a
   * missing harness reports as `runtime_claude_missing` rather than as a
   * missing Coven. Naming that tag here keeps the drift check below exact
   * instead of forcing the availability record to lie about what it verified.
   */
  availabilityRunner?: RuntimeRunnerId;
};

/**
 * Why a capability probe produced no value. `ran: false` means the probe was
 * never started; it is NOT evidence about the capability itself. Callers must
 * keep the two apart — reporting "the runtime does not support this" when the
 * truth is "we never asked" sends users chasing a setting that was never
 * wrong.
 */
export type LocalRuntimeCapabilityOutcome<T> =
  | { ran: true; value: T }
  | { ran: false; code: string; reason: string };

export const LOCAL_RUNTIME_CAPABILITY_GATE_CODES = {
  plan_missing: "runtime_plan_missing",
  plan_runner_mismatch: "runtime_plan_runner_mismatch",
} as const;

/**
 * Start a local capability subprocess only after the exact runner's passive
 * plan is ready. The explicit bypass is reserved for SSH, whose remote
 * transport retains its existing capability-routing behavior without a local
 * runtime plan.
 */
export async function probeReadyLocalRuntimeCapabilityOutcome<T>(input: {
  plan: LocalRuntimeCapabilityPlan | null;
  runner: DirectRunnerId;
  probe: () => Promise<T>;
  allowWithoutLocalPlan?: boolean;
}): Promise<LocalRuntimeCapabilityOutcome<T>> {
  if (input.plan === null) {
    if (input.allowWithoutLocalPlan) return { ran: true, value: await input.probe() };
    return {
      ran: false,
      code: LOCAL_RUNTIME_CAPABILITY_GATE_CODES.plan_missing,
      reason: `No local ${input.runner} launch plan was prepared for this turn, so its capabilities were never probed.`,
    };
  }
  if (input.plan.runner !== input.runner) {
    return {
      ran: false,
      code: LOCAL_RUNTIME_CAPABILITY_GATE_CODES.plan_runner_mismatch,
      reason: `This turn's local launch plan runs ${input.plan.runner}, not ${input.runner}, so ${input.runner} capabilities were never probed.`,
    };
  }
  // A Coven-backed plan verifies the backed runner, so compare against the
  // runner its availability record was actually tagged for.
  const verifiedRunner = input.plan.availabilityRunner ?? input.runner;
  if (input.plan.availability.runner !== verifiedRunner) {
    return {
      ran: false,
      code: LOCAL_RUNTIME_CAPABILITY_GATE_CODES.plan_runner_mismatch,
      reason: `This turn's ${input.runner} launch plan carries a readiness check for ${input.plan.availability.runner}, so its capabilities were never probed.`,
    };
  }
  if (input.plan.availability.state !== "ready") {
    return {
      ran: false,
      code: input.plan.availability.code,
      reason: input.plan.availability.message,
    };
  }
  return { ran: true, value: await input.probe() };
}

/**
 * Value-only form for capability legs that have no distinct reporting for a
 * probe that never ran. `null` collapses "not probed" into "no value" — prefer
 * {@link probeReadyLocalRuntimeCapabilityOutcome} wherever the result decides
 * a user-facing rejection.
 */
export async function probeReadyLocalRuntimeCapability<T>(input: {
  plan: LocalRuntimeCapabilityPlan | null;
  runner: DirectRunnerId;
  probe: () => Promise<T>;
  allowWithoutLocalPlan?: boolean;
}): Promise<T | null> {
  const outcome = await probeReadyLocalRuntimeCapabilityOutcome(input);
  return outcome.ran ? outcome.value : null;
}
