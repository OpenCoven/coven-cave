"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";

import { Icon } from "@/lib/icon";
import { relativeTime } from "@/lib/relative-time";
import { RelativeTime } from "@/components/ui/relative-time";
import { modelIcon, modelLabel } from "@/lib/model-label";
import { useDateTimePrefs } from "@/lib/datetime-format";
import { useMinuteTick } from "@/lib/use-minute-tick";
import type { CaveProject } from "@/lib/cave-projects-types";
import { normalizeProjectRoot } from "@/lib/cave-projects-types";
import { CHAT_FOCUS_PROJECT_EVENT } from "@/lib/chat-tab-events";
import type { SessionRow } from "@/lib/types";
import { stripLeadingTrailingEmoji, disambiguateSessionTitles } from "@/lib/cave-chat-titles";
import {
  applyManualOrder,
  mergeVisibleOrder,
  readSessionOrder,
  writeSessionOrder,
} from "@/lib/chat-session-order";
import { applyProjectOverrides, setProjectOverride, clearProjectOverride } from "@/lib/chat-project-overrides";
import { useProjectOverrides } from "@/lib/use-project-overrides";
import { useProjects } from "@/lib/use-projects";
import { deriveProjectStatus } from "@/lib/project-status";
import { useProjectsUiState } from "@/lib/projects/use-projects-ui-state";
import type { ProjectsDensity } from "@/lib/projects/projects-ui-state";
import { sessionGlyph, glyphToneClass, stripTaskPrefix } from "@/lib/projects/session-glyph";
import { projectStats } from "@/lib/projects/project-stats";
import { useRovingTabIndex } from "@/lib/use-roving-tabindex";
import { ContextMenu, openContextMenuAt, type ContextMenuState } from "@/components/ui/context-menu";
import { PopoverItem, PopoverSeparator } from "@/components/ui/popover";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { SkeletonRows } from "@/components/ui/skeleton";
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

// Cap nested chats per project card so a busy project doesn't bury the others;
// a "Show all" toggle expands the rest.
const CHAT_CAP = 8;

function chatDotClass(status: string): string {
  if (status === "running") return "bg-[var(--accent-presence)]";
  if (status === "failed" || status === "error") return "bg-[var(--color-danger)]";
  if (status === "recent") return "bg-[var(--color-success)]";
  return "bg-[var(--text-muted)]";
}


/** Most-recent activity across a project's sessions (epoch ms; 0 when empty). */
function lastActiveMs(chats: SessionRow[]): number {
  let max = 0;
  for (const s of chats) {
    const t = new Date(s.updated_at).getTime();
    if (Number.isFinite(t) && t > max) max = t;
  }
  return max;
}

/** Collapse $HOME to ~ and left-truncate long paths to "first/…/repo" so the
 *  identical absolute prefix stops dominating each row. Full path stays in the
 *  title attribute (and the inline editor still edits the real root). */
function shortRoot(p: string): string {
  const home = p.replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/, "~");
  const isAbs = home.startsWith("/");
  const parts = home.split("/").filter(Boolean);
  if (parts.length <= 2) return home;
  return `${isAbs ? "/" : ""}${parts[0]}/…/${parts[parts.length - 1]}`;
}

// A chat under a project card: click opens it (via the agents-open-session
// event the chat surface already listens for); the handle drags it to reorder
// within the project or onto another project card to move it. The trash button
// deletes the chat with a two-step confirm, mirroring the Chats list.
//
// In select mode the leading drag handle becomes a checkbox and the row's
// primary click toggles selection instead of opening the chat, so several chats
// can be deleted together via the card's bulk toolbar.
// Transient toast shown after a cross-project drag, offering a one-click Undo.
// Auto-dismisses after a few seconds; remount (via a key) restarts the timer.
function MoveUndoToast({
  label,
  onUndo,
  onDismiss,
}: {
  label: string;
  onUndo: () => void;
  onDismiss: () => void;
}) {
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  useEffect(() => {
    const t = window.setTimeout(() => dismissRef.current(), 5000);
    return () => window.clearTimeout(t);
  }, []);
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-1/2 z-50 flex max-w-[90vw] -translate-x-1/2 items-center gap-3 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-elevated)] px-3 py-2 text-[12px] text-[var(--text-primary)] shadow-[0_16px_40px_oklch(0_0_0/45%)]"
    >
      <Icon name="ph:arrow-right-bold" width={13} className="shrink-0 text-[var(--accent-presence)]" aria-hidden />
      <span className="min-w-0 truncate">{label}</span>
      <button
        type="button"
        onClick={onUndo}
        className="focus-ring shrink-0 rounded px-1.5 py-0.5 font-medium text-[var(--accent-presence)] hover:bg-[var(--bg-hover)]"
      >
        Undo
      </button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="focus-ring shrink-0 rounded p-0.5 text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
      >
        <Icon name="ph:x-bold" width={12} aria-hidden />
      </button>
    </div>
  );
}

