"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

// The Projects hub's styling (every `projects-hub`/`projects-list-row`/
// `projects-detail-*` class) lives in projects.css. Import it directly so the
// surface is always styled — it's reachable straight from the Chat → Projects
// tab, before any other surface has ever mounted.
import "@/styles/projects.css";
import { Icon } from "@/lib/icon";
import { useDateTimePrefs } from "@/lib/datetime-format";
import { useMinuteTick } from "@/lib/use-minute-tick";
import { normalizeProjectRoot, sortProjectsAlphabetically, type CaveProject } from "@/lib/cave-projects-types";
import { deriveProjectStatus } from "@/lib/project-status";
import { addChatProject } from "@/lib/chat-add-project";
import type { SessionRow } from "@/lib/types";
import { stripLeadingTrailingEmoji } from "@/lib/cave-chat-titles";
import { stripTaskPrefix } from "@/lib/projects/session-glyph";
import { applyManualOrder, readSessionOrder } from "@/lib/chat-session-order";
import { applyProjectOverrides, setProjectOverride, clearProjectOverride } from "@/lib/chat-project-overrides";
import { useProjectOverrides } from "@/lib/use-project-overrides";
import { useProjects } from "@/lib/use-projects";
import {
  PROJECTS_SELECTED_KEY,
  parseStoredProjectId,
  resolveSelectedProjectId,
} from "@/lib/projects/selected-project";
import { useRovingTabIndex } from "@/lib/use-roving-tabindex";
import { nextTypeAheadIndex } from "@/lib/projects/type-ahead";
import { smoothScrollBehavior } from "@/lib/use-prefers-reduced-motion";
import { CHAT_FOCUS_PROJECT_EVENT } from "@/lib/chat-tab-events";
import { UndoToast } from "@/components/ui/undo-toast";
import { useUndoDelete } from "@/lib/use-undo-delete";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { SkeletonRows } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

