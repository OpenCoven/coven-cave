"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon, type IconName } from "@/lib/icon";
import type { Familiar, SessionRow } from "@/lib/types";
import { AgentsMemoryView, MemoryFilesList } from "@/components/agents-memory-view";
import {
  buildAgentCardStats,
  type AgentCardStats,
  type CovenMemoryEntry,
} from "@/components/agents-view-stats";

type FileMemoryEntry = {
  root: string;
  rootLabel: string;
  relPath: string;
  fullPath: string;
  size: number;
  modified: string;
};

type CovenMemoryResponse =
  | { ok: true; entries: CovenMemoryEntry[] }
  | { ok: false; entries?: CovenMemoryEntry[]; error?: string };

type FileMemoryResponse =
  | { ok: true; entries: FileMemoryEntry[] }
  | { ok: false; entries?: FileMemoryEntry[]; error?: string };

type ViewMode = "roster" | "detail" | "global-memory";

const LAST_SELECTED_KEY = "cave:agents.lastSelected";

type AgentsViewProps = {
  familiars: Familiar[];
  sessions: SessionRow[];
  daemonRunning: boolean;
  responseNeeded: Set<string>;
  onStartChat: (familiarId: string) => void;
  onOpenSession: (sessionId: string, familiarId?: string | null) => void;
  onOpenMemoryFile: (path: string) => void;
  onOpenOnboarding: () => void;
};

function age(iso: string | null | undefined): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "";
  if (ms < 60_000) return "just now";
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function familiarMatches(familiar: Familiar, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    familiar.display_name.toLowerCase().includes(q) ||
    (familiar.role ?? "").toLowerCase().includes(q) ||
    (familiar.harness ?? "").toLowerCase().includes(q) ||
    familiar.id.toLowerCase().includes(q)
  );
}

