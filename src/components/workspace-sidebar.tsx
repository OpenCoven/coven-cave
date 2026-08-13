"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { useMinuteTick } from "@/lib/use-minute-tick";
import { SidebarRailHeader } from "@/components/sidebar-rail-header";
import { Icon, type IconName } from "@/lib/icon";
import { SidebarFooter } from "@/components/sidebar-footer";
import { ProjectAvatar } from "@/components/project-avatar";
import { sessionRailTitle } from "@/lib/session-rail-title";
import { relativeTime } from "@/lib/relative-time";
import { sessionPrStatus, type SessionPrStatus } from "@/lib/session-pr-status";
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
  isSessionPinned,
  toggleStoredPinnedSession,
  readChatSidebarView,
  writeChatSidebarView,
  type ChatSidebarView,
} from "@/lib/chat-session-prefs";
import { usePinnedSessions } from "@/lib/use-pinned-sessions";
import { deriveChatRecencyBuckets } from "@/lib/chat-recency";
import {
  chatAttentionDescription,
  chatAttentionLabel,
  compareChatAttention,
  NO_CHAT_ATTENTION,
  type ChatAttentionState,
} from "@/lib/chat-attention";
import {
  CHAT_SESSION_DRAG_MIME,
  emitChatSessionDragEnd,
  emitChatSessionDragStart,
} from "@/lib/chat-split";
import { Tabs, type TabItem } from "@/components/ui/tabs";
import { addChatProject, projectNameForRoot } from "@/lib/chat-add-project";
import { NavSectionTabs } from "@/components/nav-section-tabs";
import type { NavSection } from "@/lib/nav-section";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";

type WorkspaceSidebarMode = "home";

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
  /** ⌥↵ / ⌥-click / drag on a thread row: open it in a split pane beside the
   *  current chat (the chat surface falls back to a plain open on mobile). */
  onOpenSessionInSplit?: (session: SessionRow) => void;
  /** The Home shortcut routes through Workspace so it can coordinate the mode
   *  change with mobile drawer dismissal. Only rendered for standalone hosts
   *  that mount this rail without the Home | Chat section tabs. */
  onNavigate: (mode: WorkspaceSidebarMode) => void;
  /** Global section switcher (Home | Chat). This sidebar hosts the Code room,
   *  so the tabs ride at its top too — leaving Code returns to the Home rail. */
  onSectionChange?: (section: NavSection) => void;
  onNewChat: (projectRoot: string | null) => void;
  onDeleteSession: (session: SessionRow) => Promise<void>;
  /** Refresh the workspace sessions poll after an archive/unarchive PATCH so
   *  the row leaves (or re-enters) the live list without waiting a cycle. */
  onSessionsChanged?: () => void;
  /** Opens the thread's pull request in the in-app browser (PR badge click);
   *  without it the badge falls back to a new tab. Same chain as chat-list. */
  onOpenUrl?: (url: string) => void;
  /** Opens Settings — powers the shared footer so Chat keeps the same
   *  Dashboard/Settings footer as every other surface. */
  onOpenSettings: () => void;
};

const THREADS_PREVIEW = 6;
const CHAT_SIDEBAR_TABS: ReadonlyArray<TabItem<ChatSidebarView>> = [
  {
    id: "recent",
    label: "Recent",
    icon: "ph:clock-counter-clockwise",
    controlsId: "chat-sidebar-group-panel",
  },
  {
    id: "projects",
    label: "Projects",
    icon: "ph:folders-bold",
    controlsId: "chat-sidebar-group-panel",
  },
];

function normalizeSessionAttention(session: SessionRow): SessionRow {
  return session.attention ? session : { ...session, attention: NO_CHAT_ATTENTION };
}

function bareTimeAt(iso: string, now: number): string {
  return relativeTime(iso, now, "bare");
}

