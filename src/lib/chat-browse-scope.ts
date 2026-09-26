import type { CaveProject } from "./cave-projects-types.ts";
import { applyProjectOverrides, type ProjectOverrides } from "./chat-project-overrides.ts";
import { applyProjectScope, type ProjectSelection } from "./chat-project-selection.ts";
import { deriveChatProjectGroups } from "./chat-projects.ts";
import type { SessionRow } from "./types.ts";

/** Browse context is not the open conversation's immutable execution context. */
export type ChatBrowseScope = {
  selection: ProjectSelection;
  ready: boolean;
  /** Not ready only because context is still arriving (hydration, a project
   *  fetch), as opposed to a failure. Loading is never shown as an error. */
  loading?: boolean;
};

export type ProjectsLoadState = {
  loaded: boolean;
  loading: boolean;
  error: string | null;
};

/**
 * The scope a surface can actually filter by: the workspace's scope, further
 * gated on that surface's own familiar-scoped project fetch (#5585). One helper
 * for ChatSurface and the rail so the two can't disagree about readiness.
 */
export function effectiveChatBrowseScope(
  scope: ChatBrowseScope | undefined,
  projects: ProjectsLoadState,
): ChatBrowseScope | undefined {
  if (!scope) return undefined;
  const projectsReady = scope.selection === "all" || (projects.loaded && !projects.loading && projects.error === null);
  const ready = scope.ready && projectsReady;
  const loading = !ready && (scope.ready ? projects.error === null : Boolean(scope.loading));
  return { ...scope, ready, loading };
}

/** Copy for a scoped chat list with no rows to show. */
export function chatBrowseEmptyMessage(scope: ChatBrowseScope | undefined, hasSearch = false): string {
  if (hasSearch) return "No threads match your search.";
  if (scope && !scope.ready) {
    return scope.loading
      ? "Loading this project's chats…"
      : "Project context is unavailable. Choose another project or retry.";
  }
  if (scope && scope.selection !== "all") return "No chats in this project. Start a chat or choose another project.";
  return "No conversations yet.";
}

export function blankChatProjectRoot(
  openerRoot: string | undefined,
  openerSelection: ProjectSelection | undefined,
  currentSelection: ProjectSelection | undefined,
  currentRoot: string | null | undefined,
): string | undefined {
  if (currentSelection === undefined) return openerRoot;
  // Task/worktree launches retain their explicit cwd until the user changes
  // the global project. Hydrating the same project never re-roots that launch.
  if (openerSelection === currentSelection) return openerRoot ?? currentRoot ?? undefined;
  return currentRoot ?? undefined;
}

export function scopeChatBrowseSessions(
  sessions: SessionRow[],
  projects: CaveProject[],
  overrides: ProjectOverrides,
  scope?: ChatBrowseScope,
): SessionRow[] {
  if (!scope) return sessions;
  if (!scope.ready) return [];
  if (scope.selection === "all") return sessions;
  const groups = deriveChatProjectGroups(applyProjectOverrides(sessions, overrides), projects);
  const ids = new Set(
    applyProjectScope(groups, scope.selection).flatMap((group) => group.sessions.map((session) => session.id)),
  );
  // Only membership follows an organizational override. Opening a row must
  // still receive its recorded cwd/runtime, never the display folder's root.
  return sessions.filter((session) => ids.has(session.id));
}

export function retainOpenChatSession(
  previous: SessionRow | null,
  sessions: SessionRow[],
  sessionId: string | null,
): SessionRow | null {
  if (!sessionId) return null;
  return sessions.find((session) => session.id === sessionId)
    ?? (previous?.id === sessionId ? previous : null);
}
