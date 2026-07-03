"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon, type IconName } from "@/lib/icon";
import { sessionRailTitle } from "@/lib/session-rail-title";
import { relativeTime } from "@/lib/relative-time";
import type { SessionRow } from "@/lib/types";
import { useProjects } from "@/lib/use-projects";
import { useProjectOverrides } from "@/lib/use-project-overrides";
import { applyProjectOverrides } from "@/lib/chat-project-overrides";
import {
  deriveChatProjectGroups,
  filterVisibleChatSessions,
  type ChatProjectGroup,
} from "@/lib/chat-projects";
import {
  PINNED_SESSIONS_KEY,
  isSessionPinned,
  readPinnedSessions,
  togglePinnedSession,
} from "@/lib/chat-session-prefs";
import { addChatProject, projectNameForRoot } from "@/lib/chat-add-project";

type Props = {
  sessions: SessionRow[];
  /** Selected familiar (null = "All familiars"). Scopes the project list, the
   *  per-project session rows, and the project grant when registering. */
  activeFamiliarId?: string | null;
  activeSessionId?: string | null;
  onBack: () => void;
  onOpenSession: (session: SessionRow) => void;
  onNewChat: (projectRoot: string | null) => void;
  onDeleteSession: (session: SessionRow) => Promise<void>;
  userName?: string;
  userPlan?: string;
};

const THREADS_PREVIEW = 6;

function compactTime(iso: string): string {
  return relativeTime(iso, Date.now(), "compact");
}

function statusDotClass(status: string): string {
  if (status === "running") return "animate-pulse bg-[var(--color-success)]";
  if (status === "failed") return "bg-[var(--color-danger)]";
  if (status === "queued") return "bg-[var(--color-warning)]";
  if (status === "paused") return "bg-[var(--accent-presence-soft)]";
  return "bg-[var(--text-muted)]";
}

// A stable key per group for expand/collapse state. The ungrouped ("No project")
// bucket has a null root, so it gets its own sentinel.
function groupKey(group: ChatProjectGroup): string {
  return group.projectRoot ?? "__no-project__";
}

function folderLabel(group: ChatProjectGroup): string {
  if (group.projectName) return group.projectName;
  if (group.projectRoot) return projectNameForRoot(group.projectRoot);
  return "No project";
}

// A registered project shows a solid folder; an unregistered cwd (a real dir
// that maps to no project) and the null "No project" bucket read as a dashed
// folder — the visual cue that these threads live outside a project context.
function folderIcon(group: ChatProjectGroup, expanded: boolean): IconName {
  if (group.projectId) return expanded ? "ph:folder-open" : "ph:folder";
  return "ph:folder-simple-dashed";
}

