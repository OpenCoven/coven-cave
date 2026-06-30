"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/lib/icon";
import { deriveComuxProjects, type ComuxProject } from "@/lib/comux-projects";
import { sessionRailTitle } from "@/lib/session-rail-title";
import { relativeTime } from "@/lib/relative-time";
import type { SessionRow } from "@/lib/types";

type Props = {
  sessions: SessionRow[];
  activeSessionId?: string | null;
  onBack: () => void;
  onOpenSession: (session: SessionRow) => void;
  onNewChat: (projectRoot: string | null) => void;
};

function compactTime(iso: string): string {
  return relativeTime(iso, Date.now(), "compact");
}

function statusClass(status: string): string {
  if (status === "running") return "bg-[var(--color-success)]";
  if (status === "failed") return "bg-[var(--color-danger)]";
  if (status === "queued") return "bg-[var(--color-warning)]";
  return "bg-[var(--text-muted)]";
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
}: Props) {
  const [query, setQuery] = useState("");
  const [expandedRoots, setExpandedRoots] = useState<Set<string>>(() => new Set());

  const projects = useMemo(() => deriveComuxProjects(sessions), [sessions]);
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

      <div className="shrink-0 border-b border-[var(--border-hairline)] px-2 py-2">
        <label className="flex h-7 items-center gap-1.5 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-base)]/55 px-2 focus-within:border-[var(--border-strong)]">
          <Icon name="ph:magnifying-glass" width={12} className="shrink-0 text-[var(--text-muted)]" aria-hidden />
          <input
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
                        {projectSessions.map((session) => {
                          const title = sessionRailTitle(session);
                          const active = activeSessionId === session.id;
                          return (
                            <li key={session.id}>
                              <button
                                type="button"
                                aria-current={active ? "page" : undefined}
                                onClick={() => {
                                  selectProject(project);
                                  onOpenSession(session);
                                }}
                                className={[
                                  "flex min-h-[34px] w-full items-center gap-1.5 py-2 pl-4 pr-2 text-left text-[12px] transition-colors",
                                  active
                                    ? "bg-[var(--bg-raised)] text-[var(--text-primary)]"
                                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]/50 hover:text-[var(--text-primary)]",
                                ].join(" ")}
                              >
                                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusClass(session.status)}`} aria-hidden />
                                <span className="min-w-0 flex-1 truncate" title={title}>{title}</span>
                                <span className="shrink-0 font-mono text-[10px] text-[var(--text-muted)]">
                                  {compactTime(session.updated_at || session.created_at)}
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </nav>
    </div>
  );
}
