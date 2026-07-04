"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { Icon } from "@/lib/icon";
import { useDateTimePrefs } from "@/lib/datetime-format";
import { useMinuteTick } from "@/lib/use-minute-tick";
import { normalizeProjectRoot, sortProjectsAlphabetically, type CaveProject } from "@/lib/cave-projects-types";
import { addChatProject } from "@/lib/chat-add-project";
import type { SessionRow } from "@/lib/types";
import { stripLeadingTrailingEmoji } from "@/lib/cave-chat-titles";
import { stripTaskPrefix } from "@/lib/projects/session-glyph";
import {
  applyManualOrder,
  mergeVisibleOrder,
  readSessionOrder,
  writeSessionOrder,
} from "@/lib/chat-session-order";
import { applyProjectOverrides, setProjectOverride, clearProjectOverride } from "@/lib/chat-project-overrides";
import { useProjectOverrides } from "@/lib/use-project-overrides";
import { useProjects } from "@/lib/use-projects";
import { useProjectsUiState } from "@/lib/projects/use-projects-ui-state";
import { useRovingTabIndex } from "@/lib/use-roving-tabindex";
import { nextTypeAheadIndex } from "@/lib/projects/type-ahead";
import { UndoToast } from "@/components/ui/undo-toast";
import { useUndoDelete } from "@/lib/use-undo-delete";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { SkeletonRows } from "@/components/ui/skeleton";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";

import { ProjectRow } from "./projects/project-row";
import { shortRoot, openSessionById } from "./projects/projects-shared";
import { DirectoryPickerModal } from "@/components/directory-picker-modal";
import { isTauri } from "@/lib/tauri-platform";

/** Last path segment of an absolute path (handles both / and \ separators). */
function pathBasename(p: string): string {
  return p.replace(/[/\\]+$/, "").split(/[/\\]/).filter(Boolean).pop() ?? "";
}