export function ChatSidebar({
  sessions,
  activeFamiliarId = null,
  activeSessionId,
  onBack,
  onOpenSession,
  onNewChat,
  onDeleteSession,
  userName,
  userPlan = "Pro",
}: Props) {
  const { projects, createProject, reload } = useProjects({ familiarId: activeFamiliarId });
  const overrides = useProjectOverrides();
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [collapsedKeys, setCollapsedKeys] = useState<Set<string>>(() => new Set());
  const [showAllByKey, setShowAllByKey] = useState<Set<string>>(() => new Set());
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [confirmingSessionId, setConfirmingSessionId] = useState<string | null>(null);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  const [registeringRoot, setRegisteringRoot] = useState<string | null>(null);
  const [registerError, setRegisterError] = useState<string | null>(null);

  // Pins load after mount so SSR and first client render agree (same idiom as
  // the chat list). The store is shared with the chat surface's other lists.
  useEffect(() => {
    setPinnedIds(readPinnedSessions());
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (hydrated) window.localStorage.setItem(PINNED_SESSIONS_KEY, JSON.stringify(pinnedIds));
  }, [hydrated, pinnedIds]);

  const visibleSessions = useMemo(
    () => filterVisibleChatSessions(sessions, activeFamiliarId ?? null),
    [sessions, activeFamiliarId],
  );

  const groups = useMemo(
    () => deriveChatProjectGroups(applyProjectOverrides(visibleSessions, overrides), projects),
    [visibleSessions, overrides, projects],
  );

  const pinnedSessions = useMemo(
    () =>
      pinnedIds
        .map((id) => visibleSessions.find((s) => s.id === id))
        .filter((s): s is SessionRow => Boolean(s)),
    [pinnedIds, visibleSessions],
  );

  const hasSearch = query.trim().length > 0;
  const visibleGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    return groups
      .map((group) => ({
        ...group,
        sessions: group.sessions.filter((s) => sessionRailTitle(s).toLowerCase().includes(q)),
      }))
      .filter(
        (group) =>
          group.sessions.length > 0 ||
          folderLabel(group).toLowerCase().includes(q),
      );
  }, [groups, query]);

  const toggleCollapse = (key: string) => {
    setCollapsedKeys((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const togglePin = (sessionId: string) => {
    setPinnedIds((prev) => togglePinnedSession(prev, sessionId));
  };

  async function handleRegister(group: ChatProjectGroup) {
    if (!group.projectRoot) return;
    setRegisteringRoot(group.projectRoot);
    setRegisterError(null);
    try {
      const result = await addChatProject({
        root: group.projectRoot,
        familiarId: activeFamiliarId ?? null,
        createProject,
      });
      if (result.ok) reload();
      else setRegisterError(result.error);
    } finally {
      setRegisteringRoot(null);
    }
  }

  const initials = (userName ?? "You").split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();

  return (
    <div className="chat-sidebar flex h-full min-h-0 flex-col">
      {/* Collapsed rail — when the nav panel is collapsed the shell adds
          `.shell-nav--rail`, which hides the full sidebar and shows this
          vertical "Chats" label. Clicking it reopens the panel. */}
      <button
        type="button"
        className="chat-sidebar__rail focus-ring"
        aria-label="Expand chats"
        title="Expand chats"
        onClick={() => window.dispatchEvent(new CustomEvent("cave:toggle-left-panel"))}
      >
        <Icon name="ph:sidebar-simple" width={15} aria-hidden />
        <span className="chat-sidebar__rail-label">Chats</span>
      </button>

      <div className="chat-sidebar__full cnav">
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
            <div className="cnav__title">Chats</div>
          </div>
        </header>

        <div className="cnav__quick">
          <button type="button" onClick={() => onNewChat(null)} className="cnav__new focus-ring">
            <Icon name="ph:pencil-simple" width={15} className="cnav__new-icon" aria-hidden />
            <span className="cnav__new-label">New chat</span>
            <span className="cnav__kbd" aria-hidden>⌘N</span>
          </button>
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
              aria-label="Search chat projects and threads"
            />
            {query ? (
              <button type="button" aria-label="Clear search" onClick={() => setQuery("")} className="cnav__search-clear">
                <Icon name="ph:x-bold" width={9} aria-hidden />
              </button>
            ) : null}
          </label>
        </div>

        {registerError ? (
          <div role="alert" className="cnav__error">
            <Icon name="ph:warning-circle" width={13} className="shrink-0" aria-hidden />
            <span className="cnav__error-text">{registerError}</span>
            <button type="button" onClick={() => setRegisterError(null)} aria-label="Dismiss" className="shrink-0">
              <Icon name="ph:x-bold" width={9} aria-hidden />
            </button>
          </div>
        ) : null}

        <nav aria-label="Chat projects and threads" className="cnav__scroll">
          {!hasSearch && pinnedSessions.length > 0 ? (
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
                          <Icon name="ph:bookmark-simple-fill" width={12} className="cnav__lead is-accent" aria-hidden />
                          <span className="cnav__thread-title" title={title}>{title}</span>
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          {visibleGroups.length === 0 ? (
            <p className="cnav__empty">
              {hasSearch ? "No threads match your search." : "No conversations yet."}
            </p>
          ) : (
            <ul>
              {visibleGroups.map((group) => {
                const key = groupKey(group);
                const expanded = !collapsedKeys.has(key) || hasSearch;
                const label = folderLabel(group);
                const unregistered = Boolean(group.projectRoot) && !group.projectId;
                const registering = registeringRoot === group.projectRoot;
                const rows = showAllByKey.has(key) || hasSearch
                  ? group.sessions
                  : group.sessions.slice(0, THREADS_PREVIEW);
                return (
                  <li key={key} className={`cnav__group${expanded ? "" : " is-collapsed"}`}>
                    <div className="cnav__group-head">
                      <button
                        type="button"
                        aria-expanded={expanded}
                        aria-label={`${expanded ? "Collapse" : "Expand"} ${label} threads`}
                        onClick={() => toggleCollapse(key)}
                        className="cnav__group-toggle focus-ring"
                      >
                        <Icon name="ph:caret-down" width={10} className="cnav__chev" aria-hidden />
                        <Icon name={folderIcon(group, expanded)} width={14} className="cnav__folder" aria-hidden />
                        <span className="cnav__group-name" title={group.projectRoot ?? "Threads with no project"}>
                          {label}
                        </span>
                        <span className="cnav__count">{group.sessions.length}</span>
                      </button>
                      {unregistered ? (
                        <button
                          type="button"
                          disabled={registering}
                          onClick={() => handleRegister(group)}
                          title={`Register ${label} as a project`}
                          aria-label={`Register ${label} as a project`}
                          className="cnav__icon-btn is-accent focus-ring"
                        >
                          <Icon name={registering ? "ph:arrows-clockwise" : "ph:folders-bold"} width={13} className={registering ? "animate-spin" : undefined} aria-hidden />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => onNewChat(group.projectRoot)}
                        title={`New chat in ${label}`}
                        aria-label={`New chat in ${label}`}
                        className="cnav__icon-btn focus-ring"
                      >
                        <Icon name="ph:plus" width={12} aria-hidden />
                      </button>
                    </div>
                    {expanded ? (
                      group.sessions.length === 0 ? (
                        <p className="cnav__thread-empty">No threads yet.</p>
                      ) : (
                        <ul>
                          {rows.map((session) => {
                            const title = sessionRailTitle(session);
                            const active = activeSessionId === session.id;
                            const pinned = isSessionPinned(pinnedIds, session.id);
                            const confirming = confirmingSessionId === session.id;
                            const deleting = deletingSessionId === session.id;
                            return (
                              <li key={session.id}>
                                <div className={`cnav__thread${active ? " is-active" : ""}`}>
                                  <button
                                    type="button"
                                    aria-current={active ? "page" : undefined}
                                    onClick={() => onOpenSession(session)}
                                    className="cnav__thread-main focus-ring"
                                  >
                                    <span className={`cnav__dot ${statusDotClass(session.status)}`} aria-hidden />
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
                                        title={pinned ? "Unpin thread" : "Pin thread"}
                                        aria-label={pinned ? `Unpin ${title}` : `Pin ${title}`}
                                        aria-pressed={pinned}
                                        onClick={() => togglePin(session.id)}
                                        className={`cnav__icon-btn focus-ring${pinned ? " is-on" : ""}`}
                                      >
                                        <Icon name={pinned ? "ph:bookmark-simple-fill" : "ph:bookmark-simple"} width={12} aria-hidden />
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
                          {group.sessions.length > THREADS_PREVIEW && !showAllByKey.has(key) && !hasSearch ? (
                            <li>
                              <button
                                type="button"
                                onClick={() => setShowAllByKey((cur) => new Set(cur).add(key))}
                                className="cnav__more focus-ring"
                              >
                                Show {group.sessions.length - THREADS_PREVIEW} more
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

        <footer className="cnav__footer">
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