import { ProjectList } from "./projects/project-list";
import { ProjectDetail } from "./projects/project-detail";
import { lastActiveMs, shortRoot, openSessionById } from "./projects/projects-shared";
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
  const minuteTick = useMinuteTick(); // keep "last active" relative times + the active filter current
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
  // Opt-in "Active" view filter (ephemeral — resets each visit so a project is
  // never surprisingly hidden). It only narrows the list; it never reorders it,
  // so the alphabetical order stays stable.
  const [statusFilter, setStatusFilter] = useState<"all" | "active">("all");
  const searchRef = useRef<HTMLInputElement>(null);
  const rootInputRef = useRef<HTMLInputElement>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [rootDraft, setRootDraft] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [moveToast, setMoveToast] = useState<{ sessionId: string; prevRoot: string | null; label: string } | null>(null);
  // Bulk delete is deferred + undoable: the rows hide immediately, the actual
  // DELETEs fire only after the undo window, and Undo restores the batch.
  const { pending: deletePending, scheduleDelete: scheduleSessionDelete, undo: undoSessionDelete, commit: commitSessionDelete } = useUndoDelete<SessionRow[]>();
  const projectOverrides = useProjectOverrides();

  // ── Master-detail selection ─────────────────────────────────────────────────
  // The selected project id persists across reloads; when nothing (valid) is
  // stored, the most recently active project wins. Under the narrow single-pane
  // collapse `pane` decides which side shows; wide layouts always show both.
  const [storedSelection, setStoredSelection] = useState<string | null>(null);
  const [pane, setPane] = useState<"list" | "detail">("list");
  useEffect(() => {
    if (typeof window === "undefined") return;
    setStoredSelection(parseStoredProjectId(window.localStorage.getItem(PROJECTS_SELECTED_KEY)));
  }, []);
  const selectProject = (id: string) => {
    setStoredSelection(id);
    setPane("detail");
    try {
      window.localStorage.setItem(PROJECTS_SELECTED_KEY, id);
    } catch {
      // Storage unavailable (private mode / quota) — keep the in-memory value.
    }
  };

  // Roving keyboard navigation (WAI-ARIA) over the project rows in the list
  // pane: ↑/↓ + Home/End move focus, Enter/Space select (per-row handlers).
  const listRef = useRef<HTMLDivElement>(null);
  const { setActiveIndex } = useRovingTabIndex({ containerRef: listRef, itemSelector: "[data-proj-nav]", orientation: "vertical" });
  // Type-ahead: typing letters jumps focus to the next project whose label
  // starts with what you typed (Finder-style), staying in sync with the roving
  // tab stop. The buffer resets after a short pause.
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
  // The shared manual session order is read (so the detail list matches the
  // chat rail's drag order) but no longer written here — the rail owns dnd.
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

  // Group sessions under their (override-aware) project root, applying the
  // shared manual order, so the detail pane lists chats in the rail's order.
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

  // Keep projects stable and scannable: alphabetical by project name/root.
  // Session rows inside the detail pane keep their own manual/recency ordering.
  const sortedProjects = useMemo(() => {
    return sortProjectsAlphabetically(projects);
  }, [projects]);

  // Resolve the selection each render: the stored id when it still exists,
  // otherwise the most recently active project (then the first). Deleting the
  // selected project or a familiar-scope change re-runs this automatically.
  const lastActiveByRootKey = useMemo(() => {
    const map = new Map<string, number>();
    for (const [root, list] of chatsByRoot) map.set(root, lastActiveMs(list));
    return map;
  }, [chatsByRoot]);
  const selectedProjectId = useMemo(
    () =>
      resolveSelectedProjectId(
        storedSelection,
        sortedProjects.map((p) => ({ id: p.id, rootKey: normalizeProjectRoot(p.root) })),
        lastActiveByRootKey,
      ),
    [storedSelection, sortedProjects, lastActiveByRootKey],
  );
  const selectedProject = useMemo(
    () => sortedProjects.find((p) => p.id === selectedProjectId) ?? null,
    [sortedProjects, selectedProjectId],
  );

  // The command palette's "Open project" rows land here: select that project,
  // reveal the detail pane, and scroll its list row into view.
  useEffect(() => {
    const onFocus = (e: Event) => {
      const detail = (e as CustomEvent<{ root?: string }>).detail;
      if (!detail?.root) return;
      const rootKey = normalizeProjectRoot(detail.root);
      const match = projects.find((p) => normalizeProjectRoot(p.root) === rootKey);
      if (!match) return;
      selectProject(match.id);
      window.requestAnimationFrame(() => {
        document
          .getElementById(`pcard-el:${rootKey}`)
          ?.scrollIntoView({ block: "nearest", behavior: smoothScrollBehavior() });
      });
    };
    window.addEventListener(CHAT_FOCUS_PROJECT_EVENT, onFocus);
    return () => window.removeEventListener(CHAT_FOCUS_PROJECT_EVENT, onFocus);
  }, [projects]);

  // Roots with a live signal (running / recently-failed / active ≤24h) — powers
  // the header's active count and the opt-in Active filter. Recomputed each
  // minute (minuteTick) so "recent" ages out. Never reorders the list.
  const activeRoots = useMemo(() => {
    void minuteTick;
    const set = new Set<string>();
    for (const [root, list] of chatsByRoot) {
      if (deriveProjectStatus(list) !== null) set.add(root);
    }
    return set;
  }, [chatsByRoot, minuteTick]);
  const activeCount = useMemo(
    () => sortedProjects.reduce((n, p) => n + (activeRoots.has(normalizeProjectRoot(p.root)) ? 1 : 0), 0),
    [sortedProjects, activeRoots],
  );

  // Filter by name or path so the alphabetical list stays scannable when there
  // are many projects, then (opt-in) narrow to active projects only. Filtering
  // only narrows the list pane — the detail keeps showing the selection.
  const visibleProjects = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = q
      ? sortedProjects.filter(
          (p) => p.name.toLowerCase().includes(q) || p.root.toLowerCase().includes(q),
        )
      : sortedProjects;
    if (statusFilter === "active") {
      list = list.filter((p) => activeRoots.has(normalizeProjectRoot(p.root)));
    }
    return list;
  }, [sortedProjects, query, statusFilter, activeRoots]);

  // Move a session to another project (via the row's "Move to project" context
  // menu). targetRoot must be normalized. Captures the prior override first so
  // the move can be undone precisely (restore the old override, or clear it if
  // there wasn't one), then raises the undo toast.
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
    setQuery("");
    // Land on the new project's detail pane — its New chat button is the
    // follow-up action (replaces the old "Created X" banner).
    selectProject(project.id);
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

  // Delete a single chat from the detail pane, then ask the parent to refetch
  // sessions so the row disappears everywhere.
  const handleDeleteSession = async (sessionId: string) => {
    setSessionError(null);
    if (await deleteOneSession(sessionId)) onSessionsChanged?.();
  };

  // Bulk-delete the chats selected in the detail pane — deferred + undoable:
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

  const openBoard = () => {
    window.dispatchEvent(new CustomEvent("cave:navigate-mode", { detail: { mode: "board" } }));
  };

  return (
    <div className="flex h-full min-w-0 flex-col bg-[var(--bg-base)]">
      <header className="shrink-0 border-b border-[var(--border-hairline)] px-4 py-2.5 sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="shrink-0 text-[12px] text-[var(--text-muted)]">
              {query.trim() && visibleProjects.length !== projects.length ? (
                `${visibleProjects.length} of ${projects.length} projects`
              ) : statusFilter === "active" ? (
                `${activeCount} active project${activeCount === 1 ? "" : "s"}`
              ) : (
                <>
                  {projects.length} {projects.length === 1 ? "project" : "projects"}
                  {activeCount > 0 ? (
                    <span className="text-[var(--accent-presence)]"> · {activeCount} active</span>
                  ) : null}
                </>
              )}
            </span>
            {/* Opt-in Active filter — only useful (and shown) when there's a mix
                of active and idle projects. Narrows without reordering. */}
            {statusFilter === "active" || (projects.length > 1 && activeCount > 0 && activeCount < projects.length) ? (
              <div
                role="group"
                aria-label="Filter by activity"
                className="flex shrink-0 items-center rounded-[var(--radius-control)] border border-[var(--border-hairline)] p-0.5"
              >
                {([
                  { value: "all", label: "All" },
                  { value: "active", label: "Active" },
                ] as const).map((opt) => (
                  <Button
                    key={opt.value}
                    variant="ghost"
                    size="xs"
                    onClick={() => setStatusFilter(opt.value)}
                    aria-pressed={statusFilter === opt.value}
                    className={`h-7 rounded-[var(--radius-control)] px-2 text-[11px] font-medium ${
                      statusFilter === opt.value
                        ? "bg-[var(--bg-hover)] text-[var(--text-primary)]"
                        : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                    }`}
                  >
                    {opt.value === "active" ? `Active ${activeCount}` : opt.label}
                  </Button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void reload()}
              disabled={loading}
              aria-label="Refresh projects"
              className="h-8 rounded-[var(--radius-control)] border border-[var(--border-hairline)] px-2.5 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] disabled:opacity-50"
            >
              <Icon name="ph:arrows-clockwise-bold" width={12} className={loading ? "animate-spin" : undefined} aria-hidden />
              Refresh
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={showForm ? () => setShowForm(false) : openCreateProjectForm}
              className="h-8 rounded-[var(--radius-control)] border border-[var(--border-hairline)] bg-[var(--accent-presence)]/10 px-2.5 text-[12px] text-[var(--accent-presence)] hover:bg-[var(--accent-presence)]/15"
              leadingIcon="ph:plus-bold"
            >
              New project
            </Button>
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
              className="focus-ring h-8 w-full rounded-[var(--radius-control)] border border-[var(--border-hairline)] bg-[var(--bg-base)] pl-8 pr-7 text-[12px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
            />
            {!query && (
              <kbd
                aria-hidden
                className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded-[var(--radius-control)] border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-1 font-mono text-[10px] leading-tight text-[var(--text-muted)]"
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
              className="focus-ring h-9 rounded-[var(--radius-control)] border border-[var(--border-hairline)] bg-[var(--bg-base)] px-3 text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
            />
            <div className="flex items-center gap-2">
              <input
                ref={rootInputRef}
                value={rootDraft}
                onChange={(event) => setRootDraft(event.target.value)}
                placeholder="/absolute/path/to/project"
                className="focus-ring h-9 min-w-0 flex-1 rounded-[var(--radius-control)] border border-[var(--border-hairline)] bg-[var(--bg-base)] px-3 font-mono text-[12px] text-[var(--text-secondary)] placeholder:text-[var(--text-muted)]"
              />
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void handleBrowse()}
                title="Browse for a project folder"
                className="h-9 shrink-0 rounded-[var(--radius-control)] border border-[var(--border-hairline)] px-2.5 text-[12px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)]"
                leadingIcon="ph:folder-open"
              >
                Browse
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={creating || !nameDraft.trim() || !rootDraft.trim()}
                className="h-9 rounded-[var(--radius-control)] px-3 text-[12px] font-medium disabled:opacity-50"
              >
                {creating ? "Creating" : "Create"}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowForm(false)}
                className="h-9 rounded-[var(--radius-control)] border border-[var(--border-hairline)] px-3 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              >
                Cancel
              </Button>
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

      {(error && projects.length > 0) || sessionError ? (
        <div className="shrink-0 space-y-2 px-4 pt-3 sm:px-6">
          {error && projects.length > 0 ? (
            <div
              role="alert"
              className="flex items-center justify-between gap-3 rounded-[var(--radius-control)] border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-3 py-2 text-[12px] text-[var(--color-danger)]"
            >
              <span className="min-w-0 truncate">Couldn't refresh: {error}</span>
              <Button
                variant="danger-ghost"
                size="xs"
                onClick={() => void reload()}
                className="shrink-0 rounded-[var(--radius-control)] border border-[var(--color-danger)]/40 px-2 py-0.5 text-[11px] hover:bg-[var(--color-danger)]/15"
              >
                Retry
              </Button>
            </div>
          ) : null}
          {sessionError ? (
            <div
              role="alert"
              className="flex items-center justify-between gap-3 rounded-[var(--radius-control)] border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-3 py-2 text-[12px] text-[var(--color-danger)]"
            >
              <span className="min-w-0 truncate">Couldn't delete chat: {sessionError}</span>
              <Button
                variant="danger-ghost"
                size="xs"
                onClick={() => setSessionError(null)}
                className="shrink-0 rounded-[var(--radius-control)] border border-[var(--color-danger)]/40 px-2 py-0.5 text-[11px] hover:bg-[var(--color-danger)]/15"
              >
                Dismiss
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      <main className="projects-shell">
        {error && projects.length === 0 ? (
          <ErrorState
            icon="ph:warning"
            headline="Couldn't load projects"
            subtitle={error}
            actions={
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void reload()}
                className="rounded-[var(--radius-control)] border border-[var(--border-hairline)] px-3 py-1.5 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              >
                Retry
              </Button>
            }
          />
        ) : loading && projects.length === 0 ? (
          <div className="flex w-full flex-col gap-2 px-4 py-4 sm:px-6">
            <SkeletonRows count={4} />
          </div>
        ) : projects.length === 0 ? (
          <EmptyState
            icon="ph:folder-open"
            headline="No projects yet"
            subtitle="Add a project folder to group chats by codebase."
            actions={
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={openCreateProjectForm}
                  className="rounded-[var(--radius-control)] border border-[var(--border-hairline)] px-3 py-1.5 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                >
                  New project
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    if (typeof window !== "undefined") {
                      window.dispatchEvent(new CustomEvent("cave:salem-open"));
                    }
                  }}
                  className="rounded-[var(--radius-control)] border border-[var(--border-hairline)] px-3 py-1.5 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                  leadingIcon="ph:sparkle"
                >
                  Ask Salem
                </Button>
              </>
            }
          />
        ) : (
          <div className="projects-hub" data-pane={pane}>
            <div ref={listRef} className="projects-hub__list">
              {visibleProjects.length === 0 ? (
                <p className="px-2 py-6 text-center text-[12px] text-[var(--text-muted)]">
                  {query.trim()
                    ? `No projects match “${query.trim()}”.`
                    : "No active projects right now."}
                </p>
              ) : (
                <ProjectList
                  projects={visibleProjects}
                  chatsByRoot={chatsByRoot}
                  selectedId={selectedProjectId}
                  onSelect={selectProject}
                  onNewChat={onNewChat}
                />
              )}
            </div>
            <div className="projects-hub__detail">
              {selectedProject ? (
                <ProjectDetail
                  key={selectedProject.id}
                  project={selectedProject}
                  chats={chatsByRoot.get(normalizeProjectRoot(selectedProject.root)) ?? []}
                  allProjects={projects}
                  onRename={renameProject}
                  onUpdateRoot={updateRoot}
                  onUpdateColor={updateColor}
                  onDelete={deleteProject}
                  onNewChat={onNewChat}
                  onOpenSession={openSessionById}
                  onDeleteSession={handleDeleteSession}
                  onDeleteSessions={handleDeleteSessions}
                  onMoveSession={moveSessionToProject}
                  onOpenBoard={openBoard}
                  onBack={() => setPane("list")}
                />
              ) : (
                <div className="projects-detail-empty">Pick a project to see its details.</div>
              )}
            </div>
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