type ProjectsViewProps = {
  sessions?: SessionRow[];
  onNewChat?: (projectRoot: string) => void;
  onSessionsChanged?: () => void;
  /** When set, only projects this familiar has been granted are shown. */
  activeFamiliarId?: string | null;
};

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
    updateColor,
    deleteProject,
    reload,
  } = useProjects({ familiarId: activeFamiliarId });
  const [showForm, setShowForm] = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const rootInputRef = useRef<HTMLInputElement>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [rootDraft, setRootDraft] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createdProject, setCreatedProject] = useState<CaveProject | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [moveToast, setMoveToast] = useState<{ sessionId: string; prevRoot: string | null; label: string } | null>(null);
  // Bulk delete is deferred + undoable: the rows hide immediately, the actual
  // DELETEs fire only after the undo window, and Undo restores the batch.
  const { pending: deletePending, scheduleDelete: scheduleSessionDelete, undo: undoSessionDelete, commit: commitSessionDelete } = useUndoDelete<SessionRow[]>();
  const projectOverrides = useProjectOverrides();
  const { density, setDensity, isExpanded, setExpanded } = useProjectsUiState();
  // Roving keyboard navigation (WAI-ARIA) over the flattened list of project
  // headers + their visible session rows: ↑/↓ + Home/End move focus, Enter/Space
  // open/select (per-row handlers), and →/← expand/collapse a focused header.
  const listRef = useRef<HTMLElement>(null);
  const { setActiveIndex } = useRovingTabIndex({ containerRef: listRef, itemSelector: "[data-proj-nav]", orientation: "vertical" });
  // Type-ahead: typing letters jumps focus to the next project / session whose
  // label starts with what you typed (Finder-style), staying in sync with the
  // roving tab stop. The buffer resets after a short pause.
  const typeAheadRef = useRef<{ buffer: string; timer: number }>({ buffer: "", timer: 0 });
  useEffect(() => {
    const container = listRef.current;
    if (!container) return;
    function onKey(e: KeyboardEvent) {
      // Only printable single characters, no modifiers; never while typing in a
      // field, and only when focus is on a navigable item in the list.
      if (e.key.length !== 1 || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (!t || t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (!t.closest("[data-proj-nav]")) return;
      const root = listRef.current;
      if (!root) return;
      const items = Array.from(root.querySelectorAll<HTMLElement>("[data-proj-nav]"));
      if (items.length === 0) return;
      e.preventDefault();
      const state = typeAheadRef.current;
      window.clearTimeout(state.timer);
      state.buffer += e.key;
      state.timer = window.setTimeout(() => {
        typeAheadRef.current.buffer = "";
      }, 600);
      const labels = items.map((el) => el.getAttribute("data-proj-label") ?? el.textContent ?? "");
      const current = items.indexOf(t.closest("[data-proj-nav]") as HTMLElement);
      const next = nextTypeAheadIndex(labels, current, state.buffer);
      if (next >= 0) {
        items[next].focus();
        setActiveIndex(next);
      }
    }
    container.addEventListener("keydown", onKey);
    return () => container.removeEventListener("keydown", onKey);
  }, [setActiveIndex]);
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
    // Hide chats whose delete is pending in the undo window (still on the
    // server; restored if the user hits Undo).
    const hidden = new Set((deletePending?.item ?? []).map((s) => s.id));
    const visible = hidden.size ? sessions.filter((s) => !hidden.has(s.id)) : sessions;
    const overridden = applyProjectOverrides(visible, projectOverrides);
    const byRoot = new Map<string, SessionRow[]>();
    for (const session of overridden) {
      const root = normalizeProjectRoot(session.project_root);
      const list = byRoot.get(root) ?? [];
      list.push(session);
      byRoot.set(root, list);
    }
    for (const [root, list] of byRoot) byRoot.set(root, applyManualOrder(list, order));
    return byRoot;
  }, [sessions, projectOverrides, order, deletePending]);

  const rootBySession = useMemo(() => {
    const map = new Map<string, string>();
    for (const [root, list] of chatsByRoot) for (const s of list) map.set(s.id, root);
    return map;
  }, [chatsByRoot]);

  // Keep projects stable and scannable: alphabetical by project name/root.
  // Session rows inside each project keep their own manual/recency ordering.
  const sortedProjects = useMemo(() => {
    return sortProjectsAlphabetically(projects);
  }, [projects]);

  // Filter by name or path so the alphabetical list stays scannable when there
  // are many projects.
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
    moveSessionToProject(activeId, targetRoot);
  }

  // Move a session to another project (shared by drag-and-drop and the row's
  // "Move to project" context-menu). targetRoot must be normalized. Captures the
  // prior override first so the move can be undone precisely (restore the old
  // override, or clear it if there wasn't one), then raises the undo toast.
  const moveSessionToProject = (sessionId: string, targetRoot: string) => {
    const prevRoot = projectOverrides[sessionId] ?? null;
    const moved = sessions.find((s) => s.id === sessionId);
    const destName =
      projects.find((p) => normalizeProjectRoot(p.root) === targetRoot)?.name ?? shortRoot(targetRoot);
    const movedTitle = moved ? stripLeadingTrailingEmoji(stripTaskPrefix(moved.title)) || "chat" : "chat";
    setProjectOverride(sessionId, targetRoot);
    setMoveToast({ sessionId, prevRoot, label: `Moved “${movedTitle}” to ${destName}` });
  };

  const undoMove = () => {
    if (!moveToast) return;
    if (moveToast.prevRoot) setProjectOverride(moveToast.sessionId, moveToast.prevRoot);
    else clearProjectOverride(moveToast.sessionId);
    setMoveToast(null);
  };

  function openCreateProjectForm() {
    setCreatedProject(null);
    setShowForm(true);
    window.setTimeout(() => rootInputRef.current?.focus(), 0);
  }

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = nameDraft.trim();
    const root = rootDraft.trim();
    if (!name || !root) return;
    setCreating(true);
    const project = await createProject(name, root);
    if (project && activeFamiliarId) {
      // Register alone leaves the project 403ing in chat for this familiar —
      // grant it here so "New project" is usable the moment it's created.
      const granted = await addChatProject({
        root,
        familiarId: activeFamiliarId,
        createProject,
        existingProjectId: project.id,
      });
      if (!granted.ok) setSessionError(`Project created, but grant failed: ${granted.error}`);
    }
    setCreating(false);
    if (!project) return;
    setNameDraft("");
    setRootDraft("");
    setShowForm(false);
    setCreatedProject(project);
    setExpanded(project.id, true);
    setQuery("");
  };

  // A folder was chosen (native dialog or in-app browser) → fill the path, and
  // seed the name from the folder when the user hasn't typed one yet.
  const applyPickedDir = (dir: string) => {
    const trimmed = dir.trim();
    if (!trimmed) return;
    setRootDraft(trimmed);
    setNameDraft((current) => (current.trim() ? current : pathBasename(trimmed)));
    rootInputRef.current?.focus();
  };

  // "Browse…" — native OS folder dialog on desktop, in-app $HOME browser on web.
  const handleBrowse = async () => {
    if (isTauri()) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const picked = await invoke<string | null>("shell_pick_directory");
        if (picked) applyPickedDir(picked);
        return;
      } catch {
        // Native dialog unavailable on this build — fall back to the web browser.
      }
    }
    setPickerOpen(true);
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

  // Bulk-delete the chats selected in a project card — deferred + undoable:
  // hide them now, fire the DELETEs only after the undo window, refetch once.
  const handleDeleteSessions = async (sessionIds: string[]) => {
    setSessionError(null);
    if (sessionIds.length === 0) return;
    const ids = new Set(sessionIds);
    const removed = sessions.filter((s) => ids.has(s.id));
    if (removed.length === 0) return;
    setMoveToast(null); // one bottom toast at a time
    scheduleSessionDelete(
      removed,
      `${removed.length} chat${removed.length === 1 ? "" : "s"}`,
      async () => {
        const results = await Promise.all(removed.map((s) => deleteOneSession(s.id)));
        if (results.some(Boolean)) onSessionsChanged?.();
      },
    );
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
              onClick={showForm ? () => setShowForm(false) : openCreateProjectForm}
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
            <div className="flex items-center gap-2">
              <input
                ref={rootInputRef}
                value={rootDraft}
                onChange={(event) => setRootDraft(event.target.value)}
                placeholder="/absolute/path/to/project"
                className="focus-ring h-9 min-w-0 flex-1 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] px-3 font-mono text-[12px] text-[var(--text-secondary)] placeholder:text-[var(--text-muted)]"
              />
              <button
                type="button"
                onClick={() => void handleBrowse()}
                title="Browse for a project folder"
                className="focus-ring inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-[var(--border-hairline)] px-2.5 text-[12px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)]"
              >
                <Icon name="ph:folder-open" width={14} aria-hidden />
                Browse
              </button>
            </div>
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

      <DirectoryPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(dir) => {
          applyPickedDir(dir);
          setPickerOpen(false);
        }}
      />

      {createdProject && !showForm ? (
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--border-hairline)] bg-[var(--bg-raised)]/50 px-4 py-2 text-[12px] sm:px-6">
          <span className="min-w-0 truncate text-[var(--text-secondary)]">
            Created <span className="font-medium text-[var(--text-primary)]">{createdProject.name}</span>
          </span>
          <div className="flex shrink-0 items-center gap-2">
            {onNewChat ? (
              <button
                type="button"
                onClick={() => onNewChat?.(createdProject.root)}
                className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--accent-presence)] px-2.5 text-[12px] font-medium text-[var(--text-primary)]"
              >
                <Icon name="ph:chat-circle-dots-bold" width={13} aria-hidden />
                Start chat in {createdProject.name}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setCreatedProject(null)}
              aria-label="Dismiss created project action"
              className="focus-ring grid h-8 w-8 place-items-center rounded-md border border-[var(--border-hairline)] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]"
            >
              <Icon name="ph:x" width={12} aria-hidden />
            </button>
          </div>
        </div>
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
                  onClick={openCreateProjectForm}
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
              <DndContext id="projects-grid" sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                {visibleProjects.map((project) => (
                  <ProjectRow
                    key={project.id}
                    project={project}
                    chats={chatsByRoot.get(normalizeProjectRoot(project.root)) ?? []}
                    onRename={renameProject}
                    onUpdateRoot={updateRoot}
                    onUpdateColor={updateColor}
                    onDelete={deleteProject}
                    onNewChat={onNewChat}
                    onOpenSession={openSessionById}
                    onDeleteSession={handleDeleteSession}
                    onDeleteSessions={handleDeleteSessions}
                    density={density}
                    expanded={isExpanded(project.id)}
                    onSetExpanded={(next) => setExpanded(project.id, next)}
                    allProjects={projects}
                    onMoveSession={moveSessionToProject}
                  />
                ))}
              </DndContext>
            )}
          </div>
        )}
      </main>
      {moveToast ? (
        <UndoToast
          key={moveToast.sessionId}
          message={moveToast.label}
          icon="ph:arrow-right-bold"
          undoAriaLabel="Undo move"
          onUndo={undoMove}
          onDismiss={() => setMoveToast(null)}
          durationMs={5000}
          autoDismiss
        />
      ) : null}
      {deletePending ? (
        <UndoToast
          key={deletePending.id}
          message={`Deleted ${deletePending.label}`}
          undoAriaLabel="Undo delete"
          onUndo={undoSessionDelete}
          onDismiss={commitSessionDelete}
        />
      ) : null}
    </div>
  );
}
