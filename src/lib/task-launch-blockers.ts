/**
 * Launch refusals that only a person can clear, recorded on the task as one
 * system dependency each (#6562). The `ref` keys deduplication and lets the
 * action that clears the refusal resolve it on every card that carries it.
 */

/** The dependency ref for "this project's folder needs confirming" (#6215). */
export function projectFolderBlockerRef(projectId: string): string {
  return `project-folder:${projectId}`;
}

export function projectFolderBlockerLabel(projectName: string, moved = false): string {
  const name = projectName.trim();
  const owner = name ? `${name}’s` : "this project’s";
  return moved
    ? `Confirm where ${owner} folder moved so this task can start`
    : `Confirm ${owner} folder so this task can start`;
}

export function projectFolderConfirmedEvidence(projectName: string, at: string): string {
  const name = projectName.trim() || "The project";
  return `${name}’s folder was confirmed at ${at}`;
}
