import type { SessionRow } from "@/lib/types";

const DEAD_CHAT_STATUSES = new Set(["killed", "orphaned", "stopped", "archived"]);

export type ChatProjectGroup = {
  projectRoot: string | null;
  sessions: SessionRow[];
  defaultFamiliarId: string | null;
  updatedAt: string | null;
};

function sessionTimestamp(session: SessionRow): string {
  return session.updated_at || session.created_at;
}

export function filterVisibleChatSessions(
  sessions: SessionRow[],
  familiarId: string | null,
): SessionRow[] {
  return sessions
    .filter((session) => !DEAD_CHAT_STATUSES.has(session.status))
    .filter((session) => familiarId === null || session.familiarId === familiarId)
    .sort((a, b) => (sessionTimestamp(a) < sessionTimestamp(b) ? 1 : -1));
}

export function deriveChatProjectGroups(sessions: SessionRow[]): ChatProjectGroup[] {
  const groups = new Map<string | null, SessionRow[]>();

  for (const session of sessions) {
    const projectRoot = session.project_root?.trim() || null;
    const group = groups.get(projectRoot) ?? [];
    group.push(session);
    groups.set(projectRoot, group);
  }

  return Array.from(groups.entries())
    .map(([projectRoot, rows]) => {
      const sorted = [...rows].sort((a, b) =>
        sessionTimestamp(a) < sessionTimestamp(b) ? 1 : -1,
      );
      const latest = sorted[0] ?? null;
      return {
        projectRoot,
        sessions: sorted,
        defaultFamiliarId: latest?.familiarId ?? null,
        updatedAt: latest ? sessionTimestamp(latest) : null,
      };
    })
    .sort((a, b) => {
      if (a.updatedAt && b.updatedAt) return b.updatedAt.localeCompare(a.updatedAt);
      if (a.updatedAt) return -1;
      if (b.updatedAt) return 1;
      return (a.projectRoot ?? "").localeCompare(b.projectRoot ?? "");
    });
}
