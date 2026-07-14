"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import { usePausablePoll } from "@/lib/use-pausable-poll";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { Tabs } from "@/components/ui/tabs";
// Shared relative-time formatter, imported as `age` so the call sites read the
// same — standardizes this surface on the app-wide "2m ago / 3h ago / Jun 12" style.
import { relativeTime as age } from "@/lib/relative-time";
import { useDateTimePrefs } from "@/lib/datetime-format";
import { RelativeTime } from "@/components/ui/relative-time";
import type { Familiar, SessionRow } from "@/lib/types";
import { FamiliarAvatar } from "@/components/familiar-avatar";
import { AuthedImage } from "@/components/ui/authed-image";
import { FamiliarsMemoryView, MemoryFilesList } from "@/components/familiars-memory-view";
import type { FileMemoryEntry, MemoryFeed } from "@/components/familiars-memory-view";
import { FamiliarDailyNotes } from "@/components/familiar-daily-notes";
import { HomeFeed } from "@/components/home/home-feed";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { FamiliarSummoningCircle } from "@/components/familiar-summoning-circle";
import {
  buildFamiliarCardStats,
  type FamiliarCardStats,
  type CovenMemoryEntry,
} from "@/components/familiars-view-stats";
import { useResolvedFamiliars, type ResolvedFamiliar } from "@/lib/familiar-resolve";
import { SUMMON_FAMILIAR_EVENT, consumeSummonPending } from "@/lib/summon-events";
import { useFamiliarStudio } from "@/lib/familiar-studio-context";
import { Popover, PopoverBody, PopoverItem, PopoverSeparator } from "@/components/ui/popover";
import { SessionTraceOverlay, type TraceTarget } from "@/components/session-trace-overlay";

type CovenMemoryResponse =
  | { ok: true; entries: CovenMemoryEntry[] }
  | { ok: false; entries?: CovenMemoryEntry[]; error?: string };

type FileMemoryResponse =
  | { ok: true; entries: FileMemoryEntry[] }
  | { ok: false; entries?: FileMemoryEntry[]; error?: string };

type ViewMode = "roster" | "detail" | "agent-memory";

const LAST_SELECTED_KEY = "cave:agents.lastSelected";

type AgentsViewProps = {
  familiars: Familiar[];
  sessions: SessionRow[];
  activeFamiliar?: Familiar | null;
  daemonRunning: boolean;
  responseNeeded: Set<string>;
  onStartChat: (familiarId: string) => void;
  onOpenSession: (sessionId: string, familiarId?: string | null) => void;
  onOpenMemoryFile: (path: string) => void;
  onOpenOnboarding: () => void;
  onOpenUrl: (url: string) => void;
  /** Refresh the roster after a familiar is created and focus the new one. */
  onFamiliarCreated?: (id: string) => void;
  /** Last roster-load failure. When set with an empty roster the surface must
   *  NOT show first-run copy — the familiars may exist but be unreadable
   *  (daemon flap, auth) (cave-atzv). */
  familiarsError?: string | null;
  /** Retry a failed roster load. */
  onRetryFamiliars?: () => void;
};

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

