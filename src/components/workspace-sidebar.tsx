"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { useMinuteTick } from "@/lib/use-minute-tick";
import { useMultiSelect } from "@/lib/use-multi-select";
import { SelectionToolbar } from "@/components/ui/selection-toolbar";
import { failedTargets, type BroadcastResult } from "@/lib/chat-broadcast";
import { ChatBroadcastComposer } from "@/components/chat-broadcast-composer";
import { Icon, type IconName } from "@/lib/icon";
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
import { requestChatRailToggle } from "@/lib/chat-rail-toggle";

type Props = {
  sessions: SessionRow[];
  /** Selected familiar (null = "All familiars"). Scopes the project list and
   *  the per-project session rows. */
  activeFamiliarId?: string | null;
  activeSessionId?: string | null;
  onOpenSession: (session: SessionRow) => void;
  /** ⌥↵ / ⌥-click / drag on a thread row: open it in a split pane beside the
   *  current chat (the chat surface falls back to a plain open on mobile). */
  onOpenSessionInSplit?: (session: SessionRow) => void;
  onDeleteSession: (session: SessionRow) => Promise<void>;
  /** Refresh the workspace sessions poll after an archive/unarchive PATCH so
   *  the row leaves (or re-enters) the live list without waiting a cycle. */
  onSessionsChanged?: () => void;
  /** Opens the thread's pull request in the in-app browser (PR badge click);
   *  without it the badge falls back to a new tab. Same chain as chat-list. */
  onOpenUrl?: (url: string) => void;
  /** What the title row's collapse control does. Defaults to toggling the
   *  docked desktop rail. The mobile sheet passes its own dismiss instead —
   *  there the row is closing an overlay, not collapsing a column, and firing
   *  the rail toggle would silently flip the desktop preference as a side
   *  effect of dismissing a sheet. */
  onCollapse?: () => void;
  /** Overrides the collapse control's label for hosts where "collapse" is the
   *  wrong verb (the mobile sheet closes). */
  collapseLabel?: string;
};

const THREADS_PREVIEW = 6;

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

