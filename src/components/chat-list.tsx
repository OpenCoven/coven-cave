"use client";

import { Fragment, useMemo, useState, useEffect, useRef, useCallback, type CSSProperties, type ReactNode } from "react";
import type { Familiar, SessionRow } from "@/lib/types";
import { stripLeadingTrailingEmoji, disambiguateSessionTitles } from "@/lib/cave-chat-titles";
import { Icon } from "@/lib/icon";
import { modelIcon, modelLabel } from "@/lib/model-label";
import { useKeySymbols } from "@/lib/platform-keys";
import { useIsMobile } from "@/lib/use-viewport";
import { OriginChip } from "@/components/ui/origin-chip";
import { SessionInitiatorChip } from "@/components/ui/session-initiator-chip";
import { UndoToast } from "@/components/ui/undo-toast";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useUndoDelete } from "@/lib/use-undo-delete";
import { FamiliarAvatar } from "@/components/familiar-avatar";
import { useResolvedFamiliars } from "@/lib/familiar-resolve";
import { relativeTime, isRelativePhrase } from "@/lib/relative-time";
import { useMinuteTick } from "@/lib/use-minute-tick";
import { useDateTimePrefs, formatDate, type DateTimePrefs } from "@/lib/datetime-format";
import {
  deriveChatProjectGroups,
  filterVisibleChatSessions,
} from "@/lib/chat-projects";
import { applyProjectOverrides } from "@/lib/chat-project-overrides";
import { useProjectOverrides } from "@/lib/use-project-overrides";
import { ChatProjectSidebar } from "@/components/chat-project-sidebar";
import { useProjects } from "@/lib/use-projects";
import {
  applyProjectScope,
  normalizeSelection,
  projectSelectionKeys,
  readPersisted,
  PROJECT_SIDEBAR_KEYS,
  type ProjectSelection,
} from "@/lib/chat-project-selection";
import {
  PINNED_SESSIONS_KEY,
  isSessionPinned,
  readPinnedSessions,
  sortPinnedFirst,
  togglePinnedSession,
} from "@/lib/chat-session-prefs";
import {
  applyManualOrder,
  mergeVisibleOrder,
  partitionPinnedFirst,
  readSessionOrder,
  writeSessionOrder,
} from "@/lib/chat-session-order";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
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

type Props = {
  familiar: Familiar | null;
  familiars?: Familiar[];
  sessions: SessionRow[];
  daemonRunning?: boolean;
  onOpen: (sessionId: string, familiarId?: string | null, findQuery?: string) => void;
  onNewChat: (projectRoot?: string, familiarId?: string | null) => void;
  onSessionsChanged?: () => void;
  /** false while the workspace's first /api/sessions/list fetch is in
   *  flight — gates the list on a skeleton instead of flashing the
   *  "no chats yet" empty state. Defaults true for callers that load
   *  sessions before mounting. */
  sessionsLoaded?: boolean;
  /** When true, hides the project sidebar rail so the list fits in a narrow
   *  companion panel (e.g. the Browser right-rail). */
  compact?: boolean;
};

function chatDate(iso: string, prefs: DateTimePrefs): string {
  // Absolute session date — honors the user's date-order preference
  // (month-first "Jun 19, 2026" vs day-first "19 Jun 2026") set in Settings.
  return formatDate(iso, prefs, { year: true });
}

