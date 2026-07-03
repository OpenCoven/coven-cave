"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { useMinuteTick } from "@/lib/use-minute-tick";
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
  readChatSidebarView,
  writeChatSidebarView,
  type ChatSidebarView,
} from "@/lib/chat-session-prefs";
import { deriveChatRecencyBuckets } from "@/lib/chat-recency";
import { Popover, PopoverBody, PopoverItem, PopoverLabel } from "@/components/ui/popover";
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

type ThreadRowProps = {
  session: SessionRow;
  active: boolean;
  pinned: boolean;
  confirming: boolean;
  deleting: boolean;
  /** "folder" indents under a project folder; "flat" aligns with section headers. */
  indent: "folder" | "flat";
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
  onOpen,
  onTogglePin,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
}: ThreadRowProps) {
  const title = sessionRailTitle(session);
  return (
    <div
      className={[
        "group/thread flex min-h-[34px] w-full items-center gap-1.5 transition-colors",
        active
          ? "bg-[var(--bg-raised)] text-[var(--text-primary)]"
          : "text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]/50 hover:text-[var(--text-primary)]",
      ].join(" ")}
    >
      <button
        type="button"
        aria-current={active ? "page" : undefined}
        onClick={onOpen}
        className={`focus-ring flex min-h-[34px] min-w-0 flex-1 items-center gap-1.5 rounded py-2 ${indent === "folder" ? "pl-4" : "pl-3"} pr-1 text-left text-[12px]`}
      >
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusDotClass(session.status)}`} aria-hidden />
        <span className="min-w-0 flex-1 truncate" title={title}>{title}</span>
        {confirming ? null : (
          <span className="shrink-0 font-mono text-[10px] text-[var(--text-muted)] group-hover/thread:hidden">
            {bareTime(session.updated_at || session.created_at)}
          </span>
        )}
      </button>
      {confirming ? (
        <span className="flex shrink-0 items-center gap-1 pr-1">
          <button
            type="button"
            onClick={onCancelDelete}
            className="focus-ring rounded px-1.5 py-0.5 text-[10px] text-[var(--text-muted)] hover:bg-[var(--bg-hover)]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={deleting}
            onClick={onConfirmDelete}
            className="focus-ring rounded border border-[var(--color-danger)]/50 bg-[var(--color-danger)]/10 px-1.5 py-0.5 text-[10px] text-[var(--color-danger)] hover:bg-[var(--color-danger)]/15 disabled:opacity-50"
          >
            {deleting ? "Deleting..." : "Delete"}
          </button>
        </span>
      ) : (
        <>
          <button
            type="button"
            title={pinned ? "Unpin thread" : "Pin thread"}
            aria-label={pinned ? `Unpin ${title}` : `Pin ${title}`}
            aria-pressed={pinned}
            onClick={onTogglePin}
            className={[
              "touch-always-visible focus-ring grid h-5 w-5 shrink-0 place-items-center rounded transition-all hover:text-[var(--accent-presence)]",
              pinned
                ? "text-[var(--accent-presence)] opacity-100"
                : "text-[var(--text-muted)] opacity-0 focus-visible:opacity-100 group-hover/thread:opacity-100",
            ].join(" ")}
          >
            <Icon name={pinned ? "ph:bookmark-simple-fill" : "ph:bookmark-simple"} width={12} aria-hidden />
          </button>
          <button
            type="button"
            title="Delete thread"
            aria-label={`Delete thread ${title}`}
            onClick={onRequestDelete}
            className="touch-always-visible focus-ring mr-1 grid h-5 w-5 shrink-0 place-items-center rounded text-[var(--text-muted)] opacity-0 transition-opacity hover:bg-[var(--bg-raised)] hover:text-[var(--color-danger)] focus-visible:opacity-100 group-hover/thread:opacity-100"
          >
            <Icon name="ph:x-bold" width={10} aria-hidden />
          </button>
        </>
      )}
    </div>
  );
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
    <div className="chat-sidebar flex h-full min-h-0 flex-col bg-[color-mix(in_oklch,var(--bg-raised)_88%,transparent)]">
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

      <div className="chat-sidebar__full flex min-h-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center gap-2 border-b border-[var(--border-hairline)] px-2 py-2">
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
            <div className="truncate text-[12px] font-semibold text-[var(--text-primary)]">Chats</div>
            <div className="truncate text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">
              {view === "recent" ? "Recent chats" : "Projects"}
            </div>
          </div>
          <button
            ref={menuAnchorRef}
            type="button"
            aria-label="Sidebar options"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            title="Sidebar options"
            onClick={() => setMenuOpen((cur) => !cur)}
            className="focus-ring ml-auto grid h-7 w-7 shrink-0 place-items-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
          >
            <Icon name="ph:dots-three-bold" width={14} aria-hidden />
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

        <nav aria-label="Chat navigation" className="shrink-0 border-b border-[var(--border-hairline)] px-1.5 py-1.5">
          {[
            { key: "new", label: "New chat", icon: "ph:pencil-simple" as IconName, onClick: () => onNewChat(null) },
            { key: "search", label: "Search", icon: "ph:magnifying-glass" as IconName, onClick: () => searchRef.current?.focus() },
          ].map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={item.onClick}
              className="focus-ring flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
            >
              <Icon name={item.icon} width={14} className="shrink-0 text-[var(--text-muted)]" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
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
              aria-label="Search chat projects and threads"
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

        {registerError ? (
          <div
            role="alert"
            className="flex shrink-0 items-center gap-1.5 border-b border-[var(--border-hairline)] bg-[color-mix(in_oklch,var(--color-danger)_12%,transparent)] px-3 py-1.5 text-[11px] text-[var(--color-danger)]"
          >
            <Icon name="ph:warning-circle" width={12} className="shrink-0" aria-hidden />
            <span className="min-w-0 flex-1 truncate">{registerError}</span>
            <button type="button" onClick={() => setRegisterError(null)} aria-label="Dismiss" className="shrink-0">
              <Icon name="ph:x-bold" width={9} aria-hidden />
            </button>
          </div>
        ) : null}

        <nav aria-label="Chat threads" className="min-h-0 flex-1 overflow-y-auto pb-2">
          {!hasSearch && pinnedSessions.length > 0 ? (
            <section aria-label="Pinned threads" className="border-b border-[var(--border-hairline)] py-1">
              <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">Pinned</div>
              <ul>
                {/* Pinned rail uses a compact read-only row; ThreadRow is the full interactive row. */}
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
                        <Icon name="ph:bookmark-simple-fill" width={11} className="shrink-0 text-[var(--accent-presence)]" aria-hidden />
                        <span className="min-w-0 flex-1 truncate" title={title}>{title}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          {view === "recent" ? (
            recentBuckets.length === 0 ? (
              <p className="px-3 py-4 text-center text-[11px] text-[var(--text-muted)]">
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
                  <section key={bucket.key} aria-label={bucket.label} className="py-1">
                    <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
                      {bucket.label}
                    </div>
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
                            className="focus-ring w-full py-1.5 pl-7 pr-3 text-left text-[11px] text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
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
            <p className="px-3 py-4 text-center text-[11px] text-[var(--text-muted)]">
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
                  <li key={key}>
                    <div className="group relative flex items-center border-b border-[var(--border-hairline)] bg-[color-mix(in_oklch,var(--bg-base)_86%,var(--foreground)_14%)]">
                      <button
                        type="button"
                        aria-expanded={expanded}
                        aria-label={`${expanded ? "Collapse" : "Expand"} ${label} threads`}
                        onClick={() => toggleCollapse(key)}
                        className="focus-ring flex min-h-[38px] min-w-0 flex-1 items-center gap-1.5 rounded py-2 pl-2 pr-16 text-left text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                      >
                        <Icon name={expanded ? "ph:caret-down" : "ph:caret-right"} width={10} className="shrink-0 text-[var(--text-muted)]" aria-hidden />
                        <Icon name={folderIcon(group, expanded)} width={13} className="shrink-0 text-[var(--text-muted)]" aria-hidden />
                        <span className="min-w-0 flex-1 truncate font-semibold text-[var(--text-primary)]" title={group.projectRoot ?? "Threads with no project"}>
                          {label}
                        </span>
                        <span className="shrink-0 font-mono text-[11px] text-[var(--text-muted)]">{group.sessions.length}</span>
                      </button>
                      {unregistered ? (
                        <button
                          type="button"
                          disabled={registering}
                          onClick={() => handleRegister(group)}
                          title={`Register ${label} as a project`}
                          aria-label={`Register ${label} as a project`}
                          className="touch-always-visible focus-ring absolute right-7 grid h-5 w-5 place-items-center rounded text-[var(--accent-presence)] opacity-0 transition-opacity hover:bg-[var(--bg-raised)] focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-40"
                        >
                          <Icon name={registering ? "ph:arrows-clockwise" : "ph:folders-bold"} width={13} className={registering ? "animate-spin" : undefined} aria-hidden />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => onNewChat(group.projectRoot)}
                        title={`New chat in ${label}`}
                        aria-label={`New chat in ${label}`}
                        className="touch-always-visible focus-ring absolute right-1 grid h-5 w-5 place-items-center rounded text-[var(--text-muted)] opacity-0 transition-opacity hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)] focus-visible:opacity-100 group-hover:opacity-100"
                      >
                        <Icon name="ph:plus" width={11} aria-hidden />
                      </button>
                    </div>
                    {expanded ? (
                      group.sessions.length === 0 ? (
                        <p className="py-1 pl-8 pr-3 text-[11px] text-[var(--text-muted)]">No threads yet.</p>
                      ) : (
                        <ul>
                          {rows.map((session) => (
                            <li key={session.id}>
                              <ThreadRow
                                session={session}
                                active={activeSessionId === session.id}
                                pinned={isSessionPinned(pinnedIds, session.id)}
                                confirming={confirmingSessionId === session.id}
                                deleting={deletingSessionId === session.id}
                                indent="folder"
                                onOpen={() => onOpenSession(session)}
                                onTogglePin={() => togglePin(session.id)}
                                onRequestDelete={() => setConfirmingSessionId(session.id)}
                                onCancelDelete={() => setConfirmingSessionId(null)}
                                onConfirmDelete={() => void handleDeleteSession(session)}
                              />
                            </li>
                          ))}
                          {group.sessions.length > THREADS_PREVIEW && !showAllByKey.has(key) && !hasSearch ? (
                            <li>
                              <button
                                type="button"
                                onClick={() => setShowAllByKey((cur) => new Set(cur).add(key))}
                                className="focus-ring w-full py-1.5 pl-8 pr-3 text-left text-[11px] text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
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

        <footer className="mt-auto flex shrink-0 items-center gap-2 border-t border-[var(--border-hairline)] px-3 py-2">
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
