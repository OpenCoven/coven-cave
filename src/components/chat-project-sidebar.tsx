"use client";

import "@/styles/chat-list.css";

import { useEffect, useMemo, useState, type CSSProperties, type DragEvent as ReactDragEvent, type ReactNode } from "react";
import type { SessionRow } from "@/lib/types";
import { type ChatProjectGroup } from "@/lib/chat-projects";
import { selectionKey, type ProjectSelection } from "@/lib/chat-project-selection";
import { setProjectOverride } from "@/lib/chat-project-overrides";
import { sessionRailTitle } from "@/lib/session-rail-title";
import { cancelHoverPrefetch, hoverPrefetchConversation } from "@/lib/conversation-cache";
import { relativeTime } from "@/lib/relative-time";
import {
  isSessionPinned,
  toggleStoredPinnedSession,
} from "@/lib/chat-session-prefs";
import { usePinnedSessions } from "@/lib/use-pinned-sessions";
import {
  applyManualOrder,
  partitionPinnedFirst,
  mergeVisibleOrder,
  readSessionOrder,
  writeSessionOrder,
} from "@/lib/chat-session-order";
import {
  CHAT_RAIL_MODE_KEY,
  normalizeChatRailMode,
  railGroupPreview,
  railMoreLabel,
  type ChatRailMode,
} from "@/lib/chat-session-grouping";
import { Icon, type IconName } from "@/lib/icon";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SearchInput } from "@/components/ui/search-input";
import { SurfaceRail } from "@/components/ui/surface-rail";
import { ProjectAvatar } from "@/components/project-avatar";
import { CHAT_OPEN_PROJECTS_EVENT } from "@/lib/chat-tab-events";
import {
  CHAT_SESSION_DRAG_MIME,
  emitChatSessionDragEnd,
  emitChatSessionDragStart,
} from "@/lib/chat-split";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useDroppable,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

// Advanced-operation launchers shown in the rail footer. Each dispatches a
// window event the chat surface listens for, opening the matching right-side
// panel. "Git" surfaces the working-tree diff for the active session — the
// chat plane's git mode for agentic coding.
const ADVANCED_OPS: Array<{ event: string; label: string; title: string; icon: IconName }> = [
  { event: "cave:changes-open", label: "Git", title: "Git changes for this session", icon: "ph:git-diff" },
  { event: "cave:inspector-open", label: "Inspect", title: "Open the familiar inspector", icon: "ph:brain-bold" },
  { event: "cave:debug-open", label: "Debug", title: "Open the session debug panel", icon: "ph:bug-bold" },
];

type Props = {
  groups: ChatProjectGroup[];
  selection: ProjectSelection;
  expandedKeys: string[];
  activeSessionId?: string | null;
  onSelect: (selection: ProjectSelection) => void;
  onToggleExpanded: (key: string) => void;
  onOpenSession: (session: SessionRow) => void;
  /** ⌥↵ on a row: open the conversation in a split pane beside the current
   *  chat (keyboard twin of drag-to-split). Absent when splits are off
   *  (compact rail, mobile) — the row falls back to a plain open. */
  onOpenSessionInSplit?: (session: SessionRow) => void;
  onNewChat: (projectRoot: string | null) => void;
  onOpenProjectsTab?: () => void;
};

function statusDotClass(status: string): string {
  if (status === "running") return "animate-pulse bg-[var(--color-success)]";
  if (status === "failed") return "bg-[var(--color-danger)]";
  if (status === "queued") return "bg-[var(--color-warning)]";
  if (status === "paused") return "bg-[var(--accent-presence-soft)]";
  return "bg-[var(--text-muted)]";
}

/**
 * Compact relative age for the thread-rail rows. Delegates to the shared
 * `relativeTime` helper for "Xm ago"/"Xh ago" wording (consistent with the rest
 * of the app), but PINNED to compact density regardless of the Appearance →
 * Relative time preference — the 230px rail has no room for "X minutes ago".
 */
function shortAge(iso: string): string {
  return relativeTime(iso, Date.now(), "compact");
}

function repoLabel(group: ChatProjectGroup): string {
  return (
    group.projectName ??
    (group.projectRoot?.replace(/\\/g, "/").split("/").filter(Boolean).at(-1) ?? "No project")
  );
}