function folderLabel(group: ChatProjectGroup): string {
  if (group.projectName) return group.projectName;
  if (group.projectRoot) return group.projectRoot.split(/[\\/]/).filter(Boolean).pop() ?? group.projectRoot;
  return "No project";
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
  /** Broadcast select mode (cave-g7yg6). The row becomes a checkbox and its
   *  click picks instead of opens. Both split-pane affordances stand down —
   *  ⌥-click and drag-to-split would otherwise fire from inside a picker. */
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  /** Transient per-row outcome after a broadcast: "sent" | "failed". */
  broadcast?: "sent" | "failed" | null;
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
  selectMode = false,
  selected = false,
  onToggleSelect,
  broadcast = null,
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
        // Same markup contract the board and the chat list already use for
        // select mode, so assistive tech reads one pattern across surfaces.
        role={selectMode ? "checkbox" : undefined}
        aria-checked={selectMode ? selected : undefined}
        aria-current={!selectMode && active ? "page" : undefined}
        aria-describedby={attentionDescription ? attentionDescriptionId : undefined}
        onClick={(e) => {
          // Select mode intercepts FIRST. This row's click is overloaded —
          // ⌥-click opens a split pane — so without this the modifier path
          // would still fire from inside a picker.
          if (selectMode) {
            onToggleSelect?.();
            return;
          }
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
          if (selectMode) return;
          if (e.key === "Enter" && e.altKey && onOpenInSplit) {
            e.preventDefault();
            onOpenInSplit();
          }
        }}
        // Dragging the row onto the chat surface snaps it into a split pane
        // (chat-split-host's drop zone; same protocol as the project rail).
        draggable={Boolean(onOpenInSplit) && !selectMode}
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
        {/* In select mode the leading slot IS the checkbox — the status dot,
            PR badge and heuristic glyph all describe the thread, and none of
            them says whether it is picked. Colour is not the only channel:
            role=checkbox + aria-checked carry the same state (cave-g7yg6). */}
        {selectMode ? (
          <span
            aria-hidden
            className={`cnav__lead cnav__select-box${selected ? " is-on" : ""}`}
          >
            <Icon name="ph:check-bold" width={9} aria-hidden />
          </span>
        ) : prStatus ? null : leadGlyph ? (
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
            {/* Broadcast outcome replaces the timestamp while it shows: a
                failed target must be visible on its own row, since a
                broadcast that half-worked and said nothing is worse than one
                that failed outright. */}
            {broadcast ? (
              <span className="cnav__broadcast" data-state={broadcast}>
                {broadcast === "sent" ? "Sent" : "Failed"}
              </span>
            ) : confirming ? null : (
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

export function SidebarChatsSection({
  sessions,
  activeFamiliarId = null,
  activeSessionId,
  onOpenSession,
  onOpenSessionInSplit,
  onDeleteSession,
  onSessionsChanged,
  onOpenUrl,
  onCollapse,
  collapseLabel = "Collapse chat list",
}: Props) {
  const { projects } = useProjects({ familiarId: activeFamiliarId });
  const overrides = useProjectOverrides();
  const minuteTick = useMinuteTick();
  // Search was removed with the old search row (the header is a title row
  // now), so this is constant. Kept as a binding rather than inlined because
  // the grouping logic below branches on `hasSearch` in several places.
  const query = "";
  const [showAllByKey, setShowAllByKey] = useState<Set<string>>(() => new Set());
  // Pins come from the shared cross-surface store (chat list + thread rail +
  // this sidebar all read and write the same subscribable list).
  const pinnedIds = usePinnedSessions();
  const [confirmingSessionId, setConfirmingSessionId] = useState<string | null>(null);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // The Organize menu that toggled this went with the old search row, so
  // archived threads stay excluded (as /api/sessions/list already does
  // server-side). The archive/unarchive ACTIONS on each row are untouched.
  const showArchived = false;
  const [archivedRows, setArchivedRows] = useState<SessionRow[]>([]);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [archiveNonce, setArchiveNonce] = useState(0);
  const [archiveError, setArchiveError] = useState<string | null>(null);
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
  // Search filters the single recency-oriented chat list.
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
    () => deriveChatRecencyBuckets(recentSessions, now),
    [recentSessions, now],
  );

  // ── Broadcast select mode (cave-g7yg6) ──────────────────────────────────
  //
  // `visibleThreads` is what select-all acts on and what the hook keys its
  // reset to. It is the rows actually ON SCREEN — a section collapsed behind
  // "Show N more" is excluded, so Select all can never pick a chat the user
  // cannot see and then broadcast into it.
  const visibleThreads = useMemo(() => {
    const rows: SessionRow[] = [];
    const seen = new Set<string>();
    const push = (list: SessionRow[], key: string, previewed: boolean) => {
      const shown = previewed && !showAllByKey.has(key) ? list.slice(0, THREADS_PREVIEW) : list;
      for (const session of shown) {
        if (seen.has(session.id)) continue;
        seen.add(session.id);
        rows.push(session);
      }
    };
    push(pinnedSessions, "pinned", false);
    push(attentionSessions, "attention", true);
    for (const bucket of recentBuckets) push(bucket.sessions, `bucket:${bucket.key}`, true);
    return rows;
  }, [pinnedSessions, attentionSessions, recentBuckets, showAllByKey]);

  const select = useMultiSelect(visibleThreads, (session) => session.id);
  const [composerOpen, setComposerOpen] = useState(false);
  const [broadcastState, setBroadcastState] = useState<Record<string, "sent" | "failed">>({});

  // A broadcast's outcome is per row, and it clears itself: the markers say
  // "this just happened", not "this is what this chat is". Failures are why the
  // selection is not simply dropped — a retry must target only the failures,
  // since nothing about a send is idempotent.
  function applyBroadcastResults(results: BroadcastResult[]) {
    const next: Record<string, "sent" | "failed"> = {};
    for (const r of results) next[r.sessionId] = r.ok ? "sent" : "failed";
    setBroadcastState(next);
    const failures = failedTargets(results).map((t) => t.sessionId);
    select.exit();
    if (failures.length > 0) {
      // Re-enter select mode holding exactly the failures, so the obvious next
      // action — press Broadcast again — retries those and nothing else.
      select.setSelectMode(true);
      for (const id of failures) select.toggle(id);
    }
  }

  const togglePin = (sessionId: string) => {
    toggleStoredPinnedSession(sessionId);
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
  // list; a success refreshes both the workspace poll and the opt-in list.
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
      setArchiveNonce((n) => n + 1);
      onSessionsChanged?.();
    } catch (err) {
      setArchiveError(err instanceof Error ? err.message : archived ? "archive failed" : "unarchive failed");
    } finally {
      setArchivingId(null);
    }
  }

  return (
    // Keep `workspace-sidebar chat-sidebar` on the root: at least eight
    // Playwright specs select `.chat-sidebar` — including warmup.setup.ts,
    // which every e2e run depends on — so dropping these class names would
    // break the suite far outside this component (cave-fh9so).
    <div className="workspace-sidebar chat-sidebar chat-sidebar__embedded cnav">
        {/* Title row: "Sessions" plus the rail's collapse toggle, and nothing
            else. It replaces the old search row, which also carried the
            Organize menu. Search and "Show archived" went with it — the list
            below is already grouped by attention and recency, and the row is
            the rail's header, not a toolbar. */}
        {/* The whole row is the control, mirroring the collapsed spine — the
            icon is decoration inside it, not a nested <button> (which would be
            invalid HTML and would swallow clicks aimed at the row). */}
        <button
          type="button"
          className="cnav__title-row focus-ring"
          aria-label={collapseLabel}
          aria-expanded
          title={collapseLabel}
          onClick={() => (onCollapse ? onCollapse() : requestChatRailToggle())}
        >
          <span className="cnav__title">Sessions</span>
          <span className="cnav__title-toggle" aria-hidden>
            <Icon name="ph:sidebar-simple-fill" width={15} aria-hidden />
          </span>
        </button>
        {/* Entering select mode is its own control rather than a row gesture:
            the rows are already overloaded (⌥-click splits, drag splits), and
            a long-press or modifier would be a fourth meaning on one target. */}
        {!select.selectMode && visibleThreads.length > 1 ? (
          <button
            type="button"
            className="cnav__select-enter focus-ring"
            title="Select chats to broadcast a message to"
            onClick={() => select.setSelectMode(true)}
          >
            <Icon name="ph:list-checks-bold" width={13} aria-hidden />
            <span>Select</span>
          </button>
        ) : null}
        {select.selectMode ? (
          <div className="cnav__select-bar">
            <SelectionToolbar
              allSelected={select.allSelected(visibleThreads)}
              count={select.selectedCount}
              onToggleSelectAll={() => select.toggleSelectAll(visibleThreads)}
              onCancel={select.exit}
            >
              <button
                type="button"
                className="focus-ring cnav__broadcast-open"
                disabled={select.selectedCount === 0}
                onClick={() => setComposerOpen(true)}
              >
                Broadcast
              </button>
            </SelectionToolbar>
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
                          selectMode={select.selectMode}
                          selected={select.isSelected(session.id)}
                          onToggleSelect={() => select.toggle(session.id)}
                          broadcast={broadcastState[session.id] ?? null}
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
                            selectMode={select.selectMode}
                            selected={select.isSelected(session.id)}
                            onToggleSelect={() => select.toggle(session.id)}
                            broadcast={broadcastState[session.id] ?? null}
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
          </nav>
        </div>
        {composerOpen ? (
          <ChatBroadcastComposer
            count={select.selectedCount}
            targets={[...select.selectedIds]}
            onClose={() => setComposerOpen(false)}
            onSent={applyBroadcastResults}
          />
        ) : null}
    </div>
  );
}
