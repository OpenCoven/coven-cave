"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { Icon } from "@/lib/icon";
import { ProjectAvatar } from "@/components/project-avatar";
import { useAnnouncer } from "@/components/ui/live-region";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { OverflowMenu } from "@/components/ui/overflow-menu";
import { PopoverItem, PopoverSeparator } from "@/components/ui/popover";
import {
  clearProjectImage,
  moveProjectImage,
  setProjectImage,
  useProjectImages,
} from "@/lib/cave-project-images";
import { FAMILIAR_IMAGE_ACCEPT, prepareFamiliarImage } from "@/lib/familiar-image-upload";
import { relativeTime } from "@/lib/relative-time";
import type { CaveProject } from "@/lib/cave-projects-types";
import { normalizeProjectRoot } from "@/lib/cave-projects-types";
import type { Familiar, SessionRow } from "@/lib/types";
import type { Card } from "@/lib/cave-board-types";
import { disambiguateSessionTitles } from "@/lib/cave-chat-titles";
import { deriveProjectStatus } from "@/lib/project-status";
import { projectStats } from "@/lib/projects/project-stats";
import { projectTint } from "@/lib/comux-projects";

import { ProjectChatRow } from "./session-row";
import { GitSection, TasksSection, GrantsSection } from "./detail-sections";
import {
  CHAT_CAP,
  PROJECT_COLOR_SWATCHES,
  chatDotClass,
  shortRoot,
  type MoveTarget,
} from "./projects-shared";

// The hub's detail pane: everything about the selected project. The header
// keeps ≤2 always-visible actions (New chat, Board) plus one overflow menu
// (design language §8); rename/root/color/image/delete all live behind it or
// inline edits. Sessions render below with bulk-select and the CHAT_CAP.

type ProjectDetailProps = {
  project: CaveProject;
  chats: SessionRow[];
  allProjects: CaveProject[];
  /** Board cards (all of them, fetched once by the shell) — filtered to this
   *  project client-side by the Tasks section. */
  boardCards: Card[];
  /** Familiar roster for the Grants section's chips. */
  familiars: Familiar[];
  onRename: (id: string, name: string) => Promise<boolean>;
  onUpdateRoot: (id: string, root: string) => Promise<boolean>;
  /** Set an explicit tile tint, or null to restore the auto root-hash tint. */
  onUpdateColor: (id: string, color: string | null) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
  onNewChat?: (projectRoot: string) => void;
  onOpenSession?: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => Promise<void>;
  onDeleteSessions: (sessionIds: string[]) => Promise<void>;
  onMoveSession: (sessionId: string, targetRoot: string) => void;
  onOpenBoard?: () => void;
  /** Return to the list pane (only visible under the narrow collapse). */
  onBack: () => void;
};

