"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { useMinuteTick } from "@/lib/use-minute-tick";
import { FamiliarSwitcher } from "@/components/familiar-switcher";
import { Icon, type IconName } from "@/lib/icon";
import { ProjectAvatar } from "@/components/project-avatar";
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
  readChatSidebarView,
  writeChatSidebarView,
  type ChatSidebarView,
} from "@/lib/chat-session-prefs";
import { deriveChatRecencyBuckets } from "@/lib/chat-recency";
import { Popover, PopoverBody, PopoverItem, PopoverLabel } from "@/components/ui/popover";
import { addChatProject, projectNameForRoot } from "@/lib/chat-add-project";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";

type Props = {
  sessions: SessionRow[];
  /** Roster for the header switcher — familiar selection's one home. */
  familiars: ResolvedFamiliar[];
  /** Selected familiar (null = "All familiars"). Scopes the project list, the
   *  per-project session rows, and the project grant when registering. */
  activeFamiliarId?: string | null;
  activeSessionId?: string | null;
  responseNeeded?: Set<string>;
  /** Change the familiar scope from the header switcher (`null` = All). */
  onSelectFamiliar: (id: string | null) => void;
  onOpenSession: (session: SessionRow) => void;
  onNewChat: (projectRoot: string | null) => void;
  onDeleteSession: (session: SessionRow) => Promise<void>;
  /** Badge count for the Scheduled shortcut (from code-sidebar). */
  scheduledCount?: number;
};

const THREADS_PREVIEW = 6;

