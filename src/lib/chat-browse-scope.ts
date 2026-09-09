import type { CaveProject } from "./cave-projects-types.ts";
import { applyProjectOverrides, type ProjectOverrides } from "./chat-project-overrides.ts";
import { applyProjectScope, type ProjectSelection } from "./chat-project-selection.ts";
import { deriveChatProjectGroups } from "./chat-projects.ts";
import type { SessionRow } from "./types.ts";

/** Browse context is not the open conversation's immutable execution context. */
export type ChatBrowseScope = {
  selection: ProjectSelection;
  ready: boolean;
};

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