export function ProjectDetail({
  project,
  chats,
  allProjects,
  boardCards,
  familiars,
  onRename,
  onUpdateRoot,
  onUpdateColor,
  onDelete,
  onNewChat,
  onOpenSession,
  onDeleteSession,
  onDeleteSessions,
  onMoveSession,
  onOpenBoard,
  onBack,
}: ProjectDetailProps) {
  const rootKey = normalizeProjectRoot(project.root);
  // Identity edits (rename/root/color/image/copy/delete) resolve visually —
  // announce their outcomes so they aren't silent to assistive tech.
  const { announce } = useAnnouncer();
  const stats = projectStats(chats);
  const projectStatus = deriveProjectStatus(chats);
  const statusText =
    projectStatus === "running"
      ? "Running"
      : projectStatus === "failed"
        ? "Failed"
        : projectStatus === "recent"
          ? "Recent"
          : "Idle";
  const lastActiveIso =
    chats.reduce((acc, s) => (!acc || s.updated_at > acc ? s.updated_at : acc), "") || project.updatedAt;
  const lastActiveLabel = relativeTime(lastActiveIso);
  // Fallback branch from the most recent session's git context (populated by
  // /api/sessions/list) — the Git section shows it until its authoritative
  // /api/changes response lands.
  const branch = useMemo(() => {
    let latest: SessionRow | null = null;
    for (const s of chats) {
      if (s.git?.branch && (!latest || s.updated_at > latest.updated_at)) latest = s;
    }
    return latest?.git?.branch ?? null;
  }, [chats]);

  // Other projects this project's chats can be moved into (normalized roots).
  const moveTargets = useMemo<MoveTarget[]>(
    () =>
      allProjects
        .filter((p) => normalizeProjectRoot(p.root) !== rootKey)
        .map((p) => ({ id: p.id, name: p.name, root: normalizeProjectRoot(p.root) })),
    [allProjects, rootKey],
  );

  // ── Identity edits (name / root / color / image) ───────────────────────────
  const [editingName, setEditingName] = useState(false);
  const [editingRoot, setEditingRoot] = useState(false);
  const [nameDraft, setNameDraft] = useState(project.name);
  const [rootDraft, setRootDraft] = useState(project.root);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState<"name" | "root" | "color" | "delete" | null>(null);
  const [copiedRoot, setCopiedRoot] = useState(false);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const [imageStatus, setImageStatus] = useState<string | null>(null);
  const projectImages = useProjectImages();
  const hasImage = Boolean(projectImages[rootKey]);

  // Switching projects must not leak the previous project's drafts/confirms.
  useEffect(() => {
    setEditingName(false);
    setEditingRoot(false);
    setNameDraft(project.name);
    setRootDraft(project.root);
    setConfirmDelete(false);
    setImageStatus(null);
  }, [project.id, project.name, project.root]);

  const pickImage = () => {
    setImageStatus(null);
    imageInputRef.current?.click();
  };

  const copyRoot = async () => {
    try {
      await navigator.clipboard.writeText(project.root);
      setCopiedRoot(true);
      window.setTimeout(() => setCopiedRoot(false), 1600);
      announce("Path copied.");
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
      const ok = await onRename(project.id, next);
      setBusy(null);
      if (ok) announce(`Renamed to ${next}.`);
      else announce("Couldn't rename the project.", "assertive");
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
      if (ok) announce("Project folder updated.");
      else announce("Couldn't update the project folder.", "assertive");
    }
    setEditingRoot(false);
  };

  const deleteProject = async () => {
    setBusy("delete");
    const ok = await onDelete(project.id);
    if (ok) void clearProjectImage(project.root);
    setBusy(null);
    if (ok) announce(`Deleted project ${project.name}.`);
    else announce("Couldn't delete the project.", "assertive");
  };

  const setColor = async (color: string | null) => {
    setBusy("color");
    const ok = await onUpdateColor(project.id, color);
    setBusy(null);
    if (!ok) {
      announce("Couldn't update the color.", "assertive");
      return;
    }
    const swatchName = color ? PROJECT_COLOR_SWATCHES.find((s) => s.value === color)?.name : null;
    announce(swatchName ? `Color set to ${swatchName}.` : "Color set to auto.");
  };

  // ── Sessions: cap, disambiguated titles, bulk select ───────────────────────
  const [showAllChats, setShowAllChats] = useState(false);
  const visibleChats = showAllChats ? chats : chats.slice(0, CHAT_CAP);
  const chatTitles = useMemo(() => disambiguateSessionTitles(chats), [chats]);

  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  // Selection resets whenever the set of chats (or the project) changes, so
  // stale ids never linger after deletes or a selection switch.
  const chatIdKey = `${project.id}:${chats.map((c) => c.id).join(",")}`;
  useEffect(() => {
    setSelectMode(false);
    setSelectedIds(new Set());
    setShowAllChats(false);
  }, [chatIdKey]);
  const toggleSelect = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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

  return (
    <div className="projects-detail-head">
      <div className="projects-detail-head__row">
        <IconButton
          icon="ph:caret-left"
          onClick={onBack}
          className="projects-detail-back h-7 w-7 shrink-0 text-[var(--text-muted)]"
          aria-label="Back to project list"
          title="Back to projects"
        />
        <Button
          variant="ghost"
          size="xs"
          onClick={pickImage}
          className="relative h-auto w-auto shrink-0 rounded-[var(--radius-control)] p-0"
          title={imageStatus ?? (hasImage ? "Change project image" : "Set project image")}
          aria-label={`${hasImage ? "Change" : "Set"} image for ${project.name}`}
        >
          <ProjectAvatar name={project.name} root={project.root} color={project.color} size="lg" />
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
                // The downsize/failure messages speak via the role="status"
                // line; plain success has no message, so announce it here.
                if (res.ok && !prepared.downsized) announce("Project image updated.");
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
            aria-label={`Rename ${project.name}`}
            className="focus-ring min-w-0 flex-1 rounded-[var(--radius-control)] border border-[var(--border-strong)] bg-[var(--bg-base)] px-2 py-1 text-[15px] font-semibold text-[var(--text-primary)]"
          />
        ) : (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => {
              setNameDraft(project.name);
              setEditingName(true);
            }}
            className="projects-detail-head__title h-auto justify-start rounded-[var(--radius-control)] px-1 py-0.5 text-left"
            title={`Rename ${project.name}`}
          >
            {project.name}
          </Button>
        )}
        <div className="flex shrink-0 items-center gap-1.5">
          {onNewChat ? (
            <Button
              variant="primary"
              size="sm"
              onClick={() => onNewChat?.(project.root)}
              className="h-8 rounded-[var(--radius-control)] px-2.5 text-[12px] font-medium"
              leadingIcon="ph:chat-circle-dots-bold"
              aria-label={`New session in ${project.name}`}
            >
              New chat
            </Button>
          ) : null}
          {onOpenBoard ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={onOpenBoard}
              className="h-8 rounded-[var(--radius-control)] border border-[var(--border-hairline)] px-2.5 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              leadingIcon="ph:kanban"
              title="Open the Tasks board"
            >
              Board
            </Button>
          ) : null}
          <OverflowMenu ariaLabel={`More actions for ${project.name}`} size="sm">
            <PopoverItem
              icon="ph:pencil-simple-bold"
              onSelect={() => {
                setNameDraft(project.name);
                setEditingName(true);
              }}
            >
              Rename
            </PopoverItem>
            <PopoverItem
              icon="ph:folder-open-bold"
              onSelect={() => {
                setRootDraft(project.root);
                setEditingRoot(true);
              }}
            >
              Change folder…
            </PopoverItem>
            <PopoverItem icon="ph:image-bold" onSelect={pickImage}>
              {hasImage ? "Change image…" : "Set image…"}
            </PopoverItem>
            {hasImage ? (
              <PopoverItem
                icon="ph:minus-circle"
                onSelect={() => {
                  void clearProjectImage(project.root);
                  announce("Project image removed.");
                }}
              >
                Remove image
              </PopoverItem>
            ) : null}
            <PopoverItem icon={copiedRoot ? "ph:check" : "ph:copy"} onSelect={() => void copyRoot()}>
              Copy path
            </PopoverItem>
            <PopoverItem
              icon="ph:file-code"
              onSelect={() => {
                // Drill into this project's file tree via the code rail. The
                // event is bridged to chat mode by workspace.tsx (cave-z44);
                // the rail browses project.root with nothing selected.
                window.dispatchEvent(
                  new CustomEvent("cave:browse-project-files", { detail: { root: project.root } }),
                );
                announce(`Browsing files in ${project.name}.`);
              }}
            >
              Browse files
            </PopoverItem>
            <PopoverSeparator />
            <PopoverItem icon="ph:trash-bold" danger onSelect={() => setConfirmDelete(true)}>
              Delete project…
            </PopoverItem>
          </OverflowMenu>
        </div>
      </div>

      {/* Path row — click to edit inline, copy stays one keystroke away. */}
      <div className="flex min-w-0 items-center gap-2">
        <Icon name="ph:folder-simple-dashed" width={13} className="shrink-0 text-[var(--text-muted)]" aria-hidden />
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
            aria-label={`Project folder for ${project.name}`}
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

      {/* Status line: state in words + stats chips + branch + recency. */}
      <div className="projects-detail-head__meta">
        <span className="inline-flex items-center gap-1.5">
          {projectStatus ? (
            <span className={`projects-status-dot ${chatDotClass(projectStatus)}`} aria-hidden />
          ) : null}
          <span>{statusText}</span>
        </span>
        <span
          className="projects-session-count"
          aria-label={`${chats.length} ${chats.length === 1 ? "session" : "sessions"}`}
        >
          <Icon name="ph:chats-circle" width={12} aria-hidden />
          {chats.length}
        </span>
        {stats.running > 0 ? (
          <span className="projects-session-chip projects-session-chip--running" title={`${stats.running} running`}>
            <Icon name="ph:circle-notch-bold" width={9} className="animate-spin" aria-hidden />
            {stats.running}
          </span>
        ) : null}
        {stats.tasks > 0 ? (
          <span className="projects-session-chip" title={`${stats.tasks} ${stats.tasks === 1 ? "task" : "tasks"}`}>
            <Icon name="ph:check-square" width={10} aria-hidden />
            {stats.tasks}
          </span>
        ) : null}
        {lastActiveLabel ? <span title={`Last active ${lastActiveLabel}`}>{lastActiveLabel}</span> : null}
      </div>

      {imageStatus ? (
        <p role="status" className="text-[11px] text-[var(--text-muted)]">
          {imageStatus}
        </p>
      ) : null}

      {confirmDelete ? (
        <div
          role="alertdialog"
          aria-label={`Delete ${project.name}?`}
          className="flex items-center justify-between gap-3 rounded-[var(--radius-control)] border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-3 py-2 text-[12px]"
        >
          <span className="min-w-0 truncate text-[var(--color-danger)]">
            Delete {project.name}? Chats keep their history; only the project entry goes away.
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
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
              aria-label={`Delete ${project.name}`}
              className="h-7 rounded-[var(--radius-control)] border border-[var(--color-danger)]/50 bg-[var(--color-danger)]/10 px-2 text-[11px] text-[var(--color-danger)] hover:bg-[var(--color-danger)]/15"
            >
              Delete
            </Button>
          </span>
        </div>
      ) : null}

      {/* Color: auto (root-hash tint) or a preset swatch. */}
      <div className="flex min-w-0 items-center gap-2">
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

      {/* ── Sessions ─────────────────────────────────────────────────────────── */}
      <section className="projects-detail-section" aria-label={`Sessions in ${project.name}`}>
        <div className="projects-detail-section__title">
          <span>Sessions</span>
          {chats.length > 0 ? <span className="projects-list-row__count">{chats.length}</span> : null}
          <span className="ml-auto">
            {chats.length > 0 ? (
              selectMode ? (
                <span className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={toggleSelectAllVisible}
                    className="rounded-[var(--radius-control)] px-1.5 py-0.5 text-[11px] font-medium normal-case tracking-normal text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                  >
                    {allVisibleSelected ? "Clear" : "Select all"}
                  </Button>
                  <span className="text-[11px] font-normal normal-case tracking-normal text-[var(--text-muted)]">
                    {selectedIds.size} selected
                  </span>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={exitSelect}
                    className="rounded-[var(--radius-control)] px-1.5 py-0.5 text-[11px] normal-case tracking-normal text-[var(--text-muted)]"
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="danger-ghost"
                    size="xs"
                    disabled={bulkDeleting || selectedIds.size === 0}
                    onClick={() => void deleteSelected()}
                    leadingIcon="ph:trash-bold"
                    className="rounded-[var(--radius-control)] border border-[var(--color-danger)]/50 bg-[var(--color-danger)]/10 px-1.5 py-0.5 text-[11px] normal-case tracking-normal text-[var(--color-danger)] hover:bg-[var(--color-danger)]/15"
                  >
                    {bulkDeleting ? "Deleting…" : `Delete${selectedIds.size ? ` ${selectedIds.size}` : ""}`}
                  </Button>
                </span>
              ) : (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => setSelectMode(true)}
                  leadingIcon="ph:list-checks-bold"
                  className="rounded-[var(--radius-control)] px-1.5 py-0.5 text-[11px] font-medium normal-case tracking-normal text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                >
                  Select
                </Button>
              )
            ) : null}
          </span>
        </div>
        {chats.length > 0 ? (
          <>
            <ul className="-mx-2 flex flex-col gap-0.5">
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
                  moveTargets={moveTargets}
                  onMoveSession={onMoveSession}
                />
              ))}
            </ul>
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
          <div className="projects-detail-empty">
            No sessions yet — start one and it'll show up here.
            {onNewChat ? (
              <Button
                variant="ghost"
                size="xs"
                onClick={() => onNewChat?.(project.root)}
                className="ml-2 rounded-[var(--radius-control)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--accent-presence)]"
              >
                New chat
              </Button>
            ) : null}
          </div>
        )}
      </section>

      {/* ── Git · Tasks · Grants (PR2 sections) ──────────────────────────────── */}
      <GitSection projectRoot={project.root} sessionBranch={branch} />
      <TasksSection project={project} cards={boardCards} onOpenBoard={onOpenBoard} />
      <GrantsSection project={project} familiars={familiars} />
    </div>
  );
}