// Native HTML5 drag props for a thread row: dragging the row *body* carries the
// conversation to the chat surface's split drop zone (chat-split-host). The
// dnd-kit reorder handle is exempted — a native dragstart from inside it is
// cancelled so the pointer-driven reorder keeps sole ownership of that slot.
function sessionDragProps(sessionId: string, title: string) {
  return {
    draggable: true,
    onDragStart: (e: ReactDragEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest?.("[data-thread-drag-handle]")) {
        e.preventDefault();
        return;
      }
      e.dataTransfer.setData(CHAT_SESSION_DRAG_MIME, sessionId);
      e.dataTransfer.setData("text/plain", title);
      e.dataTransfer.effectAllowed = "copyMove";
      emitChatSessionDragStart({ sessionId, title });
    },
    onDragEnd: () => emitChatSessionDragEnd(),
  };
}


function AccentBar({ tall }: { tall?: boolean }) {
  return (
    <span
      aria-hidden
      className={`absolute left-0 top-1/2 w-[2px] -translate-y-1/2 rounded-r-full bg-[var(--accent-presence)] ${tall ? "h-5" : "h-4"}`}
    />
  );
}

// Uppercase, letter-spaced section header — the rail's modern grouping primitive.
// Reused for RESULTS / PROJECTS so every group reads the same way.
function RailSection({ label, count, action }: { label: string; count?: number; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-[var(--border-hairline)] bg-[color-mix(in_oklch,var(--bg-base)_86%,var(--foreground)_14%)] px-3 py-1.5">
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="truncate text-[length:var(--text-xs)] font-bold uppercase tracking-[0.12em] text-[var(--text-primary)]">
          {label}
        </span>
        {typeof count === "number" ? (
          <span className="font-mono text-[length:var(--text-xs)] text-[var(--text-secondary)] opacity-80">{count}</span>
        ) : null}
      </span>
      {action}
    </div>
  );
}

// ── Sortable thread row (flat search results) ─────────────────────────────────
// Mirrors the familiar-avatar-rail dnd idiom: PointerSensor activation distance
// keeps a quick click an "open", and only deliberate drag (>=5px) reorders.

function ThreadRow({
  session,
  active,
  pinned,
  onOpen,
  onOpenInSplit,
  onTogglePin,
}: {
  session: SessionRow;
  active: boolean;
  pinned: boolean;
  onOpen: () => void;
  onOpenInSplit?: () => void;
  onTogglePin: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: session.id,
  });
  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
  };
  const title = sessionRailTitle(session);
  return (
    <li
      ref={setNodeRef}
      style={style}
      data-dragging={isDragging ? "true" : undefined}
      className="chat-thread-row group/row relative"
    >
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onMouseEnter={() => hoverPrefetchConversation(session.id)}
        onMouseLeave={cancelHoverPrefetch}
        onFocus={() => hoverPrefetchConversation(session.id)}
        onBlur={cancelHoverPrefetch}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          // ⌥↵ opens in a split pane (keyboard twin of drag-to-split).
          if (e.altKey && onOpenInSplit) {
            e.preventDefault();
            onOpenInSplit();
            return;
          }
          onOpen();
        }}
        {...sessionDragProps(session.id, title)}
        aria-current={active ? "true" : undefined}
        className={[
          "focus-ring-inset relative flex min-h-[36px] w-full items-center gap-1.5 rounded-[var(--radius-control)] py-2 pl-2 pr-1.5 text-left text-[length:var(--text-sm)] transition-colors",
          active
            ? "bg-[var(--bg-raised)] text-[var(--text-primary)]"
            : "text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]/50 hover:text-[var(--text-primary)]",
        ].join(" ")}
      >
        {active ? <AccentBar /> : null}
        {/* Status dot and drag handle share one slot — dot by default, handle on
            hover — so the row reserves no extra left gutter for the handle. */}
        <span className="relative grid h-4 w-3 shrink-0 place-items-center">
          <span
            aria-hidden
            className={`h-1.5 w-1.5 rounded-full transition-opacity group-hover/row:opacity-0 ${statusDotClass(session.status)}`}
          />
          <button
            type="button"
            {...attributes}
            {...listeners}
            data-thread-drag-handle=""
            onClick={(e) => e.stopPropagation()}
            title="Drag to reorder"
            aria-label={`Reorder ${title}`}
            className="chat-thread-handle absolute inset-0 grid cursor-grab touch-none place-items-center text-[var(--text-muted)] opacity-0 transition-opacity hover:text-[var(--text-secondary)] focus-visible:opacity-100 group-hover/row:opacity-100"
          >
            <Icon name="ph:dots-six-vertical" width={11} aria-hidden />
          </button>
        </span>
        <span className="min-w-0 flex-1 truncate" title={title}>{title}</span>
        <span className="chat-thread-age shrink-0 font-mono text-[length:var(--text-2xs)] text-[var(--text-muted)] group-hover/row:hidden">
          {shortAge(session.updated_at)}
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onTogglePin();
          }}
          title={pinned ? "Unpin chat" : "Pin chat"}
          aria-label={`${pinned ? "Unpin" : "Pin"} ${title}`}
          aria-pressed={pinned}
          className={[
            "shrink-0 rounded p-0.5 transition-all hover:text-[var(--accent-presence)]",
            pinned
              ? "text-[var(--accent-presence)] opacity-100"
              : // touch-always-visible: hover-reveal is undiscoverable on touch
                // (cave-w96h). The drag handles stay hover-only on purpose —
                // they overlay the status dot, and stay hit-testable regardless.
                "touch-always-visible text-[var(--text-muted)] opacity-0 focus-visible:opacity-100 group-hover/row:opacity-100",
          ].join(" ")}
        >
          <Icon
            name={pinned ? "ph:bookmark-simple-fill" : "ph:bookmark-simple"}
            width={12}
            aria-hidden
          />
        </button>
      </div>
    </li>
  );
}

