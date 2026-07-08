import type { SessionRow } from "./types.ts";
import type { CaveProject } from "./cave-projects.ts";
import { compareProjectsAlphabetically } from "./cave-projects-types.ts";

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

/** Sentinel picker id for "this chat runs outside every registered project"
 *  (typically the familiar's own workspace). A real id so it can live in the
 *  same draft-state slot as project ids, distinct from null = "unresolved". */
export const NO_PROJECT_ID = "__no-project__";

export type ChatProjectSelection = {
  /** NO_PROJECT_ID, a registered project id, or null (new chat, nothing picked yet). */
  projectId: string | null;
  /** The registered project the chat is scoped to; null for no-project. */
  project: CaveProject | null;
};

/**
 * Resolve which project a chat is scoped to, for both the picker display and
 * the projectRoot asserted on send.
 *
 * A user-set draft wins. Then the linked task's project: a chat tied to a
 * board card belongs in that card's project even when the session was first
 * recorded elsewhere (a task chat mis-rooted in the app's own cwd otherwise
 * displays — and keeps running in — the wrong project). Otherwise the
 * session's recorded cwd (or the opener surface's root) maps to its
 * registered project. An EXISTING session whose recorded cwd maps to no
 * registered project is "No project" — it runs in the familiar's own
 * workspace or another unregistered dir, and defaulting it to the first
 * registered project would re-root the next turn's cwd there and fork the
 * harness session (`--continue` misses in the new dir). Only a brand new chat
 * (no session yet) defaults to the first project.
 */
export function resolveChatProjectSelection(args: {
  draftId: string | null;
  hasSession: boolean;
  sessionProjectRoot: string | null | undefined;
  fallbackProjectRoot: string | null | undefined;
  /** Project association of the chat's linked task (board card), when any:
   *  the card's stable projectId, with its cwd as a fallback mapping. */
  taskProjectId?: string | null;
  taskCwd?: string | null;
  projects: CaveProject[];
}): ChatProjectSelection {
  const firstProject = args.projects[0] ?? null;
  if (args.draftId === NO_PROJECT_ID) return { projectId: NO_PROJECT_ID, project: null };
  if (args.draftId) {
    return {
      projectId: args.draftId,
      project: chatProjectById(args.draftId, args.projects) ?? firstProject,
    };
  }
  const taskProject =
    chatProjectById(args.taskProjectId, args.projects) ?? projectForRoot(args.taskCwd, args.projects);
  if (taskProject) return { projectId: taskProject.id, project: taskProject };
  const mappedId = projectIdForRoot(
    args.sessionProjectRoot ?? args.fallbackProjectRoot,
    args.projects,
  );
  if (mappedId) return { projectId: mappedId, project: chatProjectById(mappedId, args.projects) };
  if (args.hasSession) return { projectId: NO_PROJECT_ID, project: null };
  return { projectId: null, project: firstProject };
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

// Sessions that exist because a generator ran — canvas refines, cron and
// heartbeat automations — not because someone opened a chat. They stay
// reachable from their origination surfaces (Canvas, Schedules, Work Queue);
// listing them here is just noise between real conversations.
const CHAT_HIDDEN_ORIGINS: ReadonlySet<string> = new Set(["cron", "heartbeat", "canvas"]);

/** True when the row is a generated run rather than a user-facing chat. */
export function isGeneratedChatSession(session: SessionRow): boolean {
  if (session.generated) return true;
  return session.origin != null && CHAT_HIDDEN_ORIGINS.has(session.origin);
}

export function filterVisibleChatSessions(
  sessions: SessionRow[],
  familiarId: string | null,
): SessionRow[] {
  return sessions
    .filter((session) => !DEAD_CHAT_STATUSES.has(session.status))
    .filter((session) => !isGeneratedChatSession(session))
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
      if (a.projectRoot === null && b.projectRoot === null) return 0;
      if (a.projectRoot === null) return 1;
      if (b.projectRoot === null) return -1;
      const aProject = a.projectId ? projects.find((project) => project.id === a.projectId) : null;
      const bProject = b.projectId ? projects.find((project) => project.id === b.projectId) : null;
      if (aProject && bProject) return compareProjectsAlphabetically(aProject, bProject);
      const aLabel = a.projectName ?? chatProjectName(a.projectRoot, projects);
      const bLabel = b.projectName ?? chatProjectName(b.projectRoot, projects);
      const byLabel = aLabel.localeCompare(bLabel, undefined, { sensitivity: "base", numeric: true });
      if (byLabel !== 0) return byLabel;
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