/** Repo name — last non-empty path segment. */
function repoName(p: string): string {
  if (!p) return "";
  const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

/** Most-recent-first by last activity. The merge layer already sorts globally,
 *  but the flat "All" view flattens per-project groups (concatenating them),
 *  which loses that order — a recent chat in one project would sink below older
 *  chats in another. Re-sorting the flattened rows restores global recency. */
function sortByRecency(rows: SessionRow[]): SessionRow[] {
  return [...rows].sort((a, b) => {
    const at = Date.parse(a.updated_at || a.created_at) || 0;
    const bt = Date.parse(b.updated_at || b.created_at) || 0;
    return bt - at;
  });
}

const STATUS_STYLES: Record<string, { dot: string; label: string; preview: string }> = {
  running: { dot: "bg-[var(--color-success)] animate-pulse", label: "running", preview: "text-[var(--color-success)]" },
  completed: { dot: "bg-[var(--text-muted)]", label: "done", preview: "text-[var(--text-muted)]" },
  failed: { dot: "bg-[var(--color-danger)]", label: "failed", preview: "text-[var(--color-danger)]" },
  queued: { dot: "bg-[var(--color-warning)]", label: "queued", preview: "text-[var(--color-warning)]" },
  paused: { dot: "bg-[var(--accent-presence-soft)]", label: "paused", preview: "text-[var(--accent-presence-soft)]" },
};

function statusStyle(s: string) {
  return STATUS_STYLES[s] ?? STATUS_STYLES.completed;
}

// ── Content search (CHAT-D9-02) ───────────────────────────────────────────────
// Title filtering stays instant/local; conversation bodies are searched
// server-side (debounced) and surface as a secondary "In conversations"
// section beneath the title-filtered rows.

type ContentSearchHit = {
  sessionId: string;
  title?: string;
  snippet: string;
  matchCount: number;
};

/** Wrap the first case-insensitive occurrence of `query` in a <mark>. */
function HighlightedSnippet({ snippet, query }: { snippet: string; query: string }) {
  const idx = query ? snippet.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (idx < 0) return <>{snippet}</>;
  return (
    <>
      {snippet.slice(0, idx)}
      <mark className="rounded-[2px] bg-[color-mix(in_oklch,var(--accent-presence)_28%,transparent)] px-0.5 text-[var(--text-primary)]">
        {snippet.slice(idx, idx + query.length)}
      </mark>
      {snippet.slice(idx + query.length)}
    </>
  );
}

type SortableHandleProps = {
  attributes: ReturnType<typeof useSortable>["attributes"];
  listeners: ReturnType<typeof useSortable>["listeners"];
  isDragging: boolean;
};

function SortableChatListItem({
  id,
  children,
}: {
  id: string;
  children: (handleProps: SortableHandleProps) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
  };
  return (
    <li
      ref={setNodeRef}
      style={style}
      data-dragging={isDragging ? "true" : undefined}
      className="chat-list-sortable-row"
    >
      {children({ attributes, listeners, isDragging })}
    </li>
  );
}

// Uppercase counted section header — mirrors the desktop rail's RailSection so
// the phone list reads with the same grouping language (PINNED / SESSIONS).
function ChatListSection({
  label,
  count,
  collapsed,
  onToggle,
}: {
  label: string;
  count?: number;
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  const inner = (
    <>
      {onToggle ? (
        <Icon
          name={collapsed ? "ph:caret-right" : "ph:caret-down"}
          width={11}
          className="shrink-0 text-[var(--text-muted)]"
          aria-hidden
        />
      ) : null}
      <span className="truncate text-[12px] font-bold uppercase tracking-[0.12em] text-[var(--text-primary)]">
        {label}
      </span>
      {typeof count === "number" ? (
        <span className="font-mono text-[12px] text-[var(--text-secondary)] opacity-80">{count}</span>
      ) : null}
    </>
  );
  if (onToggle) {
    return (
      <li className="border-b border-[var(--border-hairline)] bg-[color-mix(in_oklch,var(--bg-base)_86%,var(--foreground)_14%)]">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? "Expand" : "Collapse"} ${label}`}
          className="focus-ring flex w-full items-center gap-1.5 px-4 py-2 text-left hover:bg-[var(--bg-raised)]/40"
        >
          {inner}
        </button>
      </li>
    );
  }
  return (
    <li className="flex items-center gap-1.5 border-b border-[var(--border-hairline)] bg-[color-mix(in_oklch,var(--bg-base)_86%,var(--foreground)_14%)] px-4 py-2">
      {inner}
    </li>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ChatList({ familiar, familiars = [], sessions, daemonRunning, onOpen, onNewChat, onSessionsChanged, sessionsLoaded = true, compact = false }: Props) {
  useMinuteTick(); // keep the "Xm ago" timestamps current without a data refresh
  // Scope the project rail to what the active familiar is granted; with no
  // active familiar (all-familiars view) this loads every project as before.
  const { projects } = useProjects({ familiarId: familiar?.id ?? null });
  const projectOverrides = useProjectOverrides();
  const dtPrefs = useDateTimePrefs();
  const [error, setError] = useState<string | null>(null);
  // Two-step delete: first trash click arms the row (inline Cancel/Delete
  // confirm replaces the row actions); only the explicit Delete commits.
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() => new Set());
  const toggleSection = useCallback((key: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  const [unreadsOnly, setUnreadsOnly] = useState(false);
  // Pins are Cave-local UI state (localStorage), same idiom as the project
  // sidebar persistence below — the daemon never learns about them.
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);
  const [sessionOrder, setSessionOrder] = useState<string[]>([]);
  // Archived rows are excluded server-side by /api/sessions/list; the toggle
  // opts into them with its own includeArchived fetch (the workspace's list
  // poll stays archive-free).
  const [showArchived, setShowArchived] = useState(false);
  const [archivedRows, setArchivedRows] = useState<SessionRow[]>([]);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [archiveNonce, setArchiveNonce] = useState(0);
  // Bulk-select: pick several chats and delete/archive them in one pass. Resets
  // when the active familiar changes so stale ids never linger.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  // Bulk delete is deferred + undoable: rows hide immediately, the DELETEs fire
  // only after the undo window, and Undo restores the batch.
  const { pending: deletePending, scheduleDelete: scheduleBulkDelete, undo: undoBulkDelete, commit: commitBulkDelete } = useUndoDelete<SessionRow[]>();
  useEffect(() => { setSelectMode(false); setSelectedIds(new Set()); }, [familiar?.id]);
  // Content search (CHAT-D9-02) — hits from /api/chat/search for the current
  // query; cleared the moment the query drops below the 2-char threshold.
  const [contentHits, setContentHits] = useState<ContentSearchHit[]>([]);
  const [contentLoading, setContentLoading] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [selection, setSelection] = useState<ProjectSelection>("all");
  const [sidebarHydrated, setSidebarHydrated] = useState(false);
  const sidebarPrefsLoadedRef = useRef(false);
  const sidebarDefaultExpandedRef = useRef(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const keys = useKeySymbols();
  const isMobile = useIsMobile();
  const allFamiliars = familiar ? [familiar] : familiars;
  const resolvedFamiliars = useResolvedFamiliars(allFamiliars, { includeArchived: true });
  const resolvedFamiliar = familiar ? resolvedFamiliars[0] : null;
  const familiarsById = useMemo(
    () => new Map(familiars.map((entry) => [entry.id, entry])),
    [familiars],
  );
  const fallbackFamiliarId = familiar?.id ?? familiars[0]?.id ?? null;
  const panelTitle = familiar?.display_name ?? "Familiars";
  const panelRole = familiar?.role ?? "All project conversations";
  const panelRuntime = familiar ? (familiar.harness ?? "codex") : "mixed";
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // ── Data: filter ──────────────────────────────────────────────────────────

  const mine = useMemo(() => {
    let rows = sessions;
    if (showArchived && archivedRows.length > 0) {
      const seen = new Set(sessions.map((s) => s.id));
      rows = [...sessions, ...archivedRows.filter((s) => !seen.has(s.id))];
    }
    // Hide chats whose bulk delete is pending in the undo window (still on the
    // server; restored if the user hits Undo).
    const hidden = new Set((deletePending?.item ?? []).map((s) => s.id));
    if (hidden.size) rows = rows.filter((s) => !hidden.has(s.id));
    return filterVisibleChatSessions(rows, familiar?.id ?? null);
  }, [sessions, showArchived, archivedRows, familiar?.id, deletePending]);

  const filtered = useMemo(() => {
    let rows = mine;
    if (unreadsOnly) rows = rows.filter((s) => s.status === "running");
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (s) =>
          (s.title ?? "").toLowerCase().includes(q) ||
          (s.project_root ?? "").toLowerCase().includes(q)
      );
    }
    return rows;
  }, [mine, search, unreadsOnly]);

  const hasAny = mine.length > 0;

  // ── Grouped by project_root ──────────────────────────────────────────────

  const grouped = useMemo(() => {
    return deriveChatProjectGroups(applyProjectOverrides(filtered, projectOverrides), projects);
  }, [filtered, projects, projectOverrides]);

  // Sidebar tree builds from familiar-scoped sessions BEFORE search/unreads,
  // so it stays stable while typing. The persisted selection is normalized
  // every render: stale projects degrade to "all" silently. Below lg the
  // sidebar is hidden, so a persisted project selection must not scope the
  // list there — no affordance would exist to unscope it.
  const sidebarGroups = useMemo(() => deriveChatProjectGroups(applyProjectOverrides(mine, projectOverrides), projects), [mine, projects, projectOverrides]);
  const effectiveSelection = useMemo(
    () => normalizeSelection(isMobile ? "all" : selection, sidebarGroups),
    [isMobile, selection, sidebarGroups],
  );
  const scopedGroups = useMemo(
    () => applyProjectScope(grouped, effectiveSelection),
    [grouped, effectiveSelection],
  );

  // Focus search on Cmd+F / Ctrl+F, or "/" (GitHub-style) when the user isn't
  // already typing in a field or holding a modifier.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const t = e.target as HTMLElement | null;
        if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Sidebar state loads after mount (not in initializers) so SSR markup and
  // first client render agree; persistence is gated until that load lands.
  useEffect(() => {
    if (sidebarPrefsLoadedRef.current) return;
    if (sessionsLoaded === false) return;
    sidebarPrefsLoadedRef.current = true;
    setSidebarOpen(readPersisted<unknown>(PROJECT_SIDEBAR_KEYS.open, true) !== false);
    const hasStoredExpanded =
      typeof window !== "undefined" && window.localStorage.getItem(PROJECT_SIDEBAR_KEYS.expanded) !== null;
    sidebarDefaultExpandedRef.current = !hasStoredExpanded;
    const storedExpanded = readPersisted<unknown>(PROJECT_SIDEBAR_KEYS.expanded, null);
    setExpandedKeys(
      Array.isArray(storedExpanded)
        ? storedExpanded.filter((k): k is string => typeof k === "string")
        : projectSelectionKeys(sidebarGroups),
    );
    const storedSelection = readPersisted<unknown>(PROJECT_SIDEBAR_KEYS.selected, "all");
    setSelection(typeof storedSelection === "string" ? storedSelection : "all");
    setPinnedIds(readPinnedSessions());
    setSessionOrder(readSessionOrder());
    setSidebarHydrated(true);
  }, [sessionsLoaded, sidebarGroups]);
  useEffect(() => {
    if (!sidebarHydrated || !sidebarDefaultExpandedRef.current) return;
    setExpandedKeys(projectSelectionKeys(sidebarGroups));
  }, [sidebarHydrated, sidebarGroups]);
  useEffect(() => {
    if (sidebarHydrated) window.localStorage.setItem(PROJECT_SIDEBAR_KEYS.open, JSON.stringify(sidebarOpen));
  }, [sidebarHydrated, sidebarOpen]);
  useEffect(() => {
    if (sidebarHydrated) window.localStorage.setItem(PROJECT_SIDEBAR_KEYS.expanded, JSON.stringify(expandedKeys));
  }, [sidebarHydrated, expandedKeys]);
  useEffect(() => {
    if (sidebarHydrated) window.localStorage.setItem(PROJECT_SIDEBAR_KEYS.selected, JSON.stringify(selection));
  }, [sidebarHydrated, selection]);
  useEffect(() => {
    if (sidebarHydrated) window.localStorage.setItem(PINNED_SESSIONS_KEY, JSON.stringify(pinnedIds));
  }, [sidebarHydrated, pinnedIds]);

  // Archived sessions only load while the toggle is on; archive/unarchive
  // bumps archiveNonce so the opt-in list refetches after each change.
  useEffect(() => {
    if (!showArchived) {
      setArchivedRows([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        // Scope archived rows to the active familiar's projects, same as the
        // live list — keeps forbidden-project sessions out of the archive view.
        const scope = familiar?.id ? `&familiarId=${encodeURIComponent(familiar.id)}` : "";
        const res = await fetch(`/api/sessions/list?includeArchived=1${scope}`, { cache: "no-store" });
        const json = await res.json().catch(() => ({ ok: false }));
        if (cancelled || !json.ok || !Array.isArray(json.sessions)) return;
        setArchivedRows((json.sessions as SessionRow[]).filter((s) => s.archived_at));
      } catch {
        // keep whatever archived rows we already have
      }
    })();
    return () => { cancelled = true; };
  }, [showArchived, archiveNonce, familiar?.id]);

  // Content search fires only for queries of length ≥2, debounced ~300ms so
  // each keystroke doesn't hit disk; a retype aborts the in-flight fetch.
  useEffect(() => {
    const q = search.trim();
    if (q.length < 2) {
      setContentHits([]);
      setContentLoading(false);
      return;
    }
    const controller = new AbortController();
    setContentHits([]);
    setContentLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/chat/search?q=${encodeURIComponent(q)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const json = await res.json().catch(() => ({ ok: false }));
        if (controller.signal.aborted) return;
        setContentHits(json.ok && Array.isArray(json.hits) ? json.hits : []);
        setContentLoading(false);
      } catch {
        // aborted retype or network hiccup — a newer effect owns the state
        if (!controller.signal.aborted) {
          setContentHits([]);
          setContentLoading(false);
        }
      }
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [search]);

  const displayGroups = useMemo(() => {
    if (effectiveSelection === "all") {
      let rows = scopedGroups.flatMap((group) => group.sessions);
      rows = sessionOrder.length === 0
        ? partitionPinnedFirst(sortByRecency(rows), pinnedIds)
        : applyManualOrder(rows, sessionOrder);
      const latest = rows[0] ?? null;
      return [{
        projectId: null,
        projectRoot: null,
        projectName: null,
        sessions: rows,
        defaultFamiliarId: latest?.familiarId ?? fallbackFamiliarId,
        updatedAt: latest ? (latest.updated_at || latest.created_at) : null,
      }];
    }
    if (sessionOrder.length === 0) return sortPinnedFirst(scopedGroups, pinnedIds);
    let changed = false;
    const next = scopedGroups.map((group) => {
      const ordered = applyManualOrder(group.sessions, sessionOrder);
      if (ordered === group.sessions) return group;
      changed = true;
      return { ...group, sessions: ordered };
    });
    return changed ? next : scopedGroups;
  }, [effectiveSelection, scopedGroups, sessionOrder, pinnedIds, fallbackFamiliarId]);
  const displayIds = useMemo(
    () => displayGroups.flatMap((group) => group.sessions.map((session) => session.id)),
    [displayGroups],
  );
  // `displayIds` keeps rows in collapsed sections (they stay in DOM order for
  // drag/sort). Bulk select/delete must act only on rows the user can actually
  // SEE, or "Select all" + Delete would silently remove chats hidden inside a
  // collapsed section (data loss). The collapsible Pinned/Sessions sections only
  // exist in the flat "All" view; there a row is hidden when its section is
  // collapsed. Mirrors the per-row `rowCollapsed` computed during render.
  const visibleIds = useMemo(() => {
    if (effectiveSelection !== "all" || collapsedSections.size === 0) return displayIds;
    return displayIds.filter(
      (id) => !collapsedSections.has(isSessionPinned(pinnedIds, id) ? "pinned" : "sessions"),
    );
  }, [displayIds, effectiveSelection, collapsedSections, pinnedIds]);
  const visibleRows = useMemo(
    () => scopedGroups.reduce((n, g) => n + g.sessions.length, 0),
    [scopedGroups],
  );
  // Content hits resolve against the familiar-scoped rows and drop any
  // session the title filter already shows — title matches stay primary.
  const contentMatches = useMemo(() => {
    if (search.trim().length < 2 || contentHits.length === 0) return [];
    const shown = new Set<string>();
    for (const group of scopedGroups) for (const s of group.sessions) shown.add(s.id);
    const byId = new Map(mine.map((s) => [s.id, s]));
    const out: Array<{ hit: ContentSearchHit; row: SessionRow }> = [];
    for (const hit of contentHits) {
      if (shown.has(hit.sessionId)) continue;
      const row = byId.get(hit.sessionId);
      if (!row) continue;
      out.push({ hit, row });
    }
    return out;
  }, [contentHits, scopedGroups, mine, search]);
  const showContentSection =
    search.trim().length >= 2 && (contentLoading || contentMatches.length > 0);

  const fallbackOrderIds = useMemo(() => mine.map((s) => s.id), [mine]);
  const liveSessionIds = useMemo(() => new Set(mine.map((s) => s.id)), [mine]);

  function handleDragEnd(event: DragEndEvent, displayIds: string[]) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = displayIds.indexOf(String(active.id));
    const newIndex = displayIds.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    const nextVisible = arrayMove(displayIds, oldIndex, newIndex);
    setSessionOrder((prev) => {
      const merged = mergeVisibleOrder(prev.length > 0 ? prev : fallbackOrderIds, nextVisible);
      const pruned = merged.filter((id) => liveSessionIds.has(id));
      writeSessionOrder(pruned);
      return pruned;
    });
  }
  // ── Row actions ──────────────────────────────────────────────────────────

  const debugSession = (e: React.MouseEvent, session: SessionRow) => {
    e.stopPropagation();
    setActiveId(session.id);
    onOpen(session.id, session.familiarId);
    window.requestAnimationFrame(() => {
      window.dispatchEvent(new CustomEvent("cave:debug-open"));
    });
  };

  // ── Delete (two-step confirm) ────────────────────────────────────────────

  const deleteSession = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    setDeletingId(sessionId);
    setError(null);
    try {
      const res = await fetch(`/api/chat/conversation/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({ ok: false }));
      if (!res.ok || !json.ok) {
        setError(json.error ?? "delete failed");
        return;
      }
      setConfirmDeleteId(null);
      setActiveId((current) => (current === sessionId ? null : current));
      onSessionsChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "delete failed");
    } finally {
      setDeletingId(null);
    }
  };

  // ── Pin (Cave-local) + archive (sessions PATCH) ──────────────────────────

  const togglePin = (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    setPinnedIds((prev) => togglePinnedSession(prev, sessionId));
  };

  const setSessionArchived = async (e: React.MouseEvent, sessionId: string, archived: boolean) => {
    e.stopPropagation();
    setArchivingId(sessionId);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived }),
      });
      const json = await res.json().catch(() => ({ ok: false }));
      if (!res.ok || !json.ok) {
        setError(json.error ?? (archived ? "archive failed" : "unarchive failed"));
        return;
      }
      setArchiveNonce((n) => n + 1);
      onSessionsChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "archive failed");
    } finally {
      setArchivingId(null);
    }
  };

  // ── Bulk-select actions (reuse the per-row delete/archive endpoints) ───────
  const toggleSelect = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const exitSelect = () => { setSelectMode(false); setSelectedIds(new Set()); };
  // Visible-aware select-all: acts on the rows currently shown (visibleIds,
  // which excludes rows in a collapsed section).
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const toggleSelectAllVisible = () =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) visibleIds.forEach((id) => next.delete(id));
      else visibleIds.forEach((id) => next.add(id));
      return next;
    });
  const selectedVisibleCount = visibleIds.filter((id) => selectedIds.has(id)).length;

  // Deferred + undoable: hide the selected chats now, fire the DELETEs only
  // after the undo window, refetch once. Undo restores the whole batch.
  const bulkDelete = () => {
    // Only delete rows that are both selected AND currently visible — a section
    // collapsed after selecting must protect its now-hidden chats from deletion.
    const idSet = new Set(visibleIds.filter((id) => selectedIds.has(id)));
    const removed = mine.filter((s) => idSet.has(s.id));
    if (removed.length === 0) return;
    setError(null);
    setActiveId((cur) => (cur && idSet.has(cur) ? null : cur));
    exitSelect();
    scheduleBulkDelete(
      removed,
      `${removed.length} chat${removed.length === 1 ? "" : "s"}`,
      async () => {
        const results = await Promise.all(
          removed.map((s) =>
            fetch(`/api/chat/conversation/${encodeURIComponent(s.id)}`, { method: "DELETE" })
              .then((r) => r.json().catch(() => ({ ok: false })))
              .then((j) => !!j.ok)
              .catch(() => false),
          ),
        );
        if (results.some(Boolean)) onSessionsChanged?.();
        if (results.some((ok) => !ok)) setError("Some chats couldn't be deleted.");
      },
    );
  };

  const bulkArchive = async (archived: boolean) => {
    const ids = visibleIds.filter((id) => selectedIds.has(id));
    if (ids.length === 0) return;
    setBulkBusy(true);
    setError(null);
    const results = await Promise.all(
      ids.map((id) =>
        fetch(`/api/sessions/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ archived }),
        })
          .then((r) => r.json().catch(() => ({ ok: false })))
          .then((j) => !!j.ok)
          .catch(() => false),
      ),
    );
    setBulkBusy(false);
    if (results.some(Boolean)) {
      setArchiveNonce((n) => n + 1);
      onSessionsChanged?.();
    }
    if (results.some((ok) => !ok)) setError(`Some chats couldn't be ${archived ? "archived" : "unarchived"}.`);
    exitSelect();
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full min-w-0">
      {!compact && sidebarOpen && (
      <ChatProjectSidebar
        groups={sidebarGroups}
        selection={effectiveSelection}
        expandedKeys={expandedKeys}
        open={sidebarOpen}
        activeSessionId={activeId}
        onSetOpen={setSidebarOpen}
        onSelect={setSelection}
        onToggleExpanded={(key) => {
          sidebarDefaultExpandedRef.current = false;
          setExpandedKeys((prev) =>
            prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
          );
        }}
        onOpenSession={(s) => {
          setActiveId(s.id);
          onOpen(s.id, s.familiarId);
        }}
        onNewChat={(root) => {
          const group = sidebarGroups.find((g) => g.projectRoot === root);
          onNewChat(root ?? undefined, group?.defaultFamiliarId ?? fallbackFamiliarId);
        }}
      />
      )}
      <section className="chat-list-surface flex h-full min-w-0 flex-1 flex-col bg-[var(--bg-base)] text-[var(--text-primary)]">

      {/* ── Familiar dossier + command strip ── */}
      <header className="familiar-panel-dossier chat-list-dossier border-b border-[var(--border-hairline)] bg-[var(--bg-base)]">
        {/* Brand accent bar */}
        <div className="h-[2px] w-full bg-gradient-to-r from-transparent via-[var(--accent-presence)]/50 to-transparent" />

        {/* Identity row — only in all-familiars mode. With a familiar
            already selected, the sidebar carries its identity; repeating
            the name here is duplicate chrome. */}
        {!familiar && (
        <div className="px-4 pb-0 pt-2">
          <div className="flex min-w-0 items-start gap-2">
            {/* Avatar — larger + glyph-forward */}
            <div className="relative shrink-0">
              <div className="grid h-11 w-11 place-items-center rounded-xl border border-[var(--accent-presence)]/30 bg-[color-mix(in_oklch,var(--accent-presence)_12%,var(--bg-raised))] shadow-[0_0_12px_color-mix(in_oklch,var(--accent-presence)_18%,transparent)]">
                {resolvedFamiliar ? (
                  <FamiliarAvatar familiar={resolvedFamiliar} size="md" />
                ) : (
                  <Icon name="ph:users-three" width={20} className="text-[var(--accent-presence)]" />
                )}
              </div>
              {/* Online/offline dot */}
              <span
                className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[var(--bg-base)] ${daemonRunning ? "bg-[var(--color-success)]" : "bg-[var(--text-muted)]"}`}
                title={daemonRunning ? "online" : "offline"}
              />
            </div>

            {/* Name + subtitle */}
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex min-w-0 items-center gap-2">
                <h2 className="min-w-0 truncate text-[15px] font-semibold text-[var(--text-primary)]">
                  {panelTitle}
                </h2>
              </div>
              <p className="mt-0 truncate text-[11px] leading-snug text-[var(--text-muted)]">
                {panelRole ? (
                  <>
                    <span className="text-[var(--text-secondary)]">{panelRole}</span>
                    {" · "}
                  </>
                ) : null}
                Runtime{" "}
                <span className="font-mono">{panelRuntime}</span>
              </p>
            </div>

            {/* + Session CTA */}
            <button
              type="button"
              onClick={() => onNewChat(undefined, fallbackFamiliarId)}
              disabled={!fallbackFamiliarId}
              className="chat-list-new-button mt-0.5 flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-[var(--accent-presence)] px-3 text-[12px] font-semibold text-[var(--accent-presence-foreground)] shadow-[0_1px_8px_color-mix(in_oklch,var(--accent-presence)_35%,transparent)] transition-all hover:opacity-90 hover:shadow-[0_2px_12px_color-mix(in_oklch,var(--accent-presence)_50%,transparent)] active:scale-95"
            >
              <Icon name="ph:plus-bold" width={11} />
              Session
            </button>
          </div>
        </div>
        )}

        {/* Stats removed for sidepanel optimization */}

        {/* Search + filter row */}
        <div className="mt-3 flex items-center gap-2 px-4 pb-3">
          {!compact && !sidebarOpen && (
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              title="Show sessions"
              aria-label="Show sessions"
              aria-expanded={false}
              className="chat-list-reopen-rail focus-ring hidden h-8 w-8 shrink-0 place-items-center rounded-lg border border-[var(--border-hairline)] text-[var(--text-muted)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-secondary)] lg:grid"
            >
              <Icon name="ph:sidebar-simple" width={14} aria-hidden />
            </button>
          )}
          <label className="chat-list-search-control flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-raised)]/60 px-2.5 transition-colors focus-within:border-[var(--accent-presence)]/50 focus-within:bg-[var(--bg-raised)]">
            <Icon name="ph:magnifying-glass" width={13} className="shrink-0 text-[var(--text-muted)]" />
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape" && search) {
                  e.preventDefault();
                  setSearch("");
                }
              }}
              placeholder="Search sessions…"
              className="min-w-0 flex-1 bg-transparent text-[12px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none"
            />
            {!search && (
              <kbd
                aria-hidden
                className="pointer-events-none shrink-0 rounded border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-1 font-mono text-[10px] leading-tight text-[var(--text-muted)]"
              >
                /
              </kbd>
            )}
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="shrink-0 text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                aria-label="Clear chat search"
              >
                <Icon name="ph:x" width={12} />
              </button>
            )}
          </label>

          <button
            type="button"
            onClick={() => setUnreadsOnly((v) => !v)}
            title={unreadsOnly ? "Show all sessions" : "Show active only"}
            aria-label={unreadsOnly ? "Show all sessions" : "Show active only"}
            className={[
              "chat-list-filter-button focus-ring grid h-8 w-8 shrink-0 place-items-center rounded-lg border transition-colors",
              unreadsOnly
                ? "border-[color-mix(in_oklch,var(--color-success)_40%,transparent)] bg-[color-mix(in_oklch,var(--color-success)_15%,transparent)] text-[var(--color-success)]"
                : "border-[var(--border-hairline)] text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:text-[var(--text-secondary)]",
            ].join(" ")}
          >
            {unreadsOnly
              ? <span className="h-2 w-2 rounded-full bg-[var(--color-success)]" />
              : <Icon name="ph:circle" width={12} />}
          </button>

          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            aria-pressed={showArchived}
            aria-label={showArchived ? "Hide archived sessions" : "Show archived sessions"}
            title={showArchived ? "Hide archived sessions" : "Show archived sessions"}
            className={[
              "chat-list-filter-button focus-ring grid h-8 w-8 shrink-0 place-items-center rounded-lg border transition-colors",
              showArchived
                ? "border-[color-mix(in_oklch,var(--accent-presence)_40%,transparent)] bg-[color-mix(in_oklch,var(--accent-presence)_15%,transparent)] text-[var(--accent-presence)]"
                : "border-[var(--border-hairline)] text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:text-[var(--text-secondary)]",
            ].join(" ")}
          >
            <Icon name="ph:archive" width={12} aria-hidden />
          </button>

          <button
            type="button"
            onClick={() => { setSelectMode((v) => !v); setSelectedIds(new Set()); }}
            aria-pressed={selectMode}
            aria-label={selectMode ? "Exit select mode" : "Select multiple chats"}
            title={selectMode ? "Exit select" : "Select multiple"}
            className={[
              "chat-list-filter-button focus-ring grid h-8 w-8 shrink-0 place-items-center rounded-lg border transition-colors",
              selectMode
                ? "border-[color-mix(in_oklch,var(--accent-presence)_40%,transparent)] bg-[color-mix(in_oklch,var(--accent-presence)_15%,transparent)] text-[var(--accent-presence)]"
                : "border-[var(--border-hairline)] text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:text-[var(--text-secondary)]",
            ].join(" ")}
          >
            <Icon name="ph:list-checks-bold" width={12} aria-hidden />
          </button>

          {/* With the identity row hidden, the + Session CTA lives here */}
          {familiar && (
            <button
              type="button"
              onClick={() => onNewChat(undefined, fallbackFamiliarId)}
              disabled={!fallbackFamiliarId}
              className="chat-list-new-button flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-[var(--accent-presence)] px-3 text-[12px] font-semibold text-[var(--accent-presence-foreground)] shadow-[0_1px_8px_color-mix(in_oklch,var(--accent-presence)_35%,transparent)] transition-all hover:opacity-90 hover:shadow-[0_2px_12px_color-mix(in_oklch,var(--accent-presence)_50%,transparent)] active:scale-95"
            >
              <Icon name="ph:plus-bold" width={11} />
              Session
            </button>
          )}
        </div>
      </header>

      {/* ── Error banner (launch failures — transient, dismissable) ── */}
      {error && (
        <div
          role="alert"
          className="flex items-center justify-between gap-2 border-b border-[color-mix(in_oklch,var(--color-warning)_40%,transparent)] bg-[color-mix(in_oklch,var(--color-warning)_20%,transparent)] px-4 py-1.5 text-xs text-[var(--color-warning)]"
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <Icon name="ph:warning-circle" width={13} className="shrink-0" aria-hidden />
            <span className="min-w-0 truncate">{error}</span>
          </span>
          <button
            type="button"
            onClick={() => setError(null)}
            aria-label="Dismiss error"
            className="focus-ring grid h-5 w-5 shrink-0 place-items-center rounded hover:bg-[var(--bg-raised)]"
          >
            <Icon name="ph:x-bold" width={10} aria-hidden />
          </button>
        </div>
      )}

      {/* ── List ── */}
      <div className="chat-list-scroll min-h-0 flex-1 overflow-y-auto">
        {!sessionsLoaded && !hasAny ? (
          <div aria-hidden className="space-y-px px-4 py-3">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="animate-pulse flex gap-3 px-0 py-3.5">
                <span className="mt-1 block h-2 w-2 rounded-full bg-[var(--bg-hover)]" />
                <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <span className="h-2.5 w-1/4 rounded bg-[var(--bg-hover)] opacity-70" />
                  <span className="h-3 w-1/2 rounded bg-[var(--bg-hover)]" />
                  <span className="h-2.5 w-1/3 rounded bg-[var(--bg-hover)] opacity-50" />
                </span>
              </div>
            ))}
          </div>
        ) : !hasAny ? (
          /* Empty state */
          <div className="flex h-full flex-col justify-between px-4 py-4">
            <EmptyState
              compact
              className="rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-raised)]/35"
              icon="ph:sparkle"
              headline="Ready for a new thread"
              subtitle={
                <>
                  <span>
                    Start a focused chat with {panelTitle}. The thread will inherit the selected
                    familiar's runtime and show up here once it starts.
                  </span>
                  <span className="mt-4 block divide-y divide-[var(--border-hairline)] border-y border-[var(--border-hairline)] text-left">
                    <span className="flex items-center justify-between gap-3 py-2">
                      <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]">Runtime</span>
                      <span className="min-w-0 truncate font-mono text-[11px] text-[var(--text-secondary)]">{panelRuntime}</span>
                    </span>
                    <span className="flex items-center justify-between gap-3 py-2">
                      <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]">Model</span>
                      <span className="min-w-0 truncate font-mono text-[11px] text-[var(--text-secondary)]">{familiar?.model ?? "default"}</span>
                    </span>
                  </span>
                </>
              }
              actions={
                <Button
                  variant="primary"
                  size="sm"
                  leadingIcon="ph:plus-bold"
                  onClick={() => onNewChat(undefined, fallbackFamiliarId)}
                  disabled={!fallbackFamiliarId}
                >
                  Start with context
                </Button>
              }
            />
            <div className="rounded-md border border-dashed border-[var(--border-hairline)] px-3 py-2 text-[11px] leading-5 text-[var(--text-muted)]">
              <span className="font-medium text-[var(--text-secondary)]">Tip:</span> use {keys.mod}F
              to jump back to chat search after this list has history.
            </div>
          </div>
        ) : visibleRows === 0 && !showContentSection ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <Icon name="ph:magnifying-glass" width={20} className="text-[var(--text-muted)]" />
            <p className="text-sm text-[var(--text-muted)]">
              {search.trim() ? `No results for "${search}"` : "No sessions match the current filters"}
            </p>
            <button
              type="button"
              onClick={() => { setSearch(""); setUnreadsOnly(false); setSelection("all"); }}
              className="text-[12px] text-[var(--accent-presence)] hover:underline"
            >
              Clear filters
            </button>
          </div>
        ) : (
          <>
          {selectMode && (
            <div className="flex items-center justify-between gap-2 border-b border-[var(--border-hairline)] bg-[var(--bg-raised)]/40 px-4 py-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={toggleSelectAllVisible}
                  className="focus-ring rounded px-1.5 py-0.5 text-[11px] font-medium text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]"
                >
                  {allVisibleSelected ? "Clear" : "Select all"}
                </button>
                <span className="text-[11px] text-[var(--text-muted)]">{selectedVisibleCount} selected</span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={bulkBusy || selectedVisibleCount === 0}
                  onClick={() => void bulkArchive(!showArchived)}
                  className="focus-ring inline-flex items-center gap-1 rounded border border-[var(--border-hairline)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-50"
                >
                  <Icon name={showArchived ? "ph:tray" : "ph:archive"} width={11} aria-hidden />
                  {showArchived ? "Unarchive" : "Archive"}
                </button>
                <button
                  type="button"
                  disabled={bulkBusy || selectedVisibleCount === 0}
                  onClick={() => void bulkDelete()}
                  className="focus-ring inline-flex items-center gap-1 rounded border border-[color-mix(in_oklch,var(--color-danger)_45%,transparent)] bg-[color-mix(in_oklch,var(--color-danger)_12%,transparent)] px-2 py-0.5 text-[11px] text-[var(--color-danger)] hover:bg-[color-mix(in_oklch,var(--color-danger)_20%,transparent)] disabled:opacity-50"
                >
                  <Icon name="ph:trash" width={11} aria-hidden />
                  {bulkBusy ? "…" : `Delete${selectedVisibleCount ? ` ${selectedVisibleCount}` : ""}`}
                </button>
                <button
                  type="button"
                  onClick={exitSelect}
                  className="focus-ring rounded px-1.5 py-0.5 text-[11px] text-[var(--text-muted)] hover:bg-[var(--bg-hover)]"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          {visibleRows > 0 && (
          <DndContext
            id="chat-list"
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={(event) => handleDragEnd(event, displayIds)}
          >
            <SortableContext items={displayIds} strategy={verticalListSortingStrategy}>
          <ul className="divide-y divide-[var(--border-hairline)]">
            {displayGroups.map(({ projectRoot, sessions: rows, defaultFamiliarId }) => {
              // Flat "All sessions" view (the phone surface): split the list into a
              // counted PINNED section and a counted SESSIONS section, mirroring
              // the desktop rail. firstPinnedIdx/firstRestIdx place each header
              // before its first member, so it reads right regardless of order.
              const pinnedFlags = rows.map((r) => isSessionPinned(pinnedIds, r.id));
              const sessionTitles = disambiguateSessionTitles(rows);
              const pinnedCount = pinnedFlags.filter(Boolean).length;
              const restCount = rows.length - pinnedCount;
              const firstPinnedIdx = pinnedFlags.indexOf(true);
              const firstRestIdx = pinnedFlags.indexOf(false);
              return (
              <li key={projectRoot ?? "__none__"}>
                {/* Project group header */}
                {projectRoot !== null && effectiveSelection === "all" && (
                  <div className="group relative flex items-center gap-1.5 px-4 py-2 bg-[color-mix(in_oklch,var(--bg-base)_86%,var(--foreground)_14%)] border-b border-[var(--border-hairline)]">
                    <Icon name="ph:folder" width={12} className="shrink-0 text-[var(--text-secondary)]" />
                    <span className="truncate text-[12px] font-bold text-[var(--text-primary)] uppercase tracking-wide">
                      {repoName(projectRoot)}
                    </span>
                    <span className="font-mono text-[12px] text-[var(--text-secondary)] opacity-80">{rows.length}</span>
                    <button
                      className="chat-list-group-new touch-always-visible absolute right-2 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center w-5 h-5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-raised)]"
                      onClick={(e) => {
                        e.stopPropagation();
                        onNewChat(projectRoot, defaultFamiliarId ?? fallbackFamiliarId);
                      }}
                      title={`New session in ${repoName(projectRoot)}`}
                      aria-label={`New session in ${repoName(projectRoot)}`}
                    >
                      <Icon name="ph:plus" width="0.7rem" height="0.7rem" />
                    </button>
                  </div>
                )}
                <ul className="divide-y divide-[var(--border-hairline)]">
                  {rows.map((s, idx) => {
                    const st = statusStyle(s.status);
                    const rel = relativeTime(s.updated_at);
                    const project = repoName(s.project_root ?? "");
                    const isActive = activeId === s.id;
                    const rowFamiliar = s.familiarId ? familiarsById.get(s.familiarId) : null;
                    const rowFamiliarName = rowFamiliar?.display_name ?? familiar?.display_name ?? "Familiar";
                    const pinned = isSessionPinned(pinnedIds, s.id);
                    const sectioned = projectRoot === null;
                    const rowCollapsed =
                      sectioned && (pinned ? collapsedSections.has("pinned") : collapsedSections.has("sessions"));
                    const rowName = s.title || s.id;

                    return (
                      <Fragment key={s.id}>
                      {projectRoot === null && idx === firstPinnedIdx ? (
                        <ChatListSection
                          label="Pinned"
                          count={pinnedCount}
                          collapsed={collapsedSections.has("pinned")}
                          onToggle={() => toggleSection("pinned")}
                        />
                      ) : null}
                      {projectRoot === null && idx === firstRestIdx ? (
                        <ChatListSection
                          label="Sessions"
                          count={restCount}
                          collapsed={collapsedSections.has("sessions")}
                          onToggle={() => toggleSection("sessions")}
                        />
                      ) : null}
                      {!rowCollapsed && (
                      <SortableChatListItem id={s.id}>
                        {({ attributes, listeners }) => (
                        <div
                          role={selectMode ? "checkbox" : "button"}
                          aria-checked={selectMode ? selectedIds.has(s.id) : undefined}
                          aria-current={!selectMode && isActive ? "true" : undefined}
                          tabIndex={0}
                          onClick={() => { if (selectMode) { toggleSelect(s.id); return; } setActiveId(s.id); onOpen(s.id, s.familiarId); }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || (selectMode && e.key === " ")) {
                              e.preventDefault();
                              if (selectMode) { toggleSelect(s.id); return; }
                              setActiveId(s.id); onOpen(s.id, s.familiarId);
                            }
                          }}
                          data-selected={selectMode && selectedIds.has(s.id) ? "true" : undefined}
                          data-status={st.label}
                          data-active={isActive ? "true" : undefined}
                          className={[
                            "chat-list-row focus-ring-inset group relative flex cursor-pointer gap-3 px-4 py-3.5 transition-colors",
                            isActive
                              ? "bg-[var(--bg-raised)]"
                              : "hover:bg-[var(--bg-raised)]/50",
                            selectMode && selectedIds.has(s.id) ? "bg-[color-mix(in_oklch,var(--accent-presence)_12%,transparent)]" : "",
                          ].join(" ")}
                        >
                          {/* Active indicator */}
                          {isActive && (
                            <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-8 rounded-r-full bg-[var(--accent-presence)]" />
                          )}

                          {selectMode ? (
                            <span
                              aria-hidden
                              className={`mt-[3px] grid h-4 w-4 shrink-0 place-items-center rounded border ${
                                selectedIds.has(s.id)
                                  ? "border-[var(--accent-presence)] bg-[var(--accent-presence)] text-[var(--accent-presence-foreground)]"
                                  : "border-[var(--border-strong)] text-transparent"
                              }`}
                            >
                              <Icon name="ph:check-bold" width={10} aria-hidden />
                            </span>
                          ) : (
                            <button
                              type="button"
                              {...attributes}
                              {...listeners}
                              onClick={(e) => e.stopPropagation()}
                              title="Drag to reorder"
                              aria-label={`Reorder chat ${rowName}`}
                              className="chat-list-drag-handle touch-always-visible absolute left-0 top-1/2 grid h-6 w-4 -translate-y-1/2 cursor-grab touch-none place-items-center rounded text-[var(--text-muted)] opacity-0 transition-all hover:bg-[var(--bg-raised)] hover:text-[var(--text-secondary)] focus-visible:opacity-100 group-hover:opacity-100"
                            >
                              <Icon name="ph:dots-six-vertical" width={12} aria-hidden />
                            </button>
                          )}

                          {/* Status dot (top-aligned) */}
                          <span className="chat-list-status-dot mt-[5px] shrink-0">
                            <span
                              className={`block h-2 w-2 rounded-full ${st.dot}`}
                              title={st.label}
                            />
                          </span>

                          {/* Content */}
                          <span className="chat-list-row-content flex min-w-0 flex-1 flex-col gap-0.5">
                            {/* Row 1: familiar/project name + timestamp */}
                            <span className="chat-list-row-meta flex items-baseline justify-between gap-2">
                              <span className="chat-list-row-tags flex items-center gap-1.5 min-w-0">
                                <span className="truncate text-[12px] font-medium text-[var(--text-secondary)]">
                                  {project || rowFamiliarName}
                                </span>
                                {s.origin ? <OriginChip origin={s.origin} /> : null}
                                <SessionInitiatorChip initiator={s.initiator} />
                                {s.model ? (
                                  <span
                                    className="chat-list-row-model inline-flex shrink-0 items-center gap-0.5 rounded-[4px] bg-[var(--bg-raised)]/70 px-1 py-px text-[10px] font-medium text-[var(--text-muted)]"
                                    title={`Model: ${s.model}`}
                                  >
                                    <Icon name={modelIcon(s.model)} width={10} aria-hidden />
                                    <span className="truncate">{modelLabel(s.model)}</span>
                                  </span>
                                ) : null}
                              </span>
                              <span className="chat-list-row-time flex shrink-0 items-baseline gap-1 text-[11px] text-[var(--text-muted)]">
                                <span>{chatDate(s.updated_at, dtPrefs)}</span>
                                {isRelativePhrase(rel) ? (
                                  <>
                                    <span aria-hidden>·</span>
                                    <span>{rel}</span>
                                  </>
                                ) : null}
                              </span>
                            </span>

                            {/* Row 2: session title (bold subject line)
                           Running sessions get full white; others are slightly muted
                           — mirrors the unread/read convention in email clients. */}
                            <span className="chat-list-row-title flex min-w-0 items-center gap-1.5">
                              {pinned && (
                                <Icon
                                  name="ph:bookmark-simple-fill"
                                  width={11}
                                  className="shrink-0 text-[var(--accent-presence)]"
                                  aria-hidden
                                />
                              )}
                              <span className={[
                                "truncate text-[13px] font-semibold",
                                s.status === "running"
                                  ? "text-white"
                                  : "text-[var(--text-primary)]",
                              ].join(" ")}>
                                {stripLeadingTrailingEmoji((sessionTitles.get(s.id) ?? s.title) || "(untitled chat)")}
                              </span>
                            </span>

                            {/* Row 3: status preview */}
                            <span className={`chat-list-row-preview truncate text-[12px] ${st.preview}`}>
                              {s.archived_at ? <span className="text-[var(--text-muted)]">Archived · </span> : null}
                              {st.label === "running"
                                ? "Active now…"
                                : st.label === "failed"
                                  ? "Ended with an error"
                                  : st.label === "queued"
                                    ? "Waiting to start"
                                    : st.label === "paused"
                                      ? "Paused"
                                      : project
                                        ? `${rowFamiliarName} · ${project}`
                                        : `${rowFamiliarName}`}
                            </span>
                          </span>

                          {!selectMode && (confirmDeleteId === s.id ? (
                            /* Inline delete confirmation — replaces row actions until resolved */
                            <span
                              className="chat-list-row-confirm flex shrink-0 items-center gap-1.5 self-center"
                              onClick={(e) => e.stopPropagation()}
                              onKeyDown={(e) => e.stopPropagation()}
                              role="group"
                              aria-label="Confirm chat deletion"
                            >
                              <span className="text-[11px] font-medium text-[var(--color-danger)]">Delete chat?</span>
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(null); }}
                                className="focus-ring rounded border border-[var(--border-hairline)] px-2 py-0.5 text-[10px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-raised)]"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                onClick={(e) => void deleteSession(e, s.id)}
                                disabled={deletingId === s.id}
                                aria-label="Confirm delete chat"
                                className="focus-ring inline-flex items-center gap-1 rounded border border-[color-mix(in_oklch,var(--color-danger)_45%,transparent)] bg-[color-mix(in_oklch,var(--color-danger)_18%,transparent)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-danger)] transition-colors hover:bg-[color-mix(in_oklch,var(--color-danger)_30%,transparent)] disabled:opacity-40"
                              >
                                <Icon name="ph:trash" width={10} aria-hidden />
                                {deletingId === s.id ? "…" : "Delete"}
                              </button>
                            </span>
                          ) : (
                            /* Row actions — pin (Cave-local), archive (PATCH), debug, delete.
                               Keyboard Enter on a button must not bubble into the
                               row's open handler. */
                            <span
                              className="chat-list-row-actions flex shrink-0 items-center gap-1 self-center"
                              onKeyDown={(e) => e.stopPropagation()}
                            >
                              <button
                                type="button"
                                onClick={(e) => togglePin(e, s.id)}
                                title={pinned ? "Unpin chat" : "Pin chat"}
                                aria-label={`${pinned ? "Unpin" : "Pin"} chat ${rowName}`}
                                aria-pressed={pinned}
                                className={[
                                  "touch-always-visible inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-[var(--border-hairline)] transition-all hover:border-[color-mix(in_oklch,var(--accent-presence)_45%,transparent)] hover:bg-[color-mix(in_oklch,var(--accent-presence)_14%,transparent)] hover:text-[var(--accent-presence)] focus-visible:opacity-100 group-hover:opacity-100",
                                  pinned
                                    ? "text-[var(--accent-presence)] opacity-100"
                                    : "text-[var(--text-muted)] opacity-0",
                                ].join(" ")}
                              >
                                <Icon name={pinned ? "ph:bookmark-simple-fill" : "ph:bookmark-simple"} width={12} aria-hidden />
                              </button>
                              <button
                                type="button"
                                onClick={(e) => void setSessionArchived(e, s.id, !s.archived_at)}
                                disabled={archivingId !== null}
                                title={s.archived_at ? "Unarchive chat" : "Archive chat"}
                                aria-label={`${s.archived_at ? "Unarchive" : "Archive"} chat ${rowName}`}
                                className="touch-always-visible inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-[var(--border-hairline)] text-[var(--text-muted)] opacity-0 transition-all hover:border-[var(--border-strong)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-secondary)] focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-40"
                              >
                                <Icon name={s.archived_at ? "ph:arrow-counter-clockwise" : "ph:archive"} width={12} aria-hidden />
                              </button>
                              <button
                                type="button"
                                onClick={(e) => debugSession(e, s)}
                                title="Debug chat"
                                aria-label={`Debug chat ${rowName}`}
                                className="touch-always-visible inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-[var(--border-hairline)] text-[var(--text-muted)] opacity-0 transition-all hover:border-[var(--border-strong)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-secondary)] focus-visible:opacity-100 group-hover:opacity-100"
                              >
                                <Icon name="ph:bug-bold" width={12} aria-hidden />
                              </button>
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(s.id); }}
                                title="Delete chat"
                                aria-label={`Delete chat ${s.title || s.id}`}
                                className="touch-always-visible inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-[var(--border-hairline)] text-[var(--text-muted)] opacity-0 transition-all hover:border-[color-mix(in_oklch,var(--color-danger)_45%,transparent)] hover:bg-[color-mix(in_oklch,var(--color-danger)_14%,transparent)] hover:text-[var(--color-danger)] focus-visible:opacity-100 group-hover:opacity-100"
                              >
                                <Icon name="ph:trash" width={12} aria-hidden />
                              </button>
                            </span>
                          ))}
                        </div>
                        )}
                      </SortableChatListItem>
                      )}
                      </Fragment>
                    );
                  })}
                </ul>
              </li>
              );
            })}
          </ul>
            </SortableContext>
          </DndContext>
          )}

          {/* ── In conversations (CHAT-D9-02) — body matches for the query.
                 Title-filtered rows above stay primary; sessions already
                 visible there are deduped out of this section. ── */}
          {showContentSection && (
            <section aria-label="Matches in conversation content">
              <div className="flex items-center gap-1.5 border-y border-[var(--border-hairline)] bg-[color-mix(in_oklch,var(--bg-base)_86%,var(--foreground)_14%)] px-4 py-2">
                <Icon name="ph:chats" width={12} className="shrink-0 text-[var(--text-secondary)]" />
                <span className="truncate text-[12px] font-bold uppercase tracking-wide text-[var(--text-primary)]">
                  In conversations
                </span>
              </div>
              {contentLoading && contentMatches.length === 0 ? (
                <div aria-hidden className="space-y-px px-4 py-2">
                  {[0, 1].map((i) => (
                    <div key={i} className="animate-pulse flex flex-col gap-1.5 py-2.5">
                      <span className="h-3 w-1/2 rounded bg-[var(--bg-hover)]" />
                      <span className="h-2.5 w-3/4 rounded bg-[var(--bg-hover)] opacity-60" />
                    </div>
                  ))}
                </div>
              ) : (
                <ul className="divide-y divide-[var(--border-hairline)]">
                  {contentMatches.map(({ hit, row }) => (
                    <li key={hit.sessionId}>
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => { setActiveId(hit.sessionId); onOpen(hit.sessionId, row.familiarId, search.trim()); }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") { setActiveId(hit.sessionId); onOpen(hit.sessionId, row.familiarId, search.trim()); }
                        }}
                        className="focus-ring-inset group flex cursor-pointer flex-col gap-0.5 px-4 py-2.5 transition-colors hover:bg-[var(--bg-raised)]/50"
                      >
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="min-w-0 truncate text-[13px] font-semibold text-[var(--text-primary)]">
                            {stripLeadingTrailingEmoji(row.title || hit.title || "(untitled chat)")}
                          </span>
                          <span className="shrink-0 text-[11px] text-[var(--text-muted)]">
                            {hit.matchCount === 1 ? "1 match" : `${hit.matchCount} matches`}
                          </span>
                        </span>
                        <span className="truncate text-[12px] text-[var(--text-muted)]">
                          <HighlightedSnippet snippet={hit.snippet} query={search.trim()} />
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
          </>
        )}
      </div>

      {/* ── Footer ── */}
      <footer className="chat-list-footer border-t border-[var(--border-hairline)] px-4 py-2 text-[10px] text-[var(--text-muted)]">
        {keys.enter} open · {keys.mod}K palette · / commands in chat
      </footer>
      </section>
      {deletePending ? (
        <UndoToast
          key={deletePending.id}
          message={`Deleted ${deletePending.label}`}
          undoAriaLabel="Undo delete"
          onUndo={undoBulkDelete}
          onDismiss={commitBulkDelete}
        />
      ) : null}
    </div>
  );
}
