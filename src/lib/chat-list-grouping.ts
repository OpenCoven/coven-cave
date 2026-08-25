import { applyProjectOverrides, type ProjectOverrides } from "./chat-project-overrides.ts";
import {
  deriveChatProjectGroups,
  type CaveProject,
  type ChatProjectGroup,
  type ChatProjectIndex,
} from "./chat-projects.ts";
import type { SessionRow } from "./types.ts";

export type ChatListProjectGroups = {
  grouped: ChatProjectGroup[];
  sidebarGroups: ChatProjectGroup[];
};

/** Strip archived rows in one pass while retaining identity when no work is needed. */
export function withoutArchivedChatSessions(sessions: SessionRow[]): SessionRow[] {
  let visible: SessionRow[] | null = null;

  for (let index = 0; index < sessions.length; index += 1) {
    const session = sessions[index];
    if (session.archived_at) {
      visible ??= sessions.slice(0, index);
    } else if (visible) {
      visible.push(session);
    }
  }

  return visible ?? sessions;
}

/**
 * Build the filtered-list and stable-rail project groups together.
 *
 * The default chat-list view feeds the same sessions to both surfaces. Keep
 * that identity through project overrides so the O(sessions + projects)
 * grouping pass runs once instead of twice. Search, status, archive, and kind
 * filters still produce distinct inputs and therefore distinct group sets.
 */
export function deriveChatListProjectGroups(
  filteredSessions: SessionRow[],
  railSessions: SessionRow[],
  projects: CaveProject[],
  projectIndex: ChatProjectIndex,
  overrides: ProjectOverrides,
): ChatListProjectGroups {
  const groupedSessions = applyProjectOverrides(filteredSessions, overrides);
  const railGroupedSessions = filteredSessions === railSessions
    ? groupedSessions
    : applyProjectOverrides(railSessions, overrides);
  const grouped = deriveChatProjectGroups(groupedSessions, projects, projectIndex, {
    sessionsNewestFirst: true,
  });
  const sidebarGroups = railGroupedSessions === groupedSessions
    ? grouped
    : deriveChatProjectGroups(railGroupedSessions, projects, projectIndex, {
      sessionsNewestFirst: true,
    });

  return { grouped, sidebarGroups };
}
