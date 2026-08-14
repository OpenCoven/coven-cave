"use client";

import "@/styles/cave-md.css";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CanonicalMemoryOverviewPanel } from "@/components/canonical-memory-overview";
import {
  CanonicalMemoryReader,
  canonicalMemoryErrorCopy,
} from "@/components/canonical-memory-reader";
import {
  MemoryFilesList,
  MemoryReaderModal,
  SourceFilterChip,
} from "@/components/familiars-memory-files";
import { MemoryReaderPane } from "@/components/familiars-memory-reader";
import { MemoryRowItem } from "@/components/familiars-memory-row";
import {
  fileBase,
  formatBytes,
  memoryMatches,
  type FileMemoryEntry,
} from "@/components/familiars-memory-utils";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Modal } from "@/components/ui/modal";
import { RelativeTime } from "@/components/ui/relative-time";
import { StandardSelect } from "@/components/ui/select";
import { SkeletonRows } from "@/components/ui/skeleton";
import type {
  CanonicalMemoryOverview,
  CanonicalMemorySummary,
  PendingCanonicalMemorySelection,
} from "@/lib/canonical-memory";
import {
  canonicalMemorySelectionRowId,
  isCanonicalMemorySelectionApplied,
} from "@/lib/canonical-memory";
import { CanonicalMemoryRequestError } from "@/lib/canonical-memory-client";
import {
  loadCanonicalMemoryList,
  loadCanonicalMemoryOverview,
  refreshCanonicalMemory,
  type CanonicalMemoryListLoad,
  type CanonicalMemoryOverviewLoad,
} from "@/lib/canonical-memory-resources";
import {
  formatTimestamp,
  readDateTimePrefs,
  useDateTimePrefs,
} from "@/lib/datetime-format";
import { Icon } from "@/lib/icon";
import {
  detectStale,
  normalizeFileEntry,
  type GroupBy,
} from "@/lib/memory-management";
import {
  buildMemoryRows,
  excludeMissingCanonicalMemory,
  groupMemoryRows,
  memoryListPresentation,
  reconcileMemorySelection,
  reconcileMissingCanonicalRefresh,
  type CanonicalMemoryRow,
  type FileMemoryRow,
  type MemoryRow,
} from "@/lib/memory-rows";
import { relativeTime as age } from "@/lib/relative-time";
import { surfacePreferenceSpecs } from "@/lib/surface-preference-specs";
import { useSurfacePreference } from "@/lib/surface-preferences";
import { invalidateIfDefined } from "@/lib/surface-warm-cache";
import { readSurfaceResource } from "@/lib/surface-warmup-registry";
import type { Familiar } from "@/lib/types";
import { usePausablePoll } from "@/lib/use-pausable-poll";
import { useUndoDelete } from "@/lib/use-undo-delete";
import { UndoToast } from "@/components/ui/undo-toast";

export type { FileMemoryEntry } from "@/components/familiars-memory-utils";

export type MemoryFeed = {
  canonical:
    | { state: "loading"; entries: CanonicalMemorySummary[] }
    | { state: "ready"; entries: CanonicalMemorySummary[] }
    | { state: "error"; entries: CanonicalMemorySummary[]; error: CanonicalMemoryRequestError };
  overview:
    | { state: "loading"; value: null }
    | { state: "ready"; value: CanonicalMemoryOverview }
    | { state: "error"; value: null; error: CanonicalMemoryRequestError };
  files:
    | { state: "loading"; entries: FileMemoryEntry[] }
    | { state: "ready"; entries: FileMemoryEntry[] }
    | { state: "error"; entries: FileMemoryEntry[]; error: string };
  lastLoadedAt: string | null;
  reload: () => Promise<CanonicalMemoryListLoad>;
};

type Props = {
  familiars: Familiar[];
  activeFamiliar: Familiar | null;
  localDaemonReady?: boolean;
  onOpenMemoryFile?: (path: string) => void;
  limit?: number;
  lockToFamiliar?: boolean;
  compact?: boolean;
  feed?: MemoryFeed;
  pendingCanonicalMemorySelection?: PendingCanonicalMemorySelection | null;
  onCanonicalMemorySelectionApplied?: (id: string) => void;
};

type FileMemoryResponse =
  | { ok: true; entries: FileMemoryEntry[] }
  | { ok: false; entries?: FileMemoryEntry[]; error?: string };

type CanonicalState = MemoryFeed["canonical"];
type OverviewState = MemoryFeed["overview"];
type FilesState = MemoryFeed["files"];

function canonicalStateFrom(
  load: CanonicalMemoryListLoad,
  previousEntries: CanonicalMemorySummary[],
): CanonicalState {
  return load.state === "ready"
    ? { state: "ready", entries: load.entries }
    : { state: "error", entries: previousEntries, error: load.error };
}

function overviewStateFrom(load: CanonicalMemoryOverviewLoad): OverviewState {
  return load.state === "ready"
    ? { state: "ready", value: load.overview }
    : { state: "error", value: null, error: load.error };
}

function withFileEntries(
  state: FilesState,
  entries: FileMemoryEntry[],
): FilesState {
  if (state.state === "error") return { ...state, entries };
  return { ...state, entries };
}

