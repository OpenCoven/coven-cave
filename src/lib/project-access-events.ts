import { invalidateChatAccess } from "./chat-access-invalidation.ts";

export const PROJECT_ACCESS_CHANGED_EVENT = "cave:project-access-changed";

export function publishProjectAccessChanged(projectId: string): void {
  const normalized = projectId.trim();
  if (!normalized || typeof window === "undefined") return;
  // Cached transcript keys do not carry a verified project membership map.
  // Discard all admitted chat data rather than guessing which keys are safe.
  invalidateChatAccess({ reason: "policy" });
  window.dispatchEvent(new CustomEvent(PROJECT_ACCESS_CHANGED_EVENT, {
    detail: { projectId: normalized },
  }));
}

export function projectAccessChangedId(event: Event): string | null {
  const projectId = (event as CustomEvent<{ projectId?: unknown }>).detail?.projectId;
  return typeof projectId === "string" && projectId.trim() ? projectId.trim() : null;
}