function bareTime(iso: string): string {
  return relativeTime(iso, Date.now(), "bare");
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

// Returns a context-aware leading icon for threads whose title suggests a PR
// or branch operation (from code-sidebar). Returns null for ordinary threads.
function threadLeadingIcon(title: string): IconName | null {
  if (/^\s*resolve\s+pr\b|\bpr\s*#?\d+/i.test(title)) return "ph:git-pull-request";
  if (/\bbranch\b|\bmerge\b|\brebase\b/i.test(title)) return "ph:git-branch";
  return null;
}

type ThreadRowProps = {
  session: SessionRow;
  active: boolean;
  pinned: boolean;
  confirming: boolean;
  deleting: boolean;
  /** "folder" indents under a project folder; "flat" aligns with section headers. */
  indent: "folder" | "flat";
  /** Shown in the time-bucketed Recent view, where rows from every project
   *  interleave — the folder view already says this via the group header. */
  project?: { root: string; name: string } | null;
  /** PR/branch glyph from threadLeadingIcon — shown instead of the status dot when truthy. */
  glyph?: IconName | null;
  onOpen: () => void;
  onTogglePin: () => void;
  onRequestDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
};

function ThreadRow({
  session,
  active,
  pinned,
  confirming,
  deleting,
  indent,
  project = null,
  glyph,
  onOpen,
  onTogglePin,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
}: ThreadRowProps) {
  const title = sessionRailTitle(session);
  return (
    <div className={`cnav__thread${indent === "flat" ? " cnav__thread--flat" : ""}${active ? " is-active" : ""}`}>
      <button
        type="button"
        aria-current={active ? "page" : undefined}
        onClick={onOpen}
        className="cnav__thread-main focus-ring"
      >
        {glyph ? (
          <Icon name={glyph} width={13} className="cnav__lead" aria-hidden />
        ) : (
          <span className={`cnav__dot ${statusDotClass(session.status)}`} aria-hidden />
        )}
        {project ? (
          <span className="cnav__thread-proj" title={project.name}>
            <ProjectAvatar name={project.name} root={project.root} size="sm" />
            <span className="sr-only">{project.name}</span>
          </span>
        ) : null}
        <span className="cnav__thread-title" title={title}>{title}</span>
        {confirming ? null : (
          <span className="cnav__time">{bareTime(session.updated_at || session.created_at)}</span>
        )}
      </button>
      {confirming ? (
        <span className="cnav__confirm">
          <button type="button" onClick={onCancelDelete} className="cnav__confirm-cancel focus-ring">
            Cancel
          </button>
          <button type="button" disabled={deleting} onClick={onConfirmDelete} className="cnav__confirm-del focus-ring">
            {deleting ? "Deleting…" : "Delete"}
          </button>
        </span>
      ) : (
        <span className="cnav__row-actions">
          <button
            type="button"
            title={pinned ? "Unpin thread" : "Pin thread"}
            aria-label={pinned ? `Unpin ${title}` : `Pin ${title}`}
            aria-pressed={pinned}
            onClick={onTogglePin}
            className={`cnav__icon-btn focus-ring${pinned ? " is-on" : ""}`}
          >
            <Icon name={pinned ? "ph:bookmark-simple-fill" : "ph:bookmark-simple"} width={12} aria-hidden />
          </button>
          <button
            type="button"
            title="Delete thread"
            aria-label={`Delete thread ${title}`}
            onClick={onRequestDelete}
            className="cnav__icon-btn is-danger focus-ring"
          >
            <Icon name="ph:x-bold" width={10} aria-hidden />
          </button>
        </span>
      )}
    </div>
  );
}

export function WorkspaceSidebar({
  sessions,
  familiars,
  activeFamiliarId = null,
  activeSessionId,
  responseNeeded,
  onSelectFamiliar,
  onOpenSession,
  onNewChat,
  onDeleteSession,
  scheduledCount,
}: Props) {
  const { projects, createProject, reload } = useProjects({ familiarId: activeFamiliarId });
  const overrides = useProjectOverrides();
  const minuteTick = useMinuteTick();
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
  const [view, setView] = useState<ChatSidebarView>("recent");
  const [menuOpen, setMenuOpen] = useState(false);
  const menuAnchorRef = useRef<HTMLButtonElement>(null);
  const menuBodyRef = useRef<HTMLDivElement>(null);

  // Trap focus inside the Organize menu while it is open (same convention as
  // the GitHub action popover, #2288). Also hydrates the organize-view preference.
  useFocusTrap(menuOpen, menuBodyRef, { onEscape: () => setMenuOpen(false) });

  // Pins and the organize-view preference load after mount so SSR and first
  // client render agree (same idiom as the chat list). The store is shared
  // with the chat surface's other lists.
  useEffect(() => {
    setPinnedIds(readPinnedSessions());
    setView(readChatSidebarView());
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

  // Session → project identity for the Recent view, derived from the SAME
  // override-aware grouping the folder view renders — a chat dragged into
  // another folder shows that folder's tile, not its recorded cwd's.
  const sessionProjectById = useMemo(() => {
    const byId = new Map<string, { root: string; name: string }>();
    for (const group of groups) {
      if (!group.projectRoot) continue;
      const name = folderLabel(group);
      for (const session of group.sessions) {
        byId.set(session.id, { root: group.projectRoot, name });
      }
    }
    return byId;
  }, [groups]);

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

  // Recent view: search filters rows (empty buckets drop out via derive).
  const recentSessions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return visibleSessions;
    return visibleSessions.filter((s) => sessionRailTitle(s).toLowerCase().includes(q));
  }, [visibleSessions, query]);

  // Buckets depend on wall-clock day boundaries, and the sessions poll bails
  // out identity-unchanged when content is identical — so a data refresh alone
  // will NOT re-derive after midnight. The minute tick keeps the day buckets
  // (and the bare row times rendered each pass) on the same clock.
  const recentBuckets = useMemo(
    () => (view === "recent" ? deriveChatRecencyBuckets(recentSessions, Date.now()) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- minuteTick is the clock dependency
    [view, recentSessions, minuteTick],
  );

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

  const selectView = (next: ChatSidebarView) => {
    setView(next);
    writeChatSidebarView(next);
    setMenuOpen(false);
  };

  async function handleDeleteSession(session: SessionRow) {
    setDeletingSessionId(session.id);
    try {
      await onDeleteSession(session);
      setConfirmingSessionId(null);
    } finally {
      setDeletingSessionId(null);
    }
  }

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

  return (
    <div className="workspace-sidebar chat-sidebar flex h-full min-h-0 flex-col">
      {/* Collapsed rail — when the nav panel is collapsed the shell adds
          `.shell-nav--rail`, which hides the full sidebar and shows this
          vertical "Chats" label. Clicking it reopens the panel. */}
      <button
        type="button"
        className="workspace-sidebar__rail chat-sidebar__rail focus-ring"
        aria-label="Expand chats"
        title="Expand chats"
        onClick={() => window.dispatchEvent(new CustomEvent("cave:toggle-left-panel"))}
      >
        <Icon name="ph:sidebar-simple" width={15} aria-hidden />
        <span className="workspace-sidebar__rail-label chat-sidebar__rail-label">Chats</span>
      </button>

      <div className="workspace-sidebar__full chat-sidebar__full cnav">
        {/* Header — the labeled familiar switcher (#2747). On the CHAT page
            this sidebar REPLACES the global sidenav (SidebarMinimal never
            renders here), so this is the page's only familiar control —
            cave-l3ay restored it after #2750 removed it as a supposed
            duplicate. Every other page gets the sidenav header switcher. */}
        <header className="cnav__header">
          <div className="cnav__switcher">
            <FamiliarSwitcher
              familiars={familiars}
              activeFamiliarId={activeFamiliarId}
              sessions={sessions}
              responseNeeded={responseNeeded}
              onSelectFamiliar={onSelectFamiliar}
              placement="bottom-start"
              labeled
            />
          </div>
          <button
            type="button"
            aria-label="Go to Home"
            title="Home"
            onClick={() => window.dispatchEvent(new CustomEvent("cave:navigate-mode", { detail: { mode: "home" } }))}
            className="cnav__back focus-ring ml-auto"
          >
            <Icon name="ph:house-bold" width={15} aria-hidden />
          </button>
          <button
            ref={menuAnchorRef}
            type="button"
            aria-label="Sidebar options"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            title="Sidebar options"
            onClick={() => setMenuOpen((cur) => !cur)}
            className="cnav__back focus-ring"
          >
            <Icon name="ph:dots-three-bold" width={15} aria-hidden />
          </button>
          <Popover
            open={menuOpen}
            onOpenChange={setMenuOpen}
            anchorRef={menuAnchorRef}
            placement="bottom-end"
            minWidth={190}
            ariaLabel="Sidebar options"
          >
            <div ref={menuBodyRef} tabIndex={-1}>
              <PopoverBody role="menu" ariaLabel="Organize sidebar">
                <PopoverLabel>Organize sidebar</PopoverLabel>
                <PopoverItem icon="ph:clock" checked={view === "recent"} onSelect={() => selectView("recent")}>
                  Recent chats
                </PopoverItem>
                <PopoverItem icon="ph:folder" checked={view === "projects"} onSelect={() => selectView("projects")}>
                  By project
                </PopoverItem>
              </PopoverBody>
            </div>
          </Popover>
        </header>

        {/* One-row quick actions: New chat takes the slack; the Scheduled and
            Plugins shortcuts ride along as icon chips (labels live in
            title/aria — the badge still shows the scheduled count). */}
        <div className="cnav__quick">
          <button type="button" title="New chat (⌘N)" onClick={() => onNewChat(null)} className="cnav__new focus-ring">
            <Icon name="ph:pencil-simple" width={15} className="cnav__new-icon" aria-hidden />
            <span className="cnav__new-label">New chat</span>
          </button>
          <button
            type="button"
            title="Scheduled"
            aria-label={scheduledCount ? `Scheduled (${scheduledCount})` : "Scheduled"}
            onClick={() => window.dispatchEvent(new CustomEvent("cave:navigate-mode", { detail: { mode: "inbox" } }))}
            className="cnav__mini focus-ring"
          >
            <Icon name="ph:clock" width={14} className="cnav__mini-icon" aria-hidden />
            {typeof scheduledCount === "number" && scheduledCount > 0 ? (
              <span className="cnav__mini-count">{scheduledCount}</span>
            ) : null}
          </button>
          <button
            type="button"
            title="Plugins"
            aria-label="Plugins"
            onClick={() => window.dispatchEvent(new CustomEvent("cave:navigate-mode", { detail: { mode: "marketplace" } }))}
            className="cnav__mini focus-ring"
          >
            <Icon name="ph:plugs" width={14} className="cnav__mini-icon" aria-hidden />
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
              aria-label="Search projects and threads"
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

        <nav aria-label="Chat threads" className="cnav__scroll">
          {!hasSearch && pinnedSessions.length > 0 ? (
            <section aria-label="Pinned threads">
              <div className="cnav__label">Pinned</div>
              <ul>
                {/* Pinned rail uses a compact read-only row; ThreadRow is the full interactive row. */}
                {pinnedSessions.map((session) => {
                  const title = sessionRailTitle(session);
                  const active = activeSessionId === session.id;
                  return (
                    <li key={`pin-${session.id}`}>
                      <div className={`cnav__thread cnav__thread--flat${active ? " is-active" : ""}`}>
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

          {view === "recent" ? (
            recentBuckets.length === 0 ? (
              <p className="cnav__empty">
                {hasSearch ? "No threads match your search." : "No conversations yet."}
              </p>
            ) : (
              recentBuckets.map((bucket) => {
                const key = `bucket:${bucket.key}`;
                const rows =
                  showAllByKey.has(key) || hasSearch
                    ? bucket.sessions
                    : bucket.sessions.slice(0, THREADS_PREVIEW);
                return (
                  <section key={bucket.key} aria-label={bucket.label}>
                    <div className="cnav__label">{bucket.label}</div>
                    <ul>
                      {rows.map((session) => (
                        <li key={session.id}>
                          <ThreadRow
                            session={session}
                            active={activeSessionId === session.id}
                            pinned={isSessionPinned(pinnedIds, session.id)}
                            confirming={confirmingSessionId === session.id}
                            deleting={deletingSessionId === session.id}
                            indent="flat"
                            project={sessionProjectById.get(session.id) ?? null}
                            glyph={threadLeadingIcon(sessionRailTitle(session))}
                            onOpen={() => onOpenSession(session)}
                            onTogglePin={() => togglePin(session.id)}
                            onRequestDelete={() => setConfirmingSessionId(session.id)}
                            onCancelDelete={() => setConfirmingSessionId(null)}
                            onConfirmDelete={() => void handleDeleteSession(session)}
                          />
                        </li>
                      ))}
                      {bucket.sessions.length > THREADS_PREVIEW && !showAllByKey.has(key) && !hasSearch ? (
                        <li>
                          <button
                            type="button"
                            onClick={() => setShowAllByKey((cur) => new Set(cur).add(key))}
                            className="cnav__more focus-ring"
                            style={{ paddingLeft: "13px" }}
                          >
                            Show {bucket.sessions.length - THREADS_PREVIEW} more
                          </button>
                        </li>
                      ) : null}
                    </ul>
                  </section>
                );
              })
            )
          ) : visibleGroups.length === 0 ? (
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
                        {group.projectId ? (
                          <ProjectAvatar name={label} root={group.projectRoot} size="sm" className="cnav__folder" />
                        ) : (
                          <Icon name={folderIcon(group, expanded)} width={14} className="cnav__folder" aria-hidden />
                        )}
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
                        onClick={() => {
                          if (group.projectRoot) {
                            window.dispatchEvent(new CustomEvent("cave:code-select-project", { detail: { root: group.projectRoot } }));
                          }
                          onNewChat(group.projectRoot);
                        }}
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
                            const glyph = threadLeadingIcon(title);
                            return (
                              <li key={session.id}>
                                <ThreadRow
                                  session={session}
                                  active={activeSessionId === session.id}
                                  pinned={isSessionPinned(pinnedIds, session.id)}
                                  confirming={confirmingSessionId === session.id}
                                  deleting={deletingSessionId === session.id}
                                  indent="folder"
                                  glyph={glyph}
                                  onOpen={() => onOpenSession(session)}
                                  onTogglePin={() => togglePin(session.id)}
                                  onRequestDelete={() => setConfirmingSessionId(session.id)}
                                  onCancelDelete={() => setConfirmingSessionId(null)}
                                  onConfirmDelete={() => void handleDeleteSession(session)}
                                />
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

      </div>
    </div>
  );
}
