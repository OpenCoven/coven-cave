/**
 * The project a launch refusal asks a person to confirm, read from the JSON
 * body Chat or Board received (#6560). Only `project_root_unconfirmed` with a
 * server-named project id qualifies: the client never guesses a project from a
 * path, and a moved folder keeps its settings route, where re-pinning is a
 * deliberate choice.
 */
/**
 * The message shown beside an in-place "Confirm folder" button. The server's
 * copy points to project settings, which would contradict the button, so Chat
 * and Board show this instead whenever the button is offered (#6560).
 */
export function confirmFolderInPlaceMessage(projectName?: string | null): string {
  const name = projectName?.trim();
  return `Confirm ${name ? `${name}’s` : "this project’s"} folder to continue. Projects added before folder pinning need this once.`;
}

export function refusedUnconfirmedProjectId(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const { code, projectId } = body as { code?: unknown; projectId?: unknown };
  if (code !== "project_root_unconfirmed") return null;
  if (typeof projectId !== "string") return null;
  const id = projectId.trim();
  // Project ids are nanoid-style tokens that go into /api/projects/<id>.
  return /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null;
}
