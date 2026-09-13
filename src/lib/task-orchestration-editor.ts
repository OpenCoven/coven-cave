import type { Card, TaskDependency, TaskNextStep } from "./cave-board-types";

export type OrchestrationDraft = {
  dependencies: TaskDependency[];
  primaryBlockerId: string | null;
  primaryBlockerPinned: boolean;
  nextStep: TaskNextStep | null;
  dependencyReviewAction?: "review" | "unreview";
};

export function orchestrationDraft(
  card?: Pick<Card, "dependencies" | "primaryBlockerId" | "primaryBlockerPinned" | "nextStep">,
): OrchestrationDraft {
  return {
    dependencies: card?.dependencies?.map((dependency) => ({ ...dependency })) ?? [],
    primaryBlockerId: card?.primaryBlockerId ?? null,
    primaryBlockerPinned: card?.primaryBlockerPinned ?? false,
    nextStep: card?.nextStep
      ? {
          ...card.nextStep,
          ...(card.nextStep.inputs ? { inputs: [...card.nextStep.inputs] } : {}),
        }
      : null,
  };
}

export function changeDraftDependencies(
  draft: OrchestrationDraft,
  dependencies: TaskDependency[],
): OrchestrationDraft {
  const unresolved = dependencies.filter((dependency) => dependency.state === "unresolved");
  const primaryBlockerId = unresolved.some((dependency) => dependency.id === draft.primaryBlockerId)
    ? draft.primaryBlockerId
    : unresolved[0]?.id ?? null;
  return {
    ...draft,
    dependencies,
    primaryBlockerId,
    primaryBlockerPinned: primaryBlockerId !== null && draft.primaryBlockerPinned,
    dependencyReviewAction: undefined,
  };
}

export function changeDraftNextStep(
  draft: OrchestrationDraft,
  patch: Partial<TaskNextStep>,
  at: string,
): OrchestrationDraft {
  const nextStep: TaskNextStep = {
    summary: "",
    requiresApproval: false,
    ...draft.nextStep,
    ...patch,
    origin: "human",
    updatedAt: at,
  };
  // Keep partial input in the draft; only a wholly blank action means removal.
  const hasContent = [
    nextStep.summary,
    nextStep.actorFamiliarId,
    nextStep.capability,
    nextStep.target,
    ...(nextStep.inputs ?? []),
  ].some((value) => value?.trim()) || nextStep.requiresApproval;
  return {
    ...draft,
    nextStep: hasContent ? nextStep : null,
    dependencyReviewAction: undefined,
  };
}