// A project folder acts as a drop zone: dropping a chat anywhere on the folder
// re-buckets it into that project (cave-local override; the agent cwd is
// unchanged). id is `folder:<selectionKey>` so the drag handler can resolve it.
function FolderDroppable({ id, children }: { id: string; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      data-drop-over={isOver ? "true" : undefined}
      className={isOver ? "rounded-md ring-1 ring-inset ring-[var(--accent-presence)]/60" : undefined}
    >
      {children}
    </div>
  );
}

// A chat row inside a project folder: click opens it; the handle drags it to
// reorder within the folder or onto another folder to move it.
function FolderChatRow({
  session,
  active,
  onOpen,
  onOpenInSplit,
}: {
  session: SessionRow;
  active: boolean;
  onOpen: () => void;
  onOpenInSplit?: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: session.id,
  });
  const style: CSSProperties = { transform: CSS.Translate.toString(transform), transition };
  const title = sessionRailTitle(session);
  return (
    <li ref={setNodeRef} style={style} data-dragging={isDragging ? "true" : undefined} className="group/row relative">
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onMouseEnter={() => hoverPrefetchConversation(session.id)}
        onMouseLeave={cancelHoverPrefetch}
        onFocus={() => hoverPrefetchConversation(session.id)}
        onBlur={cancelHoverPrefetch}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          // ⌥↵ opens in a split pane (keyboard twin of drag-to-split).
          if (e.altKey && onOpenInSplit) {
            e.preventDefault();
            onOpenInSplit();
            return;
          }
          onOpen();
        }}
        {...sessionDragProps(session.id, title)}
        aria-current={active ? "true" : undefined}
        className={[
          "relative flex min-h-[34px] w-full items-center gap-1.5 py-2 pl-6 pr-2 text-left text-[length:var(--text-sm)] transition-colors",
          active
            ? "bg-[var(--bg-raised)] text-[var(--text-primary)]"
            : "text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]/50 hover:text-[var(--text-primary)]",
        ].join(" ")}
      >
        {active ? <AccentBar /> : null}
        {/* Status dot and drag handle share one slot — dot by default, handle on
            hover — so the row reserves no extra left gutter for the handle. */}
        <span className="relative grid h-4 w-3 shrink-0 place-items-center">
          <span
            aria-hidden
            className={`h-1.5 w-1.5 rounded-full transition-opacity group-hover/row:opacity-0 ${statusDotClass(session.status)}`}
          />
          <button
            type="button"
            {...attributes}
            {...listeners}
            data-thread-drag-handle=""
            onClick={(e) => e.stopPropagation()}
            title="Drag to reorder or move to another project"
            aria-label={`Move ${title}`}
            className="absolute inset-0 grid cursor-grab touch-none place-items-center text-[var(--text-muted)] opacity-0 transition-opacity hover:text-[var(--text-secondary)] focus-visible:opacity-100 group-hover/row:opacity-100"
          >
            <Icon name="ph:dots-six-vertical" width={10} aria-hidden />
          </button>
        </span>
        <span className="min-w-0 flex-1 truncate" title={title}>{title}</span>
        <span className="chat-thread-age shrink-0 font-mono text-[length:var(--text-2xs)] text-[var(--text-muted)] group-hover/row:hidden">
          {shortAge(session.updated_at)}
        </span>
      </div>
    </li>
  );
}

