"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import { usePausablePoll } from "@/lib/use-pausable-poll";
import { useDateTimePrefs } from "@/lib/datetime-format";
import type { Familiar, SessionRow } from "@/lib/types";
import type { FileMemoryEntry, MemoryFeed } from "@/components/familiars-memory-view";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { FamiliarRiteOverlay } from "@/components/familiar-rite";
import { FamiliarSummoningCircle } from "@/components/familiar-summoning-circle";
import {
  buildFamiliarCardStats,
  type CanonicalMemoryAvailability,
} from "@/components/familiars-view-stats";
import {
  loadCanonicalMemoryList,
  loadCanonicalMemoryOverview,
  refreshCanonicalMemory,
  type CanonicalMemoryListLoad,
  type CanonicalMemoryOverviewLoad,
} from "@/lib/canonical-memory-resources";
import { CanonicalMemoryRequestError } from "@/lib/canonical-memory-client";
import type { PendingCanonicalMemorySelection } from "@/lib/canonical-memory";
import { createMemoryFeedRequestGate } from "@/lib/memory-feed-request-gate";
import { useResolvedFamiliars, type ResolvedFamiliar } from "@/lib/familiar-resolve";
import { SUMMON_FAMILIAR_EVENT, consumeSummonPending } from "@/lib/summon-events";
import { useSurfacePreference } from "@/lib/surface-preferences";
import { surfacePreferenceSpecs } from "@/lib/surface-preference-specs";
import { readSurfaceResource } from "@/lib/surface-warmup-registry";
import {
  emptyStats,
  FamiliarsEmptyState,
  FamiliarRosterCard,
  FamiliarMemoryOverlay,
  FamiliarDetailRail,
  FamiliarDetailPanel,
  FamiliarAvatarPreviewOverlay,
} from "@/components/familiars-view-sections";

type FileMemoryResponse =
  | { ok: true; entries: FileMemoryEntry[] }
  | { ok: false; entries?: FileMemoryEntry[]; error?: string };