export function AgentsView({
  familiars,
  sessions,
  daemonRunning,
  responseNeeded,
  onStartChat,
  onOpenSession,
  onOpenMemoryFile,
  onOpenOnboarding,
}: AgentsViewProps) {
  const [covenEntries, setCovenEntries] = useState<CovenMemoryEntry[]>([]);
  const [fileEntries, setFileEntries] = useState<FileMemoryEntry[]>([]);
  const [memoryError, setMemoryError] = useState<string | null>(null);
  const [memoryLoaded, setMemoryLoaded] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedFamiliarId, setSelectedFamiliarId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(LAST_SELECTED_KEY);
  });
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (typeof window === "undefined") return "roster";
    return window.localStorage.getItem(LAST_SELECTED_KEY) ? "detail" : "roster";
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (selectedFamiliarId) window.localStorage.setItem(LAST_SELECTED_KEY, selectedFamiliarId);
    else window.localStorage.removeItem(LAST_SELECTED_KEY);
  }, [selectedFamiliarId]);

  const loadMemory = useCallback(async () => {
    try {
      const [covenRes, fileRes] = await Promise.all([
        fetch("/api/coven-memory", { cache: "no-store" }),
        fetch("/api/memory", { cache: "no-store" }),
      ]);
      const covenJson = (await covenRes.json()) as CovenMemoryResponse;
      const fileJson = (await fileRes.json()) as FileMemoryResponse;
      if (covenJson.ok) setCovenEntries(covenJson.entries ?? []);
      if (fileJson.ok) setFileEntries(fileJson.entries ?? []);
      const errors = [
        covenJson.ok ? null : covenJson.error ?? "Coven memory unavailable",
        fileJson.ok ? null : fileJson.error ?? "Memory files unavailable",
      ].filter(Boolean);
      setMemoryError(errors.length > 0 ? errors.join(" · ") : null);
    } catch (err) {
      setMemoryError(err instanceof Error ? err.message : "memory unavailable");
    } finally {
      setMemoryLoaded(true);
    }
  }, []);

  useEffect(() => {
    void loadMemory();
    const t = setInterval(loadMemory, 30_000);
    return () => clearInterval(t);
  }, [loadMemory]);

  const stats = useMemo(
    () => buildAgentCardStats({ familiars, sessions, covenEntries }),
    [familiars, sessions, covenEntries],
  );

  const visibleFamiliars = useMemo(
    () => familiars.filter((f) => familiarMatches(f, query)),
    [familiars, query],
  );

  const selectedFamiliar = useMemo(
    () => familiars.find((f) => f.id === selectedFamiliarId) ?? null,
    [familiars, selectedFamiliarId],
  );

  useEffect(() => {
    if (selectedFamiliarId && !selectedFamiliar) {
      setSelectedFamiliarId(null);
      setViewMode("roster");
    }
  }, [selectedFamiliar, selectedFamiliarId]);

  const enterDetail = useCallback((id: string) => {
    setSelectedFamiliarId(id);
    setViewMode("detail");
  }, []);

  const backToRoster = useCallback(() => {
    setViewMode("roster");
    setSelectedFamiliarId(null);
  }, []);

  return (
    <div className="agents-view flex h-full min-h-0 flex-col bg-[var(--bg-base)]">
      <header className="shrink-0 border-b border-[var(--border-hairline)] px-4 py-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Icon name="ph:users-three" width={16} className="text-[var(--accent-presence)]" />
              <h1 className="text-[14px] font-semibold text-[var(--text-primary)]">Agents</h1>
            </div>
            <p className="mt-1 text-[11px] text-[var(--text-muted)]">
              Roster of every familiar — identity, status, recent activity, memory at a glance.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setViewMode("global-memory")}
              className="focus-ring inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--border-hairline)] bg-[var(--accent-presence)]/10 px-2.5 text-[11px] text-[var(--accent-presence)] hover:bg-[var(--accent-presence)]/15"
            >
              <Icon name="ph:graph" width={12} />
              Memory across all agents
            </button>
            <button
              type="button"
              onClick={() => void loadMemory()}
              className="focus-ring inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--border-hairline)] px-2.5 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]"
            >
              <Icon name="ph:arrows-clockwise" width={12} />
              Refresh
            </button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[240px] flex-1">
            <Icon
              name="ph:magnifying-glass"
              width={12}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
            />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search agents…"
              className="focus-ring h-8 w-full rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)]/40 pl-7 pr-3 text-[12px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-presence)]"
            />
          </div>
          {memoryError ? (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 px-2 py-1 text-[11px] text-[var(--color-warning)]">
              <Icon name="ph:warning-circle" width={12} />
              Memory feed unavailable
              <button
                type="button"
                onClick={() => void loadMemory()}
                className="ml-1 underline underline-offset-2"
              >
                Refresh
              </button>
            </span>
          ) : null}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {familiars.length === 0 ? (
          <div className="p-4">
            <AgentsEmptyState onOpenOnboarding={onOpenOnboarding} />
          </div>
        ) : viewMode === "detail" && selectedFamiliar ? (
          <div className="agents-view__detail flex h-full min-h-0">
            <AgentDetailRail
              familiars={familiars}
              selectedId={selectedFamiliar.id}
              onSelect={enterDetail}
              onBack={backToRoster}
            />
            <AgentDetailPanel
              familiar={selectedFamiliar}
              familiars={familiars}
              sessions={sessions}
              fileEntries={fileEntries}
              memoryError={memoryError}
              memoryLoaded={memoryLoaded}
              onClose={backToRoster}
              onStartChat={() => onStartChat(selectedFamiliar.id)}
              onOpenSession={(sid) => onOpenSession(sid, selectedFamiliar.id)}
              onOpenMemoryFile={onOpenMemoryFile}
            />
          </div>
        ) : (
          <div className="p-4">
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {visibleFamiliars.map((familiar) => (
                <AgentRosterCard
                  key={familiar.id}
                  familiar={familiar}
                  stats={stats.get(familiar.id) ?? emptyStats()}
                  daemonRunning={daemonRunning}
                  responseNeeded={responseNeeded.has(familiar.id)}
                  memoryStatus={memoryError ? "error" : memoryLoaded ? "ready" : "loading"}
                  onSelect={() => enterDetail(familiar.id)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
      {viewMode === "global-memory" ? (
        <GlobalMemoryOverlay
          familiars={familiars}
          onClose={() => setViewMode(selectedFamiliarId ? "detail" : "roster")}
          onOpenMemoryFile={onOpenMemoryFile}
        />
      ) : null}
    </div>
  );
}

function emptyStats(): AgentCardStats {
  return {
    memoryCount: 0,
    latestMemory: null,
    lastSessionAt: null,
    sessionsLast7d: 0,
    hasActiveSession: false,
  };
}

function AgentsEmptyState({ onOpenOnboarding }: { onOpenOnboarding: () => void }) {
  return (
    <div className="agents-view__empty mx-auto flex max-w-md flex-col items-center px-6 py-16 text-center">
      <Icon name="ph:sparkle" width={28} className="text-[var(--accent-presence)]" />
      <h2 className="mt-3 text-[14px] font-semibold text-[var(--text-primary)]">No familiars yet</h2>
      <p className="mt-1 text-[12px] text-[var(--text-muted)]">
        Set up your first familiar to populate the roster.
      </p>
      <button
        type="button"
        onClick={onOpenOnboarding}
        className="mt-4 inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-3 text-[12px] text-[var(--text-primary)] hover:bg-[var(--bg-raised)]/80"
      >
        <Icon name="ph:plus" width={12} />
        Set up your first familiar
      </button>
    </div>
  );
}

type MemoryStatus = "loading" | "error" | "ready";

type AgentRosterCardProps = {
  familiar: Familiar;
  stats: AgentCardStats;
  daemonRunning: boolean;
  responseNeeded: boolean;
  memoryStatus: MemoryStatus;
  onSelect: () => void;
};

function AgentRosterCard({
  familiar,
  stats,
  daemonRunning,
  responseNeeded,
  memoryStatus,
  onSelect,
}: AgentRosterCardProps) {
  const glyph = (familiar.icon ?? "ph:circle-half-tilt") as IconName;
  const lastSessionLabel = stats.lastSessionAt
    ? `Last session ${age(stats.lastSessionAt)}`
    : "No sessions yet";
  const sessionsLabel =
    stats.sessionsLast7d > 0 ? ` · ${stats.sessionsLast7d} this week` : "";
  return (
    <button
      type="button"
      onClick={onSelect}
      className="focus-ring agents-view__card group flex h-full flex-col items-stretch gap-2 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-raised)]/35 p-3 text-left transition-colors hover:border-[var(--accent-presence)]/50 hover:bg-[var(--bg-raised)]/60"
      aria-label={`Open ${familiar.display_name}`}
    >
      <div className="flex items-center gap-2">
        <Icon name={glyph} width={18} className="text-[var(--accent-presence)]" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-[var(--text-primary)]">
            {familiar.display_name}
          </span>
          <span className="block truncate text-[10px] uppercase tracking-widest text-[var(--text-secondary)]">
            {familiar.role || familiar.harness || familiar.id}
          </span>
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
        <span
          className={`inline-flex h-1.5 w-1.5 rounded-full ${daemonRunning ? "bg-[var(--accent-presence)]" : "bg-[var(--text-muted)]"}`}
          aria-hidden="true"
        />
        <span>{daemonRunning ? "online" : "offline"}</span>
        {stats.hasActiveSession ? (
          <span className="rounded bg-[var(--accent-presence)]/15 px-1.5 py-0.5 text-[9px] text-[var(--accent-presence)]">
            active session
          </span>
        ) : null}
        {responseNeeded ? (
          <span className="rounded bg-[var(--color-warning)]/15 px-1.5 py-0.5 text-[9px] text-[var(--color-warning)]">
            response needed
          </span>
        ) : null}
      </div>

      <p className="text-[11px] text-[var(--text-secondary)]">
        {lastSessionLabel}{sessionsLabel}
      </p>

      <div className="mt-auto border-t border-[var(--border-hairline)] pt-2 text-[11px] text-[var(--text-secondary)]">
        {memoryStatus === "loading" ? (
          <span className="text-[var(--text-muted)]">Loading memory…</span>
        ) : memoryStatus === "error" ? (
          <span className="text-[var(--text-muted)]">Memory unavailable</span>
        ) : stats.memoryCount === 0 ? (
          <span className="text-[var(--text-muted)]">No memories yet</span>
        ) : (
          <>
            <span className="block">
              {stats.memoryCount} memor{stats.memoryCount === 1 ? "y" : "ies"}
              {stats.latestMemory ? ` · last write ${age(stats.latestMemory.updatedAt)}` : ""}
            </span>
            {stats.latestMemory ? (
              <span className="mt-0.5 block truncate text-[10px] text-[var(--text-muted)]">
                {stats.latestMemory.title}
              </span>
            ) : null}
          </>
        )}
      </div>
    </button>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// GlobalMemoryOverlay — modal-style full-screen overlay for all-agent memory
// ────────────────────────────────────────────────────────────────────────────

type GlobalMemoryOverlayProps = {
  familiars: Familiar[];
  onClose: () => void;
  onOpenMemoryFile: (path: string) => void;
};

function GlobalMemoryOverlay({ familiars, onClose, onOpenMemoryFile }: GlobalMemoryOverlayProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="agents-view__overlay fixed inset-0 z-50 grid place-items-center bg-black/40 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Memory across all agents"
      onClick={onClose}
    >
      <div
        className="agents-view__overlay-panel relative flex h-[85vh] w-[90vw] max-w-[1280px] flex-col overflow-hidden rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-base)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="focus-ring absolute right-3 top-3 z-10 inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-2 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]/80"
          aria-label="Close"
        >
          <Icon name="ph:x" width={12} />
          Close
        </button>
        <AgentsMemoryView
          familiars={familiars}
          activeFamiliar={null}
          mode="graph"
          onOpenMemoryFile={onOpenMemoryFile}
        />
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// AgentDetailRail — thin left avatar column in detail mode
// ────────────────────────────────────────────────────────────────────────────

type AgentDetailRailProps = {
  familiars: Familiar[];
  selectedId: string;
  onSelect: (id: string) => void;
  onBack: () => void;
};

function AgentDetailRail({ familiars, selectedId, onSelect, onBack }: AgentDetailRailProps) {
  return (
    <nav className="agents-view__rail flex w-[64px] shrink-0 flex-col items-center gap-2 border-r border-[var(--border-hairline)] bg-[var(--bg-raised)]/20 py-3">
      <button
        type="button"
        onClick={onBack}
        className="focus-ring agents-view__rail-back inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)]/40 text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]"
        aria-label="Back to roster"
        title="Back to roster"
      >
        <Icon name="ph:arrow-left" width={14} />
      </button>
      <div className="mt-1 h-px w-8 bg-[var(--border-hairline)]" aria-hidden="true" />
      <ul className="flex flex-col items-center gap-1.5">
        {familiars.map((f) => {
          const active = f.id === selectedId;
          return (
            <li key={f.id}>
              <button
                type="button"
                onClick={() => onSelect(f.id)}
                className={`focus-ring agents-view__rail-avatar inline-flex h-9 w-9 items-center justify-center rounded-full border ${
                  active
                    ? "border-[var(--accent-presence)] bg-[var(--accent-presence)]/15 text-[var(--accent-presence)]"
                    : "border-[var(--border-hairline)] bg-[var(--bg-raised)]/40 text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]"
                }`}
                title={f.display_name}
                aria-label={f.display_name}
                aria-current={active ? "true" : undefined}
              >
                <Icon name={(f.icon ?? "ph:circle-half-tilt") as IconName} width={14} />
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// AgentDetailPanel — right-side panel with Memory / Files / Sessions tabs
// ────────────────────────────────────────────────────────────────────────────

type DetailTab = "memory" | "files" | "sessions";

type AgentDetailPanelProps = {
  familiar: Familiar;
  familiars: Familiar[];
  sessions: SessionRow[];
  fileEntries: FileMemoryEntry[];
  memoryError: string | null;
  memoryLoaded: boolean;
  onClose: () => void;
  onStartChat: () => void;
  onOpenSession: (sessionId: string) => void;
  onOpenMemoryFile: (path: string) => void;
};

function AgentDetailPanel({
  familiar,
  familiars,
  sessions,
  fileEntries,
  memoryError,
  memoryLoaded,
  onClose,
  onStartChat,
  onOpenSession,
  onOpenMemoryFile,
}: AgentDetailPanelProps) {
  const [tab, setTab] = useState<DetailTab>("memory");
  const familiarSessions = useMemo(
    () =>
      sessions
        .filter((s) => s.familiarId === familiar.id)
        .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1)),
    [sessions, familiar.id],
  );

  return (
    <section className="agents-view__panel flex min-h-0 flex-1 flex-col bg-[var(--bg-base)]">
      <header className="flex items-center justify-between gap-2 border-b border-[var(--border-hairline)] px-4 py-3">
        <div className="flex items-center gap-2">
          <Icon name={(familiar.icon ?? "ph:circle-half-tilt") as IconName} width={18} className="text-[var(--accent-presence)]" />
          <div className="min-w-0">
            <h2 className="truncate text-[14px] font-semibold text-[var(--text-primary)]">
              {familiar.display_name}
            </h2>
            <p className="truncate text-[10px] uppercase tracking-widest text-[var(--text-secondary)]">
              {familiar.role || familiar.harness || familiar.id}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onStartChat}
            className="focus-ring inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-2 text-[11px] text-[var(--text-primary)] hover:bg-[var(--bg-raised)]/80"
          >
            <Icon name="ph:chat-circle-dots" width={12} />
            Start chat
          </button>
          <button
            type="button"
            onClick={onClose}
            className="focus-ring inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border-hairline)] px-2 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]"
            aria-label="Back to roster"
          >
            <Icon name="ph:x" width={12} />
            Close
          </button>
        </div>
      </header>

      <div className="flex shrink-0 border-b border-[var(--border-hairline)] px-3">
        {(["memory", "files", "sessions"] as const).map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`focus-ring agents-view__tab inline-flex h-9 items-center gap-1.5 px-3 text-[12px] capitalize transition-colors ${
              tab === id
                ? "border-b-2 border-[var(--accent-presence)] text-[var(--text-primary)]"
                : "border-b-2 border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
            aria-current={tab === id ? "page" : undefined}
          >
            {id}
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {tab === "memory" ? (
          <AgentsMemoryView
            familiars={familiars}
            activeFamiliar={familiar}
            mode="list"
            lockToFamiliar
            onOpenMemoryFile={onOpenMemoryFile}
          />
        ) : tab === "files" ? (
          <div className="h-full overflow-y-auto p-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-[11px] font-semibold uppercase tracking-widest text-[var(--text-secondary)]">
                Memory files
              </h3>
              <span className="text-[10px] text-[var(--text-muted)]">
                {fileEntries.length} total
              </span>
            </div>
            <MemoryFilesList
              entries={fileEntries}
              loaded={memoryLoaded}
              error={memoryError}
              onOpen={onOpenMemoryFile}
            />
            <p className="mt-2 text-[10px] text-[var(--text-muted)]">
              Note: /api/memory is global today, so this list is the same for every familiar.
            </p>
          </div>
        ) : (
          <div className="h-full overflow-y-auto p-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-[11px] font-semibold uppercase tracking-widest text-[var(--text-secondary)]">
                Sessions
              </h3>
              <span className="text-[10px] text-[var(--text-muted)]">
                {familiarSessions.length} total
              </span>
            </div>
            {familiarSessions.length === 0 ? (
              <div className="grid min-h-[120px] place-items-center rounded-lg border border-dashed border-[var(--border-hairline)] text-[12px] text-[var(--text-muted)]">
                No sessions for this familiar yet.
              </div>
            ) : (
              <ul className="divide-y divide-[var(--border-hairline)] rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-raised)]/25">
                {familiarSessions.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => onOpenSession(s.id)}
                      className="focus-ring-inset flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-[var(--bg-raised)]"
                    >
                      <Icon name="ph:terminal-window" width={13} className="mt-0.5 shrink-0 text-[var(--text-muted)]" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12px] text-[var(--text-primary)]">
                          {s.title || s.id}
                        </span>
                        <span className="mt-0.5 block truncate font-mono text-[10px] text-[var(--text-muted)]">
                          {s.harness} · {s.status}
                        </span>
                      </span>
                      <span className="shrink-0 text-[10px] text-[var(--text-muted)]">
                        {age(s.updated_at)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
