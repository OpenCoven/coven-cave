import type { SessionRow } from "./types.ts";
import type { CaveProject } from "./cave-projects.ts";
import { compareProjectsAlphabetically } from "./cave-projects-types.ts";

export type ChatProject = CaveProject;
export type { CaveProject };

export type ChatProjectGroup = {
  projectId: string | null;
  projectRoot: string | null;
  projectName: string | null;
  /** Explicit user-set project color, when the root maps to a registered project. */
  projectColor: string | null;
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
  /** Explicit opener-provided root that maps to no registered project — e.g. a
   *  `.worktrees/<branch>` checkout handed off by the worktree-creation flow.
   *  The chat runs here; it must NOT be re-rooted to a registered project.
   *  Only present when the selection resolved through that path. */
  unregisteredRoot?: string;
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
 * harness session (`--continue` misses in the new dir). An opener-provided
 * root that maps to no registered project (`fallbackProjectRoot`, e.g. a
 * freshly provisioned `.worktrees/<branch>` checkout) resolves to No-project
 * with `unregisteredRoot` carrying the root, so the chat actually runs there.
 * The same applies to an existing session whose recorded cwd lives under a
 * registered project's `.worktrees/` directory: reopened later — when the
 * view's opener root no longer matches — the chat keeps its worktree home
 * instead of degrading to a root-less No-project (cave-k0ra).
 * Only a brand new chat
 * (no session yet) defaults: to the most recent chat's registered project
 * (`recentProjectRoot`, see recentChatProjectRoot) so new chats pick up where
 * the user is actually working, then to the first project.
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
  /** Root of the most recent chat's registered project (recentChatProjectRoot):
   *  the brand-new-chat default when no other context picked a project. */
  recentProjectRoot?: string | null;
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
  // An explicit opener root that maps to no registered project (a
  // `.worktrees/<branch>` checkout from the composer's "New worktree…" flow or
  // the GitHub safe-merge hand-off) is an intentional choice of where the chat
  // runs. Falling through to the recent/first project would silently re-root
  // the chat back into the shared checkout — the exact collision the worktree
  // was created to avoid. Honored for the view's own session too (the root
  // must match), so the worktree context survives the first send; a DIFFERENT
  // session opened into this view keeps its own home instead.
  const explicitRoot = args.fallbackProjectRoot?.trim()
    ? normalizeChatProjectRoot(args.fallbackProjectRoot)
    : null;
  if (
    explicitRoot &&
    (!args.hasSession ||
      (args.sessionProjectRoot?.trim()
        ? normalizeChatProjectRoot(args.sessionProjectRoot) === explicitRoot
        : false))
  ) {
    return { projectId: NO_PROJECT_ID, project: null, unregisteredRoot: explicitRoot };
  }
  // A chat that RAN in a project's worktree keeps that root when reopened
  // later, when the view's opener root no longer matches (cave-k0ra): a
  // recorded cwd under a registered project's `.worktrees/` directory is as
  // intentional as the opener hand-off above — the git chip, env panel, and
  // enhance mode belong to that checkout, not to "No project". Scoped to
  // `.worktrees/` containment on purpose: a session recorded in the
  // familiar's own workspace (or any other unregistered dir) still resolves
  // to bare No-project, so its cwd is never surfaced or re-asserted.
  if (args.hasSession && args.sessionProjectRoot?.trim()) {
    const sessionRoot = normalizeChatProjectRoot(args.sessionProjectRoot);
    const inProjectWorktrees = args.projects.some((project) =>
      sessionRoot.startsWith(`${normalizeChatProjectRoot(project.root)}/.worktrees/`),
    );
    if (inProjectWorktrees) {
      return { projectId: NO_PROJECT_ID, project: null, unregisteredRoot: sessionRoot };
    }
  }
  if (args.hasSession) return { projectId: NO_PROJECT_ID, project: null };
  const recentProject = projectForRoot(args.recentProjectRoot, args.projects);
  if (recentProject) return { projectId: recentProject.id, project: recentProject };
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
const CHAT_HIDDEN_ORIGINS: ReadonlySet<string> = new Set(["cron", "heartbeat", "canvas", "journal", "enhance"]);

/** Legacy fallback for journal runs created before origin:"journal" existed:
 *  their titles are the exact machine prompts (daily-narrative.ts and
 *  journal-generate.ts), so prefix matches are safe — no human titles a chat
 *  this way. */
const LEGACY_JOURNAL_PROMPT_PREFIXES = [
  "Write a short narrative of my day (",
  // Stored titles truncate around 60 chars ("…about my…"), so match the
  // opener, comfortably clear of the cut and still unmistakably machine text.
  "Write a short, first-person reflective journal entry",
] as const;

/** True when the row is a generated run rather than a user-facing chat. */
export function isGeneratedChatSession(session: SessionRow): boolean {
  if (session.generated) return true;
  if (session.origin != null && CHAT_HIDDEN_ORIGINS.has(session.origin)) return true;
  const title = session.title ?? "";
  return LEGACY_JOURNAL_PROMPT_PREFIXES.some((prefix) => title.startsWith(prefix));
}

export function filterVisibleChatSessions(
  sessions: SessionRow[],
  familiarId: string | null,
  opts?: {
    /** Keep Cave-archived rows (`archived_at` set) — the chat list's explicit
     *  "Show archived" toggle. Rails and pickers never opt in, so an archived
     *  chat can't resurface in the siderail through any caller's data path. */
    includeArchived?: boolean;
  },
): SessionRow[] {
  const includeArchived = opts?.includeArchived ?? false;
  return sessions
    .filter((session) => {
      if (session.status === "archived") return false;
      if (session.status === "killed" || session.status === "orphaned" || session.status === "stopped") {
        return session.hasLocalConversation === true;
      }
      return true;
    })
    .filter((session) => includeArchived || !session.archived_at)
    .filter((session) => !isGeneratedChatSession(session))
    .filter((session) => familiarId === null || session.familiarId === familiarId)
    .sort((a, b) => (sessionTimestamp(a) < sessionTimestamp(b) ? 1 : -1));
}

/** The registered project the most recent visible chat ran in, as a root for
 *  resolveChatProjectSelection's `recentProjectRoot` — so a brand-new chat
 *  starts off in the project the user was just working in instead of the
 *  alphabetically-first one. Walks newest-first (all familiars: project
 *  context follows the work across familiar switches) and skips chats whose
 *  recorded cwd maps to no entry in `projects` — an unregistered or
 *  no-project chat can't meaningfully seed a picker that only offers
 *  registered projects, and `projects` is already scoped to the familiar's
 *  grants, so an inaccessible project can never be inherited. */
export function recentChatProjectRoot(
  sessions: SessionRow[],
  projects: CaveProject[],
): string | null {
  if (projects.length === 0) return null;
  for (const session of filterVisibleChatSessions(sessions, null)) {
    const project = projectForRoot(session.project_root, projects);
    if (project) return project.root;
  }
  return null;
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
        projectColor: project?.color ?? null,
        sessions: sorted,
        defaultFamiliarId: latest?.familiarId ?? null,
        updatedAt: latest ? sessionTimestamp(latest) : null,
      };
    })
    .sort((a, b) => {
      if (a.projectRoot === null && b.projectRoot === null) return 0;
      if (a.projectRoot === null) return 1;
      if (b.projectRoot === null) return -1;
      // Latest activity first: the project holding the most recent chat tops
      // the rail, so resuming the current conversation never needs scrolling.
      const byRecency = (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");
      if (byRecency !== 0) return byRecency;
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
