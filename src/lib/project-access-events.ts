export const PROJECT_ACCESS_CHANGED_EVENT = "cave:project-access-changed";

export function publishProjectAccessChanged(projectId: string): void {
  const normalized = projectId.trim();
  if (!normalized || typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(PROJECT_ACCESS_CHANGED_EVENT, {
    detail: { projectId: normalized },
  }));
}

export function projectAccessChangedId(event: Event): string | null {
  const projectId = (event as CustomEvent<{ projectId?: unknown }>).detail?.projectId;
  return typeof projectId === "string" && projectId.trim() ? projectId.trim() : null;
}