// A flat Recent-mode row: small status dot + title + age, recency-sorted.
// Presentation-only alternative to the folder tree — pins, reorder and moves
// stay on the By-project view; opens/split/prefetch behave identically.
function RecentChatRow({
  session,
  active,
  onOpen,
  onOpenInSplit,
}: {
  session: SessionRow;
  active: boolean;
  onOpen: () => void;
  onOpenInSplit?: () => void;
}) {
  const title = sessionRailTitle(session);
  return (
    <li className="group/row relative">
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onMouseEnter={() => hoverPrefetchConversation(session.id)}
        onMouseLeave={cancelHoverPrefetch}
        onFocus={() => hoverPrefetchConversation(session.id)}
        onBlur={cancelHoverPrefetch}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          if (e.altKey && onOpenInSplit) {
            e.preventDefault();
            onOpenInSplit();
            return;
          }
          onOpen();
        }}
        {...sessionDragProps(session.id, title)}
        aria-current={active ? "true" : undefined}
        className={[
          "focus-ring-inset relative flex min-h-[var(--space-8)] w-full items-center gap-2 rounded-[var(--radius-control)] px-2 py-1.5 text-left text-[length:var(--text-sm)] transition-colors",
          active
            ? "bg-[var(--bg-raised)] text-[var(--text-primary)]"
            : "text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]/50 hover:text-[var(--text-primary)]",
        ].join(" ")}
      >
        {active ? <AccentBar /> : null}
        <span aria-hidden className={`h-[5px] w-[5px] shrink-0 rounded-full ${statusDotClass(session.status)}`} />
        <span className="min-w-0 flex-1 truncate" title={title}>{title}</span>
        <span className="chat-thread-age shrink-0 font-mono text-[length:var(--text-2xs)] text-[var(--text-muted)]">
          {shortAge(session.updated_at)}
        </span>
      </div>
    </li>
  );
}

