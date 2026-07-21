"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { Icon } from "@/lib/icon";
import { ProjectAvatar } from "@/components/project-avatar";
import { useAnnouncer } from "@/components/ui/live-region";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Modal } from "@/components/ui/modal";
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
import { useChangesSummary } from "@/lib/use-changes-summary";
import { useResolvedFamiliars } from "@/lib/familiar-resolve";
import type { CaveProject } from "@/lib/cave-projects-types";
import { normalizeProjectRoot } from "@/lib/cave-projects-types";
import type { Familiar, SessionRow } from "@/lib/types";
import type { Card } from "@/lib/cave-board-types";
import { disambiguateSessionTitles } from "@/lib/cave-chat-titles";
import { deriveProjectStatus } from "@/lib/project-status";
import { deriveStatStrip, openTaskCount } from "@/lib/projects/detail-stats";
import { projectTint } from "@/lib/comux-projects";

import { ProjectChatRow } from "./session-row";
import {
  DetailCard,
  GrantsSection,
  TasksSection,
  cardsForProject,
  useProjectGrants,
} from "./detail-sections";
import {
  CHAT_CAP,
  PROJECT_COLOR_SWATCHES,
  chatDotClass,
  hasDesktopBridge,
  revealProjectFolder,
  shortRoot,
  type MoveTarget,
} from "./projects-shared";

// The hub's detail pane, reorganized to the design-handoff mock: identity
// header (44px avatar, click-to-rename title, New chat / Open board / Remove),
// a chip row (status · git branch+state · copyable path), a four-cell stat
// strip bound to already-loaded data, then the collapsible Tasks / Sessions /
// Access cards. The header keeps ≤3 always-visible actions plus one overflow
// menu (design language §8); folder/color/image edits live behind it.

