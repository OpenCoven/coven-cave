"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { Icon } from "@/lib/icon";
import { ProjectAvatar } from "@/components/project-avatar";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import {
  clearProjectImage,
  moveProjectImage,
  setProjectImage,
  useProjectImages,
} from "@/lib/cave-project-images";
import { FAMILIAR_IMAGE_ACCEPT, prepareFamiliarImage } from "@/lib/familiar-image-upload";
import { smoothScrollBehavior } from "@/lib/use-prefers-reduced-motion";
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

import { projectTint } from "@/lib/comux-projects";

import { ProjectChatRow } from "./session-row";
import { CHAT_CAP, chatDotClass, shortRoot, type MoveTarget } from "./projects-shared";

/** Preset tile tints — the same oklch recipe projectTint() hashes into, at
 *  fixed hues, so a hand-picked color sits naturally next to auto-tinted
 *  tiles. Stored verbatim in CaveProject.color. */
const PROJECT_COLOR_SWATCHES: { name: string; value: string }[] = [
  { name: "Clay", value: "oklch(0.74 0.12 25)" },
  { name: "Amber", value: "oklch(0.74 0.12 70)" },
  { name: "Fern", value: "oklch(0.74 0.12 145)" },
  { name: "Teal", value: "oklch(0.74 0.12 200)" },
  { name: "Sky", value: "oklch(0.74 0.12 250)" },
  { name: "Violet", value: "oklch(0.74 0.12 300)" },
  { name: "Rose", value: "oklch(0.74 0.12 340)" },
];

