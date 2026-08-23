export type OnboardingAnnouncementStep = {
  key: string;
  title: string;
  ok: boolean;
};

export function onboardingStepTransitionAnnouncement({
  previousActiveStepKey,
  activeStepKey,
  setupComplete,
  steps,
}: {
  previousActiveStepKey: string | null | undefined;
  activeStepKey: string | null;
  setupComplete: boolean;
  steps: readonly OnboardingAnnouncementStep[];
}): string | null {
  if (
    previousActiveStepKey === undefined ||
    previousActiveStepKey === activeStepKey
  ) {
    return null;
  }

  if (activeStepKey === null) {
    return setupComplete
      ? "Setup complete — every required step is done."
      : "No required setup action is available right now.";
  }

  const stepIndex = steps.findIndex((step) => step.key === activeStepKey);
  const step = steps[stepIndex];
  if (!step) return null;
  const previousStep = steps.find(
    (candidate) => candidate.key === previousActiveStepKey,
  );
  return previousStep?.ok
    ? `${previousStep.title} — done. Next: step ${stepIndex + 1}, ${step.title}.`
    : `Now on step ${stepIndex + 1}: ${step.title}.`;
}

export function onboardingStatusWarningMessage({
  statusFailures,
  mayContinue,
}: {
  statusFailures: number;
  mayContinue: boolean;
}): string | null {
  if (statusFailures <= 0) return null;
  return mayContinue
    ? "Cave couldn’t confirm every setup check. You can continue now; any unavailable feature will explain what it needs."
    : "Cave couldn’t refresh every setup check. Finish the required setup shown below, then retry.";
}

export type OnboardingStatusRequest = {
  requestId: number;
  controller: AbortController;
};

export type OnboardingStatusRequestCoordinator = {
  readonly inFlight: boolean;
  readonly currentRequestId: number;
  begin: () => OnboardingStatusRequest | null;
  cancel: () => boolean;
  finish: (request: OnboardingStatusRequest) => boolean;
  isLatest: (request: OnboardingStatusRequest) => boolean;
};

export function createOnboardingStatusRequestCoordinator():
  OnboardingStatusRequestCoordinator {
  let currentRequestId = 0;
  let current: OnboardingStatusRequest | null = null;

  return {
    get inFlight() {
      return current !== null;
    },
    get currentRequestId() {
      return currentRequestId;
    },
    begin() {
      if (current) return null;
      current = {
        requestId: ++currentRequestId,
        controller: new AbortController(),
      };
      return current;
    },
    cancel() {
      if (!current) return false;
      const cancelled = current;
      current = null;
      currentRequestId += 1;
      cancelled.controller.abort();
      return true;
    },
    finish(request) {
      if (current !== request) return false;
      current = null;
      return true;
    },
    isLatest(request) {
      return request.requestId === currentRequestId;
    },
  };
}
