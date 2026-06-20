"use client";

import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from "react";

import { Icon } from "@/lib/icon";
import { relativeTime } from "@/lib/relative-time";
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
import { applyProjectOverrides, setProjectOverride } from "@/lib/chat-project-overrides";
import { useProjectOverrides } from "@/lib/use-project-overrides";
import { useProjects } from "@/lib/use-projects";
import { deriveProjectStatus } from "@/lib/project-status";
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
function ProjectChatRow({
  session,
  displayTitle,
  onOpen,
  onDelete,
}: {
  session: SessionRow;
  displayTitle?: string;
  onOpen: () => void;
  onDelete: (id: string) => Promise<void>;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: session.id,
  });
  const style: CSSProperties = { transform: CSS.Translate.toString(transform), transition };
  const title = stripLeadingTrailingEmoji(displayTitle ?? (session.title || "(untitled chat)"));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  return (
    <li ref={setNodeRef} style={style} data-dragging={isDragging ? "true" : undefined} className="group/pc relative">
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => {
          // ARIA button pattern: Enter and Space both activate. preventDefault on
          // Space stops the page from scrolling when the row has focus.
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpen();
          }
        }}
        className="focus-ring flex w-full items-center gap-2 px-4 py-1 text-left text-[12px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
      >
        <button
          type="button"
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
          title="Drag to reorder or move to another project"
          aria-label={`Move ${title}`}
          className="grid h-4 w-3 shrink-0 cursor-grab touch-none place-items-center text-[var(--text-muted)] opacity-0 transition-opacity hover:text-[var(--text-secondary)] focus-visible:opacity-100 group-hover/pc:opacity-100"
        >
          <Icon name="ph:dots-six-vertical" width={10} aria-hidden />
        </button>
        <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${chatDotClass(session.status)}`} />
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {confirmDelete ? (
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
            className="focus-ring grid h-5 w-5 shrink-0 place-items-center rounded text-[var(--text-muted)] opacity-0 transition-opacity hover:bg-[var(--bg-hover)] hover:text-[var(--color-danger)] focus-visible:opacity-100 group-hover/pc:opacity-100"
          >
            <Icon name="ph:trash-bold" width={11} aria-hidden />
          </button>
        )}
      </div>
    </li>
  );
}

type ProjectsViewProps = {
  sessions?: SessionRow[];
  onNewChat?: (projectRoot: string) => void;
  onSessionsChanged?: () => void;
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
}: ProjectRowProps) {
  const chatCount = chats.length;
  // Every project starts collapsed to a single scannable row; expanding reveals
  // the path + its sessions.
  const [expanded, setExpanded] = useState(false);
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
        "group border-b border-[var(--border-hairline)] px-2 py-3 transition-colors",
        isOver
          ? "bg-[color-mix(in_oklch,var(--accent-presence)_10%,transparent)]"
          : "hover:bg-[var(--bg-raised)]/40",
      ].join(" ")}
    >
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          aria-label={`${expanded ? "Collapse" : "Expand"} ${project.name}${statusLabel}`}
          className="focus-ring -ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]"
        >
          <Icon name={expanded ? "ph:caret-down" : "ph:caret-right"} width={12} aria-hidden />
        </button>
        <span className="relative shrink-0">
          <Icon
            name="ph:folder-open-bold"
            width={15}
            className="text-[var(--accent-presence)]"
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

        <span className="shrink-0 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] px-2 py-0.5 text-[10px] text-[var(--text-muted)]">
          {chatCount} {chatCount === 1 ? "session" : "sessions"}
        </span>

        {lastActiveLabel ? (
          <span className="hidden shrink-0 text-[10px] text-[var(--text-muted)] sm:inline" title={`Last active ${lastActiveLabel}`}>
            {lastActiveLabel}
          </span>
        ) : null}

        <div className="flex shrink-0 items-center gap-1 opacity-100 transition-opacity motion-reduce:transition-none sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
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
            onClick={() => {
              // Launch a terminal in this project's cwd, then jump to the
              // Terminal surface. The always-mounted terminal instance creates
              // the session (spawning the shell in project.root); cave:navigate-mode
              // brings the Terminal surface to the foreground.
              window.dispatchEvent(
                new CustomEvent("cave:terminal-open", { detail: { projectRoot: project.root } }),
              );
              window.dispatchEvent(
                new CustomEvent("cave:navigate-mode", { detail: { mode: "terminal" } }),
              );
            }}
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
        <>
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
          <SortableContext items={visibleChats.map((s) => s.id)} strategy={verticalListSortingStrategy}>
            <ul className="-mx-2 mt-2 flex flex-col gap-0.5 border-t border-[var(--border-hairline)] pt-2">
              {visibleChats.map((session) => (
                <ProjectChatRow
                  key={session.id}
                  session={session}
                  displayTitle={chatTitles.get(session.id)}
                  onOpen={() => onOpenSession?.(session.id)}
                  onDelete={onDeleteSession}
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
        </>
      ) : null}
    </article>
  );
}

export function ProjectsView({ sessions = [], onNewChat, onSessionsChanged }: ProjectsViewProps) {
  const {
    projects,
    loading,
    error,
    createProject,
    renameProject,
    updateRoot,
    deleteProject,
    reload,
  } = useProjects();
  const [showForm, setShowForm] = useState(false);
  const [query, setQuery] = useState("");
  const [nameDraft, setNameDraft] = useState("");
  const [rootDraft, setRootDraft] = useState("");
  const [creating, setCreating] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const projectOverrides = useProjectOverrides();
  const [order, setOrder] = useState<string[]>([]);
  useEffect(() => {
    setOrder(readSessionOrder());
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
    const score = (p: CaveProject) =>
      lastActiveMs(chatsByRoot.get(normalizeProjectRoot(p.root)) ?? []) ||
      new Date(p.updatedAt).getTime() ||
      0;
    return [...projects].sort((a, b) => score(b) - score(a));
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
    setProjectOverride(activeId, targetRoot);
  }

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

  // Delete a chat from its project card, mirroring the Chats list delete
  // (DELETE /api/chat/conversation/:id), then ask the parent to refetch
  // sessions so the row disappears everywhere.
  const handleDeleteSession = async (sessionId: string) => {
    setSessionError(null);
    try {
      const res = await fetch(`/api/chat/conversation/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({ ok: false }));
      if (!res.ok || !json.ok) {
        setSessionError(json.error ?? "delete failed");
        return;
      }
      onSessionsChanged?.();
    } catch (err) {
      setSessionError(err instanceof Error ? err.message : "delete failed");
    }
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
              className="focus-ring h-8 w-full rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] pl-8 pr-2.5 text-[12px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
            />
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

      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
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
                  />
                ))}
              </DndContext>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
