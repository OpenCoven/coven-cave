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
  ACTIVITY_DAYS,
  buildFamiliarCardStats,
  type FamiliarCardStats,
  type CovenMemoryEntry,
} from "@/components/familiars-view-stats";
import { deriveRenown } from "@/lib/familiar-renown";
import { compactCount } from "@/lib/profile-card";
import { useResolvedFamiliars, type ResolvedFamiliar } from "@/lib/familiar-resolve";
import { SUMMON_FAMILIAR_EVENT, consumeSummonPending } from "@/lib/summon-events";
import { useFamiliarStudio } from "@/lib/familiar-studio-context";
import { Popover, PopoverBody, PopoverItem, PopoverSeparator } from "@/components/ui/popover";
import { SessionTraceOverlay, type TraceTarget } from "@/components/session-trace-overlay";
import {
  emptyStats,
  FamiliarsEmptyState,
  FamiliarRosterCard,
  FamiliarMemoryOverlay,
  FamiliarDetailRail,
  FamiliarDetailPanel,
  FamiliarAvatarPreviewOverlay,
} from "@/components/familiars-view-sections";

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
            <h1 className="familiars-view__wordmark">Familiars</h1>
            <p className="familiars-view__tagline mt-1.5">
              Roster of every familiar — identity, status, recent activity, memory at a glance.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              title="Open the summoning circle"
              className="focus-ring inline-flex h-7 items-center gap-1.5 rounded-md bg-[var(--accent-presence)] px-2.5 text-[length:var(--text-xs)] font-medium text-[var(--bg-base)] hover:opacity-90"
            >
              <Icon name="ph:magic-wand-fill" width={12} />
              Summon familiar
            </button>
            <button
              type="button"
              onClick={() => memoryFamiliar && setViewMode("agent-memory")}
              disabled={!memoryFamiliar}
              title={memoryFamiliar ? `Memory for ${memoryFamiliar.display_name}` : "Select a familiar to view memory"}
              className="focus-ring inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--border-hairline)] bg-[var(--accent-presence)]/10 px-2.5 text-[length:var(--text-xs)] text-[var(--accent-presence)] hover:bg-[var(--accent-presence)]/15"
            >
              <Icon name="ph:brain" width={12} />
              Familiar memory
            </button>
            <button
              type="button"
              onClick={() => void loadMemory()}
              className="focus-ring inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--border-hairline)] px-2.5 text-[length:var(--text-xs)] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]"
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
              className="focus-ring h-8 w-full rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)]/40 pl-7 pr-7 font-mono text-[length:var(--text-sm)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-presence)]"
            />
            {!query && (
              <kbd
                aria-hidden
                className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-1 font-mono text-[length:var(--text-2xs)] leading-tight text-[var(--text-muted)]"
              >
                /
              </kbd>
            )}
          </div>
          {memoryError ? (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 px-2 py-1 text-[length:var(--text-xs)] text-[var(--color-warning)]">
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
