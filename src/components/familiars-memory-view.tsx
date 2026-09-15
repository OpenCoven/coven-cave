"use client";

import "@/styles/cave-md.css";
import "@/styles/familiars-memory.css";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  MemoryFilesList,
  MemoryReaderModal,
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
import { SearchInput } from "@/components/ui/search-input";
import { StandardSelect } from "@/components/ui/select";
import { SkeletonRows } from "@/components/ui/skeleton";
import {
  Popover,
  PopoverBody,
  PopoverLabel,
} from "@/components/ui/popover";
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
  groupMemoryRows,
  memoryListPresentation,
  reconcileMemorySelection,
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

/** One local-file memory snapshot shared by every embedded memory surface.
 *  The canonical list and overview went with the vault, which now lives in the
 *  dedicated memory application. */
export type MemoryFeed = {
  files:
    | { state: "loading"; entries: FileMemoryEntry[] }
    | { state: "ready"; entries: FileMemoryEntry[] }
    | { state: "error"; entries: FileMemoryEntry[]; error: string };
  lastLoadedAt: string | null;
  reload: () => Promise<void>;
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
};

type FileMemoryResponse =
  | { ok: true; entries: FileMemoryEntry[] }
  | { ok: false; entries?: FileMemoryEntry[]; error?: string };