type AgentsViewProps = {
  familiars: Familiar[];
  sessions: SessionRow[];
  activeFamiliar?: Familiar | null;
  daemonRunning: boolean;
  localDaemonReady: boolean;
  pendingRosterSettledSuccessfully: boolean;
  pendingCanonicalMemorySelection?: PendingCanonicalMemorySelection | null;
  onCanonicalMemorySelectionApplied?: (id: string) => void;
  onCanonicalMemorySelectionUnavailable?: (
    selection: PendingCanonicalMemorySelection,
  ) => void;
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
  localDaemonReady,
  pendingRosterSettledSuccessfully,
  pendingCanonicalMemorySelection = null,
  onCanonicalMemorySelectionApplied,
  onCanonicalMemorySelectionUnavailable,
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
  // Summoning is a two-surface affair, and the split is deliberate.
  //
  // `createOpen` is the RITE — the default path from every Summon entry point:
  // drop a likeness, answer one question per screen, strike the seal. It binds
  // the five local harnesses and nothing else.
  //
  // `byHandOpen` is the SUMMONING CIRCLE, still the only surface that can bind
  // an SSH host, an existing OpenClaw agent, or an existing Hermes profile. The
  // rite reaches it through `onSummonByHand` rather than dead-ending on a
  // vessel it cannot express, so making the rite the default strands nobody.
  // The circle is also still the whole Enhancement Rite (see `enhanceTarget`).
  const [createOpen, setCreateOpen] = useState(false);
  const [byHandOpen, setByHandOpen] = useState(false);
  // Other surfaces request summoning through summon-events, and land on the
  // rite like every other entry point: the retained latch covers the
  // fresh-mount race (mode flip → this view mounts after the event fired); the
  // event covers the already-mounted case. The listener consumes the latch too
  // — requestSummonFamiliar arms it unconditionally, so an already-mounted view
  // that only reacted to the event left it armed and the NEXT mount popped the
  // rite open uninvited (cave-ibvl).
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
  const [canonicalMemoryState, setCanonicalMemoryState] =
    useState<MemoryFeed["canonical"]>({ state: "loading", entries: [] });
  const [canonicalOverviewState, setCanonicalOverviewState] =
    useState<MemoryFeed["overview"]>({ state: "loading", value: null });
  const [fileMemoryState, setFileMemoryState] = useState<MemoryFeed["files"]>({
    state: "loading",
    entries: [],
  });
  const [memoryLoadedAt, setMemoryLoadedAt] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const [previewFamiliar, setPreviewFamiliar] = useState<ResolvedFamiliar | null>(null);
  const [selectedFamiliarId, setSelectedFamiliarId] = useSurfacePreference(surfacePreferenceSpecs.familiars.selectedId);
  const [viewMode, setViewMode] = useSurfacePreference(surfacePreferenceSpecs.familiars.viewMode);
  const rejectedPendingSelectionRef =
    useRef<PendingCanonicalMemorySelection | null>(null);
  const memoryRequestGateRef = useRef<ReturnType<
    typeof createMemoryFeedRequestGate
  > | null>(null);
  if (!memoryRequestGateRef.current) {
    memoryRequestGateRef.current = createMemoryFeedRequestGate();
  }

  useEffect(() => {
    if (!pendingCanonicalMemorySelection) return;
    setSelectedFamiliarId(pendingCanonicalMemorySelection.familiarId);
    setViewMode("agent-memory");
  }, [
    pendingCanonicalMemorySelection,
    setSelectedFamiliarId,
    setViewMode,
  ]);

  useEffect(() => {
    const requestGate = memoryRequestGateRef.current!;
    requestGate.mount();
    return () => requestGate.unmount();
  }, []);

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

  const applyFileMemory = useCallback((fileJson: FileMemoryResponse) => {
    setFileMemoryState((current) =>
      fileJson.ok
        ? { state: "ready", entries: fileJson.entries }
        : {
            state: "error",
            entries: fileJson.entries ?? current.entries,
            error: fileJson.error ?? "Memory files unavailable",
          },
    );
  }, []);

  const applyFileMemoryError = useCallback((error: unknown) => {
    setFileMemoryState((current) => ({
      state: "error",
      entries: current.entries,
      error: error instanceof Error ? error.message : "Memory files unavailable",
    }));
  }, []);

  const loadMemory = useCallback(async () => {
    const requestGate = memoryRequestGateRef.current!;
    const request = requestGate.beginBackground("files");
    try {
      const fileResult = await readSurfaceResource<FileMemoryResponse>(
        "memory:list",
        false,
      );
      if (!requestGate.isCurrent(request)) return;
      applyFileMemory(fileResult.data);
    } catch (error) {
      if (!requestGate.isCurrent(request)) return;
      applyFileMemoryError(error);
    } finally {
      if (requestGate.isCurrent(request)) {
        setMemoryLoadedAt(new Date().toISOString());
      }
    }
  }, [applyFileMemory, applyFileMemoryError]);

  useEffect(() => {
    void loadMemory();
  }, [loadMemory]);
  // Pauses in a hidden tab; non-forced reads coalesce with the shared cache.
  usePausablePoll(() => void loadMemory(), 30_000);

  const applyCanonicalList = useCallback((canonical: CanonicalMemoryListLoad) => {
    setCanonicalMemoryState((current) =>
      canonical.state === "ready"
        ? { state: "ready", entries: canonical.entries }
        : {
            state: "error",
            entries: current.entries,
            error: canonical.error,
          },
    );
  }, []);

  const applyCanonicalOverview = useCallback(
    (overview: CanonicalMemoryOverviewLoad) => {
      setCanonicalOverviewState(
        overview.state === "ready"
          ? { state: "ready", value: overview.overview }
          : { state: "error", value: null, error: overview.error },
      );
    },
    [],
  );

  const loadCanonicalMemory = useCallback(async () => {
    const requestGate = memoryRequestGateRef.current!;
    const request = requestGate.beginBackground("canonical");
    const [canonical, overview] = await Promise.all([
      loadCanonicalMemoryList(),
      loadCanonicalMemoryOverview(),
    ]);
    if (!requestGate.isCurrent(request)) return;
    applyCanonicalList(canonical);
    applyCanonicalOverview(overview);
  }, [applyCanonicalList, applyCanonicalOverview]);

  useEffect(() => {
    void loadCanonicalMemory();
  }, [loadCanonicalMemory]);
  // Background reads stay non-forced so canonical list consumers coalesce.
  usePausablePoll(() => void loadCanonicalMemory(), 30_000);

  const refreshMemory = useCallback(async (): Promise<CanonicalMemoryListLoad> => {
    const requestGate = memoryRequestGateRef.current!;
    const request = requestGate.beginForce();
    const fileRefresh = (async () => {
      try {
        const fileResult = await readSurfaceResource<FileMemoryResponse>(
          "memory:list",
          true,
        );
        if (requestGate.isCurrent(request)) {
          applyFileMemory(fileResult.data);
        }
      } catch (error) {
        if (requestGate.isCurrent(request)) {
          applyFileMemoryError(error);
        }
      }
    })();

    let canonicalList: CanonicalMemoryListLoad;
    try {
      try {
        const canonical = await refreshCanonicalMemory();
        canonicalList = canonical.list;
        if (requestGate.isCurrent(request)) {
          applyCanonicalList(canonical.list);
          applyCanonicalOverview(canonical.overview);
        }
      } catch (error) {
        const stableError =
          error instanceof CanonicalMemoryRequestError
            ? error
            : new CanonicalMemoryRequestError("invalid_daemon_payload", 0);
        canonicalList = { state: "error", error: stableError };
        if (requestGate.isCurrent(request)) {
          applyCanonicalList(canonicalList);
          applyCanonicalOverview({ state: "error", error: stableError });
        }
      }
      await fileRefresh;
      if (requestGate.isCurrent(request)) {
        setMemoryLoadedAt(new Date().toISOString());
      }
      return canonicalList;
    } finally {
      requestGate.finishForce(request);
    }
  }, [
    applyCanonicalList,
    applyCanonicalOverview,
    applyFileMemory,
    applyFileMemoryError,
  ]);

  // A single parent feed keeps embedded memory surfaces on the same independently
  // settled canonical-list, overview, and local-file snapshots.
  const memoryFeed = useMemo<MemoryFeed>(
    () => ({
      canonical: canonicalMemoryState,
      overview: canonicalOverviewState,
      files: fileMemoryState,
      lastLoadedAt: memoryLoadedAt,
      reload: refreshMemory,
    }),
    [
      canonicalMemoryState,
      canonicalOverviewState,
      fileMemoryState,
      memoryLoadedAt,
      refreshMemory,
    ],
  );

  const canonicalStatsEntries =
    canonicalMemoryState.state === "ready"
      ? canonicalMemoryState.entries
      : [];
  const canonicalMemoryAvailability: CanonicalMemoryAvailability =
    canonicalMemoryState.state === "ready" ? "ready" : "unavailable";
  const canonicalMemoryLoaded = canonicalMemoryState.state !== "loading";
  const fileEntries = fileMemoryState.entries;
  const memoryError =
    fileMemoryState.state === "error" ? fileMemoryState.error : null;
  const memoryLoaded = fileMemoryState.state !== "loading";

  const stats = useMemo(
    () => buildFamiliarCardStats({
      familiars,
      sessions,
      covenEntries: canonicalStatsEntries,
      memoryAvailability: canonicalMemoryAvailability,
    }),
    [
      canonicalMemoryAvailability,
      canonicalStatsEntries,
      familiars,
      sessions,
    ],
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
  const pendingMemoryFamiliar = pendingCanonicalMemorySelection
    ? resolvedFamiliars.find(
        (familiar) =>
          familiar.id === pendingCanonicalMemorySelection.familiarId,
      ) ?? null
    : null;
  const memoryFamiliar = pendingCanonicalMemorySelection
    ? pendingMemoryFamiliar
    : selectedFamiliar ?? resolvedActiveFamiliar ?? null;

  useEffect(() => {
    if (
      !pendingCanonicalMemorySelection ||
      !pendingRosterSettledSuccessfully ||
      pendingMemoryFamiliar ||
      rejectedPendingSelectionRef.current ===
        pendingCanonicalMemorySelection
    ) {
      return;
    }
    rejectedPendingSelectionRef.current = pendingCanonicalMemorySelection;
    setSelectedFamiliarId(null);
    setViewMode("roster");
    onCanonicalMemorySelectionUnavailable?.(
      pendingCanonicalMemorySelection,
    );
  }, [
    pendingRosterSettledSuccessfully,
    onCanonicalMemorySelectionUnavailable,
    pendingCanonicalMemorySelection,
    pendingMemoryFamiliar,
    setSelectedFamiliarId,
    setViewMode,
  ]);

  useEffect(() => {
    if (selectedFamiliarId && !selectedFamiliar) {
      if (
        pendingCanonicalMemorySelection &&
        selectedFamiliarId === pendingCanonicalMemorySelection.familiarId
      ) {
        return;
      }
      setSelectedFamiliarId(null);
      setViewMode("roster");
    }
  }, [
    pendingCanonicalMemorySelection,
    selectedFamiliar,
    selectedFamiliarId,
    setSelectedFamiliarId,
    setViewMode,
  ]);

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
              title="Open the summoning rite"
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
              onClick={() => void refreshMemory()}
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
                onClick={() => void refreshMemory()}
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
              localDaemonReady={localDaemonReady}
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
                  stats={
                    stats.get(familiar.id) ??
                    emptyStats(canonicalMemoryAvailability)
                  }
                  daemonRunning={daemonRunning}
                  responseNeeded={responseNeeded.has(familiar.id)}
                  memoryStatus={
                    canonicalMemoryAvailability === "ready"
                      ? "ready"
                      : canonicalMemoryLoaded
                        ? "error"
                        : "loading"
                  }
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
          localDaemonReady={localDaemonReady}
          pendingCanonicalMemorySelection={pendingCanonicalMemorySelection}
          onCanonicalMemorySelectionApplied={onCanonicalMemorySelectionApplied}
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
      <FamiliarRiteOverlay
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        existingIds={familiars.map((f) => f.id)}
        defaultHarness={familiars.find((f) => f.defaultHarness)?.defaultHarness}
        onCreated={(id) => onFamiliarCreated?.(id)}
        onStartChat={onStartChat}
        // The advanced vessels the rite cannot express. Hand the whole
        // summoning over to the circle rather than half-carrying state across.
        onSummonByHand={() => {
          setCreateOpen(false);
          setByHandOpen(true);
        }}
      />
      <FamiliarSummoningCircle
        open={byHandOpen || enhanceTarget !== null}
        onClose={() => {
          setByHandOpen(false);
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
