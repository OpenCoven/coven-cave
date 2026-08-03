export type OnboardingReadinessState =
  | "checking"
  | "ready"
  | "action-required"
  | "unavailable";

export type OnboardingReadinessStep = {
  ok?: boolean;
  optional?: boolean;
  state?: OnboardingReadinessState;
  detail?: string;
  hint?: string;
};

export type OnboardingContinuationDecision = {
  mayContinue: boolean;
  complete: boolean;
  blockingKeys: string[];
  unresolvedKeys: string[];
};

export function onboardingStepState(
  step: OnboardingReadinessStep | undefined,
): OnboardingReadinessState {
  if (!step) return "checking";
  if (step.state) return step.state;
  return step.ok ? "ready" : "action-required";
}

export function onboardingContinuationDecision(
  steps: Record<string, OnboardingReadinessStep | undefined> | undefined,
): OnboardingContinuationDecision {
  if (!steps) {
    return { mayContinue: true, complete: false, blockingKeys: [], unresolvedKeys: [] };
  }

  const blockingKeys: string[] = [];
  const unresolvedKeys: string[] = [];
  let requiredStepCount = 0;
  let complete = true;

  for (const [key, step] of Object.entries(steps)) {
    if (step?.optional) continue;

    requiredStepCount += 1;
    switch (onboardingStepState(step)) {
      case "ready":
        break;
      case "action-required":
        blockingKeys.push(key);
        complete = false;
        break;
      case "checking":
      case "unavailable":
        unresolvedKeys.push(key);
        complete = false;
        break;
    }
  }

  return {
    mayContinue: blockingKeys.length === 0,
    complete: complete && requiredStepCount > 0,
    blockingKeys,
    unresolvedKeys,
  };
}