function statusDotClass(status: string): string {
  if (status === "running") return "cnav__dot--running";
  if (status === "failed") return "cnav__dot--failed";
  if (status === "queued") return "cnav__dot--queued";
  if (status === "paused") return "cnav__dot--paused";
  return "";
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

// Activity meta line under the folder name: "2 running · 12m" while sessions
// run, else "6 chats · 3h". Subsumes the old count badge, so the header keeps
// a single right-aligned slot for the hover actions.
function groupMeta(group: ChatProjectGroup, now: number): string {
  const awaiting = group.sessions.filter((session) => session.attention.state !== "none" && !session.archived_at).length;
  const running = group.sessions.filter((s) => s.status === "running").length;
  const count =
    running > 0
      ? `${running} running`
      : `${group.sessions.length} ${group.sessions.length === 1 ? "chat" : "chats"}`;
  const age = group.updatedAt ? bareTimeAt(group.updatedAt, now) : null;
  const meta = age ? `${count} · ${age}` : count;
  return awaiting > 0 ? `${awaiting} awaiting · ${meta}` : meta;
}

// Archived rows always read as settled regardless of their stored attention —
// centralized so every attention-bearing row shape (the full ThreadRow and the
// compact Pinned rail below) derives the same visible state/label/description
// from one place instead of each re-deriving (and risking drift on) the
// archived-suppression rule.
function resolveThreadAttention(
  session: SessionRow,
  archived: boolean,
  now: number,
): { state: ChatAttentionState; label: string | null; description: string | null } {
  const state: ChatAttentionState = archived ? "none" : session.attention.state;
  return {
    state,
    label: chatAttentionLabel(state),
    description: archived ? null : chatAttentionDescription(session.attention, now),
  };
}

// The visible attention cue (dot + label) — the ONE place that renders it, so
// ThreadRow and the compact Pinned rail can never drift into divergent markup
// for the same attention state.
function ThreadAttentionCue({ label }: { label: string | null }) {
  if (!label) return null;
  return (
    <span className="cnav__attention">
      <span className="cnav__attention-dot" aria-hidden />
      <span>{label}</span>
    </span>
  );
}

// Returns a context-aware leading icon for threads whose title suggests a PR
// or branch operation (from code-sidebar). Returns null for ordinary threads.
function threadLeadingIcon(title: string): IconName | null {
  if (/^\s*resolve\s+pr\b|\bpr\s*#?\d+/i.test(title)) return "ph:git-pull-request";
  if (/\bbranch\b|\bmerge\b|\brebase\b/i.test(title)) return "ph:git-branch";
  return null;
}

function sidebarThreadTitle(session: SessionRow, archived: boolean): string {
  if (!archived || !session.pullRequest) return sessionRailTitle(session);
  return sessionRailTitle({ ...session, pullRequest: undefined });
}

// PR-status badge in a thread row's leading slot — the workspace-sidebar twin
// of the chat list's badge (#2983): GitHub state colors, click opens the PR
// (in-app browser when wired) without opening the chat. Rendered as a sibling
// of the row's main <button> (never nested inside it — invalid HTML), with CSS
// aligning it over the status-dot gutter.
function ThreadPrBadge({
  prStatus,
  onOpenUrl,
}: {
  prStatus: SessionPrStatus;
  onOpenUrl?: (url: string) => void;
}) {
  return (
    <button
      type="button"
      className="cnav__pr-badge focus-ring"
      data-pr-state={prStatus.key}
      title={`Open ${prStatus.label}`}
      aria-label={`Open pull request (${prStatus.label})`}
      onClick={(e) => {
        e.stopPropagation();
        if (onOpenUrl) onOpenUrl(prStatus.url);
        else window.open(prStatus.url, "_blank", "noopener,noreferrer");
      }}
    >
      <Icon name={prStatus.icon} width={12} aria-hidden />
    </button>
  );
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
  project?: { root: string; name: string; color: string | null } | null;
  /** PR/branch glyph from threadLeadingIcon — shown instead of the status dot when truthy. */
  glyph?: IconName | null;
  /** In-app URL opener for the PR badge (new-tab fallback without it). */
  onOpenUrl?: (url: string) => void;
  onOpen: () => void;
  /** ⌥↵ / ⌥-click / drag: open beside the current chat in a split pane. */
  onOpenInSplit?: () => void;
  onTogglePin: () => void;
  /** Archive/unarchive via the sessions PATCH (same endpoint as chat-list). */
  onToggleArchive: () => void;
  /** True while any row's archive PATCH is in flight — disables the buttons. */
  archiving: boolean;
  onRequestDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
  now: number;
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
  onOpenUrl,
  onOpen,
  onOpenInSplit,
  onTogglePin,
  onToggleArchive,
  archiving,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
  now,
}: ThreadRowProps) {
  const attentionDescriptionId = useId();
  const archived = Boolean(session.archived_at);
  const title = sidebarThreadTitle(session, archived);
  // Real PR context beats the title-heuristic glyph — when the thread's work
  // reached an actual pull request, the leading slot shows the clickable
  // state-colored badge instead of the dot or heuristic icon.
  const prStatus = archived ? null : sessionPrStatus(session.pullRequest);
  // Archived rows (visible via the "Show archived" option) read muted, and the
  // leading slot shows the archive glyph so they can't pass for live threads.
  const { state: attentionState, label: attentionLabel, description: attentionDescription } = resolveThreadAttention(
    session,
    archived,
    now,
  );
  const leadGlyph = archived ? ("ph:archive" as IconName) : glyph;
  return (
    <div
      className={`cnav__thread${indent === "flat" ? " cnav__thread--flat" : ""}${prStatus ? " cnav__thread--pr" : ""}${active ? " is-active" : ""}${archived ? " is-archived" : ""}`}
      data-attention={attentionState}
    >
      {/* Chat.dc.html 2a: every row carries a 2px colour tick on its left
          edge — the session's state, readable down the whole rail without
          hunting for the dot. Active selection keeps its own separate accent
          marker; the runtime tick stays runtime-coloured (CSS). */}
      <span className={`cnav__tick ${statusDotClass(session.status)}`} aria-hidden />
      {/* A structurally separate channel from the runtime tick above — see
          .cnav__attention-tick in shell-navigation.css (cave-zs85n Task 6).
          Keeps attention visible without letting it repaint the runtime
          status colour, including on PR-badge and branch-glyph rows where
          .cnav__dot never renders at all. */}
      {attentionState !== "none" ? <span className="cnav__attention-tick" aria-hidden /> : null}
      {prStatus ? <ThreadPrBadge prStatus={prStatus} onOpenUrl={onOpenUrl} /> : null}
      <button
        type="button"
        aria-current={active ? "page" : undefined}
        aria-describedby={attentionDescription ? attentionDescriptionId : undefined}
        onClick={(e) => {
          // ⌥-click opens beside the current chat instead of replacing it.
          if (e.altKey && onOpenInSplit) {
            onOpenInSplit();
            return;
          }
          onOpen();
        }}
        onKeyDown={(e) => {
          // ⌥↵ opens in a split pane (keyboard twin of drag-to-split); stop
          // the native button activation so onClick doesn't also fire.
          if (e.key === "Enter" && e.altKey && onOpenInSplit) {
            e.preventDefault();
            onOpenInSplit();
          }
        }}
        // Dragging the row onto the chat surface snaps it into a split pane
        // (chat-split-host's drop zone; same protocol as the project rail).
        draggable={Boolean(onOpenInSplit)}
        onDragStart={(e) => {
          if (!onOpenInSplit) return;
          e.dataTransfer.setData(CHAT_SESSION_DRAG_MIME, session.id);
          e.dataTransfer.setData("text/plain", title);
          e.dataTransfer.effectAllowed = "copyMove";
          emitChatSessionDragStart({ sessionId: session.id, title });
        }}
        onDragEnd={() => {
          if (onOpenInSplit) emitChatSessionDragEnd();
        }}
        className="cnav__thread-main focus-ring"
      >
        {prStatus ? null : leadGlyph ? (
          <Icon name={leadGlyph} width={13} className="cnav__lead" aria-hidden />
        ) : (
          <span className={`cnav__dot ${statusDotClass(session.status)}`} aria-hidden />
        )}
        {project ? (
          <span className="cnav__thread-proj" title={project.name}>
            <ProjectAvatar name={project.name} root={project.root} color={project.color} size="sm" />
          </span>
        ) : null}
        {project ? <span className="sr-only">{`Project ${project.name} `}</span> : null}
        <span className="cnav__thread-copy">
          <span className="cnav__thread-line">
            <span className="cnav__thread-title" title={title}>{title}</span>
            {confirming ? null : (
              <span className="cnav__time">{bareTimeAt(session.updated_at || session.created_at, now)}</span>
            )}
          </span>
          <ThreadAttentionCue label={attentionLabel} />
        </span>
      </button>
      {attentionDescription ? (
        <span id={attentionDescriptionId} className="sr-only">{attentionDescription}</span>
      ) : null}
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
            title={archived ? "Unarchive chat" : "Archive chat"}
            aria-label={`${archived ? "Unarchive" : "Archive"} chat ${title}`}
            disabled={archiving}
            onClick={onToggleArchive}
            className="cnav__icon-btn focus-ring"
          >
            <Icon name={archived ? "ph:arrow-counter-clockwise" : "ph:archive"} width={12} aria-hidden />
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

type PinnedThreadRowProps = {
  session: SessionRow;
  active: boolean;
  now: number;
  onOpenUrl?: (url: string) => void;
  onOpen: () => void;
  onTogglePin: () => void;
};

// The Pinned rail is deliberately NOT a ThreadRow: it drops the timestamp,
// project tile, drag/split, and archive/delete affordances to stay a compact,
// always-visible shortlist, and its trailing bookmark is a one-click unpin
// rather than ThreadRow's row-actions overlay. It still shares attention
// derivation (resolveThreadAttention) and cue rendering (ThreadAttentionCue)
// with ThreadRow so the two row shapes can't render divergent attention state
// for the same session — only the surrounding chrome differs. Same rule for
// the runtime tick/archive semantics below: a pinned session can still be
// running, failed, or (once "Show archived" is on) archived, so this row
// reuses ThreadRow's own tick class and archive-glyph derivation rather than
// re-deriving them — see cave-zs85n Task 6 gap-fix notes.
function PinnedThreadRow({ session, active, now, onOpenUrl, onOpen, onTogglePin }: PinnedThreadRowProps) {
  const attentionDescriptionId = useId();
  const archived = Boolean(session.archived_at);
  const title = sidebarThreadTitle(session, archived);
  const prStatus = archived ? null : sessionPrStatus(session.pullRequest);
  const { state: attentionState, label: attentionLabel, description: attentionDescription } = resolveThreadAttention(
    session,
    archived,
    now,
  );
  const leadGlyph = archived ? ("ph:archive" as IconName) : null;
  return (
    <div
      className={`cnav__thread cnav__thread--flat${prStatus ? " cnav__thread--pr" : ""}${active ? " is-active" : ""}${archived ? " is-archived" : ""}`}
      data-attention={attentionState}
    >
      {/* Chat.dc.html 2a: every row carries a 2px colour tick on its left
          edge — the session's runtime state, readable down the whole rail
          without hunting for the dot. Shared with ThreadRow so a pinned row's
          tick can never diverge from its full-row twin. */}
      <span className={`cnav__tick ${statusDotClass(session.status)}`} aria-hidden />
      {/* Same separate attention channel as ThreadRow (cave-zs85n Task 6) —
          shared markup so the compact rail can't drift into a divergent cue. */}
      {attentionState !== "none" ? <span className="cnav__attention-tick" aria-hidden /> : null}
      {prStatus ? <ThreadPrBadge prStatus={prStatus} onOpenUrl={onOpenUrl} /> : null}
      <button
        type="button"
        aria-current={active ? "page" : undefined}
        aria-describedby={attentionDescription ? attentionDescriptionId : undefined}
        onClick={onOpen}
        className="cnav__thread-main focus-ring"
      >
        {prStatus ? null : leadGlyph ? (
          <Icon name={leadGlyph} width={13} className="cnav__lead" aria-hidden />
        ) : (
          <span className={`cnav__dot ${statusDotClass(session.status)}`} aria-hidden />
        )}
        <span className="cnav__thread-copy">
          <span className="cnav__thread-title" title={title}>{title}</span>
          <ThreadAttentionCue label={attentionLabel} />
        </span>
      </button>
      {attentionDescription ? (
        <span id={attentionDescriptionId} className="sr-only">{attentionDescription}</span>
      ) : null}
      {/* The trailing always-visible bookmark doubles as the pin marker AND a
          one-click unpin — otherwise the only unpin lives on the (possibly
          truncated/collapsed) copy of the row further down the rail. */}
      <button
        type="button"
        title="Unpin chat"
        aria-label={`Unpin ${title}`}
        aria-pressed
        onClick={onTogglePin}
        className="cnav__icon-btn is-on focus-ring"
      >
        <Icon name="ph:bookmark-simple-fill" width={12} aria-hidden />
      </button>
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
  onOpenSessionInSplit,
  onNavigate,
  onSectionChange,
  onNewChat,
  onDeleteSession,
  onSessionsChanged,
  onOpenUrl,
  onOpenSettings,
}: Props) {
  const { projects, createProject, createProjectOrThrow, reload } = useProjects({ familiarId: activeFamiliarId });
  const overrides = useProjectOverrides();
  const minuteTick = useMinuteTick();
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [collapsedKeys, setCollapsedKeys] = useState<Set<string>>(() => new Set());
  const [showAllByKey, setShowAllByKey] = useState<Set<string>>(() => new Set());
  // Pins come from the shared cross-surface store (chat list + thread rail +
  // this sidebar all read and write the same subscribable list).
  const pinnedIds = usePinnedSessions();
  const [confirmingSessionId, setConfirmingSessionId] = useState<string | null>(null);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  const [registeringRoot, setRegisteringRoot] = useState<string | null>(null);
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [view, setView] = useState<ChatSidebarView>("recent");
  const [menuOpen, setMenuOpen] = useState(false);
  const menuAnchorRef = useRef<HTMLButtonElement>(null);
  const menuBodyRef = useRef<HTMLDivElement>(null);
  const normalizedSessions = useMemo(
    () => sessions.map(normalizeSessionAttention),
    [sessions],
  );
  // One clock snapshot per minute tick, not one per render: recency buckets,
  // row bare times, and attention descriptions all read this SAME `now` so
  // they can never split into two different instants inside one render pass
  // (cave-zs85n Task 6 gap-fix — a bare Date.now() here previously advanced
  // on every unrelated re-render while recentBuckets stayed memoized against
  // the older minuteTick-only dependency, so an in-between render could show
  // stale buckets alongside a fresher bare time for the same session).
  const now = useMemo(() => Date.now(), [minuteTick]);

  // Trap focus inside the Organize menu while it is open (same convention as
  // the GitHub action popover, #2288). Also hydrates the organize-view preference.
  useFocusTrap(menuOpen, menuBodyRef, { onEscape: () => setMenuOpen(false) });

  // The organize-view preference loads after mount so SSR and first client
  // render agree (same idiom as the chat list).
  useEffect(() => {
    setView(readChatSidebarView());
  }, []);

  // Archived sessions only load while "Show archived" is on; archive/unarchive
  // bumps archiveNonce so the opt-in list refetches after each change (same
  // idiom as the chat list's toggle).
  useEffect(() => {
    if (!showArchived) {
      setArchivedRows([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        // Scope archived rows to the active familiar's projects, same as the
        // live list — keeps forbidden-project sessions out of the archive view.
        const scope = activeFamiliarId ? `&familiarId=${encodeURIComponent(activeFamiliarId)}` : "";
        const res = await fetch(`/api/sessions/list?includeArchived=1${scope}`, { cache: "no-store" });
        const json = await res.json().catch(() => ({ ok: false }));
        if (cancelled || !json.ok || !Array.isArray(json.sessions)) return;
        setArchivedRows(
          (json.sessions as SessionRow[])
            .filter((session) => session.archived_at)
            .map(normalizeSessionAttention),
        );
      } catch {
        // keep whatever archived rows we already have
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showArchived, archiveNonce, activeFamiliarId]);

  const visibleSessions = useMemo(() => {
    let rows: SessionRow[] = normalizedSessions;
    if (showArchived && archivedRows.length > 0) {
      const seen = new Set(normalizedSessions.map((session) => session.id));
      rows = [...normalizedSessions, ...archivedRows.filter((session) => !seen.has(session.id))];
    }
    return filterVisibleChatSessions(rows, activeFamiliarId ?? null, { includeArchived: showArchived });
  }, [normalizedSessions, showArchived, archivedRows, activeFamiliarId]);

  const groups = useMemo(
    () => deriveChatProjectGroups(applyProjectOverrides(visibleSessions, overrides), projects),
    [visibleSessions, overrides, projects],
  );

  // Session → project identity for the Recent view, derived from the SAME
  // override-aware grouping the folder view renders — a chat dragged into
  // another folder shows that folder's tile, not its recorded cwd's.
  const sessionProjectById = useMemo(() => {
    const byId = new Map<string, { root: string; name: string; color: string | null }>();
    for (const group of groups) {
      if (!group.projectRoot) continue;
      const name = folderLabel(group);
      for (const session of group.sessions) {
        byId.set(session.id, { root: group.projectRoot, name, color: group.projectColor });
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
  const attentionSessions = useMemo(
    () =>
      visibleSessions
        .filter((session) => session.attention.state !== "none" && !session.archived_at)
        .sort(compareChatAttention),
    [visibleSessions],
  );
  const attentionIds = useMemo(() => new Set(attentionSessions.map((session) => session.id)), [attentionSessions]);
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
    const rows = hasSearch ? visibleSessions : visibleSessions.filter((session) => !attentionIds.has(session.id));
    if (!q) return rows;
    return rows.filter((s) => sessionRailTitle(s).toLowerCase().includes(q));
  }, [visibleSessions, query, hasSearch, attentionIds]);

  // Buckets depend on wall-clock day boundaries, and the sessions poll bails
  // out identity-unchanged when content is identical — so a data refresh alone
  // will NOT re-derive after midnight. Depending on `now` (memoized above off
  // minuteTick) rather than minuteTick directly keeps this honest for
  // exhaustive-deps AND guarantees buckets are derived from the exact same
  // instant as the bare row times and attention descriptions rendered below.
  const recentBuckets = useMemo(
    () => (view === "recent" ? deriveChatRecencyBuckets(recentSessions, now) : []),
    [view, recentSessions, now],
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
    toggleStoredPinnedSession(sessionId);
  };

  const selectView = (next: ChatSidebarView) => {
    setView(next);
    writeChatSidebarView(next);
  };

  async function handleDeleteSession(session: SessionRow) {
    setDeletingSessionId(session.id);
    setDeleteError(null);
    try {
      await onDeleteSession(session);
      setConfirmingSessionId(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "delete failed");
    } finally {
      setDeletingSessionId(null);
    }
  }

  // Archive/unarchive rides the same undo-safe sessions PATCH as the chat
  // list; a success refreshes the workspace poll so the row leaves or re-enters.
  async function setSessionArchived(session: SessionRow, archived: boolean) {
    setArchivingId(session.id);
    setArchiveError(null);
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(session.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived }),
      });
      const json = await res.json().catch(() => ({ ok: false }));
      if (!res.ok || !json.ok) {
        setArchiveError(json.error ?? (archived ? "archive failed" : "unarchive failed"));
        return;
      }
      onSessionsChanged?.();
    } catch (err) {
      setArchiveError(err instanceof Error ? err.message : archived ? "archive failed" : "unarchive failed");
    } finally {
      setArchivingId(null);
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
        createProjectOrThrow,
      });
      if (result.ok) reload();
      else setRegisterError(result.error);
    } finally {
      setRegisteringRoot(null);
    }
  }

  return (
    <div className="workspace-sidebar chat-sidebar flex h-full min-h-0 flex-col">
      <div className="workspace-sidebar__full chat-sidebar__full cnav">
        {/* Global section switcher — Home | Chat (cave-24d2r). This sidebar IS
            the Code room, so switching to Home hands the rail back to the
            standard destination list. */}
        {onSectionChange ? <NavSectionTabs section="code" onSectionChange={onSectionChange} /> : null}
        {/* Header — the labeled familiar switcher (#2747) and New chat, SHARED
            with the Home section via SidebarRailHeader so the two controls
            cannot drift apart across the Home/Chat toggle. WorkspaceSidebar
            owns the primary Shell nav during Chat; Home exits Chat and restores
            the normal navigation. This scope control was restored by cave-l3ay
            after #2750 removed it as a supposed duplicate. The ⌘N hint rides
            the shared button's trailing slot rather than forking it. */}
        <SidebarRailHeader
          familiars={familiars}
          activeFamiliarId={activeFamiliarId}
          sessions={sessions}
          responseNeeded={responseNeeded}
          onSelectFamiliar={onSelectFamiliar}
          onNewChat={() => onNewChat(null)}
          newChatTitle="New chat (⌘N)"
          newChatTrailing={<kbd className="rail-header__new-kbd">⌘N</kbd>}
        />

        {/* Grouping tabs sit above the thread list. The standalone utilities
            band (Scheduled / Plugins icon chips) is retired — both
            destinations live in the Home rail's list, and dropping the band
            gives Chat the same tabs → switcher → New chat rhythm as Home. */}
        <div className="cnav__tabs-row">
          <Tabs<ChatSidebarView>
            items={CHAT_SIDEBAR_TABS}
            value={view}
            onChange={selectView}
            ariaLabel="Group chats"
            className="cnav__tabs"
            size="sm"
            idPrefix="chat-sidebar-group"
            fill
          />
          {/* The Home tab above owns the exit now; the icon button only remains
              when the section switcher is not mounted (standalone hosts). */}
          {onSectionChange ? null : (
            <button
              type="button"
              aria-label="Go to Home"
              title="Home"
              onClick={() => onNavigate("home")}
              className="cnav__back focus-ring"
            >
              <Icon name="ph:house-bold" width={15} aria-hidden />
            </button>
          )}
        </div>

        <div className="cnav__search-wrap">
          <label className="cnav__search">
            <Icon name="ph:magnifying-glass" width={13} className="cnav__search-icon" aria-hidden />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search chats…"
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
        {deleteError ? (
          <div role="alert" className="cnav__error">
            <Icon name="ph:warning-circle" width={13} className="shrink-0" aria-hidden />
            <span className="cnav__error-text">{deleteError}</span>
            <button type="button" onClick={() => setDeleteError(null)} aria-label="Dismiss" className="shrink-0">
              <Icon name="ph:x-bold" width={9} aria-hidden />
            </button>
          </div>
        ) : null}
        {archiveError ? (
          <div role="alert" className="cnav__error">
            <Icon name="ph:warning-circle" width={13} className="shrink-0" aria-hidden />
            <span className="cnav__error-text">{archiveError}</span>
            <button type="button" onClick={() => setArchiveError(null)} aria-label="Dismiss" className="shrink-0">
              <Icon name="ph:x-bold" width={9} aria-hidden />
            </button>
          </div>
        ) : null}

        <div
          id="chat-sidebar-group-panel"
          role="tabpanel"
          aria-labelledby={`chat-sidebar-group-tab-${view}`}
          className="cnav__scroll focus-ring-inset"
        >
          <nav aria-label="Chat threads">
          {!hasSearch && pinnedSessions.length > 0 ? (
            <section aria-label="Pinned threads">
              <div className="cnav__label">
                <span className="cnav__label-text">Pinned</span>
                <span className="cnav__label-count">{pinnedSessions.length}</span>
                <span className="cnav__label-rule" aria-hidden />
              </div>
              <ul>
                {pinnedSessions.map((session) => (
                  <li key={`pin-${session.id}`}>
                    <PinnedThreadRow
                      session={session}
                      active={activeSessionId === session.id}
                      now={now}
                      onOpenUrl={onOpenUrl}
                      onOpen={() => onOpenSession(session)}
                      onTogglePin={() => togglePin(session.id)}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {view === "recent" ? (
            <>
              {!hasSearch && attentionSessions.length > 0 ? (
                <section aria-label="Awaiting you">
                  <div className="cnav__label">
                    <span className="cnav__label-text">Awaiting you</span>
                    <span className="cnav__label-count">{attentionSessions.length}</span>
                    <span className="cnav__label-rule" aria-hidden />
                  </div>
                  <ul>
                    {(showAllByKey.has("attention") ? attentionSessions : attentionSessions.slice(0, THREADS_PREVIEW)).map((session) => (
                      <li key={`attention:${session.id}`}>
                        <ThreadRow
                          session={session}
                          active={activeSessionId === session.id}
                          pinned={isSessionPinned(pinnedIds, session.id)}
                          confirming={confirmingSessionId === session.id}
                          deleting={deletingSessionId === session.id}
                          indent="flat"
                          project={sessionProjectById.get(session.id) ?? null}
                          glyph={threadLeadingIcon(sessionRailTitle(session))}
                          onOpenUrl={onOpenUrl}
                          onOpen={() => onOpenSession(session)}
                          onOpenInSplit={
                            onOpenSessionInSplit ? () => onOpenSessionInSplit(session) : undefined
                          }
                          onTogglePin={() => togglePin(session.id)}
                          onToggleArchive={() => void setSessionArchived(session, !session.archived_at)}
                          archiving={archivingId !== null}
                          onRequestDelete={() => setConfirmingSessionId(session.id)}
                          onCancelDelete={() => setConfirmingSessionId(null)}
                          onConfirmDelete={() => void handleDeleteSession(session)}
                          now={now}
                        />
                      </li>
                    ))}
                    {attentionSessions.length > THREADS_PREVIEW && !showAllByKey.has("attention") ? (
                      <li>
                        <button
                          type="button"
                          onClick={() => setShowAllByKey((cur) => new Set(cur).add("attention"))}
                          className="cnav__more cnav__more--flat focus-ring"
                        >
                          Show {attentionSessions.length - THREADS_PREVIEW} more
                        </button>
                      </li>
                    ) : null}
                  </ul>
                </section>
              ) : null}
            {recentBuckets.length === 0 ? (
              attentionSessions.length > 0 && !hasSearch ? null : (
              <p className="cnav__empty">
                {hasSearch ? "No threads match your search." : "No conversations yet."}
              </p>
              )
            ) : (
              recentBuckets.map((bucket) => {
                const key = `bucket:${bucket.key}`;
                const rows =
                  showAllByKey.has(key) || hasSearch
                    ? bucket.sessions
                    : bucket.sessions.slice(0, THREADS_PREVIEW);
                return (
                  <section key={bucket.key} aria-label={bucket.label}>
                    <div className="cnav__label">
                      <span className="cnav__label-text">{bucket.label}</span>
                      <span className="cnav__label-count">{bucket.sessions.length}</span>
                      <span className="cnav__label-rule" aria-hidden />
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
                            project={sessionProjectById.get(session.id) ?? null}
                            glyph={threadLeadingIcon(sessionRailTitle(session))}
                            onOpenUrl={onOpenUrl}
                            onOpen={() => onOpenSession(session)}
                            onOpenInSplit={
                              onOpenSessionInSplit ? () => onOpenSessionInSplit(session) : undefined
                            }
                            onTogglePin={() => togglePin(session.id)}
                            onToggleArchive={() => void setSessionArchived(session, !session.archived_at)}
                            archiving={archivingId !== null}
                            onRequestDelete={() => setConfirmingSessionId(session.id)}
                            onCancelDelete={() => setConfirmingSessionId(null)}
                            onConfirmDelete={() => void handleDeleteSession(session)}
                            now={now}
                          />
                        </li>
                      ))}
                      {bucket.sessions.length > THREADS_PREVIEW && !showAllByKey.has(key) && !hasSearch ? (
                        <li>
                          <button
                            type="button"
                            onClick={() => setShowAllByKey((cur) => new Set(cur).add(key))}
                            className="cnav__more cnav__more--flat focus-ring"
                          >
                            Show {bucket.sessions.length - THREADS_PREVIEW} more
                          </button>
                        </li>
                      ) : null}
                    </ul>
                  </section>
                );
              })
            )}
            </>
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
                          <ProjectAvatar name={label} root={group.projectRoot} color={group.projectColor} size="sm" className="cnav__folder" />
                        ) : (
                          <Icon name={folderIcon(group, expanded)} width={14} className="cnav__folder" aria-hidden />
                        )}
                        <span className="cnav__group-text">
                          <span className="cnav__group-name" title={group.projectRoot ?? "Threads with no project"}>
                            {label}
                          </span>
                          <span className="cnav__group-meta">{groupMeta(group, now)}</span>
                        </span>
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
                        // (cave-gg5d) A "cave:code-select-project" dispatch used
                        // to precede this — its only listener lived in the
                        // retired (now deleted) ComuxView; onNewChat does the work.
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
                                  onOpenUrl={onOpenUrl}
                                  onOpen={() => onOpenSession(session)}
                                  onOpenInSplit={
                                    onOpenSessionInSplit
                                      ? () => onOpenSessionInSplit(session)
                                      : undefined
                                  }
                                  onTogglePin={() => togglePin(session.id)}
                                  onToggleArchive={() => void setSessionArchived(session, !session.archived_at)}
                                  archiving={archivingId !== null}
                                  onRequestDelete={() => setConfirmingSessionId(session.id)}
                                  onCancelDelete={() => setConfirmingSessionId(null)}
                                  onConfirmDelete={() => void handleDeleteSession(session)}
                                  now={now}
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

        {/* Shared footer (Dashboard + Settings + version) so Chat keeps the same
            side-panel footer as every other surface; it sits below the scrolling
            thread list because .cnav__scroll flexes and this stays put. */}
        <SidebarFooter onOpenSettings={onOpenSettings} />
      </div>
    </div>
  );
}
