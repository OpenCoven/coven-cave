"use client";

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type { SessionRow } from "@/lib/types";
import { type ChatProjectGroup } from "@/lib/chat-projects";
import { selectionKey, type ProjectSelection } from "@/lib/chat-project-selection";
import { setProjectOverride } from "@/lib/chat-project-overrides";
import { stripLeadingTrailingEmoji } from "@/lib/cave-chat-titles";
import { sessionRailTitle } from "@/lib/session-rail-title";
import {
  PINNED_SESSIONS_KEY,
  isSessionPinned,
  readPinnedSessions,
  togglePinnedSession,
} from "@/lib/chat-session-prefs";
import {
  applyManualOrder,
  partitionPinnedFirst,
  mergeVisibleOrder,
  readSessionOrder,
  writeSessionOrder,
} from "@/lib/chat-session-order";
import { Icon, type IconName } from "@/lib/icon";
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
  open: boolean;
  activeSessionId?: string | null;
  onSetOpen: (open: boolean) => void;
  onSelect: (selection: ProjectSelection) => void;
  onToggleExpanded: (key: string) => void;
  onOpenSession: (session: SessionRow) => void;
  onNewChat: (projectRoot: string | null) => void;
};

function statusDotClass(status: string): string {
  if (status === "running") return "animate-pulse bg-[var(--color-success)]";
  if (status === "failed") return "bg-[var(--color-danger)]";
  if (status === "queued") return "bg-[var(--color-warning)]";
  if (status === "paused") return "bg-[var(--accent-presence-soft)]";
  return "bg-[var(--text-muted)]";
}

/** Compact relative age for the thread-rail rows (kept terse for the 230px width). */
function shortAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return "";
  const s = Math.floor(ms / 1000);
  if (s < 60) return "now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return `${Math.floor(d / 7)}w`;
}

function repoLabel(group: ChatProjectGroup): string {
  return (
    group.projectName ??
    (group.projectRoot?.replace(/\\/g, "/").split("/").filter(Boolean).at(-1) ?? "No project")
  );
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
        <span className="truncate text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--text-primary)]">
          {label}
        </span>
        {typeof count === "number" ? (
          <span className="font-mono text-[11px] text-[var(--text-secondary)] opacity-80">{count}</span>
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
  onTogglePin,
}: {
  session: SessionRow;
  active: boolean;
  pinned: boolean;
  onOpen: () => void;
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
        onKeyDown={(e) => {
          if (e.key === "Enter") onOpen();
        }}
        aria-current={active ? "true" : undefined}
        className={[
          "focus-ring-inset relative flex min-h-[36px] w-full items-center gap-2 py-2 pl-3 pr-1.5 text-left text-[12px] transition-colors",
          active
            ? "bg-[var(--bg-raised)] text-[var(--text-primary)]"
            : "text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]/50 hover:text-[var(--text-primary)]",
        ].join(" ")}
      >
        {active ? <AccentBar /> : null}
        {/* Drag handle — appears on hover; carries the sortable listeners so the
            row's own click stays an "open". */}
        <button
          type="button"
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
          title="Drag to reorder"
          aria-label={`Reorder ${title}`}
          className="chat-thread-handle -ml-1 grid h-4 w-3 shrink-0 cursor-grab touch-none place-items-center text-[var(--text-muted)] opacity-0 transition-opacity hover:text-[var(--text-secondary)] focus-visible:opacity-100 group-hover/row:opacity-100"
        >
          <Icon name="ph:dots-six-vertical" width={11} aria-hidden />
        </button>
        <span
          aria-hidden
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusDotClass(session.status)}`}
        />
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <span className="chat-thread-age shrink-0 font-mono text-[10px] text-[var(--text-muted)] group-hover/row:hidden">
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
              : "text-[var(--text-muted)] opacity-0 focus-visible:opacity-100 group-hover/row:opacity-100",
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
}: {
  session: SessionRow;
  active: boolean;
  onOpen: () => void;
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
        onKeyDown={(e) => {
          if (e.key === "Enter") onOpen();
        }}
        aria-current={active ? "true" : undefined}
        className={[
          "relative flex min-h-[34px] w-full items-center gap-2 py-2 pl-3 pr-2 text-left text-[12px] transition-colors",
          active
            ? "bg-[var(--bg-raised)] text-[var(--text-primary)]"
            : "text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]/50 hover:text-[var(--text-primary)]",
        ].join(" ")}
      >
        {active ? <AccentBar /> : null}
        <button
          type="button"
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
          title="Drag to reorder or move to another project"
          aria-label={`Move ${title}`}
          className="grid h-4 w-3 shrink-0 cursor-grab touch-none place-items-center text-[var(--text-muted)] opacity-0 transition-opacity hover:text-[var(--text-secondary)] focus-visible:opacity-100 group-hover/row:opacity-100"
        >
          <Icon name="ph:dots-six-vertical" width={10} aria-hidden />
        </button>
        <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusDotClass(session.status)}`} />
        <span className="min-w-0 flex-1 truncate">{title}</span>
      </div>
    </li>
  );
}

