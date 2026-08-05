export type RootedCodeReadingTarget = {
  turnId: string | null;
  sourceSessionId: string | null;
  projectRoot: string | null;
};

export function reconcileCodeReadingTargetRoot<T extends RootedCodeReadingTarget>(
  target: T | null,
  sourceSessionId: string | null,
  turnProjectRoots: ReadonlyMap<string, string | null>,
): T | null {
  if (
    !target ||
    target.projectRoot ||
    !target.turnId ||
    !target.sourceSessionId ||
    target.sourceSessionId !== sourceSessionId
  ) {
    return target;
  }
  const projectRoot = turnProjectRoots.get(target.turnId);
  return projectRoot ? { ...target, projectRoot } : target;
}
