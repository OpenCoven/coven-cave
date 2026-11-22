/**
 * The project a launch refusal asks a person to confirm, read from the JSON
 * body Chat or Board received (#6560). Only `project_root_unconfirmed` with a
 * server-named project id qualifies: the client never guesses a project from a
 * path, and a moved folder keeps its settings route, where re-pinning is a
 * deliberate choice.
 */
export function refusedUnconfirmedProjectId(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const { code, projectId } = body as { code?: unknown; projectId?: unknown };
  if (code !== "project_root_unconfirmed") return null;
  if (typeof projectId !== "string") return null;
  const id = projectId.trim();
  // Project ids are nanoid-style tokens that go into /api/projects/<id>.
  return /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null;
}
