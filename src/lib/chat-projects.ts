import type { SessionRow } from "@/lib/types";

export type ChatProject = {
  id: string;
  name: string;
  root: string;
};

export const CHAT_PROJECTS: ChatProject[] = [
  {
    id: "coven-cave",
    name: "Coven Cave",
    root: "/Users/buns/Documents/GitHub/OpenCoven/coven-cave",
  },
  {
    id: "coven",
    name: "Coven",
    root: "/Users/buns/Documents/GitHub/OpenCoven/coven",
  },
  {
    id: "coven-code",
    name: "Coven Code",
    root: "/Users/buns/Documents/GitHub/OpenCoven/coven-code",
  },
  {
    id: "cast-codes",
    name: "CastCodes",
    root: "/Users/buns/Documents/GitHub/OpenCoven/cast-codes",
  },
  {
    id: "coven-docs",
    name: "Coven Docs",
    root: "/Users/buns/Documents/GitHub/OpenCoven/coven-docs",
  },
];

export const DEFAULT_CHAT_PROJECT_ID = "coven-cave";
export const DEFAULT_CHAT_PROJECT =
  CHAT_PROJECTS.find((project) => project.id === DEFAULT_CHAT_PROJECT_ID) ?? CHAT_PROJECTS[0];

const DEAD_CHAT_STATUSES = new Set(["killed", "orphaned", "stopped", "archived"]);

export type ChatProjectGroup = {
  projectId: string | null;
  projectRoot: string | null;
  projectName: string | null;
  sessions: SessionRow[];
  defaultFamiliarId: string | null;
  updatedAt: string | null;
};

export function normalizeChatProjectRoot(root: string): string {
  const normalized = root.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized || "/";
}

export function chatProjectById(projectId: string | null | undefined): ChatProject | null {
  return CHAT_PROJECTS.find((project) => project.id === projectId) ?? null;
}

export function projectForRoot(projectRoot: string | null | undefined): ChatProject | null {
  const normalized = projectRoot?.trim() ? normalizeChatProjectRoot(projectRoot) : "";
  if (!normalized) return null;
  return CHAT_PROJECTS.find((project) => normalizeChatProjectRoot(project.root) === normalized) ?? null;
}

export function projectIdForRoot(projectRoot: string | null | undefined): string | null {
  return projectForRoot(projectRoot)?.id ?? null;
}

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

  for (const project of CHAT_PROJECTS) {
    groups.set(project.root, []);
  }

  for (const session of sessions) {
    const project = projectForRoot(session.project_root);
    const projectRoot = project?.root ?? (session.project_root?.trim() ? normalizeChatProjectRoot(session.project_root) : null);
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
      const project = projectForRoot(projectRoot);
      return {
        projectId: project?.id ?? null,
        projectRoot,
        projectName: project?.name ?? null,
        sessions: sorted,
        defaultFamiliarId: latest?.familiarId ?? null,
        updatedAt: latest ? sessionTimestamp(latest) : null,
      };
    })
    .sort((a, b) => {
      if (a.updatedAt && b.updatedAt) return b.updatedAt.localeCompare(a.updatedAt);
      if (a.updatedAt) return -1;
      if (b.updatedAt) return 1;
      const aKnown = a.projectId ? CHAT_PROJECTS.findIndex((project) => project.id === a.projectId) : -1;
      const bKnown = b.projectId ? CHAT_PROJECTS.findIndex((project) => project.id === b.projectId) : -1;
      if (aKnown >= 0 && bKnown >= 0) return aKnown - bKnown;
      if (aKnown >= 0) return -1;
      if (bKnown >= 0) return 1;
      return (a.projectRoot ?? "").localeCompare(b.projectRoot ?? "");
    });
}

/** Display name for a project group — last path segment, or "No project"
 *  for the null/unscoped group. Mirrors chat-list's local repoName(). */
export function chatProjectName(projectRoot: string | null): string {
  if (!projectRoot) return "No project";
  const project = projectForRoot(projectRoot);
  if (project) return project.name;
  const parts = projectRoot.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? projectRoot;
}