export function FamiliarsView({
  familiars,
  sessions,
  activeFamiliar,
  daemonRunning,
  responseNeeded,
  onStartChat,
  onOpenSession,
  onOpenMemoryFile,
  onOpenOnboarding,
  onOpenUrl,
  onFamiliarCreated,
  familiarsError,
  onRetryFamiliars,
}: AgentsViewProps) {
  useDateTimePrefs(); // subscribe: re-render when the date/time density pref changes
  const [createOpen, setCreateOpen] = useState(false);
  // Other surfaces request the Summoning Circle through summon-events: the
  // retained latch covers the fresh-mount race (mode flip → this view mounts
  // after the event fired); the event covers the already-mounted case. The
  // listener consumes the latch too — requestSummonFamiliar arms it
  // unconditionally, so an already-mounted view that only reacted to the
  // event left it armed and the NEXT mount popped the circle open uninvited
  // (cave-ibvl).
  useEffect(() => {
    if (consumeSummonPending()) setCreateOpen(true);
    const open = () => {
      consumeSummonPending();
      setCreateOpen(true);
    };
    window.addEventListener(SUMMON_FAMILIAR_EVENT, open);
    return () => window.removeEventListener(SUMMON_FAMILIAR_EVENT, open);
  }, []);
  // When set, the summoning circle opens as the Enhancement Rite for this familiar.
  const [enhanceTarget, setEnhanceTarget] = useState<ResolvedFamiliar | null>(null);
  const [covenEntries, setCovenEntries] = useState<CovenMemoryEntry[]>([]);
  const [fileEntries, setFileEntries] = useState<FileMemoryEntry[]>([]);
  const [memoryError, setMemoryError] = useState<string | null>(null);
  const [memoryLoaded, setMemoryLoaded] = useState(false);
  const [memoryLoadedAt, setMemoryLoadedAt] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const [previewFamiliar, setPreviewFamiliar] = useState<ResolvedFamiliar | null>(null);
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
    try {
      if (selectedFamiliarId) window.localStorage.setItem(LAST_SELECTED_KEY, selectedFamiliarId);
      else window.localStorage.removeItem(LAST_SELECTED_KEY);
    } catch {
      // Full localStorage must not crash the surface; the selection just
      // won't persist across reloads.
    }
  }, [selectedFamiliarId]);

  // "/" jumps to the search (GitHub-style) while this surface is shown — but
  // never when the user is already typing in a field or holding a modifier.
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
      setMemoryLoadedAt(new Date().toISOString());
    }
  }, []);

  useEffect(() => {
    void loadMemory();
  }, [loadMemory]);
  // Pauses in a hidden tab; refreshes on return.
  usePausablePoll(() => void loadMemory(), 30_000);

  // Single source of truth for the memory endpoints: the embedded
  // FamiliarsMemoryView mounts consume this instead of running their own
  // duplicate fetch + 30s poll of the same two APIs (cave-5dnw).
  const memoryFeed = useMemo<MemoryFeed>(
    () => ({
      covenEntries,
      fileEntries,
      error: memoryError,
      loaded: memoryLoaded,
      lastLoadedAt: memoryLoadedAt,
      reload: loadMemory,
    }),
    [covenEntries, fileEntries, memoryError, memoryLoaded, memoryLoadedAt, loadMemory],
  );

  const stats = useMemo(
    () => buildFamiliarCardStats({ familiars, sessions, covenEntries }),
    [familiars, sessions, covenEntries],
  );
  const resolvedFamiliars = useResolvedFamiliars(familiars, { includeArchived: true });

  const visibleFamiliars = useMemo(
    () => resolvedFamiliars.filter((f) => familiarMatches(f, query)),
    [resolvedFamiliars, query],
  );

  const selectedFamiliar = useMemo(
    () => resolvedFamiliars.find((f) => f.id === selectedFamiliarId) ?? null,
    [resolvedFamiliars, selectedFamiliarId],
  );
  const resolvedActiveFamiliar = useMemo(
    () => (activeFamiliar ? resolvedFamiliars.find((f) => f.id === activeFamiliar.id) ?? null : null),
    [activeFamiliar, resolvedFamiliars],
  );
  const memoryFamiliar = selectedFamiliar ?? resolvedActiveFamiliar ?? null;

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
    <div className="familiars-view flex h-full min-h-0 flex-col bg-[var(--bg-base)]">
      <header className="shrink-0 border-b border-[var(--border-hairline)] px-4 py-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Icon name="ph:users-three" width={16} className="text-[var(--accent-presence)]" />
              <h1 className="text-[14px] font-semibold text-[var(--text-primary)]">Familiars</h1>
            </div>
            <p className="mt-1 text-[11px] text-[var(--text-muted)]">
              Roster of every familiar — identity, status, recent activity, memory at a glance.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              title="Open the summoning circle"
              className="focus-ring inline-flex h-7 items-center gap-1.5 rounded-md bg-[var(--accent-presence)] px-2.5 text-[11px] font-medium text-[var(--bg-base)] hover:opacity-90"
            >
              <Icon name="ph:magic-wand-fill" width={12} />
              Summon familiar
            </button>
            <button
              type="button"
              onClick={() => memoryFamiliar && setViewMode("agent-memory")}
              disabled={!memoryFamiliar}
              title={memoryFamiliar ? `Memory for ${memoryFamiliar.display_name}` : "Select a familiar to view memory"}
              className="focus-ring inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--border-hairline)] bg-[var(--accent-presence)]/10 px-2.5 text-[11px] text-[var(--accent-presence)] hover:bg-[var(--accent-presence)]/15"
            >
              <Icon name="ph:brain" width={12} />
              Familiar memory
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
              ref={searchRef}
              type="search"
              aria-label="Search familiars"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape" && query) {
                  event.preventDefault();
                  setQuery("");
                }
              }}
              placeholder="Search familiars…"
              className="focus-ring h-8 w-full rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)]/40 pl-7 pr-7 text-[12px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-presence)]"
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
            {familiarsError ? (
              // The roster failed to load — familiars may exist but be
              // unreadable right now. First-run "summon your first" copy here
              // would read as "your familiars were deleted" (cave-atzv).
              <EmptyState
                className="familiars-view__empty mx-auto my-16 max-w-md"
                icon="ph:plugs"
                headline="Can't reach your familiars"
                subtitle={
                  daemonRunning
                    ? "The roster didn't load. Your familiars are safe — retry in a moment."
                    : "The daemon is offline, so the roster can't be read. Your familiars are safe — start the daemon, then retry."
                }
                actions={
                  onRetryFamiliars ? (
                    <Button variant="primary" leadingIcon="ph:arrow-clockwise" onClick={onRetryFamiliars}>
                      Retry
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <FamiliarsEmptyState
                onCreate={() => setCreateOpen(true)}
                onOpenOnboarding={onOpenOnboarding}
              />
            )}
          </div>
        ) : viewMode === "detail" && selectedFamiliar ? (
          <div className="familiars-view__detail flex h-full min-h-0">
            <FamiliarDetailRail
              familiars={resolvedFamiliars}
              selectedId={selectedFamiliar.id}
              onSelect={enterDetail}
              onPreview={setPreviewFamiliar}
              onBack={backToRoster}
            />
            <FamiliarDetailPanel
              familiar={selectedFamiliar}
              familiars={resolvedFamiliars}
              sessions={sessions}
              fileEntries={fileEntries}
              memoryError={memoryError}
              memoryLoaded={memoryLoaded}
              memoryFeed={memoryFeed}
              onClose={backToRoster}
              onPreview={() => setPreviewFamiliar(selectedFamiliar)}
              onStartChat={() => onStartChat(selectedFamiliar.id)}
              onEnhance={() => setEnhanceTarget(selectedFamiliar)}
              onOpenSession={(sid) => onOpenSession(sid, selectedFamiliar.id)}
              onOpenMemoryFile={onOpenMemoryFile}
              onOpenUrl={onOpenUrl}
            />
          </div>
        ) : visibleFamiliars.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon="ph:magnifying-glass"
              headline="No familiars match your search"
              subtitle={`Nothing matches “${query.trim()}”. Try a different name or clear the search.`}
              actions={
                <Button leadingIcon="ph:x" onClick={() => setQuery("")}>
                  Clear search
                </Button>
              }
            />
          </div>
        ) : (
          <div className="@container p-4">
            {/* Columns follow the PANE (container), not the viewport — in a
                split tile a 1680px window must not force xl's 4 columns. */}
            <div className="grid gap-3 @min-[700px]:grid-cols-2 @min-[1050px]:grid-cols-3 @min-[1400px]:grid-cols-4">
              {visibleFamiliars.map((familiar) => (
                <FamiliarRosterCard
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
      {viewMode === "agent-memory" && memoryFamiliar ? (
        <FamiliarMemoryOverlay
          familiars={resolvedFamiliars}
          familiar={memoryFamiliar}
          memoryFeed={memoryFeed}
          onClose={() => setViewMode(selectedFamiliarId ? "detail" : "roster")}
          onOpenMemoryFile={onOpenMemoryFile}
        />
      ) : null}
      {previewFamiliar ? (
        <FamiliarAvatarPreviewOverlay
          familiar={previewFamiliar}
          onClose={() => setPreviewFamiliar(null)}
        />
      ) : null}
      <FamiliarSummoningCircle
        open={createOpen || enhanceTarget !== null}
        onClose={() => {
          setCreateOpen(false);
          setEnhanceTarget(null);
        }}
        existingIds={familiars.map((f) => f.id)}
        defaultHarness={familiars.find((f) => f.defaultHarness)?.defaultHarness}
        onCreated={(id) => onFamiliarCreated?.(id)}
        enhance={enhanceTarget}
        onEnhanced={(id) => onFamiliarCreated?.(id)}
        daemonRunning={daemonRunning}
        onStartChat={onStartChat}
      />
    </div>
  );
}

function emptyStats(): FamiliarCardStats {
  return {
    memoryCount: 0,
    latestMemory: null,
    lastSessionAt: null,
    sessionsLast7d: 0,
    hasActiveSession: false,
  };
}

function FamiliarsEmptyState({
  onCreate,
  onOpenOnboarding,
}: {
  onCreate: () => void;
  onOpenOnboarding: () => void;
}) {
  return (
    <EmptyState
      className="familiars-view__empty mx-auto my-16 max-w-md"
      icon="ph:sparkle"
      headline="The circle awaits"
      subtitle="A familiar is an AI agent with its own identity, memory, and runtime. Summon your first — it can run on this machine, on a remote host over SSH, or bridge an OpenClaw agent you already keep."
      actions={
        <div className="flex items-center gap-2">
          <Button variant="primary" leadingIcon="ph:magic-wand-fill" onClick={onCreate}>
            Summon a familiar
          </Button>
          <Button variant="ghost" onClick={onOpenOnboarding}>
            Run full setup
          </Button>
        </div>
      }
    />
  );
}

type MemoryStatus = "loading" | "error" | "ready";

type AgentRosterCardProps = {
  familiar: ResolvedFamiliar;
  stats: FamiliarCardStats;
  daemonRunning: boolean;
  responseNeeded: boolean;
  memoryStatus: MemoryStatus;
  onSelect: () => void;
};

function FamiliarRosterCard({
  familiar,
  stats,
  daemonRunning,
  responseNeeded,
  memoryStatus,
  onSelect,
}: AgentRosterCardProps) {
  const lastSessionLabel = stats.lastSessionAt
    ? `Last session ${age(stats.lastSessionAt)}`
    : "No sessions yet";
  const sessionsLabel =
    stats.sessionsLast7d > 0 ? ` · ${stats.sessionsLast7d} this week` : "";
  return (
    <div className="flex h-full flex-col">
      <button
        type="button"
        onClick={onSelect}
        className="focus-ring familiars-view__card group flex h-full flex-col items-stretch gap-2 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-raised)]/35 p-3 text-left transition-colors hover:border-[var(--accent-presence)]/50 hover:bg-[var(--bg-raised)]/60"
        aria-label={`Open ${familiar.display_name}`}
      >
        <div className="flex items-center gap-2">
          <FamiliarAvatar familiar={familiar} size="sm" />
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
            // Shimmer instead of a "Loading memory…" string — one loading
            // language across the roster, and no dead-looking text while the
            // first fetch is cold (cave-5qmm).
            <span aria-hidden className="block py-0.5">
              <Skeleton variant="text-sm" width="55%" />
            </span>
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
      <Link
        href={`/dashboard/familiars/${encodeURIComponent(familiar.id)}/analytics`}
        aria-label={`Open analytics for ${familiar.display_name}`}
        className="mt-1 self-start text-[10px] text-[var(--text-muted)] hover:text-[var(--accent-presence)]"
      >
        Analytics →
      </Link>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// FamiliarMemoryOverlay — modal-style full-screen overlay for selected familiar memory
// ────────────────────────────────────────────────────────────────────────────

type AgentMemoryOverlayProps = {
  familiars: ResolvedFamiliar[];
  familiar: ResolvedFamiliar;
  memoryFeed: MemoryFeed;
  onClose: () => void;
  onOpenMemoryFile: (path: string) => void;
};

function FamiliarMemoryOverlay({ familiars, familiar, memoryFeed, onClose, onOpenMemoryFile }: AgentMemoryOverlayProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  // Trap focus inside the panel + Escape-to-close + restore focus to the opener.
  useFocusTrap(true, panelRef, { onEscape: onClose });

  return (
    <div
      className="familiars-view__overlay fixed inset-0 z-50 grid place-items-center bg-black/40 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={`Memory for ${familiar.display_name}`}
      onClick={onClose}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className="familiars-view__overlay-panel relative flex h-[100dvh] w-full flex-col overflow-hidden border border-[var(--border-hairline)] bg-[var(--bg-base)] shadow-2xl focus:outline-none md:h-[85vh] md:w-[90vw] md:max-w-[1280px] md:rounded-xl"
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
        <FamiliarsMemoryView
          familiars={familiars}
          activeFamiliar={familiar}
          lockToFamiliar
          feed={memoryFeed}
          onOpenMemoryFile={onOpenMemoryFile}
        />
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// FamiliarDetailRail — thin left avatar column in detail mode
// ────────────────────────────────────────────────────────────────────────────

type AgentDetailRailProps = {
  familiars: ResolvedFamiliar[];
  selectedId: string;
  onSelect: (id: string) => void;
  onPreview: (familiar: ResolvedFamiliar) => void;
  onBack: () => void;
};

function FamiliarDetailRail({ familiars, selectedId, onSelect, onPreview, onBack }: AgentDetailRailProps) {
  return (
    <nav className="familiars-view__rail flex w-[64px] shrink-0 flex-col items-center gap-2 border-r border-[var(--border-hairline)] bg-[var(--bg-raised)]/20 py-3">
      <button
        type="button"
        onClick={onBack}
        className="focus-ring familiars-view__rail-back inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)]/40 text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]"
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
                onClick={() => {
                  onSelect(f.id);
                  onPreview(f);
                }}
                className={`focus-ring familiars-view__rail-avatar inline-flex h-9 w-9 items-center justify-center rounded-full border ${
                  active
                    ? "border-[var(--accent-presence)] bg-[var(--accent-presence)]/15 text-[var(--accent-presence)]"
                    : "border-[var(--border-hairline)] bg-[var(--bg-raised)]/40 text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]"
                }`}
                title={f.display_name}
                aria-label={`Preview ${f.display_name}'s avatar`}
                aria-current={active ? "true" : undefined}
              >
                <FamiliarAvatar familiar={f} size="sm" />
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// FamiliarDetailPanel — right-side panel with Memory / Files / Sessions tabs
// ────────────────────────────────────────────────────────────────────────────

type DetailTab = "memory" | "daily-notes" | "files" | "sessions" | "feed";

const DETAIL_TABS: { id: DetailTab; label: string }[] = [
  { id: "memory", label: "Memory" },
  { id: "daily-notes", label: "Daily Notes" },
  { id: "files", label: "Files" },
  { id: "sessions", label: "Sessions" },
  { id: "feed", label: "Feed" },
];

type AgentDetailPanelProps = {
  familiar: ResolvedFamiliar;
  familiars: ResolvedFamiliar[];
  sessions: SessionRow[];
  fileEntries: FileMemoryEntry[];
  memoryError: string | null;
  memoryLoaded: boolean;
  memoryFeed: MemoryFeed;
  onClose: () => void;
  onPreview: () => void;
  onStartChat: () => void;
  /** Open the summoning circle in Enhancement Rite mode for this familiar. */
  onEnhance: () => void;
  onOpenSession: (sessionId: string) => void;
  onOpenMemoryFile: (path: string) => void;
  onOpenUrl: (url: string) => void;
};

// Per-familiar overflow menu on the detail panel header. Remove routes to the
// Studio lifecycle tab rather than confirming here — the destructive flow
// (confirm copy, undo toast, tombstone coupling) lives only in
// familiar-studio-lifecycle-tab.tsx, and this menu is the discoverable
// entry point the Familiars surface lacked.
function FamiliarPanelMenu({ familiar }: { familiar: ResolvedFamiliar }) {
  const { openFamiliarStudio } = useFamiliarStudio();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="focus-ring inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--border-hairline)] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]"
        aria-label={`${familiar.display_name} options`}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Familiar options"
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="ph:dots-three-vertical" width={14} aria-hidden />
      </button>
      <Popover
        open={open}
        onOpenChange={setOpen}
        anchorRef={triggerRef}
        placement="bottom-end"
        minWidth={200}
        ariaLabel="Familiar options"
      >
        <PopoverBody>
          <PopoverItem
            icon="ph:pencil-simple"
            onSelect={() => {
              setOpen(false);
              openFamiliarStudio(familiar.id, "identity");
            }}
          >
            Edit in Studio
          </PopoverItem>
          <PopoverSeparator />
          <PopoverItem
            icon="ph:trash"
            danger
            onSelect={() => {
              setOpen(false);
              openFamiliarStudio(familiar.id, "lifecycle");
            }}
          >
            Remove familiar…
          </PopoverItem>
        </PopoverBody>
      </Popover>
    </>
  );
}

function FamiliarDetailPanel({
  familiar,
  familiars,
  sessions,
  fileEntries,
  memoryError,
  memoryLoaded,
  memoryFeed,
  onClose,
  onPreview,
  onStartChat,
  onEnhance,
  onOpenSession,
  onOpenMemoryFile,
  onOpenUrl,
}: AgentDetailPanelProps) {
  const [tab, setTab] = useState<DetailTab>("memory");
  // Session trace overlay — the daemon event timeline behind one session.
  const [traceTarget, setTraceTarget] = useState<TraceTarget | null>(null);
  const familiarSessions = useMemo(
    () =>
      sessions
        .filter((s) => s.familiarId === familiar.id)
        .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1)),
    [sessions, familiar.id],
  );
  const familiarFileEntries = useMemo(
    () =>
      fileEntries
        .filter((entry) => entry.familiarId === familiar.id)
        .sort((a, b) => (a.modified < b.modified ? 1 : -1)),
    [fileEntries, familiar.id],
  );

  return (
    <section className="familiars-view__panel flex min-h-0 flex-1 flex-col bg-[var(--bg-base)]">
      <header className="flex items-center justify-between gap-2 border-b border-[var(--border-hairline)] px-4 py-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onPreview}
            className="focus-ring inline-flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-raised)]/50 text-[var(--text-primary)] hover:border-[var(--accent-presence)]/60"
            aria-label={`Enlarge ${familiar.display_name}'s avatar`}
            title="Enlarge avatar"
          >
            <FamiliarAvatar familiar={familiar} size="xl" />
          </button>
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
            title="Start chat"
            className="focus-ring inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-2 text-[11px] text-[var(--text-primary)] hover:bg-[var(--bg-raised)]/80"
          >
            <Icon name="ph:chat-circle-dots" width={12} />
            Start
          </button>
          <button
            type="button"
            onClick={onEnhance}
            title={`Enhance ${familiar.display_name} in the circle`}
            className="focus-ring inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border-hairline)] bg-[var(--accent-presence)]/10 px-2 text-[11px] text-[var(--accent-presence)] hover:bg-[var(--accent-presence)]/15"
          >
            <Icon name="ph:magic-wand-fill" width={12} />
            Enhance
          </button>
          <FamiliarPanelMenu familiar={familiar} />
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

      <Tabs
        items={DETAIL_TABS}
        value={tab}
        onChange={setTab}
        ariaLabel="Familiar details"
        idPrefix="familiar-detail"
        className="shrink-0 px-3"
      />

      <div
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
        role="tabpanel"
        id={`familiar-detail-panel-${tab}`}
        aria-labelledby={`familiar-detail-tab-${tab}`}
      >
        {tab === "memory" ? (
          <FamiliarsMemoryView
            familiars={familiars}
            activeFamiliar={familiar}
            lockToFamiliar
            feed={memoryFeed}
            onOpenMemoryFile={onOpenMemoryFile}
          />
        ) : tab === "daily-notes" ? (
          <FamiliarDailyNotes familiar={familiar} />
        ) : tab === "files" ? (
          <div className="flex min-h-0 flex-1 flex-col p-4">
            <div className="mb-2 flex shrink-0 items-center justify-between">
              <h3 className="text-[11px] font-semibold uppercase tracking-widest text-[var(--text-secondary)]">
                Memory files
              </h3>
              <span className="text-[10px] text-[var(--text-muted)]">
                {familiarFileEntries.length} total
              </span>
            </div>
            <MemoryFilesList
              entries={familiarFileEntries}
              loaded={memoryLoaded}
              error={memoryError}
              onOpen={onOpenMemoryFile}
              className="flex min-h-0 flex-1 flex-col overflow-hidden"
              listClassName="h-full min-h-0 divide-y divide-[var(--border-hairline)] overflow-y-auto"
            />
            <p className="mt-2 text-[10px] text-[var(--text-muted)]">
              Only files traced to {familiar.display_name} are shown here.
            </p>
          </div>
        ) : tab === "feed" ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
            <HomeFeed onOpenUrl={onOpenUrl} />
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
              <EmptyState
                compact
                icon="ph:chats-circle"
                headline="No sessions for this familiar yet"
                subtitle="Sessions started with this familiar will show up here."
              />
            ) : (
              <ul className="divide-y divide-[var(--border-hairline)] rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-raised)]/25">
                {familiarSessions.map((s) => (
                  <li key={s.id} className="flex items-stretch">
                    <button
                      type="button"
                      onClick={() => onOpenSession(s.id)}
                      className="focus-ring-inset flex min-w-0 flex-1 items-start gap-2 px-3 py-2 text-left hover:bg-[var(--bg-raised)]"
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
                      <RelativeTime iso={s.updated_at} className="shrink-0 text-[10px] text-[var(--text-muted)]" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setTraceTarget({ id: s.id, title: s.title })}
                      className="focus-ring-inset flex shrink-0 items-center gap-1 border-l border-[var(--border-hairline)] px-2 text-[10px] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
                      title="Trace this session's daemon events"
                      aria-label={`Trace ${s.title || s.id}`}
                    >
                      <Icon name="ph:tree-structure" width={12} aria-hidden />
                      Trace
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {traceTarget ? (
        <SessionTraceOverlay target={traceTarget} onClose={() => setTraceTarget(null)} />
      ) : null}
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// FamiliarAvatarPreviewOverlay — enlarged peek at the selected familiar avatar
// ────────────────────────────────────────────────────────────────────────────

type FamiliarAvatarPreviewOverlayProps = {
  familiar: ResolvedFamiliar;
  onClose: () => void;
};

function FamiliarAvatarPreviewOverlay({ familiar, onClose }: FamiliarAvatarPreviewOverlayProps) {
  return (
    <Modal
      open
      onClose={onClose}
      breadcrumb={["Familiars", familiar.display_name]}
      ariaLabel={`${familiar.display_name} avatar preview`}
    >
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="grid aspect-square w-full max-w-[320px] place-items-center overflow-hidden rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-base)]">
          <AuthedImage
            src={familiar.avatarImage}
            alt={`${familiar.display_name} avatar`}
            className="h-full w-full object-cover"
            fallback={<FamiliarAvatar familiar={familiar} size="xl" />}
          />
        </div>
        <div className="min-w-0">
          <div className="truncate text-[14px] font-semibold text-[var(--text-primary)]">
            {familiar.display_name}
          </div>
          <div className="mt-0.5 truncate text-[11px] uppercase tracking-widest text-[var(--text-secondary)]">
            {familiar.role || familiar.harness || familiar.id}
          </div>
        </div>
      </div>
    </Modal>
  );
}
