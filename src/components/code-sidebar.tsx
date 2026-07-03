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
  /** Selected familiar (null = "All familiars"). When set, the project list and
   *  every per-project session count/row is scoped to this familiar so the
   *  navigator matches the familiar-filtered thread list rather than tallying
   *  every familiar's chats in a shared project. */
  activeFamiliarId?: string | null;
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
  activeFamiliarId = null,
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

  // Scope to the selected familiar (null = All → count everything) so the project
  // list, counts, rows, and pinned threads reflect only that familiar's chats.
  const scopedSessions = useMemo(
    () =>
      activeFamiliarId
        ? sessions.filter((session) => session.familiarId === activeFamiliarId)
        : sessions,
    [sessions, activeFamiliarId],
  );

  const projects = useMemo(() => deriveComuxProjects(scopedSessions), [scopedSessions]);
  const pinnedIds = useSessionPins();
  const [showAllByRoot, setShowAllByRoot] = useState<Set<string>>(() => new Set());
  const THREADS_PREVIEW = 5;
  const pinnedSessions = useMemo(
    () => pinnedIds
      .map((id) => scopedSessions.find((s) => s.id === id))
      .filter((s): s is SessionRow => Boolean(s)),
    [pinnedIds, scopedSessions],
  );
  const visibleProjects = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((project) => {
      if (project.name.toLowerCase().includes(q) || project.root.toLowerCase().includes(q)) return true;
      return sessionsForProject(scopedSessions, project).some((session) =>
        sessionRailTitle(session).toLowerCase().includes(q),
      );
    });
  }, [projects, query, scopedSessions]);

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

  const initials = (userName ?? "You").split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();

  return (
    <div className="code-sidebar flex h-full min-h-0 flex-col">
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

      <div className="code-sidebar__full cnav">
        <header className="cnav__header">
          <button
            type="button"
            aria-label="Back to previous surface"
            title="Back to previous surface"
            onClick={onBack}
            className="cnav__back focus-ring"
          >
            <Icon name="ph:arrow-left" width={15} aria-hidden />
          </button>
          <div className="min-w-0">
            <div className="cnav__title">Code</div>
          </div>
        </header>

        <div className="cnav__quick">
          <button type="button" onClick={() => onNewChat(null)} className="cnav__new focus-ring">
            <Icon name="ph:pencil-simple" width={15} className="cnav__new-icon" aria-hidden />
            <span className="cnav__new-label">New session</span>
            <span className="cnav__kbd" aria-hidden>⌘N</span>
          </button>
          <div className="cnav__mini-row">
            <button type="button" onClick={() => navigateMode(NAV_TARGETS.scheduled.mode)} className="cnav__mini focus-ring">
              <Icon name="ph:clock" width={14} className="cnav__mini-icon" aria-hidden />
              <span className="cnav__mini-label">Scheduled</span>
              {typeof scheduledCount === "number" && scheduledCount > 0 ? (
                <span className="cnav__mini-count">{scheduledCount}</span>
              ) : null}
            </button>
            <button type="button" onClick={() => navigateMode(NAV_TARGETS.plugins.mode)} className="cnav__mini focus-ring">
              <Icon name="ph:plugs" width={14} className="cnav__mini-icon" aria-hidden />
              <span className="cnav__mini-label">Plugins</span>
            </button>
          </div>
        </div>

        <div className="cnav__search-wrap">
          <label className="cnav__search">
            <Icon name="ph:magnifying-glass" width={13} className="cnav__search-icon" aria-hidden />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search projects or threads…"
              aria-label="Search Code projects and threads"
            />
            {query ? (
              <button type="button" aria-label="Clear search" onClick={() => setQuery("")} className="cnav__search-clear">
                <Icon name="ph:x-bold" width={9} aria-hidden />
              </button>
            ) : null}
          </label>
        </div>

        <nav aria-label="Code projects and threads" className="cnav__scroll">
          {pinnedSessions.length > 0 ? (
            <section aria-label="Pinned threads">
              <div className="cnav__label">Pinned</div>
              <ul>
                {pinnedSessions.map((session) => {
                  const title = sessionRailTitle(session);
                  const active = activeSessionId === session.id;
                  return (
                    <li key={`pin-${session.id}`}>
                      <div className={`cnav__thread${active ? " is-active" : ""}`}>
                        <button
                          type="button"
                          aria-current={active ? "page" : undefined}
                          onClick={() => onOpenSession(session)}
                          className="cnav__thread-main focus-ring"
                        >
                          <Icon name="ph:push-pin-fill" width={12} className="cnav__lead is-accent" aria-hidden />
                          <span className="cnav__thread-title" title={title}>{title}</span>
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}
          {visibleProjects.length === 0 ? (
            <p className="cnav__empty">No code projects yet.</p>
          ) : (
            <ul>
              {visibleProjects.map((project) => {
                const projectSessions = sessionsForProject(scopedSessions, project);
                const expanded = expandedRoots.has(project.root) || query.trim().length > 0;
                return (
                  <li key={project.root} className={`cnav__group${expanded ? "" : " is-collapsed"}`}>
                    <div className="cnav__group-head">
                      <button
                        type="button"
                        aria-expanded={expanded}
                        aria-label={`${expanded ? "Collapse" : "Expand"} ${project.name} threads`}
                        onClick={() => {
                          selectProject(project);
                          toggleProject(project.root);
                        }}
                        className="cnav__group-toggle focus-ring"
                      >
                        <Icon name="ph:caret-down" width={10} className="cnav__chev" aria-hidden />
                        <Icon name={expanded ? "ph:folder-open" : "ph:folder"} width={14} className="cnav__folder" aria-hidden />
                        <span className="cnav__group-name" title={project.root}>
                          {project.name}
                        </span>
                        <span className="cnav__count">{projectSessions.length}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          selectProject(project);
                          onNewChat(project.root);
                        }}
                        title={`New code chat in ${project.name}`}
                        aria-label={`New code chat in ${project.name}`}
                        className="cnav__icon-btn focus-ring"
                      >
                        <Icon name="ph:plus" width={12} aria-hidden />
                      </button>
                    </div>
                    {expanded ? (
                      projectSessions.length === 0 ? (
                        <p className="cnav__thread-empty">No threads yet.</p>
                      ) : (
                        <ul>
                          {(showAllByRoot.has(project.root) ? projectSessions : projectSessions.slice(0, THREADS_PREVIEW)).map((session) => {
                            const title = sessionRailTitle(session);
                            const active = activeSessionId === session.id;
                            const isPinnedRow = pinnedIds.includes(session.id);
                            const confirming = confirmingSessionId === session.id;
                            const deleting = deletingSessionId === session.id;
                            const glyph = threadLeadingIcon(title);
                            return (
                              <li key={session.id}>
                                <div className={`cnav__thread${active ? " is-active" : ""}`}>
                                  <button
                                    type="button"
                                    aria-current={active ? "page" : undefined}
                                    onClick={() => {
                                      selectProject(project);
                                      onOpenSession(session);
                                    }}
                                    className="cnav__thread-main focus-ring"
                                  >
                                    {glyph ? (
                                      <Icon name={glyph} width={13} className="cnav__lead" aria-hidden />
                                    ) : (
                                      <span className={`cnav__dot ${statusClass(session.status)}`} aria-hidden />
                                    )}
                                    <span className="cnav__thread-title" title={title}>{title}</span>
                                    {confirming ? null : (
                                      <span className="cnav__time">
                                        {compactTime(session.updated_at || session.created_at)}
                                      </span>
                                    )}
                                  </button>
                                  {confirming ? (
                                    <span className="cnav__confirm">
                                      <button type="button" onClick={() => setConfirmingSessionId(null)} className="cnav__confirm-cancel focus-ring">
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
                                        className="cnav__confirm-del focus-ring"
                                      >
                                        {deleting ? "Deleting…" : "Delete"}
                                      </button>
                                    </span>
                                  ) : (
                                    <>
                                      <button
                                        type="button"
                                        title={isPinnedRow ? "Unpin thread" : "Pin thread"}
                                        aria-label={isPinnedRow ? `Unpin ${title}` : `Pin ${title}`}
                                        onClick={() => toggleSessionPin(session.id)}
                                        className={`cnav__icon-btn focus-ring${isPinnedRow ? " is-on" : ""}`}
                                      >
                                        <Icon name={isPinnedRow ? "ph:push-pin-fill" : "ph:push-pin"} width={11} aria-hidden />
                                      </button>
                                      <button
                                        type="button"
                                        title="Delete thread"
                                        aria-label={`Delete thread ${title}`}
                                        onClick={() => setConfirmingSessionId(session.id)}
                                        className="cnav__icon-btn is-danger focus-ring"
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
                                className="cnav__more focus-ring"
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

        <footer className="code-sidebar__footer code-sidebar__user cnav__footer">
          <span className="cnav__avatar" aria-hidden>{initials}</span>
          <span className="cnav__user">
            <span className="cnav__user-name">{userName ?? "You"}</span>
            <span className="cnav__user-plan">{userPlan}</span>
          </span>
        </footer>
      </div>
    </div>
  );
}