function ProjectChatRow({
  session,
  displayTitle,
  onOpen,
  onDelete,
  selectMode,
  selected,
  onToggleSelect,
  density,
}: {
  session: SessionRow;
  displayTitle?: string;
  onOpen: () => void;
  onDelete: (id: string) => Promise<void>;
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  density: ProjectsDensity;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: session.id,
  });
  const style: CSSProperties = { transform: CSS.Translate.toString(transform), transition };
  const title = stripLeadingTrailingEmoji(stripTaskPrefix(displayTitle ?? (session.title || "(untitled chat)")));
  const glyph = sessionGlyph(session);
  const branch = session.git?.branch ?? null;
  const diff = session.diff ?? null;
  const hasDiff = !!diff && (diff.additions > 0 || diff.deletions > 0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [menu, setMenu] = useState<ContextMenuState>(null);
  const activate = () => (selectMode ? onToggleSelect(session.id) : onOpen());
  return (
    <li
      ref={setNodeRef}
      style={style}
      data-dragging={isDragging ? "true" : undefined}
      className="group/pc relative rounded-md data-[dragging=true]:z-10 data-[dragging=true]:bg-[var(--bg-raised)] data-[dragging=true]:opacity-90 data-[dragging=true]:shadow-[0_8px_24px_oklch(0_0_0/35%)] data-[dragging=true]:ring-1 data-[dragging=true]:ring-[var(--border-strong)]"
    >
      <div
        role={selectMode ? "checkbox" : "button"}
        aria-checked={selectMode ? selected : undefined}
        tabIndex={0}
        data-proj-nav
        onContextMenu={openContextMenuAt(setMenu)}
        onClick={activate}
        onKeyDown={(e) => {
          // ARIA button/checkbox pattern: Enter and Space both activate.
          // preventDefault on Space stops the page from scrolling when focused.
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            activate();
          }
        }}
        data-selected={selectMode && selected ? "true" : undefined}
        className={`focus-ring flex w-full items-center gap-2 px-4 text-left text-[12px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] data-[selected=true]:bg-[var(--accent-presence)]/10 data-[selected=true]:text-[var(--text-primary)] ${density === "compact" ? "py-0.5" : "py-1"}`}
      >
        {selectMode ? (
          <span
            aria-hidden
            className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded border ${
              selected
                ? "border-[var(--accent-presence)] bg-[var(--accent-presence)] text-[var(--text-primary)]"
                : "border-[var(--border-strong)] text-transparent"
            }`}
          >
            <Icon name="ph:check-bold" width={9} aria-hidden />
          </span>
        ) : (
          <button
            type="button"
            {...attributes}
            {...listeners}
            onClick={(e) => e.stopPropagation()}
            title="Drag to reorder or move to another project"
            aria-label={`Move ${title}`}
            className="grid h-4 w-3 shrink-0 cursor-grab touch-none place-items-center text-[var(--text-muted)] opacity-0 transition-opacity hover:text-[var(--text-secondary)] focus-visible:opacity-100 group-hover/pc:opacity-100 [@media(pointer:coarse)]:opacity-100"
          >
            <Icon name="ph:dots-six-vertical" width={10} aria-hidden />
          </button>
        )}
        <span
          className={`grid h-3.5 w-3.5 shrink-0 place-items-center ${glyphToneClass(glyph.tone)}`}
          title={glyph.label}
          aria-label={glyph.label}
          role="img"
        >
          {glyph.icon ? (
            <Icon name={glyph.icon} width={13} className={glyph.spin ? "animate-spin" : undefined} aria-hidden />
          ) : (
            <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${chatDotClass(session.status)}`} />
          )}
        </span>
        <span className="min-w-0 flex-1 truncate" title={title}>{title}</span>
        {selectMode ? null : (
          <span className="flex shrink-0 items-center gap-2 text-[10px] text-[var(--text-muted)]">
            {density === "comfortable" && session.model ? (
              <span
                className="hidden items-center gap-0.5 rounded-[4px] bg-[var(--bg-raised)]/70 px-1 py-px font-medium sm:inline-flex"
                title={`Model: ${session.model}`}
              >
                <Icon name={modelIcon(session.model)} width={10} aria-hidden />
                <span className="truncate">{modelLabel(session.model)}</span>
              </span>
            ) : null}
            {density === "comfortable" && branch ? (
              <span className="hidden max-w-[10rem] items-center gap-0.5 truncate font-mono sm:inline-flex" title={`Branch: ${branch}`}>
                <Icon name="ph:git-branch-bold" width={10} aria-hidden />
                <span className="truncate">{branch}</span>
              </span>
            ) : null}
            {density === "comfortable" && hasDiff ? (
              <span className="hidden items-center gap-1 font-mono sm:inline-flex" title={`+${diff!.additions} −${diff!.deletions}`}>
                <span className="text-[var(--color-success)]">+{diff!.additions}</span>
                <span className="text-[var(--color-danger)]">−{diff!.deletions}</span>
              </span>
            ) : null}
            <RelativeTime iso={session.updated_at} className="tabular-nums" />
          </span>
        )}
        {selectMode ? null : confirmDelete ? (
          <span className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setConfirmDelete(false);
              }}
              className="focus-ring rounded px-1.5 py-0.5 text-[10px] text-[var(--text-muted)] hover:bg-[var(--bg-hover)]"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={deleting}
              onClick={async (e) => {
                e.stopPropagation();
                setDeleting(true);
                await onDelete(session.id);
                setDeleting(false);
                setConfirmDelete(false);
              }}
              className="focus-ring rounded border border-[var(--color-danger)]/50 bg-[var(--color-danger)]/10 px-1.5 py-0.5 text-[10px] text-[var(--color-danger)] hover:bg-[var(--color-danger)]/15 disabled:opacity-50"
            >
              Delete
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setConfirmDelete(true);
            }}
            title="Delete chat"
            aria-label={`Delete ${title}`}
            className="focus-ring grid h-5 w-5 shrink-0 place-items-center rounded text-[var(--text-muted)] opacity-0 transition-opacity hover:bg-[var(--bg-hover)] hover:text-[var(--color-danger)] focus-visible:opacity-100 group-hover/pc:opacity-100 [@media(pointer:coarse)]:opacity-100"
          >
            <Icon name="ph:trash-bold" width={11} aria-hidden />
          </button>
        )}
      </div>
      <ContextMenu state={menu} onClose={() => setMenu(null)} ariaLabel={`Actions for ${title}`}>
        <PopoverItem icon="ph:chat-circle-dots-bold" onSelect={() => { setMenu(null); onOpen(); }}>
          Open chat
        </PopoverItem>
        <PopoverSeparator />
        <PopoverItem icon="ph:trash-bold" danger onSelect={() => { setMenu(null); setConfirmDelete(true); }}>
          Delete chat…
        </PopoverItem>
      </ContextMenu>
    </li>
  );
}

