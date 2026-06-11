"use client";

import { useMemo, useState, useEffect, useRef } from "react";
import type { Familiar, SessionRow } from "@/lib/types";
import { stripLeadingTrailingEmoji } from "@/lib/cave-chat-titles";
import { Icon } from "@/lib/icon";
import { useKeySymbols } from "@/lib/platform-keys";
import { useIsMobile } from "@/lib/use-viewport";
import { OriginChip } from "@/components/ui/origin-chip";
import { FamiliarAvatar } from "@/components/familiar-avatar";
import { useResolvedFamiliars } from "@/lib/familiar-resolve";
import {
  deriveChatProjectGroups,
  filterVisibleChatSessions,
} from "@/lib/chat-projects";
import { ChatProjectSidebar } from "@/components/chat-project-sidebar";
import {
  applyProjectScope,
  normalizeSelection,
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

type Props = {
  familiar: Familiar | null;
  familiars?: Familiar[];
  sessions: SessionRow[];
  daemonRunning?: boolean;
  onOpen: (sessionId: string, familiarId?: string | null) => void;
  onNewChat: (projectRoot?: string, familiarId?: string | null) => void;
  onSessionsChanged?: () => void;
  /** false while the workspace's first /api/sessions/list fetch is in
   *  flight — gates the list on a skeleton instead of flashing the
   *  "no chats yet" empty state. Defaults true for callers that load
   *  sessions before mounting. */
  sessionsLoaded?: boolean;
};

function age(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  if (h < 48) return "Yesterday";
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} days ago`;
  if (d < 14) return "1 week ago";
  if (d < 21) return "2 weeks ago";
  return `${Math.floor(d / 7)} weeks ago`;
}

function chatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

/** Repo name — last non-empty path segment. */
function repoName(p: string): string {
  if (!p) return "";
  const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? p;
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

// ── Main component ────────────────────────────────────────────────────────────

export function ChatList({ familiar, familiars = [], sessions, daemonRunning, onOpen, onNewChat, onSessionsChanged, sessionsLoaded = true }: Props) {
  const [error, setError] = useState<string | null>(null);
  // Two-step delete: first trash click arms the row (inline Cancel/Delete
  // confirm replaces the row actions); only the explicit Delete commits.
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [unreadsOnly, setUnreadsOnly] = useState(false);
  // Pins are Cave-local UI state (localStorage), same idiom as the project
  // sidebar persistence below — the daemon never learns about them.
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);
  // Archived rows are excluded server-side by /api/sessions/list; the toggle
  // opts into them with its own includeArchived fetch (the workspace's list
  // poll stays archive-free).
  const [showArchived, setShowArchived] = useState(false);
  const [archivedRows, setArchivedRows] = useState<SessionRow[]>([]);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [archiveNonce, setArchiveNonce] = useState(0);
  // Content search (CHAT-D9-02) — hits from /api/chat/search for the current
  // query; cleared the moment the query drops below the 2-char threshold.
  const [contentHits, setContentHits] = useState<ContentSearchHit[]>([]);
  const [contentLoading, setContentLoading] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [selection, setSelection] = useState<ProjectSelection>("all");
  const [sidebarHydrated, setSidebarHydrated] = useState(false);
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

  // Focus search on Cmd+F / Ctrl+F
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
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
    setSidebarOpen(readPersisted<unknown>(PROJECT_SIDEBAR_KEYS.open, true) !== false);
    const storedExpanded = readPersisted<unknown>(PROJECT_SIDEBAR_KEYS.expanded, []);
    setExpandedKeys(
      Array.isArray(storedExpanded)
        ? storedExpanded.filter((k): k is string => typeof k === "string")
        : [],
    );
    const storedSelection = readPersisted<unknown>(PROJECT_SIDEBAR_KEYS.selected, "all");
    setSelection(typeof storedSelection === "string" ? storedSelection : "all");
    setPinnedIds(readPinnedSessions());
    setSidebarHydrated(true);
  }, []);
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
        const res = await fetch("/api/sessions/list?includeArchived=1", { cache: "no-store" });
        const json = await res.json().catch(() => ({ ok: false }));
        if (cancelled || !json.ok || !Array.isArray(json.sessions)) return;
        setArchivedRows((json.sessions as SessionRow[]).filter((s) => s.archived_at));
      } catch {
        // keep whatever archived rows we already have
      }
    })();
    return () => { cancelled = true; };
  }, [showArchived, archiveNonce]);

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
        if (!controller.signal.aborted) setContentLoading(false);
      }
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [search]);

  // ── Data: filter ──────────────────────────────────────────────────────────

  const mine = useMemo(() => {
    let rows = sessions;
    if (showArchived && archivedRows.length > 0) {
      const seen = new Set(sessions.map((s) => s.id));
      rows = [...sessions, ...archivedRows.filter((s) => !seen.has(s.id))];
    }
    return filterVisibleChatSessions(rows, familiar?.id ?? null);
  }, [sessions, showArchived, archivedRows, familiar?.id]);

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
  const runningCount = mine.filter((s) => s.status === "running").length;
  const projectCount = new Set(mine.map((s) => s.project_root).filter(Boolean)).size;

  // ── Grouped by project_root ──────────────────────────────────────────────

  const grouped = useMemo(() => {
    return deriveChatProjectGroups(filtered);
  }, [filtered]);

  // Sidebar tree builds from familiar-scoped sessions BEFORE search/unreads,
  // so it stays stable while typing. The persisted selection is normalized
  // every render: stale projects degrade to "all" silently. Below lg the
  // sidebar is hidden, so a persisted project selection must not scope the
  // list there — no affordance would exist to unscope it.
  const sidebarGroups = useMemo(() => deriveChatProjectGroups(mine), [mine]);
  const effectiveSelection = useMemo(
    () => normalizeSelection(isMobile ? "all" : selection, sidebarGroups),
    [isMobile, selection, sidebarGroups],
  );
  const scopedGroups = useMemo(
    () => applyProjectScope(grouped, effectiveSelection),
    [grouped, effectiveSelection],
  );
  // Pinned rows float to the top of their project group; recency order is
  // preserved inside both partitions.
  const displayGroups = useMemo(
    () => sortPinnedFirst(scopedGroups, pinnedIds),
    [scopedGroups, pinnedIds],
  );
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

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full min-w-0">
      <ChatProjectSidebar
        groups={sidebarGroups}
        selection={effectiveSelection}
        expandedKeys={expandedKeys}
        open={sidebarOpen}
        activeSessionId={activeId}
        onSetOpen={setSidebarOpen}
        onSelect={setSelection}
        onToggleExpanded={(key) =>
          setExpandedKeys((prev) =>
            prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
          )
        }
        onOpenSession={(s) => {
          setActiveId(s.id);
          onOpen(s.id, s.familiarId);
        }}
        onNewChat={(root) => {
          const group = sidebarGroups.find((g) => g.projectRoot === root);
          onNewChat(root ?? undefined, group?.defaultFamiliarId ?? fallbackFamiliarId);
        }}
      />
      <section className="chat-list-surface flex h-full min-w-0 flex-1 flex-col bg-[var(--bg-base)] text-[var(--text-primary)]">

      {/* ── Agent dossier + command strip ── */}
      <header className="agent-panel-dossier chat-list-dossier border-b border-[var(--border-hairline)] bg-[var(--bg-base)]">
        {/* Brand accent bar */}
        <div className="h-[2px] w-full bg-gradient-to-r from-transparent via-[var(--accent-presence)]/50 to-transparent" />

        {/* Identity row — only in all-familiars mode. With a familiar
            already selected, the sidebar carries its identity; repeating
            the name here is duplicate chrome. */}
        {!familiar && (
        <div className="px-4 pb-0 pt-4">
          <div className="flex min-w-0 items-start gap-3">
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
              <p className="mt-0.5 truncate text-[11px] leading-snug text-[var(--text-muted)]">
                {panelRole ? (
                  <>
                    <span className="text-[var(--text-secondary)]">{panelRole}</span>
                    {" · "}
                  </>
                ) : null}
                Agent runtime{" "}
                <span className="font-mono">{panelRuntime}</span>
              </p>
            </div>

            {/* + Chat CTA */}
            <button
              type="button"
              onClick={() => onNewChat(undefined, fallbackFamiliarId)}
              disabled={!fallbackFamiliarId}
              className="mt-0.5 flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-[var(--accent-presence)] px-3 text-[12px] font-semibold text-white shadow-[0_1px_8px_color-mix(in_oklch,var(--accent-presence)_35%,transparent)] transition-all hover:opacity-90 hover:shadow-[0_2px_12px_color-mix(in_oklch,var(--accent-presence)_50%,transparent)] active:scale-95"
            >
              <Icon name="ph:plus-bold" width={11} />
              Chat
            </button>
          </div>
        </div>
        )}

        {/* Stats row */}
        <div className={`${familiar ? "pt-4" : "mt-3"} grid grid-cols-3 gap-1.5 px-4`}>
          <div className="group rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-raised)]/30 px-2.5 py-2 transition-colors hover:border-[var(--accent-presence)]/25 hover:bg-[var(--bg-raised)]/60">
            <div className="flex items-center gap-1.5">
              <Icon name="ph:chats" width={11} className="text-[var(--text-muted)]" />
              <p className="text-[9px] font-medium uppercase tracking-[0.1em] text-[var(--text-muted)]">Chats</p>
            </div>
            <p className="mt-1 font-mono text-[15px] font-semibold text-[var(--text-primary)]">{mine.length}</p>
          </div>
          <div className="group rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-raised)]/30 px-2.5 py-2 transition-colors hover:border-[var(--accent-presence)]/25 hover:bg-[var(--bg-raised)]/60">
            <div className="flex items-center gap-1.5">
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${runningCount > 0 ? "animate-pulse bg-[var(--color-success)]" : "bg-[var(--text-muted)]"}`} />
              <p className="text-[9px] font-medium uppercase tracking-[0.1em] text-[var(--text-muted)]">Live</p>
            </div>
            <p className={`mt-1 font-mono text-[15px] font-semibold ${runningCount > 0 ? "text-[var(--color-success)]" : "text-[var(--text-primary)]"}`}>{runningCount}</p>
          </div>
          <div className="group rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-raised)]/30 px-2.5 py-2 transition-colors hover:border-[var(--accent-presence)]/25 hover:bg-[var(--bg-raised)]/60">
            <div className="flex items-center gap-1.5">
              <Icon name="ph:folder" width={11} className="text-[var(--text-muted)]" />
              <p className="text-[9px] font-medium uppercase tracking-[0.1em] text-[var(--text-muted)]">Projects</p>
            </div>
            <p className="mt-1 font-mono text-[15px] font-semibold text-[var(--text-primary)]">{projectCount}</p>
          </div>
        </div>

        {/* Search + filter row */}
        <div className="mt-3 flex items-center gap-2 px-4 pb-3">
          <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-raised)]/60 px-2.5 transition-colors focus-within:border-[var(--accent-presence)]/50 focus-within:bg-[var(--bg-raised)]">
            <Icon name="ph:magnifying-glass" width={13} className="shrink-0 text-[var(--text-muted)]" />
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search chats…"
              className="min-w-0 flex-1 bg-transparent text-[12px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none"
            />
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
            className={[
              "focus-ring flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-medium transition-colors",
              unreadsOnly
                ? "border-[color-mix(in_oklch,var(--color-success)_40%,transparent)] bg-[color-mix(in_oklch,var(--color-success)_15%,transparent)] text-[var(--color-success)]"
                : "border-[var(--border-hairline)] text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:text-[var(--text-secondary)]",
            ].join(" ")}
          >
            {unreadsOnly
              ? <span className="h-2 w-2 rounded-full bg-[var(--color-success)]" />
              : <Icon name="ph:circle" width={12} />}
            Unreads
          </button>

          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            aria-pressed={showArchived}
            aria-label={showArchived ? "Hide archived chats" : "Show archived chats"}
            title={showArchived ? "Hide archived chats" : "Show archived chats"}
            className={[
              "focus-ring flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-medium transition-colors",
              showArchived
                ? "border-[color-mix(in_oklch,var(--accent-presence)_40%,transparent)] bg-[color-mix(in_oklch,var(--accent-presence)_15%,transparent)] text-[var(--accent-presence)]"
                : "border-[var(--border-hairline)] text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:text-[var(--text-secondary)]",
            ].join(" ")}
          >
            <Icon name="ph:archive" width={12} aria-hidden />
            Archived
          </button>

          {/* With the identity row hidden, the + Chat CTA lives here */}
          {familiar && (
            <button
              type="button"
              onClick={() => onNewChat(undefined, fallbackFamiliarId)}
              disabled={!fallbackFamiliarId}
              className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-[var(--accent-presence)] px-3 text-[12px] font-semibold text-white shadow-[0_1px_8px_color-mix(in_oklch,var(--accent-presence)_35%,transparent)] transition-all hover:opacity-90 hover:shadow-[0_2px_12px_color-mix(in_oklch,var(--accent-presence)_50%,transparent)] active:scale-95"
            >
              <Icon name="ph:plus-bold" width={11} />
              Chat
            </button>
          )}
        </div>
      </header>

      {/* ── Error banner (launch failures — transient, dismissable) ── */}
      {error && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 border-b border-[color-mix(in_oklch,var(--color-warning)_40%,transparent)] bg-[color-mix(in_oklch,var(--color-warning)_20%,transparent)] px-4 py-1.5 text-xs text-[var(--color-warning)]"
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
            <div className="rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-raised)]/35 p-4">
              <div className="flex items-start gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] text-[var(--text-muted)]">
                  <Icon name="ph:sparkle" width={17} aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-[var(--text-primary)]">Ready for a new thread</p>
                  <p className="mt-1 text-[12px] leading-5 text-[var(--text-muted)]">
                    Start a focused chat with {panelTitle}. The thread will inherit the selected
                    familiar's runtime and show up here once it starts.
                  </p>
                </div>
              </div>
              <div className="mt-4 divide-y divide-[var(--border-hairline)] border-y border-[var(--border-hairline)] text-left">
                <div className="flex items-center justify-between gap-3 py-2">
                  <p className="text-[9px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]">Harness</p>
                  <p className="min-w-0 truncate font-mono text-[11px] text-[var(--text-secondary)]">{panelRuntime}</p>
                </div>
                <div className="flex items-center justify-between gap-3 py-2">
                  <p className="text-[9px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]">Model</p>
                  <p className="min-w-0 truncate font-mono text-[11px] text-[var(--text-secondary)]">{familiar?.model ?? "default"}</p>
                </div>
              </div>
              <button
                onClick={() => onNewChat(undefined, fallbackFamiliarId)}
                disabled={!fallbackFamiliarId}
                className="mt-4 flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-[var(--accent-presence)] px-3 text-[12px] font-medium text-white transition-opacity hover:opacity-85"
              >
                <Icon name="ph:plus-bold" width={12} />
                Start with context
              </button>
            </div>
            <div className="rounded-md border border-dashed border-[var(--border-hairline)] px-3 py-2 text-[11px] leading-5 text-[var(--text-muted)]">
              <span className="font-medium text-[var(--text-secondary)]">Tip:</span> use {keys.mod}F
              to jump back to chat search after this list has history.
            </div>
          </div>
        ) : visibleRows === 0 && !showContentSection ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <Icon name="ph:magnifying-glass" width={20} className="text-[var(--text-muted)]" />
            <p className="text-sm text-[var(--text-muted)]">
              {search.trim() ? `No results for "${search}"` : "No chats match the current filters"}
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
          {visibleRows > 0 && (
          <ul className="divide-y divide-[var(--border-hairline)]">
            {displayGroups.map(({ projectRoot, sessions: rows, defaultFamiliarId }) => (
              <li key={projectRoot ?? "__none__"}>
                {/* Project group header */}
                {projectRoot !== null && effectiveSelection === "all" && (
                  <div className="group relative flex items-center gap-1.5 px-4 py-1.5 bg-[var(--bg-raised)]/30 border-b border-[var(--border-hairline)]">
                    <Icon name="ph:folder" width={12} className="shrink-0 text-[var(--text-muted)]" />
                    <span className="truncate text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wide">
                      {repoName(projectRoot)}
                    </span>
                    <button
                      className="touch-always-visible absolute right-2 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center w-5 h-5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-raised)]"
                      onClick={(e) => {
                        e.stopPropagation();
                        onNewChat(projectRoot, defaultFamiliarId ?? fallbackFamiliarId);
                      }}
                      title={`New chat in ${repoName(projectRoot)}`}
                      aria-label={`New chat in ${repoName(projectRoot)}`}
                    >
                      <Icon name="ph:plus" width="0.7rem" height="0.7rem" />
                    </button>
                  </div>
                )}
                <ul className="divide-y divide-[var(--border-hairline)]">
                  {rows.map((s) => {
                    const st = statusStyle(s.status);
                    const project = repoName(s.project_root ?? "");
                    const isActive = activeId === s.id;
                    const rowFamiliar = s.familiarId ? familiarsById.get(s.familiarId) : null;
                    const rowFamiliarName = rowFamiliar?.display_name ?? familiar?.display_name ?? "Familiar";
                    const pinned = isSessionPinned(pinnedIds, s.id);
                    const rowName = s.title || s.id;

                    return (
                      <li key={s.id}>
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() => { setActiveId(s.id); onOpen(s.id, s.familiarId); }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") { setActiveId(s.id); onOpen(s.id, s.familiarId); }
                          }}
                          className={[
                            "focus-ring-inset group relative flex cursor-pointer gap-3 px-4 py-3.5 transition-colors",
                            isActive
                              ? "bg-[var(--bg-raised)]"
                              : "hover:bg-[var(--bg-raised)]/50",
                          ].join(" ")}
                        >
                          {/* Active indicator */}
                          {isActive && (
                            <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-8 rounded-r-full bg-[var(--accent-presence)]" />
                          )}

                          {/* Status dot (top-aligned) */}
                          <span className="mt-[5px] shrink-0">
                            <span
                              className={`block h-2 w-2 rounded-full ${st.dot}`}
                              title={st.label}
                            />
                          </span>

                          {/* Content */}
                          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                            {/* Row 1: familiar/project name + timestamp */}
                            <span className="flex items-baseline justify-between gap-2">
                              <span className="flex items-center gap-1.5 min-w-0">
                                <span className="truncate text-[12px] font-medium text-[var(--text-secondary)]">
                                  {project || rowFamiliarName}
                                </span>
                                {s.origin ? <OriginChip origin={s.origin} /> : null}
                              </span>
                              <span className="flex shrink-0 items-baseline gap-1 text-[11px] text-[var(--text-muted)]">
                                <span>{chatDate(s.updated_at)}</span>
                                <span aria-hidden>·</span>
                                <span>{age(s.updated_at)}</span>
                              </span>
                            </span>

                            {/* Row 2: session title (bold subject line)
                           Running sessions get full white; others are slightly muted
                           — mirrors the unread/read convention in email clients. */}
                            <span className="flex min-w-0 items-center gap-1.5">
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
                                {stripLeadingTrailingEmoji(s.title || "(untitled chat)")}
                              </span>
                            </span>

                            {/* Row 3: status preview */}
                            <span className={`truncate text-[12px] ${st.preview}`}>
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

                          {confirmDeleteId === s.id ? (
                            /* Inline delete confirmation — replaces row actions until resolved */
                            <span
                              className="flex shrink-0 items-center gap-1.5 self-center"
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
                            /* Row actions — pin (Cave-local), archive (PATCH), delete.
                               Keyboard Enter on a button must not bubble into the
                               row's open handler. */
                            <span
                              className="flex shrink-0 items-center gap-1 self-center"
                              onKeyDown={(e) => e.stopPropagation()}
                            >
                              <button
                                type="button"
                                onClick={(e) => togglePin(e, s.id)}
                                title={pinned ? "Unpin chat" : "Pin chat"}
                                aria-label={`${pinned ? "Unpin" : "Pin"} chat ${rowName}`}
                                aria-pressed={pinned}
                                className={[
                                  "touch-always-visible shrink-0 rounded border border-[var(--border-hairline)] px-1.5 py-0.5 transition-all hover:border-[color-mix(in_oklch,var(--accent-presence)_45%,transparent)] hover:bg-[color-mix(in_oklch,var(--accent-presence)_14%,transparent)] hover:text-[var(--accent-presence)] focus-visible:opacity-100 group-hover:opacity-100",
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
                                disabled={archivingId === s.id}
                                title={s.archived_at ? "Unarchive chat" : "Archive chat"}
                                aria-label={`${s.archived_at ? "Unarchive" : "Archive"} chat ${rowName}`}
                                className="touch-always-visible shrink-0 rounded border border-[var(--border-hairline)] px-1.5 py-0.5 text-[var(--text-muted)] opacity-0 transition-all hover:border-[var(--border-strong)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-secondary)] focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-40"
                              >
                                <Icon name={s.archived_at ? "ph:arrow-counter-clockwise" : "ph:archive"} width={12} aria-hidden />
                              </button>
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(s.id); }}
                                title="Delete chat"
                                aria-label={`Delete chat ${s.title || s.id}`}
                                className="touch-always-visible shrink-0 rounded border border-[var(--border-hairline)] px-1.5 py-0.5 text-[var(--text-muted)] opacity-0 transition-all hover:border-[color-mix(in_oklch,var(--color-danger)_45%,transparent)] hover:bg-[color-mix(in_oklch,var(--color-danger)_14%,transparent)] hover:text-[var(--color-danger)] focus-visible:opacity-100 group-hover:opacity-100"
                              >
                                <Icon name="ph:trash" width={12} aria-hidden />
                              </button>
                            </span>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
          )}

          {/* ── In conversations (CHAT-D9-02) — body matches for the query.
                 Title-filtered rows above stay primary; sessions already
                 visible there are deduped out of this section. ── */}
          {showContentSection && (
            <section aria-label="Matches in conversation content">
              <div className="flex items-center gap-1.5 border-y border-[var(--border-hairline)] bg-[var(--bg-raised)]/30 px-4 py-1.5">
                <Icon name="ph:chats" width={12} className="shrink-0 text-[var(--text-muted)]" />
                <span className="truncate text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
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
                        onClick={() => { setActiveId(hit.sessionId); onOpen(hit.sessionId, row.familiarId); }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") { setActiveId(hit.sessionId); onOpen(hit.sessionId, row.familiarId); }
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
    </div>
  );
}
