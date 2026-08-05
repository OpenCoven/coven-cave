import {
  resolvePathWithinProjectRoot,
  type ProjectRelativePath,
} from "./cave-projects-types.ts";

export type RootedCodeReadingTarget = {
  turnId: string | null;
  sourceSessionId: string | null;
  projectRoot: string | null;
};

export function reconcileCodeReadingTargetRoot<T extends RootedCodeReadingTarget>(
  target: T | null,
  sourceSessionId: string | null,
  turnProjectRoots: ReadonlyMap<string, string | null>,
  liveCreatedSessionId: string | null = null,
): T | null {
  if (!target) return target;
  const canPromote =
    target.sourceSessionId === null &&
    sourceSessionId !== null &&
    liveCreatedSessionId === sourceSessionId &&
    target.turnId !== null &&
    turnProjectRoots.has(target.turnId);
  const promoted =
    canPromote
      ? { ...target, sourceSessionId }
      : target;
  if (
    promoted.projectRoot ||
    !promoted.turnId ||
    !promoted.sourceSessionId ||
    promoted.sourceSessionId !== sourceSessionId
  ) {
    return promoted;
  }

  const projectRoot = turnProjectRoots.get(promoted.turnId);
  return projectRoot ? { ...promoted, projectRoot } : promoted;
}

/** Resolve a code-fence path only when it remains inside its captured root. */
export function resolveCodeReadingTargetPath(
  projectRoot: string | null | undefined,
  targetPath: string | null | undefined,
): ProjectRelativePath | null {
  return resolvePathWithinProjectRoot(projectRoot, targetPath);
}