type ProjectsViewProps = {
  sessions?: SessionRow[];
  onNewChat?: (projectRoot: string) => void;
  onSessionsChanged?: () => void;
  /** When set, only projects this familiar has been granted are shown. */
  activeFamiliarId?: string | null;
};

function openSessionById(sessionId: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("cave:agents-open-session", { detail: { sessionId } }));
}

type ProjectRowProps = {
  project: CaveProject;
  chats: SessionRow[];
  onRename: (id: string, name: string) => Promise<boolean>;
  onUpdateRoot: (id: string, root: string) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
  onNewChat?: (projectRoot: string) => void;
  onOpenSession?: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => Promise<void>;
  onDeleteSessions: (sessionIds: string[]) => Promise<void>;
  density: ProjectsDensity;
  expanded: boolean;
  onSetExpanded: (next: boolean) => void;
};

function ProjectRow({
  project,
  chats,
  onRename,
  onUpdateRoot,
  onDelete,
  onNewChat,
  onOpenSession,
  onDeleteSession,
  onDeleteSessions,
  density,
  expanded,
  onSetExpanded,
}: ProjectRowProps) {
  const chatCount = chats.length;
  const stats = projectStats(chats);
  // Expanded/collapsed state is lifted to the container and persisted, so a
  // project the user opened stays open across reloads (native-app memory)
  // instead of resetting to a flat collapsed list every visit.
  const setExpanded = (next: boolean | ((value: boolean) => boolean)) =>
    onSetExpanded(typeof next === "function" ? next(expanded) : next);
  const cardKey = normalizeProjectRoot(project.root);

  // The command palette's "Open project" rows expand + scroll a project into
  // view via this event (the Projects tab is opened first, then focused).
  useEffect(() => {
    const onFocus = (e: Event) => {
      const detail = (e as CustomEvent<{ root?: string }>).detail;
      if (!detail?.root || normalizeProjectRoot(detail.root) !== cardKey) return;
      setExpanded(true);
      window.requestAnimationFrame(() => {
        document
          .getElementById(`pcard-el:${cardKey}`)
          ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      });
    };
    window.addEventListener(CHAT_FOCUS_PROJECT_EVENT, onFocus);
    return () => window.removeEventListener(CHAT_FOCUS_PROJECT_EVENT, onFocus);
  }, [cardKey]);
  const lastActiveIso =
    chats.reduce((acc, s) => (!acc || s.updated_at > acc ? s.updated_at : acc), "") || project.updatedAt;
  const lastActiveLabel = relativeTime(lastActiveIso);
  // Glanceable status: running (any) > failed (most recent) > recently active
  // (≤24h) > dormant (no dot). Derivation is pure + unit-tested.
  const projectStatus = deriveProjectStatus(chats);
  const statusLabel =
    projectStatus === "running"
      ? ", a session is running"
      : projectStatus === "failed"
        ? ", last session failed"
        : projectStatus === "recent"
          ? ", active recently"
          : "";
  const [showAllChats, setShowAllChats] = useState(false);
  const visibleChats = showAllChats ? chats : chats.slice(0, CHAT_CAP);
  const chatTitles = useMemo(() => disambiguateSessionTitles(chats), [chats]);

  // Bulk-select: pick several chats and delete them in one pass. Selection is
  // scoped to this project card and resets when the set of chats changes (e.g.
  // after a delete) so stale ids never linger.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const chatIdKey = chats.map((c) => c.id).join(",");
  useEffect(() => {
    setSelectMode(false);
    setSelectedIds(new Set());
  }, [chatIdKey]);
  const toggleSelect = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  // Visible-aware select-all: acts on the chats currently shown (respects the
  // Show all / Show less cap) and flips to "Clear" once they're all picked.
  const allVisibleSelected =
    visibleChats.length > 0 && visibleChats.every((s) => selectedIds.has(s.id));
  const toggleSelectAllVisible = () =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) for (const s of visibleChats) next.delete(s.id);
      else for (const s of visibleChats) next.add(s.id);
      return next;
    });
  const exitSelect = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };
  const deleteSelected = async () => {
    const ids = chats.map((s) => s.id).filter((id) => selectedIds.has(id));
    if (ids.length === 0) return;
    setBulkDeleting(true);
    await onDeleteSessions(ids);
    setBulkDeleting(false);
    exitSelect();
  };

  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `pcard:${normalizeProjectRoot(project.root)}`,
  });
  const [editingName, setEditingName] = useState(false);
  const [editingRoot, setEditingRoot] = useState(false);
  const [nameDraft, setNameDraft] = useState(project.name);
  const [rootDraft, setRootDraft] = useState(project.root);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState<"name" | "root" | "delete" | null>(null);
  const [copiedRoot, setCopiedRoot] = useState(false);
  const [menu, setMenu] = useState<ContextMenuState>(null);

  const openTerminalHere = () => {
    window.dispatchEvent(new CustomEvent("cave:terminal-open", { detail: { projectRoot: project.root } }));
    window.dispatchEvent(new CustomEvent("cave:navigate-mode", { detail: { mode: "terminal" } }));
  };

  const copyRoot = async () => {
    try {
      await navigator.clipboard.writeText(project.root);
      setCopiedRoot(true);
      window.setTimeout(() => setCopiedRoot(false), 1600);
    } catch {
      // Clipboard blocked (insecure context / permissions) — no-op.
    }
  };

  const commitName = async () => {
    const next = nameDraft.trim();
    if (!next) {
      setNameDraft(project.name);
      setEditingName(false);
      return;
    }
    if (next !== project.name) {
      setBusy("name");
      await onRename(project.id, next);
      setBusy(null);
    }
    setEditingName(false);
  };

  const commitRoot = async () => {
    const next = rootDraft.trim();
    if (!next) {
      setRootDraft(project.root);
      setEditingRoot(false);
      return;
    }
    if (normalizeProjectRoot(next) !== normalizeProjectRoot(project.root)) {
      setBusy("root");
      await onUpdateRoot(project.id, next);
      setBusy(null);
    }
    setEditingRoot(false);
  };

  const deleteProject = async () => {
    setBusy("delete");
    await onDelete(project.id);
    setBusy(null);
  };

  return (
    <article
      ref={setDropRef}
      id={`pcard-el:${cardKey}`}
      data-drop-over={isOver ? "true" : undefined}
      className={[
        "group border-b border-[var(--border-hairline)] px-2 transition-colors",
        density === "compact" ? "py-1.5" : "py-3",
        isOver
          ? "rounded-md bg-[color-mix(in_oklch,var(--accent-presence)_12%,transparent)] ring-1 ring-inset ring-[var(--accent-presence)]/50"
          : "hover:bg-[var(--bg-raised)]/40",
      ].join(" ")}
    >
      <div className="flex min-w-0 items-center gap-2" onContextMenu={openContextMenuAt(setMenu)}>
        <button
          type="button"
          data-proj-nav
          onClick={() => setExpanded((value) => !value)}
          onKeyDown={(e) => {
            // Tree-style disclosure: → expands, ← collapses (no-op when already
            // in that state). Vertical roving (↑/↓) is handled by the container.
            if (e.key === "ArrowRight" && !expanded) {
              e.preventDefault();
              setExpanded(true);
            } else if (e.key === "ArrowLeft" && expanded) {
              e.preventDefault();
              setExpanded(false);
            }
          }}
          aria-expanded={expanded}
          aria-label={`${expanded ? "Collapse" : "Expand"} ${project.name}${statusLabel}`}
          className="focus-ring -ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]"
        >
          <Icon name={expanded ? "ph:caret-down" : "ph:caret-right"} width={12} aria-hidden />
        </button>
        <span
          className="relative shrink-0"
          style={{ color: project.color || "var(--accent-presence)" }}
        >
          <Icon
            name="ph:folder-open-bold"
            width={15}
            aria-hidden
          />
          {projectStatus ? (
            <span
              className={`absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full ring-2 ring-[var(--bg-base)] ${chatDotClass(
                projectStatus,
              )}${projectStatus === "running" ? " animate-pulse" : ""}`}
              title={
                projectStatus === "running"
                  ? "A session is running"
                  : projectStatus === "failed"
                    ? "Last session failed"
                    : "Active recently"
              }
              aria-hidden
            />
          ) : null}
        </span>
        {editingName ? (
          <input
            autoFocus
            value={nameDraft}
            onChange={(event) => setNameDraft(event.target.value)}
            onBlur={() => void commitName()}
            onKeyDown={(event) => {
              if (event.key === "Enter") void commitName();
              if (event.key === "Escape") {
                setNameDraft(project.name);
                setEditingName(false);
              }
            }}
            disabled={busy === "name"}
            className="focus-ring min-w-0 flex-1 rounded-md border border-[var(--border-strong)] bg-[var(--bg-base)] px-2 py-1 text-[13px] font-semibold text-[var(--text-primary)]"
          />
        ) : (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            className="focus-ring min-w-0 flex-1 truncate rounded-md px-1 py-0.5 text-left text-[13px] font-semibold text-[var(--text-primary)] hover:text-[var(--accent-presence)]"
            title={expanded ? `Collapse ${project.name}` : `Expand ${project.name}`}
          >
            {project.name}
          </button>
        )}

        <span className="flex shrink-0 items-center gap-1.5 text-[10px] text-[var(--text-muted)]">
          {stats.running > 0 ? (
            <span
              className="inline-flex items-center gap-1 font-medium text-[var(--accent-presence)]"
              title={`${stats.running} running`}
            >
              <Icon name="ph:circle-notch-bold" width={9} className="animate-spin" aria-hidden />
              {stats.running}
            </span>
          ) : null}
          {stats.tasks > 0 ? (
            <span
              className="inline-flex items-center gap-1"
              title={`${stats.tasks} ${stats.tasks === 1 ? "task" : "tasks"}`}
            >
              <Icon name="ph:check-square" width={10} aria-hidden />
              {stats.tasks}
            </span>
          ) : null}
          <span className="rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] px-2 py-0.5">
            {chatCount} {chatCount === 1 ? "session" : "sessions"}
          </span>
        </span>

        {lastActiveLabel ? (
          <span className="hidden shrink-0 text-[10px] text-[var(--text-muted)] sm:inline" title={`Last active ${lastActiveLabel}`}>
            {lastActiveLabel}
          </span>
        ) : null}

        <div
          className={`flex shrink-0 items-center gap-1 transition-opacity motion-reduce:transition-none ${
            confirmDelete
              ? "opacity-100"
              : "opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
          }`}
        >
          <button
            type="button"
            onClick={() => onNewChat?.(project.root)}
            className="focus-ring flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            title="New session"
            aria-label={`New session in ${project.name}`}
          >
            <Icon name="ph:chat-circle-dots-bold" width={14} aria-hidden />
          </button>
          <button
            type="button"
            // Launch a terminal in this project's cwd, then jump to the Terminal
            // surface (the always-mounted terminal instance spawns the shell in
            // project.root; cave:navigate-mode brings the surface to the foreground).
            onClick={openTerminalHere}
            className="focus-ring flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            title="Open terminal"
            aria-label={`Open terminal in ${project.name}`}
          >
            <Icon name="ph:terminal-window-bold" width={14} aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => { setNameDraft(project.name); setEditingName(true); }}
            aria-label={`Rename ${project.name}`}
            title="Rename"
            className="focus-ring flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          >
            <Icon name="ph:pencil-simple-bold" width={14} aria-hidden />
          </button>
          {confirmDelete ? (
            <>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="focus-ring h-7 rounded-md px-2 text-[11px] text-[var(--text-muted)] hover:bg-[var(--bg-hover)]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void deleteProject()}
                disabled={busy === "delete"}
                className="focus-ring h-7 rounded-md border border-[var(--color-danger)]/50 bg-[var(--color-danger)]/10 px-2 text-[11px] text-[var(--color-danger)] hover:bg-[var(--color-danger)]/15 disabled:opacity-50"
              >
                Delete
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="focus-ring flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--color-danger)]"
              title="Delete project"
              aria-label={`Delete ${project.name}`}
            >
              <Icon name="ph:trash-bold" width={14} aria-hidden />
            </button>
          )}
        </div>
      </div>

      {expanded ? (
        <div className="projects-expand-enter">
      <div className="mt-2 flex min-w-0 items-center gap-2 pl-6">
        <Icon
          name="ph:folder-simple-dashed"
          width={13}
          className="shrink-0 text-[var(--text-muted)]"
          aria-hidden
        />
        {editingRoot ? (
          <input
            autoFocus
            value={rootDraft}
            onChange={(event) => setRootDraft(event.target.value)}
            onBlur={() => void commitRoot()}
            onKeyDown={(event) => {
              if (event.key === "Enter") void commitRoot();
              if (event.key === "Escape") {
                setRootDraft(project.root);
                setEditingRoot(false);
              }
            }}
            disabled={busy === "root"}
            className="focus-ring min-w-0 flex-1 rounded-md border border-[var(--border-strong)] bg-[var(--bg-base)] px-2 py-1 font-mono text-[11px] text-[var(--text-secondary)]"
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              setRootDraft(project.root);
              setEditingRoot(true);
            }}
            className="focus-ring min-w-0 flex-1 truncate rounded-md px-1 py-0.5 text-left font-mono text-[11px] text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
            title={project.root}
          >
            {shortRoot(project.root)}
          </button>
        )}
        {!editingRoot && (
          <button
            type="button"
            onClick={copyRoot}
            className="focus-ring shrink-0 rounded-md p-1 text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
            title={copiedRoot ? "Copied" : "Copy path"}
            aria-label={`Copy path ${project.root}`}
          >
            <Icon name={copiedRoot ? "ph:check" : "ph:copy"} width={12} aria-hidden />
          </button>
        )}
      </div>

      {chats.length > 0 ? (
        <>
          <div className="-mx-2 mt-2 flex items-center justify-between gap-2 border-t border-[var(--border-hairline)] px-4 pt-2">
            {selectMode ? (
              <>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={toggleSelectAllVisible}
                    className="focus-ring rounded px-1.5 py-0.5 text-[11px] font-medium text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]"
                  >
                    {allVisibleSelected ? "Clear" : "Select all"}
                  </button>
                  <span className="text-[11px] text-[var(--text-muted)]">
                    {selectedIds.size} selected
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={exitSelect}
                    className="focus-ring rounded px-1.5 py-0.5 text-[11px] text-[var(--text-muted)] hover:bg-[var(--bg-hover)]"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={bulkDeleting || selectedIds.size === 0}
                    onClick={() => void deleteSelected()}
                    className="focus-ring inline-flex items-center gap-1 rounded border border-[var(--color-danger)]/50 bg-[var(--color-danger)]/10 px-1.5 py-0.5 text-[11px] text-[var(--color-danger)] hover:bg-[var(--color-danger)]/15 disabled:opacity-50"
                  >
                    <Icon name="ph:trash-bold" width={11} aria-hidden />
                    {bulkDeleting ? "Deleting…" : `Delete${selectedIds.size ? ` ${selectedIds.size}` : ""}`}
                  </button>
                </div>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setSelectMode(true)}
                className="focus-ring ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]"
              >
                <Icon name="ph:list-checks-bold" width={12} aria-hidden />
                Select
              </button>
            )}
          </div>
          <SortableContext items={visibleChats.map((s) => s.id)} strategy={verticalListSortingStrategy}>
            <ul className="-mx-2 mt-1 flex flex-col gap-0.5">
              {visibleChats.map((session) => (
                <ProjectChatRow
                  key={session.id}
                  session={session}
                  displayTitle={chatTitles.get(session.id)}
                  onOpen={() => onOpenSession?.(session.id)}
                  onDelete={onDeleteSession}
                  selectMode={selectMode}
                  selected={selectedIds.has(session.id)}
                  onToggleSelect={toggleSelect}
                  density={density}
                />
              ))}
            </ul>
          </SortableContext>
          {chats.length > CHAT_CAP ? (
            <button
              type="button"
              onClick={() => setShowAllChats((value) => !value)}
              aria-expanded={showAllChats}
              className="focus-ring mt-1 rounded-md px-2 py-1 text-[11px] font-medium text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]"
            >
              {showAllChats ? "Show less" : `Show all ${chats.length} sessions`}
            </button>
          ) : null}
        </>
      ) : (
        <p className="mt-2 border-t border-[var(--border-hairline)] pt-2 text-[11px] text-[var(--text-muted)]">
          No sessions yet — drag one here or start a new session.
        </p>
      )}
        </div>
      ) : null}
      <ContextMenu state={menu} onClose={() => setMenu(null)} ariaLabel={`Actions for ${project.name}`}>
        <PopoverItem icon="ph:chat-circle-dots-bold" onSelect={() => { setMenu(null); onNewChat?.(project.root); }}>
          New session
        </PopoverItem>
        <PopoverItem icon="ph:terminal-window-bold" onSelect={() => { setMenu(null); openTerminalHere(); }}>
          Open terminal
        </PopoverItem>
        <PopoverItem icon="ph:pencil-simple-bold" onSelect={() => { setMenu(null); setNameDraft(project.name); setEditingName(true); }}>
          Rename
        </PopoverItem>
        <PopoverItem icon={copiedRoot ? "ph:check" : "ph:copy"} onSelect={() => { setMenu(null); void copyRoot(); }}>
          Copy path
        </PopoverItem>
        <PopoverSeparator />
        <PopoverItem icon="ph:trash-bold" danger onSelect={() => { setMenu(null); setExpanded(true); setConfirmDelete(true); }}>
          Delete project…
        </PopoverItem>
      </ContextMenu>
    </article>
  );
}

