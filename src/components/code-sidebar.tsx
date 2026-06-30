"use client";

import { useMemo, useRef, useState } from "react";
import { Icon, type IconName } from "@/lib/icon";
import { deriveComuxProjects, type ComuxProject } from "@/lib/comux-projects";
import { sessionRailTitle } from "@/lib/session-rail-title";
import { relativeTime } from "@/lib/relative-time";
import { useSessionPins } from "@/lib/use-session-pins";
import { toggleSessionPin } from "@/lib/session-pins";
import type { SessionRow } from "@/lib/types";

type Props = {
  sessions: SessionRow[];
  activeSessionId?: string | null;
  onBack: () => void;
  onOpenSession: (session: SessionRow) => void;
  onNewChat: (projectRoot: string | null) => void;
  onDeleteSession: (session: SessionRow) => Promise<void>;
  userName?: string;
  userPlan?: string;
  scheduledCount?: number;
};

function navigateMode(mode: string) {
  window.dispatchEvent(new CustomEvent("cave:navigate-mode", { detail: { mode } }));
}

// Deep-link targets for the Code-nav shortcuts: Scheduled → Automations,
// Plugins → the Plugins/Marketplace surface.
const NAV_TARGETS = { scheduled: { mode: "inbox" }, plugins: { mode: "marketplace" } } as const;

function compactTime(iso: string): string {
  return relativeTime(iso, Date.now(), "compact");
}

function statusClass(status: string): string {
  if (status === "running") return "bg-[var(--color-success)]";
  if (status === "failed") return "bg-[var(--color-danger)]";
  if (status === "queued") return "bg-[var(--color-warning)]";
  return "bg-[var(--text-muted)]";
}