type ProjectDetailProps = {
  project: CaveProject;
  chats: SessionRow[];
  allProjects: CaveProject[];
  /** Board cards (all of them, fetched once by the shell) — filtered to this
   *  project client-side. */
  boardCards: Card[];
  /** Familiar roster for the Access card's rows. */
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
  // Identity edits (rename/root/color/image/copy/remove) resolve visually —
  // announce their outcomes so they aren't silent to assistive tech.
  const { announce } = useAnnouncer();
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
  // /api/sessions/list) — shown until the authoritative /api/changes response
  // lands. Exactly one component polls git: this one, for the selected root.
  const sessionBranch = useMemo(() => {
    let latest: SessionRow | null = null;
    for (const s of chats) {
      if (s.git?.branch && (!latest || s.updated_at > latest.updated_at)) latest = s;
    }
    return latest?.git?.branch ?? null;
  }, [chats]);
  const changes = useChangesSummary(project.root, true);
  const branch = changes.branch ?? sessionBranch;
  const [copiedBranch, setCopiedBranch] = useState(false);
  const copyBranch = async () => {
    if (!branch) return;
    try {
      await navigator.clipboard.writeText(branch);
      setCopiedBranch(true);
      window.setTimeout(() => setCopiedBranch(false), 1600);
      announce("Branch name copied.");
    } catch {
      // Clipboard blocked (insecure context / permissions) — no-op.
    }
  };

  // Other projects this project's chats can be moved into (normalized roots).
  const moveTargets = useMemo<MoveTarget[]>(
    () =>
      allProjects
        .filter((p) => normalizeProjectRoot(p.root) !== rootKey)
        .map((p) => ({ id: p.id, name: p.name, root: normalizeProjectRoot(p.root) })),
    [allProjects, rootKey],
  );

  // ── Grants (lifted: stat strip + Access card + Remove dialog share it) ─────
  const grants = useProjectGrants(project);
  const resolvedFamiliars = useResolvedFamiliars(familiars);
  const grantedCount = useMemo(
    () =>
      resolvedFamiliars.reduce(
        (n, f) => n + (f.id === grants.supremeFamiliarId || grants.grantedIds.has(f.id) ? 1 : 0),
        0,
      ),
    [resolvedFamiliars, grants.supremeFamiliarId, grants.grantedIds],
  );

  // ── Tasks (quick-add lifted so the stat strip sees optimistic adds) ────────
  // The server derives cwd from projectId (never client-supplied); the created
  // card is appended locally so it shows instantly, and cave:board:reload
  // nudges the shell's board fetch for everyone else.
  const [createdCards, setCreatedCards] = useState<Card[]>([]);
  const [creatingTask, setCreatingTask] = useState(false);
  useEffect(() => {
    setCreatedCards([]);
  }, [project.id]);
  const createTask = async (title: string): Promise<boolean> => {
    setCreatingTask(true);
    try {
      const res = await fetch("/api/board", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, projectId: project.id }),
      });
      const json = await res.json();
      if (!json?.ok || !json.card) throw new Error(json?.error ?? "create failed");
      setCreatedCards((prev) => [json.card as Card, ...prev]);
      announce(`Task added to ${project.name}.`);
      window.dispatchEvent(new Event("cave:board:reload"));
      return true;
    } catch {
      announce("Couldn't add the task.", "assertive");
      return false;
    } finally {
      setCreatingTask(false);
    }
  };
  const mergedCards = useMemo(() => {
    const seen = new Set(boardCards.map((c) => c.id));
    return [...createdCards.filter((c) => !seen.has(c.id)), ...boardCards];
  }, [boardCards, createdCards]);
  const projectCards = useMemo(() => cardsForProject(mergedCards, project), [mergedCards, project]);
  const openCards = useMemo(() => projectCards.filter((c) => c.status !== "done"), [projectCards]);
  const doneCount = projectCards.length - openCards.length;
  const runningCount = openCards.filter((c) => c.status === "running").length;

  // ── Stat strip: every cell binds to data this pane already loads ───────────
  const statStrip = deriveStatStrip({
    sessionCount: chats.length,
    openTasks: openTaskCount(projectCards),
    grantedCount,
    rosterCount: resolvedFamiliars.length,
    lastActiveLabel,
  });

  // ── Identity edits (name / root / color / image) ───────────────────────────
  const [editingName, setEditingName] = useState(false);
  const [editingRoot, setEditingRoot] = useState(false);
  const [nameDraft, setNameDraft] = useState(project.name);
  const [rootDraft, setRootDraft] = useState(project.root);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState<"name" | "root" | "color" | "delete" | "icon" | null>(null);
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

  // Mock parity: click = upload, double-click = generate. The single click is
  // deferred just long enough (260ms) for a double-click to cancel it, so a
  // generate never also opens the file picker. The generator is the existing
  // /api/projects/icon flow — the same action stays in the overflow menu.
  const avatarClickTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (avatarClickTimer.current) window.clearTimeout(avatarClickTimer.current);
    },
    [],
  );
  const onAvatarClick = () => {
    if (avatarClickTimer.current) window.clearTimeout(avatarClickTimer.current);
    avatarClickTimer.current = window.setTimeout(() => {
      avatarClickTimer.current = null;
      pickImage();
    }, 260);
  };
  const onAvatarDoubleClick = () => {
    if (avatarClickTimer.current) {
      window.clearTimeout(avatarClickTimer.current);
      avatarClickTimer.current = null;
    }
    if (busy !== "icon") void generateIcon();
  };

  // AI-generated icon: the server builds a distinct per-project prompt
  // (deterministic hue/motif from the root, fresh composition per press) and
  // the result lands in the same image store uploads use — so it renders in
  // the chat sidebar, project picker, and board immediately.
  const generateIcon = async () => {
    setBusy("icon");
    setImageStatus("Generating icon…");
    announce(`Generating an icon for ${project.name}.`);
    try {
      const res = await fetch("/api/projects/icon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: project.name, root: project.root }),
      });
      const payload = (await res.json()) as
        | { ok: true; dataUrl: string; mime: string }
        | { ok: false; error?: string; hint?: string; providerMessage?: string };
      if (!payload.ok) {
        const reason = payload.hint ?? payload.providerMessage ?? "Couldn't generate an icon.";
        setImageStatus(reason);
        announce(reason, "assertive");
        return;
      }
      const saved = await setProjectImage(project.root, {
        dataUrl: payload.dataUrl,
        mime: payload.mime,
      });
      setImageStatus(saved.ok ? null : saved.reason);
      if (saved.ok) announce("Project icon generated.");
      else announce(saved.reason, "assertive");
    } catch {
      setImageStatus("Couldn't generate an icon.");
      announce("Couldn't generate an icon.", "assertive");
    } finally {
      setBusy(null);
    }
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

  // Remove = registry delete: the folder and its git history stay on disk.
  // Grants are revoked first (best-effort) so the dialog's promise holds —
  // each revoke is the same real DELETE /api/project-grants mutation the
  // Access card drives.
  const deleteProject = async () => {
    setBusy("delete");
    const revokeIds = resolvedFamiliars
      .filter((f) => f.id !== grants.supremeFamiliarId && grants.grantedIds.has(f.id))
      .map((f) => f.id);
    await Promise.allSettled(
      revokeIds.map((familiarId) =>
        fetch("/api/project-grants", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ targetFamiliarId: familiarId, projectId: project.id }),
        }),
      ),
    );
    const ok = await onDelete(project.id);
    if (ok) void clearProjectImage(project.root);
    setBusy(null);
    setConfirmDelete(false);
    if (ok) announce(`Removed project ${project.name}.`);
    else announce("Couldn't remove the project.", "assertive");
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

  const sessionsSummary =
    chats.length === 0 ? "None yet" : lastActiveLabel ? `Latest ${lastActiveLabel}` : null;

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
          onClick={onAvatarClick}
          onDoubleClick={onAvatarDoubleClick}
          className="projects-detail-head__avatar relative h-auto w-auto shrink-0 rounded-[var(--radius-control)] p-0"
          title={imageStatus ?? "Click to upload an image · double-click to generate one"}
          aria-label={`${hasImage ? "Change" : "Set"} image for ${project.name}`}
        >
          <ProjectAvatar name={project.name} root={project.root} color={project.color} size="xl" />
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
            className="focus-ring min-w-0 flex-1 rounded-[var(--radius-control)] border border-[var(--border-strong)] bg-[var(--bg-base)] px-2 py-1 text-[length:var(--text-xl)] font-semibold text-[var(--text-primary)]"
          />
        ) : (
          <span className="flex min-w-0 flex-1 items-center gap-1">
            <Button
              variant="ghost"
              size="xs"
              onClick={() => {
                setNameDraft(project.name);
                setEditingName(true);
              }}
              className="projects-detail-head__title h-auto min-w-0 justify-start rounded-[var(--radius-control)] px-1 py-0.5 text-left"
              title={`Rename ${project.name}`}
            >
              {project.name}
            </Button>
            <IconButton
              icon="ph:pencil-simple"
              size="xs"
              onClick={() => {
                setNameDraft(project.name);
                setEditingName(true);
              }}
              className="projects-detail-head__rename shrink-0 text-[var(--text-muted)] hover:text-[var(--accent-presence)]"
              title="Rename project"
              aria-label="Rename project"
            />
          </span>
        )}
        <div className="flex shrink-0 items-center gap-1.5">
          {onNewChat ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onNewChat?.(project.root)}
              className="projects-newchat h-8 rounded-[var(--radius-control)] px-3 text-[length:var(--text-sm)] font-medium"
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
              className="h-8 rounded-[var(--radius-control)] border border-[var(--border-hairline)] px-2.5 text-[length:var(--text-sm)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              leadingIcon="ph:kanban"
              title="Open the Tasks board"
            >
              Open board
            </Button>
          ) : null}
          <span className="projects-head-divider" aria-hidden />
          <IconButton
            icon="ph:trash-bold"
            size="sm"
            danger
            onClick={() => setConfirmDelete(true)}
            className="h-8 w-8 shrink-0"
            title="Remove project from list"
            aria-label="Remove project from list"
          />
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
            <PopoverItem
              icon="ph:sparkle-bold"
              disabled={busy === "icon"}
              onSelect={() => void generateIcon()}
              title="Generate a distinct AI icon for this project (uses your connected model's image provider — OPENAI_API_KEY or GOOGLE_API_KEY in Vault)"
            >
              {busy === "icon" ? "Generating icon…" : hasImage ? "Regenerate AI icon" : "Generate AI icon"}
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
            {hasDesktopBridge() ? (
              <PopoverItem
                icon="ph:folder-open-bold"
                onSelect={() => {
                  void revealProjectFolder(project.root).then((ok) =>
                    announce(ok ? `Opened ${project.name} in the file manager.` : "Couldn't open the folder.", ok ? "polite" : "assertive"),
                  );
                }}
              >
                Reveal in Finder
              </PopoverItem>
            ) : null}
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
            {/* Tile color moved out of the always-visible header (cave-dn9w):
                a rarely-used preference doesn't earn a whole header line. Same
                swatches + handlers, now a menu row. */}
            <div className="px-2 py-1.5">
      {/* Color: auto (root-hash tint) or a preset swatch. */}
            <div className="flex min-w-0 items-center gap-2">
              <span className="shrink-0 text-[length:var(--text-2xs)] font-medium uppercase tracking-wide text-[var(--text-muted)]">
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
            </div>
            <PopoverSeparator />
            <PopoverItem icon="ph:trash-bold" danger onSelect={() => setConfirmDelete(true)}>
              Remove project…
            </PopoverItem>
          </OverflowMenu>
        </div>
      </div>

      {/* ── Chip row: status · git branch+state · copyable path ──────────────
          The folder stays editable via the overflow's "Change folder…"; while
          editing, the inline input replaces the chips. */}
      {editingRoot ? (
        <div className="flex min-w-0 items-center gap-2">
          <Icon name="ph:folder-simple-dashed" width={13} className="shrink-0 text-[var(--text-muted)]" aria-hidden />
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
            className="focus-ring min-w-0 flex-1 rounded-[var(--radius-control)] border border-[var(--border-strong)] bg-[var(--bg-base)] px-2 py-1 font-mono text-[length:var(--text-xs)] text-[var(--text-secondary)]"
          />
        </div>
      ) : (
        <div className="projects-detail-chips">
          <span
            className="projects-chip"
            title="Project state, derived from its latest sessions"
          >
            {projectStatus ? (
              <span className={`projects-status-dot ${chatDotClass(projectStatus)}`} aria-hidden />
            ) : (
              <span className="projects-status-dot bg-[var(--text-muted)]" aria-hidden />
            )}
            <span>{statusText}</span>
          </span>
          {changes.loaded && changes.notARepo ? null : branch ? (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => void copyBranch()}
              className="projects-chip projects-chip--action h-auto"
              title={copiedBranch ? "Copied" : `Copy branch name: ${branch}`}
              aria-label={`Copy branch name ${branch}`}
            >
              <Icon name={copiedBranch ? "ph:check" : "ph:git-branch-bold"} width={11} aria-hidden />
              <span className="projects-chip__mono">{branch}</span>
              <span className="projects-chip__sep" aria-hidden>·</span>
              {!changes.loaded ? (
                <span>checking…</span>
              ) : changes.count > 0 ? (
                <span
                  className="projects-chip__state projects-chip__state--dirty"
                  title={`${changes.count} ${changes.count === 1 ? "file" : "files"} with uncommitted changes in the working tree`}
                >
                  {changes.count} uncommitted
                </span>
              ) : (
                <span className="projects-chip__state">clean</span>
              )}
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="xs"
            onClick={() => void copyRoot()}
            className="projects-chip projects-chip--action h-auto"
            title={copiedRoot ? "Copied" : `Copy path: ${project.root}`}
            aria-label={`Copy path ${project.root}`}
          >
            <Icon name={copiedRoot ? "ph:check" : "ph:folder-simple-dashed"} width={11} aria-hidden />
            <span className="projects-chip__mono" title={project.root}>{shortRoot(project.root)}</span>
            <span className="projects-chip__hint">{copiedRoot ? "Copied" : "Copy"}</span>
          </Button>
        </div>
      )}

      {imageStatus ? (
        <p role="status" className="text-[length:var(--text-xs)] text-[var(--text-muted)]">
          {imageStatus}
        </p>
      ) : null}

      {/* ── Stat strip: four cells, all bound to already-loaded data ────────── */}
      <div className="projects-stat-strip" role="group" aria-label={`Stats for ${project.name}`}>
        <span className="projects-stat-strip__cell">
          <span className="projects-stat-strip__value">{statStrip.sessions}</span>
          <span className="projects-stat-strip__label">Sessions</span>
        </span>
        <span className="projects-stat-strip__cell">
          <span className="projects-stat-strip__value">{statStrip.openTasks}</span>
          <span className="projects-stat-strip__label">Open tasks</span>
        </span>
        <span className="projects-stat-strip__cell">
          <span className="projects-stat-strip__value">{statStrip.familiars}</span>
          <span className="projects-stat-strip__label">Familiars</span>
        </span>
        <span className="projects-stat-strip__cell">
          <span className="projects-stat-strip__value">{statStrip.lastActive}</span>
          <span className="projects-stat-strip__label">Last active</span>
        </span>
      </div>

      {/* ── Remove confirm: facts first, then the consequence, then the verb ── */}
      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        ariaLabel={`Remove ${project.name}?`}
        footerActions={
          <>
            <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => void deleteProject()}
              disabled={busy === "delete"}
              aria-label={`Delete ${project.name}`}
            >
              {busy === "delete" ? "Removing…" : "Remove project"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="m-0 text-[length:var(--text-md)] font-semibold text-[var(--text-primary)]">
            Remove “{project.name}”?
          </p>
          <div className="projects-remove-facts">
            <span className="projects-remove-facts__key">Folder</span>
            <span className="projects-remove-facts__value font-mono">{project.root}</span>
            <span className="projects-remove-facts__key">Open tasks</span>
            <span className="projects-remove-facts__value">{statStrip.openTasks}</span>
            <span className="projects-remove-facts__key">Sessions</span>
            <span className="projects-remove-facts__value">{statStrip.sessions}</span>
            <span className="projects-remove-facts__key">Access</span>
            <span className="projects-remove-facts__value">{statStrip.familiars} familiars</span>
          </div>
          <p className="m-0 text-[length:var(--text-xs)] text-[var(--text-muted)]">
            This removes the project from your list and revokes familiar grants. Chats keep their
            history, and the folder and its git history stay on disk untouched.
          </p>
        </div>
      </Modal>

      {/* ── Tasks ────────────────────────────────────────────────────────────── */}
      <TasksSection
        project={project}
        openCards={openCards}
        doneCount={doneCount}
        runningCount={runningCount}
        creatingTask={creatingTask}
        onCreateTask={createTask}
        onOpenBoard={onOpenBoard}
      />

      {/* ── Sessions ─────────────────────────────────────────────────────────── */}
      <DetailCard
        card="sessions"
        ariaLabel={`Sessions in ${project.name}`}
        title="Sessions"
        countTag={chats.length > 0 ? chats.length : null}
        summary={sessionsSummary}
      >
        {chats.length > 0 ? (
          <>
            <div className="mb-1 flex items-center justify-end gap-1 px-1">
              {selectMode ? (
                <span className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={toggleSelectAllVisible}
                    className="rounded-[var(--radius-control)] px-1.5 py-0.5 text-[length:var(--text-xs)] font-medium text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                  >
                    {allVisibleSelected ? "Clear" : "Select all"}
                  </Button>
                  <span className="text-[length:var(--text-xs)] text-[var(--text-muted)]">
                    {selectedIds.size} selected
                  </span>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={exitSelect}
                    className="rounded-[var(--radius-control)] px-1.5 py-0.5 text-[length:var(--text-xs)] text-[var(--text-muted)]"
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="danger-ghost"
                    size="xs"
                    disabled={bulkDeleting || selectedIds.size === 0}
                    onClick={() => void deleteSelected()}
                    leadingIcon="ph:trash-bold"
                    className="rounded-[var(--radius-control)] border border-[var(--color-danger)]/50 bg-[var(--color-danger)]/10 px-1.5 py-0.5 text-[length:var(--text-xs)] text-[var(--color-danger)] hover:bg-[var(--color-danger)]/15"
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
                  className="rounded-[var(--radius-control)] px-1.5 py-0.5 text-[length:var(--text-xs)] font-medium text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                >
                  Select
                </Button>
              )}
            </div>
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
                className="projects-more-btn mt-1"
              >
                {showAllChats ? "Show fewer" : `Show all ${chats.length} sessions`}
              </Button>
            ) : null}
          </>
        ) : (
          <div className="projects-detail-empty">
            No sessions yet — start one and it&apos;ll show up here.
          </div>
        )}
        {onNewChat ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onNewChat?.(project.root)}
            leadingIcon="ph:plus-bold"
            className="mt-2 w-full justify-center rounded-[var(--radius-control)] border border-[var(--border-hairline)] text-[length:var(--text-sm)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          >
            New chat
          </Button>
        ) : null}
      </DetailCard>

      {/* ── Access (familiar grants) ─────────────────────────────────────────── */}
      <GrantsSection project={project} familiars={resolvedFamiliars} grants={grants} />
    </div>
  );
}