type ProjectRowProps = {
  project: CaveProject;
  chats: SessionRow[];
  onRename: (id: string, name: string) => Promise<boolean>;
  onUpdateRoot: (id: string, root: string) => Promise<boolean>;
  /** Set an explicit tile tint, or null to restore the auto root-hash tint. */
  onUpdateColor: (id: string, color: string | null) => Promise<boolean>;
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
  onUpdateColor,
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
          ?.scrollIntoView({ block: "nearest", behavior: smoothScrollBehavior() });
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
  const statusText =
    projectStatus === "running"
      ? "Running"
      : projectStatus === "failed"
        ? "Failed"
        : projectStatus === "recent"
          ? "Recent"
          : "Idle";
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
  const [busy, setBusy] = useState<"name" | "root" | "color" | "delete" | null>(null);
  const [copiedRoot, setCopiedRoot] = useState(false);
  const [menu, setMenu] = useState<ContextMenuState>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const [imageStatus, setImageStatus] = useState<string | null>(null);
  const projectImages = useProjectImages();
  const hasImage = Boolean(projectImages[cardKey]);
  const pickImage = () => {
    setImageStatus(null);
    imageInputRef.current?.click();
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
      const ok = await onUpdateRoot(project.id, next);
      // The avatar is keyed by root — re-key it so it follows the project.
      if (ok) void moveProjectImage(project.root, next);
      setBusy(null);
    }
    setEditingRoot(false);
  };

  const deleteProject = async () => {
    setBusy("delete");
    const ok = await onDelete(project.id);
    if (ok) void clearProjectImage(project.root);
    setBusy(null);
  };

  const setColor = async (color: string | null) => {
    setBusy("color");
    await onUpdateColor(project.id, color);
    setBusy(null);
  };

  return (
    <>
      <tr
        ref={setDropRef}
        id={`pcard-el:${cardKey}`}
        data-drop-over={isOver ? "true" : undefined}
        className={[
          "group projects-table-row",
          density === "compact" ? "projects-table-row--compact" : "projects-table-row--comfortable",
          isOver ? "selected ring-1 ring-inset ring-[var(--accent-presence)]/50" : "",
        ].join(" ")}
        onContextMenu={openContextMenuAt(setMenu)}
      >
        <td>
          <div className="flex min-w-0 items-center gap-2">
        <IconButton
          icon={expanded ? "ph:caret-down" : "ph:caret-right"}
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
          className="-ml-1 h-6 w-6 text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
        />
        <Button
          variant="ghost"
          size="xs"
          onClick={pickImage}
          className="relative h-auto w-auto shrink-0 rounded-[var(--radius-control)] p-0"
          title={imageStatus ?? (hasImage ? "Change project image" : "Set project image")}
          aria-label={`${hasImage ? "Change" : "Set"} image for ${project.name}`}
        >
          <ProjectAvatar name={project.name} root={project.root} color={project.color} size="md" />
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
        </Button>
        <input
          ref={imageInputRef}
          type="file"
          accept={FAMILIAR_IMAGE_ACCEPT}
          className="sr-only"
          tabIndex={-1}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (!file) return;
            setImageStatus(null);
            void prepareFamiliarImage(file)
              .then(async (prepared) => {
                const res = await setProjectImage(project.root, prepared);
                setImageStatus(
                  res.ok ? (prepared.downsized ? "Image was downsized for Cave." : null) : res.reason,
                );
              })
              .catch((err) => {
                setImageStatus(err instanceof Error ? err.message : "Could not read image.");
              });
          }}
        />
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
            className="focus-ring min-w-0 flex-1 rounded-[var(--radius-control)] border border-[var(--border-strong)] bg-[var(--bg-base)] px-2 py-1 text-[13px] font-semibold text-[var(--text-primary)]"
          />
        ) : (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            className="min-w-0 flex-1 justify-start truncate rounded-[var(--radius-control)] px-1 py-0.5 text-left text-[13px] font-semibold text-[var(--text-primary)] hover:text-[var(--accent-presence)]"
            title={expanded ? `Collapse ${project.name}` : `Expand ${project.name}`}
          >
            {project.name}
          </Button>
        )}
          </div>
        </td>

        <td>
          <span className={`board-table-cell-status${projectStatus ? "" : " board-table-cell-status--idle"}`}>
            {projectStatus ? (
              <span className={`board-table-status-dot ${chatDotClass(projectStatus)}`} aria-hidden />
            ) : null}
            <span>{statusText}</span>
          </span>
        </td>

        <td>
          {/* Glanceable sessions metric: the count leads (the column header
              already says "Sessions", so the noun is dropped), with running /
              task chips trailing. Full text stays available to assistive tech. */}
          <span
            className="board-table-cell-sessions"
            aria-label={`${chatCount} ${chatCount === 1 ? "session" : "sessions"}`}
          >
          {chatCount > 0 ? (
            <span className="projects-session-count">
              <Icon name="ph:chats-circle" width={12} aria-hidden />
              {chatCount}
            </span>
          ) : (
            <span className="board-table-muted" aria-hidden>—</span>
          )}
          {stats.running > 0 ? (
            <span
              className="projects-session-chip projects-session-chip--running"
              title={`${stats.running} running`}
            >
              <Icon name="ph:circle-notch-bold" width={9} className="animate-spin" aria-hidden />
              {stats.running}
            </span>
          ) : null}
          {stats.tasks > 0 ? (
            <span
              className="projects-session-chip"
              title={`${stats.tasks} ${stats.tasks === 1 ? "task" : "tasks"}`}
            >
              <Icon name="ph:check-square" width={10} aria-hidden />
              {stats.tasks}
            </span>
          ) : null}
          </span>
        </td>

        <td>
        {lastActiveLabel ? (
          <span className="board-table-cell-time" title={`Last active ${lastActiveLabel}`}>
            {lastActiveLabel}
          </span>
        ) : (
          <span className="board-table-muted">—</span>
        )}
        </td>

        <td style={{ textAlign: "right" }}>
          <div
            className={`ml-auto flex shrink-0 items-center justify-end gap-1 transition-opacity motion-reduce:transition-none ${
            confirmDelete
              ? "opacity-100"
              : "opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
          }`}
        >
          <IconButton
            icon="ph:chat-circle-dots-bold"
            onClick={() => onNewChat?.(project.root)}
            className="h-7 w-7 text-[var(--text-muted)]"
            title="New session"
            aria-label={`New session in ${project.name}`}
          />
          <IconButton
            icon="ph:pencil-simple-bold"
            onClick={() => { setNameDraft(project.name); setEditingName(true); }}
            aria-label={`Rename ${project.name}`}
            title="Rename"
            className="h-7 w-7 text-[var(--text-muted)]"
          />
          {confirmDelete ? (
            <>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => setConfirmDelete(false)}
                className="h-7 rounded-[var(--radius-control)] px-2 text-[11px] text-[var(--text-muted)]"
              >
                Cancel
              </Button>
              <Button
                variant="danger-ghost"
                size="xs"
                onClick={() => void deleteProject()}
                disabled={busy === "delete"}
                className="h-7 rounded-[var(--radius-control)] border border-[var(--color-danger)]/50 bg-[var(--color-danger)]/10 px-2 text-[11px] text-[var(--color-danger)] hover:bg-[var(--color-danger)]/15"
              >
                Delete
              </Button>
            </>
          ) : (
            <IconButton
              icon="ph:trash-bold"
              onClick={() => setConfirmDelete(true)}
              danger
              className="h-7 w-7 text-[var(--text-muted)] hover:text-[var(--color-danger)]"
              title="Delete project"
              aria-label={`Delete ${project.name}`}
            />
          )}
          </div>
          <ContextMenu state={menu} onClose={() => setMenu(null)} ariaLabel={`Actions for ${project.name}`}>
            <PopoverItem icon="ph:chat-circle-dots-bold" onSelect={() => { setMenu(null); onNewChat?.(project.root); }}>
              New session
            </PopoverItem>
            <PopoverItem icon="ph:pencil-simple-bold" onSelect={() => { setMenu(null); setNameDraft(project.name); setEditingName(true); }}>
              Rename
            </PopoverItem>
            <PopoverItem icon="ph:image-bold" onSelect={() => { setMenu(null); pickImage(); }}>
              {hasImage ? "Change image…" : "Set image…"}
            </PopoverItem>
            {hasImage ? (
              <PopoverItem icon="ph:minus-circle" onSelect={() => { setMenu(null); void clearProjectImage(project.root); }}>
                Remove image
              </PopoverItem>
            ) : null}
            <PopoverItem icon={copiedRoot ? "ph:check" : "ph:copy"} onSelect={() => { setMenu(null); void copyRoot(); }}>
              Copy path
            </PopoverItem>
            <PopoverSeparator />
            <PopoverItem icon="ph:trash-bold" danger onSelect={() => { setMenu(null); setExpanded(true); setConfirmDelete(true); }}>
              Delete project…
            </PopoverItem>
          </ContextMenu>
        </td>
      </tr>

      {imageStatus ? (
        <tr className="projects-table-detail-row">
          <td colSpan={5}>
            <p role="status" className="pl-8 text-[11px] text-[var(--text-muted)]">
              {imageStatus}
            </p>
          </td>
        </tr>
      ) : null}

      {expanded ? (
        <tr className="projects-table-detail-row">
          <td colSpan={5}>
        <div className="projects-expand-enter projects-table-detail">
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
            className="focus-ring min-w-0 flex-1 rounded-[var(--radius-control)] border border-[var(--border-strong)] bg-[var(--bg-base)] px-2 py-1 font-mono text-[11px] text-[var(--text-secondary)]"
          />
        ) : (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => {
              setRootDraft(project.root);
              setEditingRoot(true);
            }}
            className="min-w-0 flex-1 justify-start truncate rounded-[var(--radius-control)] px-1 py-0.5 text-left font-mono text-[11px] text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
            title={project.root}
          >
            {shortRoot(project.root)}
          </Button>
        )}
        {!editingRoot && (
          <IconButton
            icon={copiedRoot ? "ph:check" : "ph:copy"}
            size="xs"
            onClick={copyRoot}
            className="shrink-0 text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
            title={copiedRoot ? "Copied" : "Copy path"}
            aria-label={`Copy path ${project.root}`}
          />
        )}
      </div>

      <div className="mt-2 flex min-w-0 items-center gap-2 pl-6">
        <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
          Color
        </span>
        <div className="flex items-center gap-1.5" role="group" aria-label={`Tile color for ${project.name}`}>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => void setColor(null)}
            disabled={busy === "color"}
            aria-pressed={!project.color}
            title="Auto — tinted from the project path"
            aria-label="Auto color"
            className={`h-4 w-4 shrink-0 rounded-full border border-dashed border-[var(--border-strong)] p-0 ${
              !project.color ? "ring-2 ring-[var(--accent-presence)] ring-offset-1 ring-offset-[var(--bg-base)]" : ""
            }`}
            style={{ background: `color-mix(in oklch, ${projectTint(project.root)} 45%, transparent)` }}
          />
          {PROJECT_COLOR_SWATCHES.map((swatch) => (
            <Button
              key={swatch.value}
              variant="ghost"
              size="xs"
              onClick={() => void setColor(swatch.value)}
              disabled={busy === "color"}
              aria-pressed={project.color === swatch.value}
              title={swatch.name}
              aria-label={`${swatch.name} color`}
              className={`h-4 w-4 shrink-0 rounded-full p-0 ${
                project.color === swatch.value
                  ? "ring-2 ring-[var(--accent-presence)] ring-offset-1 ring-offset-[var(--bg-base)]"
                  : ""
              }`}
              style={{ background: swatch.value }}
            />
          ))}
        </div>
      </div>

      {chats.length > 0 ? (
        <>
          <div className="-mx-2 mt-2 flex items-center justify-between gap-2 border-t border-[var(--border-hairline)] px-4 pt-2">
            {selectMode ? (
              <>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={toggleSelectAllVisible}
                    className="rounded-[var(--radius-control)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                  >
                    {allVisibleSelected ? "Clear" : "Select all"}
                  </Button>
                  <span className="text-[11px] text-[var(--text-muted)]">
                    {selectedIds.size} selected
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={exitSelect}
                    className="rounded-[var(--radius-control)] px-1.5 py-0.5 text-[11px] text-[var(--text-muted)]"
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="danger-ghost"
                    size="xs"
                    disabled={bulkDeleting || selectedIds.size === 0}
                    onClick={() => void deleteSelected()}
                    leadingIcon="ph:trash-bold"
                    className="rounded-[var(--radius-control)] border border-[var(--color-danger)]/50 bg-[var(--color-danger)]/10 px-1.5 py-0.5 text-[11px] text-[var(--color-danger)] hover:bg-[var(--color-danger)]/15"
                  >
                    {bulkDeleting ? "Deleting…" : `Delete${selectedIds.size ? ` ${selectedIds.size}` : ""}`}
                  </Button>
                </div>
              </>
            ) : (
              <Button
                variant="ghost"
                size="xs"
                onClick={() => setSelectMode(true)}
                leadingIcon="ph:list-checks-bold"
                className="ml-auto rounded-[var(--radius-control)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
              >
                Select
              </Button>
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
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setShowAllChats((value) => !value)}
              aria-expanded={showAllChats}
              className="mt-1 rounded-[var(--radius-control)] px-2 py-1 text-[11px] font-medium text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
            >
              {showAllChats ? "Show less" : `Show all ${chats.length} sessions`}
            </Button>
          ) : null}
        </>
      ) : (
        <p className="mt-2 border-t border-[var(--border-hairline)] pt-2 text-[11px] text-[var(--text-muted)]">
          No sessions yet — drag one here or start a new session.
        </p>
      )}
        </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}