function threadLeadingIcon(title: string): IconName | null {
  if (/^\s*resolve\s+pr\b|\bpr\s*#?\d+/i.test(title)) return "ph:git-pull-request";
  if (/\bbranch\b|\bmerge\b|\brebase\b/i.test(title)) return "ph:git-branch";
  return null;
}

function sessionsForProject(sessions: SessionRow[], project: ComuxProject): SessionRow[] {
  return sessions
    .filter((session) => session.project_root?.replace(/\\/g, "/").replace(/\/+$/, "") === project.root)
    .sort((a, b) => (b.updated_at || b.created_at).localeCompare(a.updated_at || a.created_at));
}

export function CodeSidebar({
  sessions,
  activeSessionId,
  onBack,
  onOpenSession,
  onNewChat,
  onDeleteSession,
  userName,
  userPlan = "Pro",
  scheduledCount,
}: Props) {
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const [expandedRoots, setExpandedRoots] = useState<Set<string>>(() => new Set());
  const [confirmingSessionId, setConfirmingSessionId] = useState<string | null>(null);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);

  const projects = useMemo(() => deriveComuxProjects(sessions), [sessions]);
  const pinnedIds = useSessionPins();
  const [showAllByRoot, setShowAllByRoot] = useState<Set<string>>(() => new Set());
  const THREADS_PREVIEW = 5;
  const pinnedSessions = useMemo(
    () => pinnedIds
      .map((id) => sessions.find((s) => s.id === id))
      .filter((s): s is SessionRow => Boolean(s)),
    [pinnedIds, sessions],
  );
  const visibleProjects = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((project) => {
      if (project.name.toLowerCase().includes(q) || project.root.toLowerCase().includes(q)) return true;
      return sessionsForProject(sessions, project).some((session) =>
        sessionRailTitle(session).toLowerCase().includes(q),
      );
    });
  }, [projects, query, sessions]);

  const toggleProject = (root: string) => {
    setExpandedRoots((current) => {
      const next = new Set(current);
      if (next.has(root)) next.delete(root);
      else next.add(root);
      return next;
    });
  };

  const selectProject = (project: ComuxProject) => {
    window.dispatchEvent(new CustomEvent("cave:code-select-project", { detail: { root: project.root } }));
  };

  return (
    <div className="code-sidebar flex h-full min-h-0 flex-col bg-[color-mix(in_oklch,var(--bg-raised)_88%,transparent)]">
      {/* Collapsed rail — when the nav panel is collapsed the shell adds
          `.shell-nav--rail`, which CSS uses to hide the full sidebar and show
          this vertical "Sessions" label instead of a bare clipped icon (mirrors
          the comux Details/Preview rails). Clicking it reopens the panel. */}
      <button
        type="button"
        className="code-sidebar__rail focus-ring"
        aria-label="Expand sessions"
        title="Expand sessions"
        onClick={() => window.dispatchEvent(new CustomEvent("cave:toggle-left-panel"))}
      >
        <Icon name="ph:sidebar-simple" width={15} aria-hidden />
        <span className="code-sidebar__rail-label">Sessions</span>
      </button>

      <div className="code-sidebar__full flex min-h-0 flex-1 flex-col">
      <header className="code-sidebar__header flex shrink-0 items-center gap-2 border-b border-[var(--border-hairline)] px-2 py-2">
        <button
          type="button"
          aria-label="Back to previous surface"
          title="Back to previous surface"
          onClick={onBack}
          className="focus-ring grid h-7 w-7 shrink-0 place-items-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
        >
          <Icon name="ph:arrow-left-bold" width={13} aria-hidden />
        </button>
        <div className="min-w-0">
          <div className="truncate text-[12px] font-semibold text-[var(--text-primary)]">Code</div>
          <div className="truncate text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Projects</div>
        </div>
      </header>

      <nav aria-label="Code navigation" className="shrink-0 border-b border-[var(--border-hairline)] px-1.5 py-1.5">
        {[
          { key: "new", label: "New chat", icon: "ph:pencil-simple" as IconName, count: undefined as number | undefined, onClick: () => onNewChat(null) },
          { key: "search", label: "Search", icon: "ph:magnifying-glass" as IconName, count: undefined as number | undefined, onClick: () => searchRef.current?.focus() },
          { key: "scheduled", label: "Scheduled", icon: "ph:clock" as IconName, count: scheduledCount, onClick: () => navigateMode(NAV_TARGETS.scheduled.mode) },
          { key: "plugins", label: "Plugins", icon: "ph:plugs" as IconName, count: undefined as number | undefined, onClick: () => navigateMode(NAV_TARGETS.plugins.mode) },
        ].map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={item.onClick}
            className="focus-ring flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
          >
            <Icon name={item.icon} width={14} className="shrink-0 text-[var(--text-muted)]" aria-hidden />
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {typeof item.count === "number" && item.count > 0 ? (
              <span className="shrink-0 rounded-full bg-[var(--bg-raised)] px-1.5 text-[10px] font-mono text-[var(--text-muted)]">{item.count}</span>
            ) : null}
          </button>
        ))}
      </nav>

      <div className="shrink-0 border-b border-[var(--border-hairline)] px-2 py-2">
        <label className="flex h-7 items-center gap-1.5 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-base)]/55 px-2 focus-within:border-[var(--border-strong)]">
          <Icon name="ph:magnifying-glass" width={12} className="shrink-0 text-[var(--text-muted)]" aria-hidden />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search projects or threads..."
            aria-label="Search Code projects and threads"
            className="min-w-0 flex-1 bg-transparent text-[12px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
          />
          {query ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setQuery("")}
              className="text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
            >
              <Icon name="ph:x-bold" width={10} aria-hidden />
            </button>
          ) : null}
        </label>
      </div>

      <nav aria-label="Code projects and threads" className="min-h-0 flex-1 overflow-y-auto pb-2">
        {pinnedSessions.length > 0 ? (
          <section aria-label="Pinned threads" className="border-b border-[var(--border-hairline)] py-1">
            <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">Pinned</div>
            <ul>
              {pinnedSessions.map((session) => {
                const title = sessionRailTitle(session);
                const active = activeSessionId === session.id;
                return (
                  <li key={`pin-${session.id}`}>
                    <button
                      type="button"
                      aria-current={active ? "page" : undefined}
                      onClick={() => onOpenSession(session)}
                      className={`focus-ring flex min-h-[32px] w-full items-center gap-1.5 py-1.5 pl-3 pr-2 text-left text-[12px] ${active ? "bg-[var(--bg-raised)] text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]/50 hover:text-[var(--text-primary)]"}`}
                    >
                      <Icon name="ph:push-pin-fill" width={11} className="shrink-0 text-[var(--text-muted)]" aria-hidden />
                      <span className="min-w-0 flex-1 truncate" title={title}>{title}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
        {visibleProjects.length === 0 ? (
          <p className="px-3 py-4 text-center text-[11px] text-[var(--text-muted)]">
            No code projects yet.
          </p>
        ) : (
          <ul>
            {visibleProjects.map((project) => {
              const projectSessions = sessionsForProject(sessions, project);
              const expanded = expandedRoots.has(project.root) || query.trim().length > 0;
              return (
                <li key={project.root}>
                  <div className="group relative flex items-center border-b border-[var(--border-hairline)] bg-[color-mix(in_oklch,var(--bg-base)_86%,var(--foreground)_14%)]">
                    <button
                      type="button"
                      aria-expanded={expanded}
                      aria-label={`${expanded ? "Collapse" : "Expand"} ${project.name} threads`}
                      onClick={() => {
                        selectProject(project);
                        toggleProject(project.root);
                      }}
                      className="focus-ring flex min-h-[38px] min-w-0 flex-1 items-center gap-1.5 rounded py-2 pl-2 pr-8 text-left text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                    >
                      <Icon name={expanded ? "ph:caret-down" : "ph:caret-right"} width={10} className="shrink-0 text-[var(--text-muted)]" aria-hidden />
                      <Icon name={expanded ? "ph:folder-open" : "ph:folder"} width={13} className="shrink-0 text-[var(--text-muted)]" aria-hidden />
                      <span className="min-w-0 flex-1 truncate font-semibold text-[var(--text-primary)]" title={project.root}>
                        {project.name}
                      </span>
                      <span className="shrink-0 font-mono text-[11px] text-[var(--text-muted)]">{projectSessions.length}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        selectProject(project);
                        onNewChat(project.root);
                      }}
                      title={`New code chat in ${project.name}`}
                      aria-label={`New code chat in ${project.name}`}
                      className="touch-always-visible focus-ring absolute right-1 grid h-5 w-5 place-items-center rounded text-[var(--text-muted)] opacity-0 transition-opacity hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)] focus-visible:opacity-100 group-hover:opacity-100"
                    >
                      <Icon name="ph:plus" width={11} aria-hidden />
                    </button>
                  </div>
                  {expanded ? (
                    projectSessions.length === 0 ? (
                      <p className="py-1 pl-8 pr-3 text-[11px] text-[var(--text-muted)]">No threads yet.</p>
                    ) : (
                      <ul>
                        {(showAllByRoot.has(project.root) ? projectSessions : projectSessions.slice(0, THREADS_PREVIEW)).map((session) => {
                          const title = sessionRailTitle(session);
                          const active = activeSessionId === session.id;
                          const isPinnedRow = pinnedIds.includes(session.id);
                          const confirming = confirmingSessionId === session.id;
                          const deleting = deletingSessionId === session.id;
                          return (
                            <li key={session.id}>
                              <div
                                className={[
                                  "group/code-thread flex min-h-[34px] w-full items-center gap-1.5 transition-colors",
                                  active
                                    ? "bg-[var(--bg-raised)] text-[var(--text-primary)]"
                                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]/50 hover:text-[var(--text-primary)]",
                                ].join(" ")}
                              >
                                <button
                                  type="button"
                                  aria-current={active ? "page" : undefined}
                                  onClick={() => {
                                    selectProject(project);
                                    onOpenSession(session);
                                  }}
                                  className="focus-ring flex min-h-[34px] min-w-0 flex-1 items-center gap-1.5 rounded py-2 pl-4 pr-1 text-left text-[12px]"
                                >
                                  {(() => {
                                    const glyph = threadLeadingIcon(title);
                                    return glyph ? (
                                      <Icon name={glyph} width={12} className="shrink-0 text-[var(--text-muted)]" aria-hidden />
                                    ) : (
                                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusClass(session.status)}`} aria-hidden />
                                    );
                                  })()}
                                  <span className="min-w-0 flex-1 truncate" title={title}>{title}</span>
                                  {confirming ? null : (
                                    <span className="shrink-0 font-mono text-[10px] text-[var(--text-muted)]">
                                      {compactTime(session.updated_at || session.created_at)}
                                    </span>
                                  )}
                                </button>
                                {confirming ? (
                                  <span className="flex shrink-0 items-center gap-1 pr-1">
                                    <button
                                      type="button"
                                      onClick={() => setConfirmingSessionId(null)}
                                      className="focus-ring rounded px-1.5 py-0.5 text-[10px] text-[var(--text-muted)] hover:bg-[var(--bg-hover)]"
                                    >
                                      Cancel
                                    </button>
                                    <button
                                      type="button"
                                      disabled={deleting}
                                      onClick={async () => {
                                        setDeletingSessionId(session.id);
                                        try {
                                          await onDeleteSession(session);
                                          setConfirmingSessionId(null);
                                        } finally {
                                          setDeletingSessionId(null);
                                        }
                                      }}
                                      className="focus-ring rounded border border-[var(--color-danger)]/50 bg-[var(--color-danger)]/10 px-1.5 py-0.5 text-[10px] text-[var(--color-danger)] hover:bg-[var(--color-danger)]/15 disabled:opacity-50"
                                    >
                                      {deleting ? "Deleting..." : "Delete"}
                                    </button>
                                  </span>
                                ) : (
                                  <>
                                    <button
                                      type="button"
                                      title={isPinnedRow ? "Unpin thread" : "Pin thread"}
                                      aria-label={isPinnedRow ? `Unpin ${title}` : `Pin ${title}`}
                                      onClick={() => toggleSessionPin(session.id)}
                                      className="touch-always-visible focus-ring grid h-5 w-5 shrink-0 place-items-center rounded text-[var(--text-muted)] opacity-0 transition-opacity hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)] focus-visible:opacity-100 group-hover/code-thread:opacity-100"
                                    >
                                      <Icon name={isPinnedRow ? "ph:push-pin-fill" : "ph:push-pin"} width={11} aria-hidden />
                                    </button>
                                    <button
                                      type="button"
                                      title="Delete thread"
                                      aria-label={`Delete thread ${title}`}
                                      onClick={() => setConfirmingSessionId(session.id)}
                                      className="touch-always-visible focus-ring mr-1 grid h-5 w-5 shrink-0 place-items-center rounded text-[var(--text-muted)] opacity-55 transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--color-danger)] focus-visible:opacity-100 group-hover/code-thread:opacity-100"
                                    >
                                      <Icon name="ph:x-bold" width={10} aria-hidden />
                                    </button>
                                  </>
                                )}
                              </div>
                            </li>
                          );
                        })}
                        {projectSessions.length > THREADS_PREVIEW && !showAllByRoot.has(project.root) ? (
                          <li>
                            <button
                              type="button"
                              onClick={() => setShowAllByRoot((cur) => new Set(cur).add(project.root))}
                              className="focus-ring w-full py-1.5 pl-8 pr-3 text-left text-[11px] text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                            >
                              Show more
                            </button>
                          </li>
                        ) : null}
                      </ul>
                    )
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </nav>

      <footer className="code-sidebar__footer code-sidebar__user mt-auto flex shrink-0 items-center gap-2 border-t border-[var(--border-hairline)] px-3 py-2">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[var(--bg-raised)] text-[11px] font-semibold text-[var(--text-primary)]" aria-hidden>
          {(userName ?? "You").split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12px] font-medium text-[var(--text-primary)]">{userName ?? "You"}</span>
          <span className="block truncate text-[10px] text-[var(--text-muted)]">{userPlan}</span>
        </span>
      </footer>
      </div>
    </div>
  );
}