export function ChatProjectSidebar({
  groups,
  selection,
  expandedKeys,
  open,
  activeSessionId,
  onSetOpen,
  onSelect,
  onToggleExpanded,
  onOpenSession,
  onNewChat,
}: Props) {
  const [search, setSearch] = useState("");
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);
  const [order, setOrder] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);

  // UI prefs (pins + manual order) load after mount so SSR markup and the
  // first client render agree — same idiom as the chat list's persistence.
  useEffect(() => {
    setPinnedIds(readPinnedSessions());
    setOrder(readSessionOrder());
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (hydrated) window.localStorage.setItem(PINNED_SESSIONS_KEY, JSON.stringify(pinnedIds));
  }, [hydrated, pinnedIds]);

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
    setPinnedIds((prev) => togglePinnedSession(prev, sessionId));
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

  if (!open) {
    return (
      <aside className="hidden shrink-0 border-r border-[var(--border-hairline)] lg:flex">
        <button
          type="button"
          onClick={() => onSetOpen(true)}
          title="Show sessions"
          aria-label="Show sessions"
          aria-expanded={false}
          className="focus-ring flex w-7 flex-col items-center pt-3 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-raised)]/50 hover:text-[var(--text-primary)]"
        >
          <span className="edge-rail-chip">
            <Icon name="ph:sidebar-simple" width={14} aria-hidden />
          </span>
        </button>
      </aside>
    );
  }

  return (
    <aside className="chat-thread-rail hidden w-[230px] shrink-0 flex-col border-r border-[var(--border-hairline)] lg:flex">
      <div
        className="flex shrink-0 items-center gap-2 px-3 pb-1 pt-2"
        aria-label="Chat projects header"
      >
        <span className="min-w-0 flex-1 truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
          Projects
        </span>
        <button
          type="button"
          onClick={() => onSelect("all")}
          aria-current={selection === "all" ? "true" : undefined}
          className={[
            "shrink-0 rounded px-1.5 py-0.5 text-[10px] transition-colors",
            selection === "all"
              ? "text-[var(--accent-presence)]"
              : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]",
          ].join(" ")}
        >
          All sessions
        </button>
        <button
          type="button"
          onClick={() => onSetOpen(false)}
          title="Hide sessions"
          aria-label="Hide sessions"
          aria-expanded
          className="focus-ring grid h-6 w-6 place-items-center rounded text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-raised)]/40 hover:text-[var(--text-primary)]"
        >
          <Icon name="ph:sidebar-simple-fill" width={14} aria-hidden />
        </button>
      </div>

      {/* Search */}
      <div className="px-2 pb-2 pt-0 border-b border-[var(--border-hairline)]">
        <label className="flex h-7 items-center gap-1.5 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-raised)]/60 px-2 transition-colors focus-within:border-[var(--accent-presence)]/50 focus-within:bg-[var(--bg-raised)]">
          <Icon name="ph:magnifying-glass" width={12} className="shrink-0 text-[var(--text-muted)]" aria-hidden />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search sessions…"
            aria-label="Search sessions"
            className="min-w-0 flex-1 bg-transparent text-[12px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              aria-label="Clear search"
              className="shrink-0 text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
            >
              <Icon name="ph:x" width={11} aria-hidden />
            </button>
          )}
        </label>
      </div>

      <nav aria-label="Familiar sessions" className="min-h-0 flex-1 overflow-y-auto pb-2">
        {/* ── Flat results appear only while searching; projects stay primary. ── */}
        {hasSearch ? (
          display.length === 0 ? (
            <p className="px-3 pb-3 pt-1 text-center text-[11px] text-[var(--text-muted)]">
              No sessions match your search
            </p>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
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
                      onTogglePin={() => togglePin(session.id)}
                    />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
          )
        ) : null}

        {/* ── Projects — scope the list to one working directory ── */}
        {groups.length > 0 && (
          <>
            {hasSearch ? <div className="mt-1 border-t border-[var(--border-hairline)]" /> : null}

            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleFolderDragEnd}>
              {groups.map((group) => {
                const key = selectionKey(group.projectId, group.projectRoot);
                const expanded = expandedKeys.includes(key);
                const isSelected = selection === key;
                const label = repoLabel(group);
                const orderedSessions = applyManualOrder(group.sessions, order);
                const orderedIds = orderedSessions.map((s) => s.id);
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
                        "focus-ring flex min-h-[38px] min-w-0 flex-1 items-center gap-1.5 rounded py-2 pl-1.5 pr-2 text-left text-[12px] transition-colors",
                        isSelected
                          ? "text-[var(--text-primary)]"
                          : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
                      ].join(" ")}
                    >
                      <Icon name={expanded ? "ph:caret-down" : "ph:caret-right"} width={10} aria-hidden className="shrink-0 text-[var(--text-muted)]" />
                      <Icon
                        name={expanded ? "ph:folder-open" : "ph:folder"}
                        width={13}
                        aria-hidden
                        className="shrink-0 text-[var(--text-muted)]"
                      />
                      <span
                        className={[
                          "min-w-0 flex-1 truncate font-bold",
                          isSelected ? "text-[var(--accent-presence)]" : "text-[var(--text-primary)]",
                        ].join(" ")}
                      >
                        {label}
                      </span>
                      <span className="shrink-0 font-mono text-[11px] text-[var(--text-secondary)] opacity-80">
                        {group.sessions.length}
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
                        {orderedSessions.map((session) => (
                          <FolderChatRow
                            key={session.id}
                            session={session}
                            active={activeSessionId === session.id}
                            onOpen={() => onOpenSession(session)}
                          />
                        ))}
                      </ul>
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
      <div className="chat-thread-ops flex shrink-0 items-center gap-1 border-t border-[var(--border-hairline)] px-2 py-1.5">
        {ADVANCED_OPS.map((op) => (
          <button
            key={op.event}
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent(op.event))}
            title={op.title}
            aria-label={op.title}
            className="focus-ring flex min-w-0 flex-1 items-center justify-center gap-1 rounded-md px-1 py-1 text-[10px] font-medium text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-raised)]/60 hover:text-[var(--text-secondary)]"
          >
            <Icon name={op.icon} width={12} aria-hidden />
            <span className="truncate">{op.label}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}