export function ChatProjectSidebar({
  groups,
  selection,
  expandedKeys,
  activeSessionId,
  onSelect,
  onToggleExpanded,
  onOpenSession,
  onOpenSessionInSplit,
  onNewChat,
  onOpenProjectsTab,
}: Props) {
  const [search, setSearch] = useState("");
  // Pins come from the shared cross-surface store; the manual drag order is
  // still local (this rail is its only writer).
  const pinnedIds = usePinnedSessions();
  const [order, setOrder] = useState<string[]>([]);
  // By project (folder tree, default) vs Recent (flat recency list) — the
  // rail's presentation mode, persisted as a plain string.
  const [railMode, setRailModeState] = useState<ChatRailMode>("projects");
  // Per-group preview cap: groups render at most 6 rows until "Show N more".
  const [showMoreKeys, setShowMoreKeys] = useState<Set<string>>(() => new Set());

  // The manual order loads after mount so SSR markup and the first client
  // render agree — same idiom as the chat list's persistence.
  useEffect(() => {
    setOrder(readSessionOrder());
    try {
      setRailModeState(normalizeChatRailMode(window.localStorage.getItem(CHAT_RAIL_MODE_KEY)));
    } catch {
      // storage unavailable — default mode stands
    }
  }, []);

  const setRailMode = (mode: ChatRailMode) => {
    setRailModeState(mode);
    try {
      window.localStorage.setItem(CHAT_RAIL_MODE_KEY, mode);
    } catch {
      // persistence is best-effort
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Flatten every group's sessions for cross-project search results and order
  // pruning. The project tree remains the default navigation surface.
  const allSessions = useMemo(() => {
    const flat = groups.flatMap((g) => g.sessions);
    return [...flat].sort((a, b) =>
      (a.updated_at || a.created_at) < (b.updated_at || b.created_at) ? 1 : -1,
    );
  }, [groups]);

  const display = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    let rows = allSessions;
    rows = rows.filter(
      (s) =>
        (s.title ?? "").toLowerCase().includes(q) ||
        (s.project_root ?? "").toLowerCase().includes(q),
    );
    rows = applyManualOrder(rows, order);
    // Default view floats pinned to the top; once the user has dragged a manual
    // order, that intent wins and pins stay put (no tug-of-war on drop).
    if (order.length === 0) rows = partitionPinnedFirst(rows, pinnedIds);
    return rows;
  }, [allSessions, search, order, pinnedIds]);

  const displayIds = useMemo(() => display.map((s) => s.id), [display]);
  const hasSearch = search.trim().length > 0;

  function openProjectsTab() {
    if (onOpenProjectsTab) {
      onOpenProjectsTab();
      return;
    }
    window.dispatchEvent(new CustomEvent(CHAT_OPEN_PROJECTS_EVENT));
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = displayIds.indexOf(String(active.id));
    const newIndex = displayIds.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    const nextVisible = arrayMove(displayIds, oldIndex, newIndex);
    setOrder((prev) => {
      const merged = mergeVisibleOrder(prev, nextVisible);
      // Prune ids that no longer match a live session so the array can't grow
      // without bound across deletes.
      const live = new Set(allSessions.map((s) => s.id));
      const pruned = merged.filter((id) => live.has(id));
      writeSessionOrder(pruned);
      return pruned;
    });
  }

  function togglePin(sessionId: string) {
    toggleStoredPinnedSession(sessionId);
  }

  // Folder-tree DnD: reorder a chat within its project, or drop it onto another
  // project folder to move it there (cave-local override — the agent cwd is
  // never touched). over.id is a chat id (reorder/move-near) or `folder:<key>`.
  function handleFolderDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    if (activeId === overId) return;

    const source = groups.find((g) => g.sessions.some((s) => s.id === activeId));
    if (!source) return;

    let target: ChatProjectGroup | undefined;
    if (overId.startsWith("folder:")) {
      const overKey = overId.slice("folder:".length);
      target = groups.find((g) => selectionKey(g.projectId, g.projectRoot) === overKey);
    } else {
      target = groups.find((g) => g.sessions.some((s) => s.id === overId));
    }
    if (!target) return;

    const sourceKey = selectionKey(source.projectId, source.projectRoot);
    const targetKey = selectionKey(target.projectId, target.projectRoot);

    if (sourceKey === targetKey) {
      // Same folder → reorder via the shared manual-order list.
      if (overId.startsWith("folder:")) return;
      const ids = applyManualOrder(source.sessions, order).map((s) => s.id);
      const from = ids.indexOf(activeId);
      const to = ids.indexOf(overId);
      if (from < 0 || to < 0) return;
      const nextVisible = arrayMove(ids, from, to);
      setOrder((prev) => {
        const merged = mergeVisibleOrder(prev, nextVisible);
        const live = new Set(allSessions.map((s) => s.id));
        const pruned = merged.filter((id) => live.has(id));
        writeSessionOrder(pruned);
        return pruned;
      });
      return;
    }

    // Different folder → move (empty root = the ungrouped bucket).
    setProjectOverride(activeId, target.projectRoot ?? "");
  }

  // Rail-mode mini toggle (26px): By project = folder tree, Recent = flat
  // recency rows. aria-pressed buttons, not a tablist — the rail's modes are
  // views of one list, not panels.
  function railModeSegmentClass(on: boolean): string {
    return [
      "focus-ring-inset h-full min-w-0 flex-1 truncate px-2 text-[length:var(--text-xs)] transition-colors",
      on
        ? "bg-[color-mix(in_oklch,var(--accent-presence)_16%,transparent)] font-medium text-[var(--accent-presence)] shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--accent-presence)_38%,transparent)]"
        : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]",
    ].join(" ");
  }

  const recentRows = allSessions;

  return (
    <div className="hidden lg:contents">
      <SurfaceRail
        storageKey="cave:chat:rail"
        title="Chats"
        ariaLabel="Chats"
        actions={
          <>
            <button
              type="button"
              onClick={() => onNewChat(null)}
              title="New chat"
              aria-label="New chat"
              className="focus-ring text-[var(--accent-presence)]"
            >
              <Icon name="ph:plus-bold" width={14} aria-hidden />
            </button>
            <button
              type="button"
              title="Open Projects tab"
              aria-label="Open Projects tab"
              onClick={openProjectsTab}
              className="focus-ring"
            >
              <Icon name="ph:folder-open-bold" width={13} aria-hidden />
            </button>
          </>
        }
        search={
          <SearchInput
            value={search}
            onValueChange={setSearch}
            onClear={() => setSearch("")}
            placeholder="Search chats…"
            aria-label="Search chats"
          />
        }
      >
        {(open, setOpen) => (
          <>
            {open ? (
              <div
                role="group"
                aria-label="Chats rail view"
                className="flex h-[26px] shrink-0 items-stretch overflow-hidden rounded-[var(--radius-control)] border border-[var(--border-hairline)]"
              >
                <button
                  type="button"
                  aria-pressed={railMode === "projects"}
                  onClick={() => setRailMode("projects")}
                  className={railModeSegmentClass(railMode === "projects")}
                >
                  By project
                </button>
                <button
                  type="button"
                  aria-pressed={railMode === "recent"}
                  onClick={() => setRailMode("recent")}
                  className={railModeSegmentClass(railMode === "recent")}
                >
                  Recent
                </button>
              </div>
            ) : null}

            <nav aria-label="Familiar sessions" className="flex min-h-0 flex-col pb-2">
              {/* ── Flat results appear only while searching; projects stay primary. ── */}
              {open && hasSearch ? (
                display.length === 0 ? (
                  <p className="px-3 pb-3 pt-1 text-center text-[length:var(--text-xs)] text-[var(--text-muted)]">
                    No chats match your search
                  </p>
                ) : (
                  <DndContext id="chat-sidebar-projects" sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                    <SortableContext items={displayIds} strategy={verticalListSortingStrategy}>
                      <ul>
                        <li>
                          <RailSection label="Results" count={display.length} />
                        </li>
                        {display.map((session) => (
                          <ThreadRow
                            key={session.id}
                            session={session}
                            active={activeSessionId === session.id}
                            pinned={isSessionPinned(pinnedIds, session.id)}
                            onOpen={() => onOpenSession(session)}
                            onOpenInSplit={
                              onOpenSessionInSplit ? () => onOpenSessionInSplit(session) : undefined
                            }
                            onTogglePin={() => togglePin(session.id)}
                          />
                        ))}
                      </ul>
                    </SortableContext>
                  </DndContext>
                )
              ) : null}

              {/* ── Zero sessions — a friendly invitation instead of a blank rail.
                    Without this, a familiar with no sessions yet rendered an empty
                    nav and the rail read as broken. onNewChat(null) opens a fresh
                    compose view (no project scope) — the same path as the folder
                    "+" buttons. */}
              {!hasSearch && groups.length === 0 ? (
                open ? (
                  <div className="px-1 pt-4">
                    <EmptyState
                      compact
                      className="rounded-lg border border-dashed border-[var(--border-hairline)] bg-[var(--bg-raised)]/35"
                      icon="ph:chat-circle-dots"
                      headline="No conversations yet"
                      subtitle="Start a chat and your sessions will appear here."
                      actions={
                        <Button size="sm" variant="primary" leadingIcon="ph:plus" onClick={() => onNewChat(null)}>
                          Start a chat
                        </Button>
                      }
                    />
                  </div>
                ) : null
              ) : null}

              {/* ── Recent — flat recency-sorted rows (open rail only) ── */}
              {open && !hasSearch && railMode === "recent" && recentRows.length > 0 ? (
                <ul className="flex flex-col gap-px">
                  {recentRows.map((session) => (
                    <RecentChatRow
                      key={session.id}
                      session={session}
                      active={activeSessionId === session.id}
                      onOpen={() => onOpenSession(session)}
                      onOpenInSplit={
                        onOpenSessionInSplit ? () => onOpenSessionInSplit(session) : undefined
                      }
                    />
                  ))}
                </ul>
              ) : null}

              {/* ── Collapsed rail: project identity tiles only. Activating one
                    expands the rail, scopes the list to that project, and opens
                    the group. ── */}
              {!open && groups.length > 0 ? (
                <div className="flex flex-col items-center gap-1">
                  {groups.map((group) => {
                    const key = selectionKey(group.projectId, group.projectRoot);
                    const label = repoLabel(group);
                    return (
                      <button
                        key={key}
                        type="button"
                        title={label}
                        aria-label={`Open ${label} chats`}
                        aria-current={selection === key ? "true" : undefined}
                        onClick={() => {
                          setOpen(true);
                          onSelect(key);
                          if (!expandedKeys.includes(key)) onToggleExpanded(key);
                        }}
                        className={[
                          "focus-ring grid h-8 w-8 place-items-center rounded-[var(--radius-control)] transition-colors",
                          selection === key
                            ? "bg-[color-mix(in_oklch,var(--accent-presence)_16%,transparent)]"
                            : "hover:bg-[var(--bg-raised)]/60",
                        ].join(" ")}
                      >
                        <ProjectAvatar name={label} root={group.projectRoot} color={group.projectColor} size="md" />
                      </button>
                    );
                  })}
                </div>
              ) : null}

              {/* ── Projects — scope the list to one working directory ── */}
              {open && (railMode === "projects" || hasSearch) && groups.length > 0 && (
                <>
                  {hasSearch ? <div className="mt-1 border-t border-[var(--border-hairline)]" /> : null}

                  <button
                    type="button"
                    onClick={() => onSelect("all")}
                    aria-current={selection === "all" ? "true" : undefined}
                    className={[
                      "focus-ring mb-0.5 rounded px-2 py-1 text-left text-[length:var(--text-2xs)] font-medium uppercase tracking-[0.08em] transition-colors",
                      selection === "all"
                        ? "text-[var(--accent-presence)]"
                        : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]",
                    ].join(" ")}
                  >
                    All sessions
                  </button>

                  <DndContext id="cps-folders" sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleFolderDragEnd}>
                    {groups.map((group) => {
                      const key = selectionKey(group.projectId, group.projectRoot);
                      const expanded = expandedKeys.includes(key);
                      const isSelected = selection === key;
                      const label = repoLabel(group);
                      const orderedSessions = applyManualOrder(group.sessions, order);
                      const showAll = showMoreKeys.has(key);
                      const { shown, hiddenCount } = railGroupPreview(orderedSessions, showAll);
                      const orderedIds = shown.map((s) => s.id);
                      const latestIso = group.updatedAt ?? group.sessions[0]?.updated_at ?? null;
                      const groupMeta = `${group.sessions.length} chat${group.sessions.length === 1 ? "" : "s"}${latestIso ? ` · ${shortAge(latestIso)}` : ""}`;
                      return (
                        <FolderDroppable key={key} id={`folder:${key}`}>
                          <div
                            className={[
                              // Project folders are task-section headers: a mode-aware
                              // fill (darker than the page in light mode, lighter in
                              // dark — the ramp inverts per mode) + a hairline divider
                              // so each group reads clearly as a header, matching the
                              // RailSection treatment. Selected keeps an accent tint.
                              "group relative flex w-full items-center border-b border-[var(--border-hairline)] transition-colors",
                              isSelected
                                ? "bg-[color-mix(in_oklch,var(--bg-base)_80%,var(--accent-presence)_20%)]"
                                : "bg-[color-mix(in_oklch,var(--bg-base)_86%,var(--foreground)_14%)] hover:bg-[color-mix(in_oklch,var(--bg-base)_80%,var(--foreground)_20%)]",
                            ].join(" ")}
                          >
                            {isSelected ? <AccentBar tall /> : null}
                            <button
                              type="button"
                              onClick={() => {
                                onSelect(key);
                                onToggleExpanded(key);
                              }}
                              aria-expanded={expanded}
                              aria-label={`${expanded ? "Collapse" : "Expand"} ${label} sessions`}
                              aria-current={isSelected ? "true" : undefined}
                              className={[
                                "focus-ring flex min-h-[38px] min-w-0 flex-1 items-center gap-1.5 rounded py-2 pl-1.5 pr-2 text-left text-[length:var(--text-sm)] transition-colors",
                                isSelected
                                  ? "text-[var(--text-primary)]"
                                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
                              ].join(" ")}
                            >
                              <Icon name={expanded ? "ph:caret-down" : "ph:caret-right"} width={10} aria-hidden className="shrink-0 text-[var(--text-muted)]" />
                              <ProjectAvatar
                                name={label}
                                root={group.projectRoot}
                                color={group.projectColor}
                                size="md"
                                className="shrink-0"
                              />
                              <span
                                className={[
                                  "min-w-0 flex-1 truncate font-bold",
                                  isSelected ? "text-[var(--accent-presence)]" : "text-[var(--text-primary)]",
                                ].join(" ")}
                              >
                                {label}
                              </span>
                              <span className="shrink-0 text-[length:var(--text-2xs)] text-[var(--text-muted)]">
                                {groupMeta}
                              </span>
                            </button>
                            <button
                              type="button"
                              onClick={() => onNewChat(group.projectRoot)}
                              title={`New session in ${label}`}
                              aria-label={`New session in ${label}`}
                              className="touch-always-visible focus-ring absolute right-1 grid h-5 w-5 place-items-center rounded text-[var(--text-muted)] opacity-0 transition-opacity hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)] focus-visible:opacity-100 group-hover:opacity-100"
                            >
                              <Icon name="ph:plus" width={11} aria-hidden />
                            </button>
                          </div>
                          {expanded ? (
                            <SortableContext items={orderedIds} strategy={verticalListSortingStrategy}>
                              <ul>
                                {shown.map((session) => (
                                  <FolderChatRow
                                    key={session.id}
                                    session={session}
                                    active={activeSessionId === session.id}
                                    onOpen={() => onOpenSession(session)}
                                    onOpenInSplit={
                                      onOpenSessionInSplit ? () => onOpenSessionInSplit(session) : undefined
                                    }
                                  />
                                ))}
                              </ul>
                              {hiddenCount > 0 || showAll ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setShowMoreKeys((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(key)) next.delete(key);
                                      else next.add(key);
                                      return next;
                                    })
                                  }
                                  className="focus-ring w-full rounded-[var(--radius-sm)] py-1 pl-6 pr-2 text-left text-[length:var(--text-2xs)] text-[var(--text-muted)] transition-colors hover:text-[var(--accent-presence)]"
                                >
                                  {railMoreLabel(showAll, hiddenCount)}
                                </button>
                              ) : null}
                            </SortableContext>
                          ) : null}
                        </FolderDroppable>
                      );
                    })}
                  </DndContext>
                </>
              )}
            </nav>

            {/* ── Advanced operations ── quick launchers for the right-side panels
                  (Git diff / Inspector / Debug). They reach the chat surface's right
                  panel through the same window-event bridge as the MetaLine bug
                  button, so the rail stays decoupled from the panel's owner. */}
            <div className="chat-thread-ops mt-auto flex shrink-0 items-center gap-1 border-t border-[var(--border-hairline)] pt-1.5 data-[open=false]:flex-col" data-open={open ? "true" : "false"}>
              {ADVANCED_OPS.map((op) => (
                <button
                  key={op.event}
                  type="button"
                  onClick={() => window.dispatchEvent(new CustomEvent(op.event))}
                  title={op.title}
                  aria-label={op.title}
                  className="focus-ring flex min-w-0 flex-1 items-center justify-center gap-1 rounded-md px-1 py-1 text-[length:var(--text-2xs)] font-medium text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-raised)]/60 hover:text-[var(--text-secondary)]"
                >
                  <Icon name={op.icon} width={12} aria-hidden />
                  {open ? <span className="truncate">{op.label}</span> : null}
                </button>
              ))}
            </div>
          </>
        )}
      </SurfaceRail>
    </div>
  );
}
