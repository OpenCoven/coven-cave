import type { SessionRow } from "./types.ts";
import type { CaveProject } from "./cave-projects.ts";

export type ChatProject = CaveProject;
export type { CaveProject };

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

export function chatProjectById(
  projectId: string | null | undefined,
  projects: CaveProject[],
): CaveProject | null {
  if (!projectId) return null;
  return projects.find((project) => project.id === projectId) ?? null;
}

export function projectForRoot(
  projectRoot: string | null | undefined,
  projects: CaveProject[],
): CaveProject | null {
  const normalized = projectRoot?.trim() ? normalizeChatProjectRoot(projectRoot) : "";
  if (!normalized) return null;
  return projects.find((project) => normalizeChatProjectRoot(project.root) === normalized) ?? null;
}

export function projectIdForRoot(
  projectRoot: string | null | undefined,
  projects: CaveProject[],
): string | null {
  return projectForRoot(projectRoot, projects)?.id ?? null;
}

function sessionTimestamp(session: SessionRow): string {
  return session.updated_at || session.created_at;
}

function projectLeafName(projectRoot: string | null): string | null {
  if (!projectRoot) return null;
  const parts = projectRoot.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.at(-1) ?? projectRoot;
}

function projectNameWithParent(projectRoot: string): string {
  const parts = projectRoot.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length >= 2) return `${parts.at(-2)}/${parts.at(-1)}`;
  return parts[0] ?? projectRoot;
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

export function deriveChatProjectGroups(
  sessions: SessionRow[],
  projects: CaveProject[],
): ChatProjectGroup[] {
  const groups = new Map<string | null, SessionRow[]>();

  for (const session of sessions) {
    const project = projectForRoot(session.project_root, projects);
    const projectRoot = project?.root
      ?? (session.project_root?.trim() ? normalizeChatProjectRoot(session.project_root) : null);
    const group = groups.get(projectRoot) ?? [];
    group.push(session);
    groups.set(projectRoot, group);
  }

  const rootEntries = Array.from(groups.keys()).filter((root): root is string => root !== null);
  const leafCounts = new Map<string, number>();
  for (const root of rootEntries) {
    const leaf = projectLeafName(root);
    if (leaf) leafCounts.set(leaf, (leafCounts.get(leaf) ?? 0) + 1);
  }

  return Array.from(groups.entries())
    .map(([projectRoot, rows]) => {
      const sorted = [...rows].sort((a, b) =>
        sessionTimestamp(a) < sessionTimestamp(b) ? 1 : -1,
      );
      const latest = sorted[0] ?? null;
      const project = projectForRoot(projectRoot, projects);
      const leaf = projectLeafName(projectRoot);
      const inferredProjectName =
        projectRoot && !project && leaf && (leafCounts.get(leaf) ?? 0) > 1
          ? projectNameWithParent(projectRoot)
          : null;
      return {
        projectId: project?.id ?? null,
        projectRoot,
        projectName: project?.name ?? inferredProjectName,
        sessions: sorted,
        defaultFamiliarId: latest?.familiarId ?? null,
        updatedAt: latest ? sessionTimestamp(latest) : null,
      };
    })
    .sort((a, b) => {
      if (a.updatedAt && b.updatedAt) return b.updatedAt.localeCompare(a.updatedAt);
      if (a.updatedAt) return -1;
      if (b.updatedAt) return 1;
      const aKnown = a.projectId ? projects.findIndex((project) => project.id === a.projectId) : -1;
      const bKnown = b.projectId ? projects.findIndex((project) => project.id === b.projectId) : -1;
      if (aKnown >= 0 && bKnown >= 0) return aKnown - bKnown;
      if (aKnown >= 0) return -1;
      if (bKnown >= 0) return 1;
      return (a.projectRoot ?? "").localeCompare(b.projectRoot ?? "");
    });
}

export function chatProjectName(
  projectRoot: string | null,
  projects: CaveProject[],
): string {
  if (!projectRoot) return "No project";
  const project = projectForRoot(projectRoot, projects);
  if (project) return project.name;
  const parts = projectRoot.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? projectRoot;
}