export function ProjectsView({ sessions = [], onNewChat, onSessionsChanged, activeFamiliarId = null }: ProjectsViewProps) {
  useDateTimePrefs(); // subscribe: re-render when the date/time density pref changes
  useMinuteTick(); // keep the per-project "last active" relative times current
  const {
    projects,
    loading,
    error,
    createProject,
    renameProject,
    updateRoot,
    deleteProject,
    reload,
  } = useProjects({ familiarId: activeFamiliarId });
  const [showForm, setShowForm] = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [rootDraft, setRootDraft] = useState("");
  const [creating, setCreating] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [moveToast, setMoveToast] = useState<{ sessionId: string; prevRoot: string | null; label: string } | null>(null);
  const projectOverrides = useProjectOverrides();
  const { density, setDensity, isExpanded, setExpanded } = useProjectsUiState();
  // Roving keyboard navigation (WAI-ARIA) over the flattened list of project
  // headers + their visible session rows: ↑/↓ + Home/End move focus, Enter/Space
  // open/select (per-row handlers), and →/← expand/collapse a focused header.
  const listRef = useRef<HTMLElement>(null);
  useRovingTabIndex({ containerRef: listRef, itemSelector: "[data-proj-nav]", orientation: "vertical" });
  const [order, setOrder] = useState<string[]>([]);
  useEffect(() => {
    setOrder(readSessionOrder());
  }, []);

  // "/" jumps to the projects filter (GitHub-style) while this surface is shown,
  // unless the user is already typing in a field or holding a modifier.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      const el = searchRef.current;
      if (!el) return;
      e.preventDefault();
      el.focus();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Group sessions under their (override-aware) project root, applying the
  // shared manual order, so each project card lists its chats in drag order.
  const chatsByRoot = useMemo(() => {
    const overridden = applyProjectOverrides(sessions, projectOverrides);
    const byRoot = new Map<string, SessionRow[]>();
    for (const session of overridden) {
      const root = normalizeProjectRoot(session.project_root);
      const list = byRoot.get(root) ?? [];
      list.push(session);
      byRoot.set(root, list);
    }
    for (const [root, list] of byRoot) byRoot.set(root, applyManualOrder(list, order));
    return byRoot;
  }, [sessions, projectOverrides, order]);

  const rootBySession = useMemo(() => {
    const map = new Map<string, string>();
    for (const [root, list] of chatsByRoot) for (const s of list) map.set(s.id, root);
    return map;
  }, [chatsByRoot]);

  // Surface the projects you're actually working in: order by most-recent
  // session activity, falling back to the project's own updatedAt.
  const sortedProjects = useMemo(() => {
    // Decorate-sort-undecorate: compute each score ONCE (each call runs
    // lastActiveMs over the root's chats) instead of ~2x per comparison.
    const scored = projects.map((p) => ({
      p,
      score:
        lastActiveMs(chatsByRoot.get(normalizeProjectRoot(p.root)) ?? []) ||
        new Date(p.updatedAt).getTime() ||
        0,
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.map((s) => s.p);
  }, [projects, chatsByRoot]);

  // Filter by name or path so the (recency-sorted) list stays scannable when
  // there are many projects.
  const visibleProjects = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sortedProjects;
    return sortedProjects.filter(
      (p) => p.name.toLowerCase().includes(q) || p.root.toLowerCase().includes(q),
    );
  }, [sortedProjects, query]);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    if (activeId === overId) return;
    const sourceRoot = rootBySession.get(activeId);
    if (sourceRoot === undefined) return;
    const targetRoot = overId.startsWith("pcard:")
      ? overId.slice("pcard:".length)
      : rootBySession.get(overId);
    if (targetRoot === undefined) return;

    if (sourceRoot === targetRoot) {
      if (overId.startsWith("pcard:")) return;
      const ids = (chatsByRoot.get(targetRoot) ?? []).map((s) => s.id);
      const from = ids.indexOf(activeId);
      const to = ids.indexOf(overId);
      if (from < 0 || to < 0) return;
      const nextVisible = arrayMove(ids, from, to);
      setOrder((prev) => {
        const merged = mergeVisibleOrder(prev, nextVisible);
        const live = new Set(sessions.map((s) => s.id));
        const pruned = merged.filter((id) => live.has(id));
        writeSessionOrder(pruned);
        return pruned;
      });
      return;
    }
    // Different project → move (cave-local override; agent cwd untouched).
    // Capture the prior override first so the move can be undone precisely
    // (restore the old override, or clear it if there wasn't one).
    const prevRoot = projectOverrides[activeId] ?? null;
    const moved = sessions.find((s) => s.id === activeId);
    const destName =
      projects.find((p) => normalizeProjectRoot(p.root) === targetRoot)?.name ?? shortRoot(targetRoot);
    const movedTitle = moved ? stripLeadingTrailingEmoji(stripTaskPrefix(moved.title)) || "chat" : "chat";
    setProjectOverride(activeId, targetRoot);
    setMoveToast({ sessionId: activeId, prevRoot, label: `Moved “${movedTitle}” to ${destName}` });
  }

  const undoMove = () => {
    if (!moveToast) return;
    if (moveToast.prevRoot) setProjectOverride(moveToast.sessionId, moveToast.prevRoot);
    else clearProjectOverride(moveToast.sessionId);
    setMoveToast(null);
  };

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = nameDraft.trim();
    const root = rootDraft.trim();
    if (!name || !root) return;
    setCreating(true);
    const project = await createProject(name, root);
    setCreating(false);
    if (!project) return;
    setNameDraft("");
    setRootDraft("");
    setShowForm(false);
  };

  // Delete one chat, mirroring the Chats list delete (DELETE
  // /api/chat/conversation/:id). Returns whether it succeeded; callers refetch.
  const deleteOneSession = async (sessionId: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/chat/conversation/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({ ok: false }));
      if (!res.ok || !json.ok) {
        setSessionError(json.error ?? "delete failed");
        return false;
      }
      return true;
    } catch (err) {
      setSessionError(err instanceof Error ? err.message : "delete failed");
      return false;
    }
  };

  // Delete a single chat from its project card, then ask the parent to refetch
  // sessions so the row disappears everywhere.
  const handleDeleteSession = async (sessionId: string) => {
    setSessionError(null);
    if (await deleteOneSession(sessionId)) onSessionsChanged?.();
  };

  // Bulk-delete the chats selected in a project card. Runs the deletes in
  // parallel, then refetches once if anything succeeded so the surviving rows
  // (if a delete failed) stay accurate.
  const handleDeleteSessions = async (sessionIds: string[]) => {
    setSessionError(null);
    if (sessionIds.length === 0) return;
    const results = await Promise.all(sessionIds.map((id) => deleteOneSession(id)));
    if (results.some(Boolean)) onSessionsChanged?.();
  };

  return (
    <div className="flex h-full min-w-0 flex-col bg-[var(--bg-base)]">
      <header className="shrink-0 border-b border-[var(--border-hairline)] px-4 py-2.5 sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[12px] text-[var(--text-muted)]">
            {query.trim() && visibleProjects.length !== projects.length
              ? `${visibleProjects.length} of ${projects.length} projects`
              : `${projects.length} ${projects.length === 1 ? "project" : "projects"}`}
          </span>
          <div className="flex items-center gap-2">
            <div
              role="group"
              aria-label="List density"
              className="flex items-center rounded-md border border-[var(--border-hairline)] p-0.5"
            >
              {([
                { value: "comfortable", icon: "ph:rows", label: "Comfortable density" },
                { value: "compact", icon: "ph:list-bullets-bold", label: "Compact density" },
              ] as const).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setDensity(opt.value)}
                  aria-pressed={density === opt.value}
                  aria-label={opt.label}
                  title={opt.label}
                  className={`focus-ring flex h-7 w-7 items-center justify-center rounded ${
                    density === opt.value
                      ? "bg-[var(--bg-hover)] text-[var(--text-primary)]"
                      : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                  }`}
                >
                  <Icon name={opt.icon} width={14} aria-hidden />
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => void reload()}
              disabled={loading}
              aria-label="Refresh projects"
              className="focus-ring flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-hairline)] px-2.5 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] disabled:opacity-50"
            >
              <Icon name="ph:arrows-clockwise-bold" width={12} className={loading ? "animate-spin" : undefined} aria-hidden />
              Refresh
            </button>
            <button
              type="button"
              onClick={() => setShowForm((value) => !value)}
              className="focus-ring flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-hairline)] bg-[var(--accent-presence)]/10 px-2.5 text-[12px] text-[var(--accent-presence)] hover:bg-[var(--accent-presence)]/15"
            >
              <Icon name="ph:plus-bold" width={12} aria-hidden />
              New project
            </button>
          </div>
        </div>
        {projects.length > 1 ? (
          <div className="relative mt-2">
            <Icon
              name="ph:magnifying-glass"
              width={13}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
              aria-hidden
            />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape" && query) {
                  event.preventDefault();
                  setQuery("");
                }
              }}
              placeholder="Filter projects by name or path…"
              aria-label="Filter projects"
              className="focus-ring h-8 w-full rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] pl-8 pr-7 text-[12px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
            />
            {!query && (
              <kbd
                aria-hidden
                className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-1 font-mono text-[10px] leading-tight text-[var(--text-muted)]"
              >
                /
              </kbd>
            )}
          </div>
        ) : null}
      </header>

      {showForm ? (
        <form
          onSubmit={handleCreate}
          onKeyDown={(event) => {
            if (event.key === "Escape") setShowForm(false);
          }}
          className="shrink-0 border-b border-[var(--border-hairline)] bg-[var(--bg-sunken)] px-4 py-3 sm:px-6"
        >
          <div className="grid gap-2 lg:grid-cols-[minmax(160px,0.7fr)_minmax(260px,1.3fr)_auto]">
            <input
              autoFocus
              value={nameDraft}
              onChange={(event) => setNameDraft(event.target.value)}
              placeholder="Project name"
              className="focus-ring h-9 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] px-3 text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
            />
            <input
              value={rootDraft}
              onChange={(event) => setRootDraft(event.target.value)}
              placeholder="/absolute/path/to/project"
              className="focus-ring h-9 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] px-3 font-mono text-[12px] text-[var(--text-secondary)] placeholder:text-[var(--text-muted)]"
            />
            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={creating || !nameDraft.trim() || !rootDraft.trim()}
                className="focus-ring h-9 rounded-md bg-[var(--accent-presence)] px-3 text-[12px] font-medium text-[var(--text-primary)] disabled:opacity-50"
              >
                {creating ? "Creating" : "Create"}
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="focus-ring h-9 rounded-md border border-[var(--border-hairline)] px-3 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              >
                Cancel
              </button>
            </div>
          </div>
        </form>
      ) : null}

      <main ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
        {error && projects.length === 0 ? (
          <ErrorState
            icon="ph:warning"
            headline="Couldn't load projects"
            subtitle={error}
            actions={
              <button
                type="button"
                onClick={() => void reload()}
                className="focus-ring rounded-md border border-[var(--border-hairline)] px-3 py-1.5 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              >
                Retry
              </button>
            }
          />
        ) : loading && projects.length === 0 ? (
          <div className="flex w-full flex-col gap-2">
            <SkeletonRows count={4} />
          </div>
        ) : projects.length === 0 ? (
          <EmptyState
            icon="ph:folder-open"
            headline="No projects yet"
            subtitle="Add a project folder to group chats by codebase."
            actions={
              <>
                <button
                  type="button"
                  onClick={() => setShowForm(true)}
                  className="focus-ring rounded-md border border-[var(--border-hairline)] px-3 py-1.5 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                >
                  New project
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (typeof window !== "undefined") {
                      window.dispatchEvent(new CustomEvent("cave:salem-open"));
                    }
                  }}
                  className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-[var(--border-hairline)] px-3 py-1.5 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                >
                  <Icon name="ph:sparkle" width={13} aria-hidden />
                  Ask Salem
                </button>
              </>
            }
          />
        ) : (
          <div className="flex w-full flex-col">
            {error ? (
              <div
                role="alert"
                className="flex items-center justify-between gap-3 rounded-md border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-3 py-2 text-[12px] text-[var(--color-danger)]"
              >
                <span className="min-w-0 truncate">Couldn't refresh: {error}</span>
                <button
                  type="button"
                  onClick={() => void reload()}
                  className="focus-ring shrink-0 rounded-md border border-[var(--color-danger)]/40 px-2 py-0.5 text-[11px] hover:bg-[var(--color-danger)]/15"
                >
                  Retry
                </button>
              </div>
            ) : null}
            {sessionError ? (
              <div
                role="alert"
                className="flex items-center justify-between gap-3 rounded-md border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-3 py-2 text-[12px] text-[var(--color-danger)]"
              >
                <span className="min-w-0 truncate">Couldn't delete chat: {sessionError}</span>
                <button
                  type="button"
                  onClick={() => setSessionError(null)}
                  className="focus-ring shrink-0 rounded-md border border-[var(--color-danger)]/40 px-2 py-0.5 text-[11px] hover:bg-[var(--color-danger)]/15"
                >
                  Dismiss
                </button>
              </div>
            ) : null}
            {visibleProjects.length === 0 ? (
              <p className="px-2 py-6 text-center text-[12px] text-[var(--text-muted)]">
                No projects match “{query.trim()}”.
              </p>
            ) : (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                {visibleProjects.map((project) => (
                  <ProjectRow
                    key={project.id}
                    project={project}
                    chats={chatsByRoot.get(normalizeProjectRoot(project.root)) ?? []}
                    onRename={renameProject}
                    onUpdateRoot={updateRoot}
                    onDelete={deleteProject}
                    onNewChat={onNewChat}
                    onOpenSession={openSessionById}
                    onDeleteSession={handleDeleteSession}
                    onDeleteSessions={handleDeleteSessions}
                    density={density}
                    expanded={isExpanded(project.id)}
                    onSetExpanded={(next) => setExpanded(project.id, next)}
                  />
                ))}
              </DndContext>
            )}
          </div>
        )}
      </main>
      {moveToast ? (
        <MoveUndoToast
          key={moveToast.sessionId}
          label={moveToast.label}
          onUndo={undoMove}
          onDismiss={() => setMoveToast(null)}
        />
      ) : null}
    </div>
  );
}
