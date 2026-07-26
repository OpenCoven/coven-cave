import type {
  DirectRunnerId,
  RuntimeAvailability,
} from "../runtime-availability.ts";

export type LocalRuntimeCapabilityPlan = {
  runner: DirectRunnerId;
  availability: RuntimeAvailability;
};

/**
 * Start a local capability subprocess only after the exact runner's passive
 * plan is ready. The explicit bypass is reserved for SSH, whose remote
 * transport retains its existing capability-routing behavior without a local
 * runtime plan.
 */
export async function probeReadyLocalRuntimeCapability<T>(input: {
  plan: LocalRuntimeCapabilityPlan | null;
  runner: DirectRunnerId;
  probe: () => Promise<T>;
  allowWithoutLocalPlan?: boolean;
}): Promise<T | null> {
  if (input.plan === null) {
    return input.allowWithoutLocalPlan ? input.probe() : null;
  }
  if (
    input.plan.runner !== input.runner ||
    input.plan.availability.runner !== input.runner ||
    input.plan.availability.state !== "ready"
  ) {
    return null;
  }
  return input.probe();
}