type FilesState = MemoryFeed["files"];

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
}: Props) {
  useDateTimePrefs();
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
  const [filtersOpen, setFiltersOpen] = useState(false);
  const sourceSummaryId = useId();
  const filtersTriggerRef = useRef<HTMLButtonElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const mountedRef = useRef(true);
  // Match Workspace's explicit-refresh precedence: polls may supersede polls,
  // but cannot overtake a forced refresh; a newer forced epoch still wins.
  const loadGenerationRef = useRef(0);
  const loadForceEpochRef = useRef(0);
  const loadActiveForceEpochRef = useRef<number | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      loadGenerationRef.current += 1;
      loadForceEpochRef.current += 1;
      loadActiveForceEpochRef.current = null;
    };
  }, []);

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
            await feed.reload();
            if (!isCurrent()) return;
          }
          return;
        }

        await loadFiles(force, isCurrent);
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
    [feed, loadFiles],
  );

  useEffect(() => {
    if (!feed) return;
    const pendingDelete = pendingDeletePathRef.current;
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


  const familiarById = useMemo(
    () => new Map(familiars.map((familiar) => [familiar.id, familiar])),
    [familiars],
  );
  const effectiveFamiliarFilter =
    lockToFamiliar && activeFamiliar?.id
      ? activeFamiliar.id
      : familiarFilter;
  const normalizedQuery = query.trim().toLowerCase();
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
    () =>
      buildMemoryRows({
        files: filesState.entries,
        familiarFilter: effectiveFamiliarFilter,
        query: normalizedQuery,
        sourceFilter,
        sortMode,
        staleOnly,
        familiarLabel: (id) => familiarById.get(id)?.display_name ?? id,
      }),
    [
      effectiveFamiliarFilter,
      familiarById,
      filesState.entries,
      normalizedQuery,
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
    const reconciled = reconcileMemorySelection({
      selectedRowId,
      rowIds: unifiedRows.map((row) => row.rowId),
      filesState: filesState.state,
    });
    if (reconciled === selectedRowId) return;
    setSelectedRowId(reconciled);
    if (expandRow?.rowId === selectedRowId) setExpandRow(null);
  }, [
    expandRow?.rowId,
    filesState.state,
    selectedRowId,
    unifiedRows,
  ]);

  const selectMemoryRow = useCallback((rowId: MemoryRow["rowId"]) => {
    setSelectedRowId(rowId);
  }, []);

  const clearMemorySelection = useCallback(() => {
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
  const activeFilterSummary = useMemo(() => {
    const parts: string[] = [];
    const sourceLabels: Record<string, string> = {
      "coven-origin": "Coven origin",
      "external-harness": "External runtimes",
      runtime: "Runtime memory",
    };
    if (sourceFilter !== "all") {
      parts.push(sourceLabels[sourceFilter] ?? sourceFilter);
    }
    if (groupMode !== "none") parts.push(`Group: ${groupMode}`);
    if (sortMode !== "recent") parts.push(`Sort: ${sortMode}`);
    if (staleOnly) parts.push("Stale");
    return parts.length > 0 ? parts.join(" · ") : "Filters";
  }, [groupMode, sortMode, sourceFilter, staleOnly]);

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
      filesState.entries
        .map((entry) => entry.familiarId)
        .filter((id): id is string => Boolean(id)),
    );
    return familiars.filter((familiar) => ids.has(familiar.id));
  }, [filesState.entries, familiars]);

  useEffect(() => {
    if (lockToFamiliar) return;
    const familiarIds = new Set(familiars.map((familiar) => familiar.id));
    const memoryFamiliarIds = new Set(
      filesState.entries
        .map((entry) => entry.familiarId)
        .filter((id): id is string => Boolean(id)),
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
    filesState.entries,
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
  const memorySourceSummary = `Coven origin ${fileSourceCounts.covenOrigin}; External runtimes ${fileSourceCounts.externalHarnesses}; Runtime memory ${fileSourceCounts.runtimeMemory}`;

  const filesSettled = filesState.state !== "loading";
  const listPresentation = memoryListPresentation({
    filesState: filesState.state,
    rowCount: unifiedRows.length,
  });
  const contentClass = compact
    ? "fm-content--compact flex flex-col overflow-y-auto"
    : "fm-content--split grid min-h-0";

  return (
    <div className="@container/memview fm-workspace flex min-h-0 flex-1 flex-col bg-[var(--bg-base)]">
      <div
        className={`fm-header shrink-0 border-b border-[var(--border-hairline)] ${
          compact ? "px-3 py-2" : "px-4 py-3"
        }`}
      >
        {!compact ? (
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[length:var(--text-xs)]">
            <div className="flex min-w-0 items-center gap-2">
              <Icon
                name="ph:brain-bold"
                width={14}
                className="shrink-0 text-[var(--accent-presence)]"
                aria-hidden
              />
              <h2 className="truncate font-semibold text-[var(--text-primary)]">
                Familiar Memory
              </h2>
              <span aria-hidden className="text-[var(--border-strong)]">·</span>
              <span className="truncate text-[var(--text-secondary)]">
                {selectedFamiliar?.display_name ?? "No familiar selected"}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[var(--text-muted)]">
              <span>{unifiedRows.length} shown</span>
              {lastLoadedAt ? (
                <>
                  <span aria-hidden>·</span>
                  <span
                    title={`Last refreshed ${formatTimestamp(
                      lastLoadedAt,
                      readDateTimePrefs(),
                    )}`}
                  >
                    Updated {age(lastLoadedAt)}
                  </span>
                </>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <SearchInput
            ref={searchInputRef}
            value={query}
            onValueChange={setQuery}
            onClear={() => setQuery("")}
            aria-label={
              lockToFamiliar && selectedFamiliar?.display_name
                ? `Search ${selectedFamiliar.display_name}'s memory`
                : "Search memory"
            }
            placeholder={
              lockToFamiliar && selectedFamiliar?.display_name
                ? `Search ${selectedFamiliar.display_name}'s memory…`
                : "Search memory…"
            }
            containerClassName="min-w-0 flex-1"
          />
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
          {!compact ? (
            <>
              <span id={sourceSummaryId} className="sr-only">
                Sources: {memorySourceSummary}
              </span>
              <button
                ref={filtersTriggerRef}
                type="button"
                aria-haspopup="dialog"
                aria-expanded={filtersOpen}
                aria-describedby={sourceSummaryId}
                onClick={() => setFiltersOpen((current) => !current)}
                className="focus-ring inline-flex h-8 max-w-56 items-center gap-1.5 rounded-md border border-[var(--border-hairline)] px-2 text-[length:var(--text-xs)] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
              >
                <Icon name="ph:funnel" width={11} aria-hidden />
                <span className="truncate">{activeFilterSummary}</span>
              </button>
              <Popover
                open={filtersOpen}
                onOpenChange={setFiltersOpen}
                anchorRef={filtersTriggerRef}
                placement="bottom-end"
                minWidth={300}
                ariaLabel="Memory filters"
              >
                <PopoverBody>
                  <PopoverLabel>Memory filters</PopoverLabel>
                  <div className="grid gap-3 p-3">
                    <div className="grid gap-1">
                      <span className="text-[length:var(--text-xs)] font-medium text-[var(--text-secondary)]">Source</span>
                      <StandardSelect<typeof sourceFilter>
                        label="Source"
                        value={sourceFilter}
                        onChange={setSourceFilter}
                        options={[
                          { value: "all", label: "All sources" },
                          { value: "coven-origin", label: `Coven origin (${fileSourceCounts.covenOrigin})` },
                          { value: "external-harness", label: `External runtimes (${fileSourceCounts.externalHarnesses})` },
                          { value: "runtime", label: `Runtime memory (${fileSourceCounts.runtimeMemory})` },
                        ]}
                      />
                    </div>
                    <div className="grid gap-1">
                      <span className="text-[length:var(--text-xs)] font-medium text-[var(--text-secondary)]">Group</span>
                      <StandardSelect<GroupBy>
                        label="Group"
                        value={groupMode}
                        onChange={setGroupMode}
                        options={[
                          { value: "none", label: "None" },
                          { value: "type", label: "Type" },
                          { value: "source", label: "Source" },
                          { value: "date", label: "Date" },
                        ]}
                      />
                    </div>
                    <div className="grid gap-1">
                      <span className="text-[length:var(--text-xs)] font-medium text-[var(--text-secondary)]">Sort</span>
                      <StandardSelect<typeof sortMode>
                        label="Sort"
                        value={sortMode}
                        onChange={setSortMode}
                        options={[
                          { value: "recent", label: "Recent" },
                          { value: "oldest", label: "Oldest" },
                          { value: "name", label: "Name" },
                          { value: "size", label: "Size" },
                          { value: "staleFirst", label: "Stale first" },
                        ]}
                      />
                    </div>
                    <button
                      type="button"
                      aria-pressed={staleOnly}
                      onClick={() => setStaleOnly((current) => !current)}
                      className={`focus-ring flex min-h-8 items-center justify-between rounded-md border px-2 text-[length:var(--text-xs)] ${
                        staleOnly
                          ? "border-[var(--color-warning)] bg-[var(--color-warning)]/12 text-[var(--text-primary)]"
                          : "border-[var(--border-hairline)] text-[var(--text-secondary)]"
                      }`}
                    >
                      <span>Stale only</span>
                      <span>{suggestions.length}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSourceFilter("all");
                        setGroupMode("none");
                        setSortMode("recent");
                        setStaleOnly(false);
                      }}
                      className="focus-ring min-h-8 rounded-md border border-[var(--border-hairline)] px-2 text-[length:var(--text-xs)] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
                    >
                      Reset filters
                    </button>
                  </div>
                </PopoverBody>
              </Popover>
            </>
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

        {filesState.state === "error" ? (
          <div className="mt-2">
            <ErrorState
              compact
              headline="Couldn't load memory files"
              subtitle={filesState.error}
            />
          </div>
        ) : null}
      </div>

      <div className={`fm-content min-h-0 flex-1 ${contentClass}`}>
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
              <MemoryReaderPane
                row={selectedRow ?? null}
                age={selectedRow ? age(selectedRow.sortTime) : ""}
                sizeLabel={selectedRow ? formatBytes(selectedRow.size) : ""}
                onOpenFile={(path) => onOpenMemoryFile?.(path)}
                onExpand={(row) => setExpandRow(row)}
                onBack={clearMemorySelection}
              />
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
      ) : null}
    </div>
  );
}

export { MemoryFilesList, MemoryReaderModal } from "@/components/familiars-memory-files";