export function FamiliarsMemoryView({
  familiars,
  activeFamiliar,
  localDaemonReady = false,
  onOpenMemoryFile,
  limit,
  lockToFamiliar,
  compact,
  feed,
  pendingCanonicalMemorySelection = null,
  onCanonicalMemorySelectionApplied,
}: Props) {
  useDateTimePrefs();
  const [canonicalState, setCanonicalState] = useState<CanonicalState>({
    state: "loading",
    entries: [],
  });
  const [overviewState, setOverviewState] = useState<OverviewState>({
    state: "loading",
    value: null,
  });
  const [filesState, setFilesState] = useState<FilesState>({
    state: "loading",
    entries: [],
  });
  const [lastLoadedAt, setLastLoadedAt] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [storedFamiliarFilter, setFamiliarFilter] = useSurfacePreference(
    surfacePreferenceSpecs.familiarMemory.familiarId,
  );
  const familiarFilter =
    storedFamiliarFilter || activeFamiliar?.id || familiars[0]?.id || "";
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [pinnedCanonicalSelection, setPinnedCanonicalSelection] = useState<{
    selection: PendingCanonicalMemorySelection;
    row: CanonicalMemoryRow;
  } | null>(null);
  const acknowledgedPendingSelectionRef =
    useRef<PendingCanonicalMemorySelection | null>(null);
  const [sourceFilter, setSourceFilter] = useSurfacePreference(
    surfacePreferenceSpecs.familiarMemory.source,
  );
  const [sortMode, setSortMode] = useSurfacePreference(
    surfacePreferenceSpecs.familiarMemory.sort,
  );
  const [groupMode, setGroupMode] = useSurfacePreference(
    surfacePreferenceSpecs.familiarMemory.group,
  );
  const [staleOnly, setStaleOnly] = useSurfacePreference(
    surfacePreferenceSpecs.familiarMemory.staleOnly,
  );
  const [expandRow, setExpandRow] = useState<MemoryRow | null>(null);
  const {
    pending: undoPending,
    scheduleDelete,
    undo: undoDelete,
    commit: commitDelete,
  } = useUndoDelete<{ key: string }>();
  const pendingDeletePathRef = useRef<string | null>(null);
  const effectiveLimit = limit ?? Infinity;
  const FILE_PAGE = 80;
  const [fileLimit, setFileLimit] = useState(FILE_PAGE);
  const [headerCollapsed, setHeaderCollapsed] = useState(false);
  const [missingCanonical, setMissingCanonical] = useState<{
    memoryId: string | null;
    notice: string | null;
  }>({ memoryId: null, notice: null });
  const lastListScrollTop = useRef(0);
  const mastheadRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const mountedRef = useRef(true);
  // Match Workspace's explicit-refresh precedence: polls may supersede polls,
  // but cannot overtake a forced refresh; a newer forced epoch still wins.
  const loadGenerationRef = useRef(0);
  const loadForceEpochRef = useRef(0);
  const loadActiveForceEpochRef = useRef<number | null>(null);

  const collapseMasthead = useCallback(() => {
    if (
      typeof document !== "undefined" &&
      mastheadRef.current?.contains(document.activeElement)
    ) {
      searchInputRef.current?.focus({ preventScroll: true });
    }
    setHeaderCollapsed(true);
  }, []);

  const onListScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      const top = event.currentTarget.scrollTop;
      const previous = lastListScrollTop.current;
      if (top <= 4) setHeaderCollapsed(false);
      else if (top > previous + 4) collapseMasthead();
      else if (top < previous - 4) setHeaderCollapsed(false);
      lastListScrollTop.current = top;
    },
    [collapseMasthead],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      loadGenerationRef.current += 1;
      loadForceEpochRef.current += 1;
      loadActiveForceEpochRef.current = null;
    };
  }, []);

  const settleMissingCanonicalRefresh = useCallback(
    (refresh: CanonicalMemoryListLoad) => {
      setMissingCanonical((current) => {
        const reconciled = reconcileMissingCanonicalRefresh({
          missingMemoryId: current.memoryId,
          notice: current.notice,
          refreshState: refresh.state,
          entries: refresh.state === "ready" ? refresh.entries : [],
        });
        return {
          memoryId: reconciled.missingMemoryId,
          notice: reconciled.notice,
        };
      });
    },
    [],
  );

  const loadFiles = useCallback(
    async (force: boolean, isCurrent: () => boolean) => {
      try {
        const result = await readSurfaceResource<FileMemoryResponse>(
          "memory:list",
          force,
        );
        if (!isCurrent()) return;
        const data = result.data;
        const pendingDelete = pendingDeletePathRef.current;
        if (data.ok) {
          setFilesState({
            state: "ready",
            entries: data.entries.filter(
              (entry) => entry.fullPath !== pendingDelete,
            ),
          });
        } else {
          setFilesState((current) => ({
            state: "error",
            entries: (data.entries ?? current.entries).filter(
              (entry) => entry.fullPath !== pendingDelete,
            ),
            error: data.error ?? "Memory files unavailable",
          }));
        }
      } catch (error) {
        if (!isCurrent()) return;
        setFilesState((current) => ({
          state: "error",
          entries: current.entries,
          error: error instanceof Error ? error.message : "Memory files unavailable",
        }));
      }
    },
    [],
  );

  const load = useCallback(
    async (force = false) => {
      const generation = ++loadGenerationRef.current;
      const forceEpoch = force
        ? ++loadForceEpochRef.current
        : loadForceEpochRef.current;
      const startedDuringForcedRefresh =
        !force && loadActiveForceEpochRef.current !== null;
      if (force) loadActiveForceEpochRef.current = forceEpoch;
      const isCurrent = () =>
        mountedRef.current &&
        (force
          ? forceEpoch === loadForceEpochRef.current
          : !startedDuringForcedRefresh &&
            forceEpoch === loadForceEpochRef.current &&
            generation === loadGenerationRef.current);

      try {
        if (feed) {
          if (force) {
            const canonical = await feed.reload();
            if (!isCurrent()) return;
            settleMissingCanonicalRefresh(canonical);
          }
          return;
        }

        const fileLoad = loadFiles(force, isCurrent);
        if (force) {
          const canonical = await refreshCanonicalMemory();
          if (!isCurrent()) return;
          setCanonicalState((current) =>
            canonicalStateFrom(canonical.list, current.entries)
          );
          setOverviewState(overviewStateFrom(canonical.overview));
          settleMissingCanonicalRefresh(canonical.list);
        } else {
          const [canonical, overview] = await Promise.all([
            loadCanonicalMemoryList(),
            loadCanonicalMemoryOverview(),
          ]);
          if (!isCurrent()) return;
          setCanonicalState((current) =>
            canonicalStateFrom(canonical, current.entries)
          );
          setOverviewState(overviewStateFrom(overview));
        }
        await fileLoad;
        if (!isCurrent()) return;
        setLastLoadedAt(new Date().toISOString());
      } finally {
        if (
          force &&
          loadActiveForceEpochRef.current === forceEpoch
        ) {
          loadActiveForceEpochRef.current = null;
        }
      }
    },
    [feed, loadFiles, settleMissingCanonicalRefresh],
  );

  useEffect(() => {
    if (!feed) return;
    const pendingDelete = pendingDeletePathRef.current;
    setCanonicalState(feed.canonical);
    setOverviewState(feed.overview);
    setFilesState(
      withFileEntries(
        feed.files,
        feed.files.entries.filter(
          (entry) => entry.fullPath !== pendingDelete,
        ),
      ),
    );
    setLastLoadedAt(feed.lastLoadedAt);
  }, [feed]);

  useEffect(() => {
    if (!feed) void load();
  }, [feed, load]);
  usePausablePoll(() => void load(), 30_000, { enabled: !feed });

  const handleDelete = useCallback(
    (row: FileMemoryRow) => {
      const path = row.path;
      pendingDeletePathRef.current = path;
      setFilesState((current) =>
        withFileEntries(
          current,
          current.entries.filter((entry) => entry.fullPath !== path),
        )
      );
      scheduleDelete({ key: row.rowId }, row.title, async () => {
        const response = await fetch("/api/memory/delete", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path }),
        });
        if (response.ok) invalidateIfDefined("memory:list");
        if (pendingDeletePathRef.current === path) {
          pendingDeletePathRef.current = null;
        }
        if (feed) void feed.reload();
      });
    },
    [feed, scheduleDelete],
  );

  const handleUndoDelete = useCallback(() => {
    pendingDeletePathRef.current = null;
    undoDelete();
    void load(true);
  }, [load, undoDelete]);

  const handleMissingCanonicalMemory = useCallback((memoryId: string) => {
    setCanonicalState((current) => ({
      ...current,
      entries: excludeMissingCanonicalMemory(current.entries, memoryId),
    }));
    setMissingCanonical({
      memoryId,
      notice: "Memory not found",
    });
    setPinnedCanonicalSelection((current) =>
      current?.selection.id === memoryId ? null : current
    );
    setSelectedRowId(null);
    setExpandRow(null);
  }, []);

  const familiarById = useMemo(
    () => new Map(familiars.map((familiar) => [familiar.id, familiar])),
    [familiars],
  );
  const effectiveFamiliarFilter =
    lockToFamiliar && activeFamiliar?.id
      ? activeFamiliar.id
      : familiarFilter;
  const activePendingCanonicalRowId =
    pendingCanonicalMemorySelection?.familiarId === effectiveFamiliarFilter
      ? canonicalMemorySelectionRowId(pendingCanonicalMemorySelection)
      : null;
  const normalizedQuery = query.trim().toLowerCase();
  const availableCanonicalEntries = useMemo(
    () =>
      excludeMissingCanonicalMemory(
        canonicalState.entries,
        missingCanonical.memoryId,
      ),
    [canonicalState.entries, missingCanonical.memoryId],
  );
  const activePinnedCanonicalRow =
    !pendingCanonicalMemorySelection &&
    pinnedCanonicalSelection?.selection.familiarId ===
      effectiveFamiliarFilter &&
    (canonicalState.state !== "ready" ||
      availableCanonicalEntries.some(
        (entry) =>
          entry.id === pinnedCanonicalSelection.selection.id &&
          entry.familiarId ===
            pinnedCanonicalSelection.selection.familiarId,
      ))
      ? pinnedCanonicalSelection.row
      : null;
  const activeCanonicalNavigationRowId =
    activePendingCanonicalRowId ?? activePinnedCanonicalRow?.rowId ?? null;

  const visibleCanonical = useMemo(() => {
    if (staleOnly) return [];
    return availableCanonicalEntries
      .filter((entry) => entry.familiarId === effectiveFamiliarFilter)
      .filter((entry) => memoryMatches(entry, normalizedQuery))
      .sort((a, b) =>
        a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0
      );
  }, [
    availableCanonicalEntries,
    effectiveFamiliarFilter,
    normalizedQuery,
    staleOnly,
  ]);

  const familiarScopedFiles = useMemo(
    () =>
      filesState.entries.filter(
        (entry) => entry.familiarId === effectiveFamiliarFilter,
      ),
    [effectiveFamiliarFilter, filesState.entries],
  );

  const visibleFiles = useMemo(() => {
    const staleByEntry = new Map(
      familiarScopedFiles.map((entry) => [
        entry,
        detectStale(normalizeFileEntry(entry)).stale,
      ]),
    );
    const compare: Record<
      typeof sortMode,
      (a: FileMemoryEntry, b: FileMemoryEntry) => number
    > = {
      recent: (a, b) =>
        a.modified < b.modified ? 1 : a.modified > b.modified ? -1 : 0,
      oldest: (a, b) =>
        a.modified > b.modified ? 1 : a.modified < b.modified ? -1 : 0,
      name: (a, b) => fileBase(a.relPath).localeCompare(fileBase(b.relPath)),
      size: (a, b) => b.size - a.size,
      staleFirst: (a, b) =>
        Number(staleByEntry.get(b)) - Number(staleByEntry.get(a)),
    };
    return familiarScopedFiles
      .filter(
        (entry) =>
          sourceFilter === "all" || entry.sourceKind === sourceFilter,
      )
      .filter((entry) => memoryMatches(entry, normalizedQuery))
      .filter((entry) => !staleOnly || staleByEntry.get(entry) === true)
      .sort(compare[sortMode]);
  }, [
    familiarScopedFiles,
    normalizedQuery,
    sortMode,
    sourceFilter,
    staleOnly,
  ]);

  const unifiedRows = useMemo(
    () => {
      const rows = buildMemoryRows({
        canonical: availableCanonicalEntries,
        files: filesState.entries,
        familiarFilter: effectiveFamiliarFilter,
        query: normalizedQuery,
        sourceFilter,
        sortMode,
        staleOnly,
        familiarLabel: (id) => familiarById.get(id)?.display_name ?? id,
      });
      if (
        activePendingCanonicalRowId &&
        !rows.some((row) => row.rowId === activePendingCanonicalRowId)
      ) {
        const pendingTarget = availableCanonicalEntries.find(
          (entry) =>
            entry.id === pendingCanonicalMemorySelection?.id &&
            entry.familiarId === effectiveFamiliarFilter,
        );
        if (!pendingTarget) return rows;

        const [pendingRow] = buildMemoryRows({
          canonical: [pendingTarget],
          files: [],
          familiarFilter: effectiveFamiliarFilter,
          query: "",
          sourceFilter: "all",
          sortMode,
          staleOnly: false,
          familiarLabel: (id) => familiarById.get(id)?.display_name ?? id,
        });
        return pendingRow ? [pendingRow, ...rows] : rows;
      }
      if (
        activePinnedCanonicalRow &&
        !rows.some((row) => row.rowId === activePinnedCanonicalRow.rowId)
      ) {
        return [activePinnedCanonicalRow, ...rows];
      }
      return rows;
    },
    [
      activePendingCanonicalRowId,
      activePinnedCanonicalRow,
      availableCanonicalEntries,
      effectiveFamiliarFilter,
      familiarById,
      filesState.entries,
      normalizedQuery,
      pendingCanonicalMemorySelection?.id,
      sortMode,
      sourceFilter,
      staleOnly,
    ],
  );
  const selectedRow = useMemo(
    () => unifiedRows.find((row) => row.rowId === selectedRowId) ?? null,
    [selectedRowId, unifiedRows],
  );

  useEffect(() => {
    const reconciled =
      activeCanonicalNavigationRowId ??
      reconcileMemorySelection({
        selectedRowId,
        rowIds: unifiedRows.map((row) => row.rowId),
        canonicalState: canonicalState.state,
        filesState: filesState.state,
      });
    if (reconciled === selectedRowId) return;
    setSelectedRowId(reconciled);
    if (expandRow?.rowId === selectedRowId) setExpandRow(null);
  }, [
    activeCanonicalNavigationRowId,
    canonicalState.state,
    expandRow?.rowId,
    filesState.state,
    selectedRowId,
    unifiedRows,
  ]);

  useEffect(() => {
    setPinnedCanonicalSelection((current) => {
      if (!current) return current;
      if (
        pendingCanonicalMemorySelection &&
        pendingCanonicalMemorySelection !== current.selection
      ) {
        return null;
      }
      if (current.selection.familiarId !== effectiveFamiliarFilter) {
        return null;
      }
      if (
        canonicalState.state === "ready" &&
        !availableCanonicalEntries.some(
          (entry) =>
            entry.id === current.selection.id &&
            entry.familiarId === current.selection.familiarId,
        )
      ) {
        return null;
      }
      return current;
    });
  }, [
    availableCanonicalEntries,
    canonicalState.state,
    effectiveFamiliarFilter,
    pendingCanonicalMemorySelection,
  ]);

  useEffect(() => {
    if (!pendingCanonicalMemorySelection) return;
    if (
      acknowledgedPendingSelectionRef.current ===
      pendingCanonicalMemorySelection
    ) {
      return;
    }
    if (selectedRow?.kind !== "canonical") return;
    if (
      !isCanonicalMemorySelectionApplied({
        pending: pendingCanonicalMemorySelection,
        familiarId: effectiveFamiliarFilter,
        selectedRowId,
        selectedMemoryId: selectedRow.memoryId,
      })
    ) {
      return;
    }
    acknowledgedPendingSelectionRef.current =
      pendingCanonicalMemorySelection;
    setPinnedCanonicalSelection({
      selection: pendingCanonicalMemorySelection,
      row: selectedRow,
    });
    onCanonicalMemorySelectionApplied?.(
      pendingCanonicalMemorySelection.id,
    );
  }, [
    effectiveFamiliarFilter,
    onCanonicalMemorySelectionApplied,
    pendingCanonicalMemorySelection,
    selectedRow,
    selectedRowId,
  ]);

  const selectMemoryRow = useCallback((rowId: MemoryRow["rowId"]) => {
    setPinnedCanonicalSelection((current) =>
      current && current.row.rowId !== rowId ? null : current
    );
    setSelectedRowId(rowId);
  }, []);

  const clearMemorySelection = useCallback(() => {
    setPinnedCanonicalSelection(null);
    setSelectedRowId(null);
  }, []);
  const pagedRows = useMemo(
    () => unifiedRows.slice(0, fileLimit),
    [fileLimit, unifiedRows],
  );

  const renderRow = (row: MemoryRow) => {
    const common = {
      age: age(row.sortTime),
      selected: selectedRowId === row.rowId,
      onSelect: () => selectMemoryRow(row.rowId),
      onExpand: () => setExpandRow(row),
    };
    return row.kind === "file" ? (
      <MemoryRowItem
        key={row.rowId}
        row={row}
        {...common}
        onDelete={
          row.protection === "structural"
            ? undefined
            : () => handleDelete(row)
        }
      />
    ) : (
      <MemoryRowItem key={row.rowId} row={row} {...common} />
    );
  };

  const suggestions = useMemo(
    () =>
      visibleFiles
        .map(normalizeFileEntry)
        .filter((entry) => detectStale(entry).stale),
    [visibleFiles],
  );
  const bulkDeletable = useMemo(
    () => suggestions.filter((entry) => entry.protection === "normal"),
    [suggestions],
  );

  useEffect(() => {
    setFileLimit(FILE_PAGE);
  }, [
    effectiveFamiliarFilter,
    normalizedQuery,
    sortMode,
    sourceFilter,
    staleOnly,
  ]);

  const familiarsWithMemory = useMemo(() => {
    const ids = new Set(
      availableCanonicalEntries.map((entry) => entry.familiarId),
    );
    return familiars.filter((familiar) => ids.has(familiar.id));
  }, [availableCanonicalEntries, familiars]);

  useEffect(() => {
    if (lockToFamiliar) return;
    const familiarIds = new Set(familiars.map((familiar) => familiar.id));
    const memoryFamiliarIds = new Set(
      canonicalState.entries.map((entry) => entry.familiarId),
    );
    if (
      storedFamiliarFilter &&
      familiarIds.has(storedFamiliarFilter) &&
      (memoryFamiliarIds.size === 0 ||
        memoryFamiliarIds.has(storedFamiliarFilter))
    ) {
      return;
    }
    const next =
      activeFamiliar?.id && familiarIds.has(activeFamiliar.id)
        ? activeFamiliar.id
        : familiars.find((familiar) => memoryFamiliarIds.has(familiar.id))?.id ??
          familiars[0]?.id ??
          "";
    if (next && next !== storedFamiliarFilter) setFamiliarFilter(next);
  }, [
    activeFamiliar?.id,
    canonicalState.entries,
    familiars,
    lockToFamiliar,
    setFamiliarFilter,
    storedFamiliarFilter,
  ]);

  const selectedFamiliar =
    familiarById.get(effectiveFamiliarFilter) ??
    (activeFamiliar?.id === effectiveFamiliarFilter ? activeFamiliar : null);
  const familiarOptions = useMemo(() => {
    const options =
      familiarsWithMemory.length > 0 ? familiarsWithMemory : familiars;
    if (
      !selectedFamiliar ||
      options.some((familiar) => familiar.id === selectedFamiliar.id)
    ) {
      return options;
    }
    return [selectedFamiliar, ...options];
  }, [familiars, familiarsWithMemory, selectedFamiliar]);

  const fileSourceCounts = useMemo(
    () => ({
      covenOrigin: familiarScopedFiles.filter(
        (entry) => entry.sourceKind === "coven-origin",
      ).length,
      externalHarnesses: familiarScopedFiles.filter(
        (entry) => entry.sourceKind === "external-harness",
      ).length,
      runtimeMemory: familiarScopedFiles.filter(
        (entry) => entry.sourceKind === "runtime",
      ).length,
    }),
    [familiarScopedFiles],
  );

  const filesSettled = filesState.state !== "loading";
  const listPresentation = memoryListPresentation({
    canonicalState: canonicalState.state,
    filesState: filesState.state,
    rowCount: unifiedRows.length,
  });
  const contentClass = compact
    ? "flex flex-col gap-4 overflow-y-auto p-4"
    : "grid min-h-0 gap-4 p-4 @min-[1024px]/memview:grid-cols-[minmax(0,1fr)_minmax(420px,560px)]";
  const canonicalError =
    canonicalState.state === "error"
      ? canonicalMemoryErrorCopy(canonicalState.error.code)
      : null;

  return (
    <div className="@container/memview flex min-h-0 flex-1 flex-col bg-[var(--bg-base)]">
      <div
        className={`shrink-0 border-b border-[var(--border-hairline)] ${
          compact ? "px-3 py-2" : "px-4 py-3"
        }`}
      >
        {!compact ? (
          <div
            ref={mastheadRef}
            data-testid="memory-masthead"
            data-collapsed={headerCollapsed ? "true" : "false"}
            aria-hidden={headerCollapsed}
            inert={headerCollapsed ? true : undefined}
            className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${
              headerCollapsed ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100"
            }`}
          >
            <div className="min-h-0 overflow-hidden">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Icon
                      name="ph:brain-bold"
                      width={15}
                      className="text-[var(--accent-presence)]"
                    />
                    <h2 className="text-[length:var(--text-md)] font-semibold text-[var(--text-primary)]">
                      Familiar Memory
                    </h2>
                  </div>
                  <p className="mt-1 text-[length:var(--text-xs)] text-[var(--text-muted)]">
                    Trusted canonical recall and local memory files for one familiar.
                  </p>
                </div>
                {lastLoadedAt ? (
                  <span
                    className="text-[length:var(--text-2xs)] text-[var(--text-muted)]"
                    title={`Last refreshed ${formatTimestamp(
                      lastLoadedAt,
                      readDateTimePrefs(),
                    )}`}
                  >
                    Updated {age(lastLoadedAt)}
                  </span>
                ) : null}
              </div>
              <div
                data-testid="memory-stats-inline"
                className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[length:var(--text-xs)] text-[var(--text-secondary)]"
              >
                <span className="inline-flex items-baseline gap-1 px-1">
                  <span className="text-[var(--text-muted)]">
                    Familiar memories
                  </span>
                  <span className="font-semibold text-[var(--text-primary)]">
                    {visibleCanonical.length}
                  </span>
                </span>
                <span aria-hidden className="text-[var(--border-strong)]">
                  ·
                </span>
                <span className="mr-0.5 text-[length:var(--text-2xs)] uppercase tracking-wider text-[var(--text-muted)]">
                  Sources
                </span>
                <SourceFilterChip
                  label="Coven origin"
                  count={fileSourceCounts.covenOrigin}
                  active={sourceFilter === "coven-origin"}
                  onClick={() =>
                    setSourceFilter((current) =>
                      current === "coven-origin" ? "all" : "coven-origin"
                    )
                  }
                  help="Files written by this Cave's own familiars and conversations"
                />
                <SourceFilterChip
                  label="External runtimes"
                  count={fileSourceCounts.externalHarnesses}
                  active={sourceFilter === "external-harness"}
                  onClick={() =>
                    setSourceFilter((current) =>
                      current === "external-harness"
                        ? "all"
                        : "external-harness"
                    )
                  }
                  help="Memory kept by other agent tools on this machine"
                />
                <SourceFilterChip
                  label="Runtime memory"
                  count={fileSourceCounts.runtimeMemory}
                  active={sourceFilter === "runtime"}
                  onClick={() =>
                    setSourceFilter((current) =>
                      current === "runtime" ? "all" : "runtime"
                    )
                  }
                  help="Working files a runtime writes while it runs"
                />
              </div>
              <div className="mt-3">
                {overviewState.state === "ready" ? (
                  <CanonicalMemoryOverviewPanel overview={overviewState.value} />
                ) : overviewState.state === "loading" ? (
                  <SkeletonRows count={2} />
                ) : overviewState.state === "error" ? (
                  <ErrorState
                    compact
                    live={false}
                    headline="Couldn't load canonical overview"
                    subtitle={
                      canonicalMemoryErrorCopy(overviewState.error.code).subtitle
                    }
                  />
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        <div
          className={`${
            compact || headerCollapsed ? "" : "mt-3"
          } flex flex-wrap items-center gap-2 transition-[margin] duration-200`}
        >
          <div className={`relative ${compact ? "min-w-0" : "min-w-[220px]"} flex-1`}>
            <Icon
              name="ph:magnifying-glass"
              width={12}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
            />
            <input
              ref={searchInputRef}
              type="search"
              aria-label={
                lockToFamiliar && selectedFamiliar?.display_name
                  ? `Search ${selectedFamiliar.display_name}'s memory`
                  : "Search memory"
              }
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape" && query) {
                  event.preventDefault();
                  setQuery("");
                }
              }}
              placeholder={
                lockToFamiliar && selectedFamiliar?.display_name
                  ? `Search ${selectedFamiliar.display_name}'s memory…`
                  : "Search memory..."
              }
              className="focus-ring h-8 w-full rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)]/40 pl-7 pr-8 text-[length:var(--text-sm)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-presence)] [&::-webkit-search-cancel-button]:appearance-none"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="focus-ring absolute right-1.5 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
              >
                <Icon name="ph:x-bold" width={10} />
              </button>
            ) : null}
          </div>
          {!lockToFamiliar ? (
            <StandardSelect
              label="Filter memory by familiar"
              value={familiarFilter}
              onChange={setFamiliarFilter}
              className="h-8 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)]/40 px-2 text-[length:var(--text-sm)] text-[var(--text-secondary)] focus:border-[var(--accent-presence)]"
              options={familiarOptions.map((familiar) => ({
                value: familiar.id,
                label: familiar.display_name,
              }))}
            />
          ) : null}
          <Button
            size="xs"
            variant="ghost"
            leadingIcon="ph:arrows-clockwise"
            aria-label="Refresh memory"
            onClick={() => void load(true)}
          >
            Refresh
          </Button>
        </div>

        {!compact ? (
          <div className="memory-controls mt-3">
            <label className="memory-control">
              Group
              <StandardSelect<GroupBy>
                label="Group memory"
                value={groupMode}
                onChange={setGroupMode}
                className="memory-control-select"
                options={[
                  { value: "none", label: "None" },
                  { value: "type", label: "Type" },
                  { value: "source", label: "Source" },
                  { value: "date", label: "Date" },
                ]}
              />
            </label>
            <label className="memory-control">
              Sort
              <StandardSelect<typeof sortMode>
                label="Sort memory"
                value={sortMode}
                onChange={setSortMode}
                className="memory-control-select"
                options={[
                  { value: "recent", label: "Recent" },
                  { value: "oldest", label: "Oldest" },
                  { value: "name", label: "Name" },
                  { value: "size", label: "Size" },
                  { value: "staleFirst", label: "Stale first" },
                ]}
              />
            </label>
            <button
              type="button"
              aria-pressed={staleOnly}
              onClick={() => setStaleOnly((current) => !current)}
              className={`focus-ring inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[length:var(--text-xs)] transition-colors ${
                staleOnly
                  ? "border-[var(--color-warning)] bg-[var(--color-warning)]/12 text-[var(--text-primary)]"
                  : "border-[var(--border-hairline)] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]"
              }`}
            >
              Stale ({suggestions.length})
            </button>
          </div>
        ) : null}

        {canonicalError ? (
          <div className="mt-2">
            <ErrorState
              compact
              headline="Couldn't load familiar memories"
              subtitle={canonicalError.subtitle}
            />
          </div>
        ) : null}
        {filesState.state === "error" ? (
          <div className="mt-2">
            <ErrorState
              compact
              headline="Couldn't load memory files"
              subtitle={filesState.error}
            />
          </div>
        ) : null}
        {missingCanonical.notice ? (
          <div
            role="status"
            className="mt-2 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)]/40 px-3 py-2 text-[length:var(--text-xs)] text-[var(--text-secondary)]"
          >
            <span className="font-medium text-[var(--text-primary)]">
              Memory not found.
            </span>{" "}
            The stale row was removed. Choose Refresh to reconcile the canonical list.
          </div>
        ) : null}
      </div>

      <div className={`min-h-0 flex-1 ${contentClass}`}>
        {compact ? (
          <>
            {listPresentation === "empty" ? (
              <div className="grid place-items-center rounded-lg border border-dashed border-[var(--border-hairline)] px-4 py-6">
                <EmptyState
                  compact
                  icon="ph:brain"
                  headline={`No memories yet for ${
                    selectedFamiliar?.display_name ?? "this familiar"
                  }`}
                  subtitle="Familiar memories are saved during chats after verification. Memory files appear when the familiar's runtime writes to disk."
                />
              </div>
            ) : null}
            <section className="min-h-0">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-[length:var(--text-xs)] font-semibold uppercase tracking-widest text-[var(--text-secondary)]">
                  Familiar memory
                </h3>
                <div className="flex items-center gap-2">
                  <span className="text-[length:var(--text-2xs)] text-[var(--text-muted)]">
                    {visibleCanonical.length} visible
                  </span>
                </div>
              </div>
              {canonicalState.state === "loading" ? (
                <SkeletonRows count={4} className="p-2" />
              ) : canonicalState.state === "ready" &&
                visibleCanonical.length === 0 ? (
                <EmptyState
                  compact
                  icon="ph:brain"
                  headline="No familiar memories match this view."
                />
              ) : (
                <div className="flex flex-col divide-y divide-[var(--border-hairline)] border-t border-[var(--border-hairline)]">
                  {visibleCanonical.slice(0, effectiveLimit).map((entry) => {
                    const familiar = familiarById.get(entry.familiarId);
                    return (
                      <button
                        type="button"
                        key={entry.id}
                        onClick={() => {
                          selectMemoryRow(`coven:${entry.id}`);
                          const row = unifiedRows.find(
                            (candidate) =>
                              candidate.kind === "canonical" &&
                              candidate.memoryId === entry.id,
                          );
                          if (row) setExpandRow(row);
                        }}
                        className="focus-ring-inset px-1 py-3 text-left transition-colors hover:bg-[var(--bg-raised)]/30"
                      >
                        <span className="flex items-start justify-between gap-2">
                          <span className="min-w-0">
                            <span className="flex items-center gap-1.5 text-[length:var(--text-2xs)] text-[var(--text-muted)]">
                              <span className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[var(--text-secondary)]">
                                {familiar?.display_name ?? entry.familiarId}
                              </span>
                              <RelativeTime iso={entry.updatedAt} />
                            </span>
                            <span className="mt-2 block line-clamp-2 text-[length:var(--text-base)] font-medium text-[var(--text-primary)]">
                              {entry.title}
                            </span>
                            <span className="mt-2 block line-clamp-3 text-[length:var(--text-xs)] leading-5 text-[var(--text-secondary)]">
                              {entry.excerpt}
                            </span>
                            <span className="mt-2 block text-[length:var(--text-2xs)] text-[var(--text-muted)]">
                              {entry.verification.state} ·{" "}
                              {entry.privacy.classification ?? "unclassified"}
                            </span>
                          </span>
                          <Icon
                            name="ph:brain"
                            width={14}
                            className="mt-0.5 shrink-0 text-[var(--text-muted)]"
                          />
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
            <section className="min-h-0">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-[length:var(--text-xs)] font-semibold uppercase tracking-widest text-[var(--text-secondary)]">
                  Memory files
                </h3>
                <span className="text-[length:var(--text-2xs)] text-[var(--text-muted)]">
                  {visibleFiles.length} visible
                </span>
              </div>
              <MemoryFilesList
                entries={visibleFiles}
                onOpen={onOpenMemoryFile}
                loaded={filesSettled}
                error={
                  filesState.state === "error" ? filesState.error : null
                }
                limit={effectiveLimit}
                activeFamiliarId={effectiveFamiliarFilter}
              />
            </section>
          </>
        ) : (
          <>
            <section
              className={`min-h-0 flex-col ${
                selectedRowId
                  ? "hidden @min-[1024px]/memview:flex"
                  : "flex"
              }`}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-[length:var(--text-xs)] font-semibold uppercase tracking-widest text-[var(--text-secondary)]">
                  Memories
                </h3>
                <div className="flex items-center gap-2">
                  {staleOnly && bulkDeletable.length > 0 ? (
                    <button
                      type="button"
                      onClick={() =>
                        unifiedRows
                          .filter(
                            (row): row is FileMemoryRow =>
                              row.kind === "file" &&
                              row.stale &&
                              row.protection === "normal",
                          )
                          .forEach(handleDelete)
                      }
                      className="focus-ring inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border-hairline)] px-2 text-[length:var(--text-xs)] text-[var(--color-warning)] hover:bg-[var(--bg-raised)]"
                    >
                      <Icon name="ph:trash" width={11} />
                      Delete {bulkDeletable.length} cleanable
                    </button>
                  ) : null}
                  <span className="text-[length:var(--text-2xs)] text-[var(--text-muted)]">
                    {unifiedRows.length > fileLimit
                      ? `${fileLimit} of ${unifiedRows.length}`
                      : `${unifiedRows.length} shown`}
                  </span>
                </div>
              </div>
              <div
                onScroll={onListScroll}
                className="min-h-0 flex-1 overflow-y-auto border-t border-[var(--border-hairline)]"
              >
                {listPresentation === "loading" ? (
                  <SkeletonRows count={6} className="p-3" />
                ) : listPresentation === "empty" ? (
                  <EmptyState
                    compact
                    icon="ph:brain"
                    headline="No memories match this view."
                  />
                ) : listPresentation === "unavailable" ? null : groupMode === "none" ? (
                  <ul className="divide-y divide-[var(--border-hairline)]">
                    {pagedRows.map(renderRow)}
                  </ul>
                ) : (
                  <div>
                    {groupMemoryRows(pagedRows, groupMode).map((group) => (
                      <div key={group.key}>
                        <h4 className="sticky top-0 z-[1] flex items-center gap-1.5 border-b border-[var(--border-hairline)] bg-[var(--bg-raised)]/95 px-3 py-1.5 text-[length:var(--text-2xs)] font-semibold uppercase tracking-widest text-[var(--text-secondary)] backdrop-blur">
                          {group.label}
                          <span className="font-normal text-[var(--text-muted)]">
                            ({group.rows.length})
                          </span>
                        </h4>
                        <ul className="divide-y divide-[var(--border-hairline)]">
                          {group.rows.map(renderRow)}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
                {unifiedRows.length > fileLimit ? (
                  <button
                    type="button"
                    onClick={() => setFileLimit((current) => current + FILE_PAGE)}
                    className="focus-ring flex w-full items-center justify-center gap-1.5 border-t border-[var(--border-hairline)] px-3 py-2 text-[length:var(--text-xs)] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
                  >
                    <Icon name="ph:caret-down" width={11} />
                    Show more · {fileLimit} of {unifiedRows.length}
                  </button>
                ) : null}
              </div>
            </section>

            <div
              className={`min-h-0 flex-col ${
                selectedRowId
                  ? "flex"
                  : "hidden @min-[1024px]/memview:flex"
              }`}
            >
              {selectedRow?.kind === "canonical" ? (
                <CanonicalMemoryReader
                  memoryId={selectedRow.memoryId}
                  localDaemonReady={localDaemonReady}
                  onMissing={() => handleMissingCanonicalMemory(selectedRow.memoryId)}
                  onRefresh={() => load(true)}
                  onBack={clearMemorySelection}
                />
              ) : (
                <MemoryReaderPane
                  row={selectedRow?.kind === "file" ? selectedRow : null}
                  age={selectedRow ? age(selectedRow.sortTime) : ""}
                  sizeLabel={
                    selectedRow?.kind === "file"
                      ? formatBytes(selectedRow.size)
                      : ""
                  }
                  onOpenFile={(path) => onOpenMemoryFile?.(path)}
                  onExpand={(row) => setExpandRow(row)}
                  onBack={clearMemorySelection}
                />
              )}
            </div>
          </>
        )}
      </div>

      {undoPending ? (
        <UndoToast
          message={
            <>
              Deleted <strong>{undoPending.label}</strong>
            </>
          }
          icon="ph:trash"
          undoAriaLabel={`Undo delete ${undoPending.label}`}
          onUndo={handleUndoDelete}
          onDismiss={commitDelete}
        />
      ) : null}

      {expandRow?.kind === "file" ? (
        <MemoryReaderModal
          path={expandRow.contentPath}
          title={expandRow.title}
          onClose={() => setExpandRow(null)}
        />
      ) : expandRow?.kind === "canonical" ? (
        <Modal
          open
          wide
          breadcrumb={["Familiar memory", expandRow.title]}
          onClose={() => setExpandRow(null)}
        >
          <div className="h-[75vh] min-h-0">
            <CanonicalMemoryReader
              memoryId={expandRow.memoryId}
              localDaemonReady={localDaemonReady}
              onMissing={() => handleMissingCanonicalMemory(expandRow.memoryId)}
              onRefresh={() => load(true)}
            />
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

export { MemoryFilesList, MemoryReaderModal } from "@/components/familiars-memory-files";
