"use client";

import { useEffect, useMemo, useState } from "react";

import { Icon } from "@/lib/icon";
import { relativeTime } from "@/lib/relative-time";
import type { CaveProject } from "@/lib/cave-projects-types";
import { normalizeProjectRoot } from "@/lib/cave-projects-types";
import { CHAT_FOCUS_PROJECT_EVENT } from "@/lib/chat-tab-events";
import type { SessionRow } from "@/lib/types";
import { stripLeadingTrailingEmoji, disambiguateSessionTitles } from "@/lib/cave-chat-titles";
import { deriveProjectStatus } from "@/lib/project-status";
import { projectStats } from "@/lib/projects/project-stats";
import type { ProjectsDensity } from "@/lib/projects/projects-ui-state";
import { ContextMenu, openContextMenuAt, type ContextMenuState } from "@/components/ui/context-menu";
import { PopoverItem, PopoverSeparator } from "@/components/ui/popover";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";

import { ProjectChatRow } from "./session-row";
import { CHAT_CAP, chatDotClass, shortRoot, type MoveTarget } from "./projects-shared";

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
  allProjects: CaveProject[];
  onMoveSession: (sessionId: string, targetRoot: string) => void;
};

export function ProjectRow({
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
  allProjects,
  onMoveSession,
}: ProjectRowProps) {
  const chatCount = chats.length;
  const stats = projectStats(chats);
  // Expanded/collapsed state is lifted to the container and persisted, so a
  // project the user opened stays open across reloads (native-app memory)
  // instead of resetting to a flat collapsed list every visit.
  const setExpanded = (next: boolean | ((value: boolean) => boolean)) =>
    onSetExpanded(typeof next === "function" ? next(expanded) : next);
  const cardKey = normalizeProjectRoot(project.root);
  // Other projects this card's chats can be moved into (normalized roots).
  const moveTargets = useMemo<MoveTarget[]>(
    () =>
      allProjects
        .filter((p) => normalizeProjectRoot(p.root) !== cardKey)
        .map((p) => ({ id: p.id, name: p.name, root: normalizeProjectRoot(p.root) })),
    [allProjects, cardKey],
  );

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
          data-proj-label={project.name}
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
                  moveTargets={moveTargets}
                  onMoveSession={onMoveSession}
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
