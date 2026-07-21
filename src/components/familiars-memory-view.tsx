"use client";

import "@/styles/cave-md.css";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { Icon } from "@/lib/icon";
import { usePausablePoll } from "@/lib/use-pausable-poll";
import { invalidateIfDefined } from "@/lib/surface-warm-cache";
import { formatTimestamp, readDateTimePrefs, useDateTimePrefs } from "@/lib/datetime-format";
// Shared relative-time formatter, imported as `age` so the call sites read the
// same — standardizes this surface on the app-wide "2m ago / 3h ago / Jun 12" style.
import { relativeTime as age } from "@/lib/relative-time";
import { RelativeTime } from "@/components/ui/relative-time";
import type { Familiar } from "@/lib/types";
import type { CovenMemoryEntry } from "@/components/familiars-view-stats";
import { MarkdownBlock } from "@/components/message-bubble";
import { useUndoDelete } from "@/lib/use-undo-delete";
import { useMemoryFile } from "@/lib/use-memory-file";
import { UndoToast } from "@/components/ui/undo-toast";
import {
  classifyProtection,
  detectStale,
  normalizeCovenEntry,
  normalizeFileEntry,
  type GroupBy,
  type RawCovenEntry,
  type RawFileEntry,
} from "@/lib/memory-management";
import { buildMemoryRows, groupMemoryRows, type MemoryRow } from "@/lib/memory-rows";
import { MemoryRowItem } from "@/components/familiars-memory-row";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonRows } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { StandardSelect } from "@/components/ui/select";
import { MemoryReaderPane } from "@/components/familiars-memory-reader";
import {
  ExpandMemoryButton,
  MemoryFilesList,
  MemoryReaderModal,
  SourceFilterChip,
} from "@/components/familiars-memory-files";
import { compactPath, fileBase, fileDir, formatBytes, memoryMatches, type FileMemoryEntry } from "@/components/familiars-memory-utils";
import { useSurfacePreference } from "@/lib/surface-preferences";
import { surfacePreferenceSpecs } from "@/lib/surface-preference-specs";

export type { FileMemoryEntry } from "@/components/familiars-memory-utils";

/**
 * Memory data supplied by a parent that already fetches /api/coven-memory +
 * /api/memory (FamiliarsView polls them for its roster stats). Passing this
 * makes the view a mirror of the parent's single 30s poll instead of running
 * a duplicate fetch+poll of the same two endpoints. Standalone mounts
 * (companion rail, studio tab) omit it and keep self-fetching.
 */
export type MemoryFeed = {
  covenEntries: CovenMemoryEntry[];
  fileEntries: FileMemoryEntry[];
  error: string | null;
  loaded: boolean;
  lastLoadedAt: string | null;
  reload: () => Promise<void>;
};

type Props = {
  familiars: Familiar[];
  activeFamiliar: Familiar | null;
  onOpenMemoryFile?: (path: string) => void;
  /** Cap the number of entries rendered per section. */
  limit?: number;
  /** Suppress the familiar picker; render the active familiar as a chip. */
  lockToFamiliar?: boolean;
  /** Compact header for narrow surfaces like the companion rail. */
  compact?: boolean;
  /** Parent-owned memory data; suppresses this view's own fetch + poll. */
  feed?: MemoryFeed;
};

type CovenMemoryResponse =
  | { ok: true; entries: CovenMemoryEntry[] }
  | { ok: false; entries?: CovenMemoryEntry[]; error?: string };

type FileMemoryResponse =
  | { ok: true; entries: FileMemoryEntry[] }
  | { ok: false; entries?: FileMemoryEntry[]; error?: string };

export function FamiliarsMemoryView({ familiars, activeFamiliar, onOpenMemoryFile, limit, lockToFamiliar, compact, feed }: Props) {
  useDateTimePrefs(); // subscribe: re-render when the date/time density pref changes
  const [covenEntries, setCovenEntries] = useState<CovenMemoryEntry[]>([]);
  const [fileEntries, setFileEntries] = useState<FileMemoryEntry[]>([]);
  const [query, setQuery] = useState("");
  const [storedFamiliarFilter, setFamiliarFilter] = useSurfacePreference(surfacePreferenceSpecs.familiarMemory.familiarId);
  const familiarFilter = storedFamiliarFilter || activeFamiliar?.id || familiars[0]?.id || "";
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useSurfacePreference(surfacePreferenceSpecs.familiarMemory.source);
  const [sortMode, setSortMode] = useSurfacePreference(surfacePreferenceSpecs.familiarMemory.sort);
  const [groupMode, setGroupMode] = useSurfacePreference(surfacePreferenceSpecs.familiarMemory.group);
  const [staleOnly, setStaleOnly] = useSurfacePreference(surfacePreferenceSpecs.familiarMemory.staleOnly);
  const [expandRow, setExpandRow] = useState<MemoryRow | null>(null);
  const { pending: undoPending, scheduleDelete, undo: undoDelete, commit: commitDelete } = useUndoDelete<{ key: string }>();
  // The real DELETE is deferred 4s for undo, but the 30s poll / on-focus refresh
  // re-fetches during that window and would resurrect the optimistically-removed
  // row. Track the one pending path (useUndoDelete is single-pending) and filter
  // it out of anything load() applies until the delete commits or is undone.
  const pendingDeletePathRef = useRef<string | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState<string | null>(null);
  const effectiveLimit = limit ?? Infinity;
  // Incremental render cap for the full view (rail/compact use `limit` instead).
  const FILE_PAGE = 80;
  const [fileLimit, setFileLimit] = useState(FILE_PAGE);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Collapse the masthead (title + description + stats) when the memory list is
  // scrolled down, restoring it on scroll-up or at the top — frees vertical room
  // for the list while keeping the search + group/sort controls always reachable.
  const [headerCollapsed, setHeaderCollapsed] = useState(false);
  const lastListScrollTop = useRef(0);
  const onListScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const top = event.currentTarget.scrollTop;
    const prev = lastListScrollTop.current;
    if (top <= 4) {
      setHeaderCollapsed(false);
    } else if (top > prev + 4) {
      setHeaderCollapsed(true); // scrolling down
    } else if (top < prev - 4) {
      setHeaderCollapsed(false); // scrolling up
    }
    lastListScrollTop.current = top;
  }, []);

  const load = useCallback(async () => {
    // Parent-fed mode: the parent owns the fetch; its fresh data flows back
    // in through the mirror effect below.
    if (feed) {
      await feed.reload();
      return;
    }
    try {
      const [covenRes, fileRes] = await Promise.all([
        fetch("/api/coven-memory", { cache: "no-store" }),
        fetch("/api/memory", { cache: "no-store" }),
      ]);
      const covenJson = (await covenRes.json()) as CovenMemoryResponse;
      const fileJson = (await fileRes.json()) as FileMemoryResponse;

      const pendingDelete = pendingDeletePathRef.current;
      if (covenJson.ok) setCovenEntries((covenJson.entries ?? []).filter((e) => e.path !== pendingDelete));
      if (fileJson.ok) setFileEntries((fileJson.entries ?? []).filter((e) => e.fullPath !== pendingDelete));

      const errors = [
        covenJson.ok ? null : covenJson.error ?? "Coven memory unavailable",
        fileJson.ok ? null : fileJson.error ?? "Memory files unavailable",
      ].filter(Boolean);
      setError(errors.length > 0 ? errors.join(" · ") : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "memory unavailable");
    } finally {
      setLoaded(true);
      setLastLoadedAt(new Date().toISOString());
    }
  }, [feed]);

  // Mirror parent-fed data into the local state the rest of the view (and the
  // optimistic-delete overlay) already works against. The pending-delete filter
  // keeps a parent poll landing inside the 4s undo window from resurrecting the
  // optimistically-removed row — same guard the self-fetching path applies.
  useEffect(() => {
    if (!feed) return;
    const pendingDelete = pendingDeletePathRef.current;
    setCovenEntries(feed.covenEntries.filter((e) => e.path !== pendingDelete));
    setFileEntries(feed.fileEntries.filter((e) => e.fullPath !== pendingDelete));
    setError(feed.error);
    if (feed.loaded) setLoaded(true);
    setLastLoadedAt(feed.lastLoadedAt);
  }, [feed]);

  const handleDelete = useCallback(
    (path: string, key: string, source: "coven" | "file") => {
      // optimistic removal from the rendered lists + suppress a poll re-adding it
      pendingDeletePathRef.current = path;
      if (source === "coven") setCovenEntries((prev) => prev.filter((e) => e.path !== path));
      else setFileEntries((prev) => prev.filter((e) => e.fullPath !== path));
      scheduleDelete({ key }, path.split("/").pop() ?? "entry", async () => {
        const response = await fetch("/api/memory/delete", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path }),
        });
        if (response.ok) invalidateIfDefined("agents:coven-memory", "memory:list");
        // Delete committed server-side; stop filtering (unless a newer delete
        // has already claimed the slot).
        if (pendingDeletePathRef.current === path) pendingDeletePathRef.current = null;
        // Parent-fed mode: refresh the parent's cache so its mirror (and the
        // roster stats it derives) reflect the deletion promptly.
        if (feed) void feed.reload();
      });
    },
    [scheduleDelete, feed],
  );

  const handleUndoDelete = useCallback(() => {
    // Undo cancels the DELETE, so stop suppressing the path before re-pulling.
    pendingDeletePathRef.current = null;
    undoDelete();
    void load(); // re-pull so the optimistically-removed row reappears
  }, [undoDelete, load]);

  useEffect(() => {
    if (!feed) void load();
  }, [load, feed]);
  // Pauses in a hidden tab; refreshes on return. Disabled entirely in
  // parent-fed mode — the parent's single poll covers both components
  // (cave-5dnw: this used to double-fetch /api/coven-memory + /api/memory).
  usePausablePoll(() => void load(), 30_000, { enabled: !feed });

  const familiarById = useMemo(() => new Map(familiars.map((f) => [f.id, f])), [familiars]);
  const effectiveFamiliarFilter = lockToFamiliar && activeFamiliar?.id ? activeFamiliar.id : familiarFilter;
  const q = query.trim().toLowerCase();

  const visibleCoven = useMemo(
    () =>
      covenEntries
        .filter((entry) => entry.familiar_id === effectiveFamiliarFilter)
        .filter((entry) => memoryMatches(entry, q))
        .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1)),
    [covenEntries, effectiveFamiliarFilter, q],
  );

  const familiarScopedFiles = useMemo(
    // Only the selected familiar's own files — shared/global pools and other
    // familiars' files are excluded from this per-familiar view.
    () => fileEntries.filter((entry) => entry.familiarId === effectiveFamiliarFilter),
    [fileEntries, effectiveFamiliarFilter],
  );

  const visibleFiles = useMemo(() => {
    // Precompute staleness once per entry (detectStale + normalizeFileEntry are not
    // free); reused by the staleOnly filter and the staleFirst comparator so neither
    // recomputes per element / per comparison.
    const staleByEntry = new Map(familiarScopedFiles.map((entry) => [entry, detectStale(normalizeFileEntry(entry)).stale]));
    const cmp: Record<typeof sortMode, (a: FileMemoryEntry, b: FileMemoryEntry) => number> = {
      recent: (a, b) => (a.modified < b.modified ? 1 : a.modified > b.modified ? -1 : 0),
      oldest: (a, b) => (a.modified > b.modified ? 1 : a.modified < b.modified ? -1 : 0),
      name: (a, b) => fileBase(a.relPath).localeCompare(fileBase(b.relPath)),
      size: (a, b) => (b.size ?? 0) - (a.size ?? 0),
      staleFirst: (a, b) => Number(staleByEntry.get(b)) - Number(staleByEntry.get(a)),
    };
    return familiarScopedFiles
      .filter((entry) => sourceFilter === "all" || entry.sourceKind === sourceFilter)
      .filter((entry) => memoryMatches(entry, q))
      .filter((entry) => !staleOnly || (staleByEntry.get(entry) ?? false))
      .sort(cmp[sortMode]);
  }, [familiarScopedFiles, q, sourceFilter, sortMode, staleOnly]);

  // Lib-backed normalized files, used by the suggestions/stale section.
  const normalizedVisibleFiles = useMemo(() => visibleFiles.map(normalizeFileEntry), [visibleFiles]);

  // Unified master list backing the full-view two-pane layout.
  const unifiedRows = useMemo(
    () =>
      buildMemoryRows({
        coven: covenEntries as unknown as RawCovenEntry[],
        files: fileEntries as unknown as RawFileEntry[],
        familiarFilter: effectiveFamiliarFilter,
        query: q,
        sourceFilter,
        sortMode,
        staleOnly,
        familiarLabel: (id) => familiarById.get(id)?.display_name ?? id,
      }),
    [covenEntries, fileEntries, effectiveFamiliarFilter, q, sourceFilter, sortMode, staleOnly, familiarById],
  );
  const selectedRow = useMemo(
    () => unifiedRows.find((r) => r.rowId === selectedRowId) ?? null,
    [unifiedRows, selectedRowId],
  );
  // The visible page of rows (shared by flat + grouped rendering).
  const pagedRows = useMemo(() => unifiedRows.slice(0, fileLimit), [unifiedRows, fileLimit]);
  const renderRow = (row: MemoryRow) => (
    <MemoryRowItem
      key={row.rowId}
      row={row}
      age={age(row.sortTime)}
      selected={selectedRowId === row.rowId}
      onSelect={() => setSelectedRowId(row.rowId)}
      onExpand={() => setExpandRow(row)}
      onDelete={
        row.protection !== "structural"
          ? () => handleDelete(row.path, row.rowId, row.kind === "agent" ? "coven" : "file")
          : undefined
      }
    />
  );

  // Stale entries across BOTH sources, powering the Stale pill + bulk delete.
  const suggestions = useMemo(() => {
    const all = [...visibleCoven.map((e) => normalizeCovenEntry(e)), ...normalizedVisibleFiles];
    return all.filter((e) => detectStale(e).stale);
  }, [visibleCoven, normalizedVisibleFiles]);
  // bulk-selectable = suggestions that are NOT protected from bulk
  const bulkDeletable = useMemo(
    () => suggestions.filter((e) => e.protection === "normal"),
    [suggestions],
  );

  // Reset pagination whenever the result set changes underneath the user.
  useEffect(() => { setFileLimit(FILE_PAGE); }, [q, sourceFilter, effectiveFamiliarFilter, staleOnly, sortMode]);

  const familiarsWithMemory = useMemo(() => {
    const ids = new Set(covenEntries.map((entry) => entry.familiar_id));
    return familiars.filter((familiar) => ids.has(familiar.id));
  }, [covenEntries, familiars]);

  // Count the scoped file pool so source chips match the selected familiar view.
  const fileSourceCounts = useMemo(() => ({
    covenOrigin: familiarScopedFiles.filter((entry) => entry.sourceKind === "coven-origin").length,
    externalHarnesses: familiarScopedFiles.filter((entry) => entry.sourceKind === "external-harness").length,
    runtimeMemory: familiarScopedFiles.filter((entry) => entry.sourceKind === "runtime").length,
  }), [familiarScopedFiles]);

  useEffect(() => {
    if (lockToFamiliar) return;
    const familiarIds = new Set(familiars.map((familiar) => familiar.id));
    // A valid restored selection is the user's return preference. The active
    // workspace familiar is only a fallback for an empty or stale preference;
    // otherwise every remount would immediately overwrite the remembered
    // Memory filter with whichever familiar happens to be active in Chat.
    const memoryFamiliarIds = new Set(covenEntries.map((entry) => entry.familiar_id));
    if (
      storedFamiliarFilter &&
      familiarIds.has(storedFamiliarFilter) &&
      (memoryFamiliarIds.size === 0 || memoryFamiliarIds.has(storedFamiliarFilter))
    ) {
      return;
    }

    const next = activeFamiliar?.id && familiarIds.has(activeFamiliar.id)
      ? activeFamiliar.id
      : familiars.find((familiar) => memoryFamiliarIds.has(familiar.id))?.id ?? familiars[0]?.id ?? "";
    if (next && next !== storedFamiliarFilter) setFamiliarFilter(next);
  }, [activeFamiliar?.id, covenEntries, familiars, lockToFamiliar, setFamiliarFilter, storedFamiliarFilter]);

  const selectedFamiliar =
    familiarById.get(effectiveFamiliarFilter) ??
    (activeFamiliar?.id === effectiveFamiliarFilter ? activeFamiliar : null);
  const familiarOptions = useMemo(() => {
    const options = familiarsWithMemory.length > 0 ? familiarsWithMemory : familiars;
    if (!selectedFamiliar || options.some((familiar) => familiar.id === selectedFamiliar.id)) return options;
    return [selectedFamiliar, ...options];
  }, [familiars, familiarsWithMemory, selectedFamiliar]);

  const contentClass = compact
    ? "flex flex-col gap-4 overflow-y-auto p-4"
    : "grid min-h-0 gap-4 p-4 @min-[1024px]/memview:grid-cols-[minmax(0,1fr)_minmax(420px,560px)]";

  return (
    <div className="@container/memview flex min-h-0 flex-1 flex-col bg-[var(--bg-base)]">
      <div className={`shrink-0 border-b border-[var(--border-hairline)] ${compact ? "px-3 py-2" : "px-4 py-3"}`}>
        {compact ? null : (
          <div
            data-testid="memory-masthead"
            data-collapsed={headerCollapsed ? "true" : "false"}
            aria-hidden={headerCollapsed}
            className={`overflow-hidden transition-all duration-200 ease-out ${headerCollapsed ? "max-h-0 opacity-0" : "max-h-48 opacity-100"}`}
          >
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <Icon name="ph:brain-bold" width={15} className="text-[var(--accent-presence)]" />
                  <h2 className="text-[length:var(--text-md)] font-semibold text-[var(--text-primary)]">Familiar Memory</h2>
                </div>
                <p className="mt-1 text-[length:var(--text-xs)] text-[var(--text-muted)]">
                  Focused recall for one familiar at a time, with local memory files kept in the list surface.
                </p>
              </div>
              <div className="flex items-center gap-2.5">
                {lastLoadedAt ? (
                  <span className="text-[length:var(--text-2xs)] text-[var(--text-muted)]" title={`Last refreshed ${formatTimestamp(lastLoadedAt, readDateTimePrefs())}`}>
                    Updated {age(lastLoadedAt)}
                  </span>
                ) : null}
                <button type="button" onClick={() => void load()} className="focus-ring inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--border-hairline)] px-2.5 text-[length:var(--text-xs)] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]">
                  <Icon name="ph:arrows-clockwise" width={12} />
                  Refresh
                </button>
              </div>
            </div>

            <div
              data-testid="memory-stats-inline"
              className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[length:var(--text-xs)] text-[var(--text-secondary)]"
            >
              <span className="inline-flex items-baseline gap-1 px-1"><span className="text-[var(--text-muted)]">Familiar memories</span> <span className="font-semibold text-[var(--text-primary)]">{visibleCoven.length}</span></span>
              <span aria-hidden className="text-[var(--border-strong)]">·</span>
              <span className="mr-0.5 text-[length:var(--text-2xs)] uppercase tracking-wider text-[var(--text-muted)]">Sources</span>
              <SourceFilterChip label="Coven origin" count={fileSourceCounts.covenOrigin} active={sourceFilter === "coven-origin"} onClick={() => setSourceFilter((s) => (s === "coven-origin" ? "all" : "coven-origin"))} help="Files written by this Cave's own familiars and conversations" />
              <SourceFilterChip label="External runtimes" count={fileSourceCounts.externalHarnesses} active={sourceFilter === "external-harness"} onClick={() => setSourceFilter((s) => (s === "external-harness" ? "all" : "external-harness"))} help="Memory kept by other agent tools on this machine (e.g. Claude Code, Codex)" />
              <SourceFilterChip label="Runtime memory" count={fileSourceCounts.runtimeMemory} active={sourceFilter === "runtime"} onClick={() => setSourceFilter((s) => (s === "runtime" ? "all" : "runtime"))} help="Working files a runtime writes for itself while it runs" />
              {sourceFilter !== "all" ? (
                <button
                  type="button"
                  onClick={() => setSourceFilter("all")}
                  className="focus-ring ml-0.5 inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[length:var(--text-2xs)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                >
                  <Icon name="ph:x-bold" width={9} />
                  Clear filter
                </button>
              ) : null}
            </div>
          </div>
        )}

        <div className={`${compact ? "" : headerCollapsed ? "" : "mt-3"} flex flex-wrap items-center gap-2 transition-[margin] duration-200`}>
          <div className={`relative ${compact ? "min-w-0" : "min-w-[220px]"} flex-1`}>
            <Icon name="ph:magnifying-glass" width={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              type="search"
              aria-label={lockToFamiliar && selectedFamiliar?.display_name ? `Search ${selectedFamiliar.display_name}'s memory` : "Search memory"}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Escape" && query) { event.preventDefault(); setQuery(""); } }}
              placeholder={lockToFamiliar && selectedFamiliar?.display_name ? `Search ${selectedFamiliar.display_name}'s memory...` : "Search memory..."}
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
          {lockToFamiliar ? null : (
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
          )}
        </div>
        {compact ? null : (
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
              onClick={() => setStaleOnly((s) => !s)}
              className={`focus-ring inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[length:var(--text-xs)] transition-colors ${
                staleOnly ? "border-[var(--color-warning)] bg-[var(--color-warning)]/12 text-[var(--text-primary)]" : "border-[var(--border-hairline)] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]"
              }`}
            >
              Stale ({suggestions.length})
            </button>
          </div>
        )}
        {error ? (
          <div
            role="alert"
            className="mt-2 flex items-center gap-2 rounded-md border border-[var(--color-warning)]/35 bg-[var(--color-warning)]/10 px-2.5 py-1.5 text-[length:var(--text-xs)] text-[var(--text-secondary)]"
          >
            <Icon name="ph:warning-circle" width={13} className="shrink-0 text-[var(--color-warning)]" aria-hidden />
            <span className="min-w-0 flex-1">{error}</span>
            <Button size="xs" variant="ghost" leadingIcon="ph:arrow-clockwise" onClick={() => void load()}>
              Retry
            </Button>
          </div>
        ) : null}
      </div>

      <div className={`min-h-0 flex-1 ${contentClass}`}>
        {compact && loaded && !error && visibleCoven.length === 0 && visibleFiles.length === 0 ? (
          <div className="grid place-items-center rounded-lg border border-dashed border-[var(--border-hairline)] bg-[var(--bg-raised)]/25 px-4 py-6">
            <EmptyState
              compact
              icon="ph:brain"
              headline={`No memories yet for ${selectedFamiliar?.display_name ?? "this familiar"}`}
              subtitle="Familiar memories are saved during chats. Memory files appear when the familiar's runtime writes to disk."
            />
          </div>
        ) : (
          !compact ? (
          <>
            {/* LIST PANE */}
            <section className={`min-h-0 flex-col ${selectedRowId ? "hidden @min-[1024px]/memview:flex" : "flex"}`}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-[length:var(--text-xs)] font-semibold uppercase tracking-widest text-[var(--text-secondary)]">Memories</h3>
                <div className="flex items-center gap-2">
                  {staleOnly && bulkDeletable.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => bulkDeletable.forEach((e) => handleDelete(e.path, e.key, e.source))}
                      className="focus-ring inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border-hairline)] px-2 text-[length:var(--text-xs)] text-[var(--color-warning)] hover:bg-[var(--bg-raised)]"
                    >
                      <Icon name="ph:trash" width={11} />
                      Delete {bulkDeletable.length} cleanable
                    </button>
                  ) : null}
                  <span className="text-[length:var(--text-2xs)] text-[var(--text-muted)]">
                    {unifiedRows.length > fileLimit ? `${fileLimit} of ${unifiedRows.length}` : `${unifiedRows.length} shown`}
                  </span>
                </div>
              </div>
              <div onScroll={onListScroll} className="min-h-0 flex-1 overflow-y-auto border-t border-[var(--border-hairline)]">
                {unifiedRows.length === 0 ? (
                  !loaded ? (
                    <SkeletonRows count={6} className="p-3" />
                  ) : error ? (
                    <div className="px-3 py-8 text-center text-[length:var(--text-sm)] text-[var(--text-muted)]">
                      Couldn't load memories. See the error above and try again.
                    </div>
                  ) : (
                    <EmptyState compact icon="ph:brain" headline="No memories match this view." />
                  )
                ) : groupMode === "none" ? (
                  <ul className="divide-y divide-[var(--border-hairline)]">
                    {pagedRows.map(renderRow)}
                  </ul>
                ) : (
                  <div>
                    {groupMemoryRows(pagedRows, groupMode).map((group) => (
                      <div key={group.key}>
                        <h4 className="sticky top-0 z-[1] flex items-center gap-1.5 border-b border-[var(--border-hairline)] bg-[var(--bg-raised)]/95 px-3 py-1.5 text-[length:var(--text-2xs)] font-semibold uppercase tracking-widest text-[var(--text-secondary)] backdrop-blur">
                          {group.label}
                          <span className="font-normal text-[var(--text-muted)]">({group.rows.length})</span>
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
                    onClick={() => setFileLimit((n) => n + FILE_PAGE)}
                    className="focus-ring flex w-full items-center justify-center gap-1.5 border-t border-[var(--border-hairline)] px-3 py-2 text-[length:var(--text-xs)] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
                  >
                    <Icon name="ph:caret-down" width={11} />
                    Show more · {fileLimit} of {unifiedRows.length}
                  </button>
                ) : null}
              </div>
            </section>

            {/* READER PANE */}
            <div className={`min-h-0 flex-col ${selectedRowId ? "flex" : "hidden @min-[1024px]/memview:flex"}`}>
              <MemoryReaderPane
                row={selectedRow}
                age={selectedRow ? age(selectedRow.sortTime) : ""}
                sizeLabel={selectedRow ? formatBytes(selectedRow.size) : ""}
                onOpenFile={(p) => onOpenMemoryFile?.(p)}
                onExpand={(r) => setExpandRow(r)}
                onBack={() => setSelectedRowId(null)}
              />
            </div>
          </>
          ) : (
          <>
        {compact ? (
        <section className="min-h-0">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[length:var(--text-xs)] font-semibold uppercase tracking-widest text-[var(--text-secondary)]">Familiar memory</h3>
            <span className="text-[length:var(--text-2xs)] text-[var(--text-muted)]">{visibleCoven.length} visible</span>
          </div>
          {visibleCoven.length === 0 ? (
            !loaded ? (
              <SkeletonRows count={4} className="p-2" />
            ) : error ? (
              <div className="grid place-items-center rounded-lg border border-dashed border-[var(--border-hairline)] px-4 py-6 text-center text-[length:var(--text-sm)] text-[var(--text-muted)]">
                Couldn’t load familiar memories. See the error above and try again.
              </div>
            ) : (
              <EmptyState compact icon="ph:brain" headline="No familiar memories match this view." />
            )
          ) : (
            <div className="flex flex-col divide-y divide-[var(--border-hairline)] border-t border-[var(--border-hairline)]">
              {visibleCoven.slice(0, effectiveLimit).map((entry) => {
                const familiar = familiarById.get(entry.familiar_id);
                return (
                  <article
                    key={entry.id}
                    className="px-1 py-3 transition-colors hover:bg-[var(--bg-raised)]/30"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 text-[length:var(--text-2xs)] text-[var(--text-muted)]">
                          <span className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[var(--text-secondary)]">
                            {familiar?.display_name ?? entry.familiar_id}
                          </span>
                          <RelativeTime iso={entry.updated_at} />
                        </div>
                        <h4 className="mt-2 line-clamp-2 text-[length:var(--text-base)] font-medium text-[var(--text-primary)]">{entry.title}</h4>
                      </div>
                      <Icon name="ph:brain" width={14} className="mt-0.5 shrink-0 text-[var(--text-muted)]" />
                    </div>
                    {entry.excerpt ? (
                      <p className="mt-2 line-clamp-4 text-[length:var(--text-xs)] leading-5 text-[var(--text-secondary)]">{entry.excerpt}</p>
                    ) : null}
                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onOpenMemoryFile?.(entry.path); }}
                        className="focus-ring inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border-hairline)] px-2 text-[length:var(--text-xs)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
                      >
                        <Icon name="ph:file-text" width={12} />
                        Open memory
                      </button>
                      <ExpandMemoryButton path={entry.path} title={entry.title} />
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
        ) : null}

        <section className="min-h-0">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-[length:var(--text-xs)] font-semibold uppercase tracking-widest text-[var(--text-secondary)]">Memory files</h3>
            <div className="flex items-center gap-2">
              <span className="text-[length:var(--text-2xs)] text-[var(--text-muted)]">{visibleFiles.length} visible</span>
            </div>
          </div>
          <MemoryFilesList
            entries={visibleFiles}
            onOpen={onOpenMemoryFile}
            loaded={loaded}
            error={error}
            limit={effectiveLimit}
            activeFamiliarId={effectiveFamiliarFilter}
            onSelect={undefined}
            selectedRowId={null}
            onDelete={undefined}
          />
        </section>
          </>
          )
        )}
      </div>
      {undoPending ? (
        <UndoToast
          message={<>Deleted <strong>{undoPending.label}</strong></>}
          icon="ph:trash"
          undoAriaLabel={`Undo delete ${undoPending.label}`}
          onUndo={handleUndoDelete}
          onDismiss={commitDelete}
        />
      ) : null}
      {expandRow ? (
        <MemoryReaderModal path={expandRow.contentPath ?? expandRow.path} title={expandRow.title} onClose={() => setExpandRow(null)} />
      ) : null}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Standalone file-list — reusable by the Familiars detail panel without the
// coven-memory half or the familiar picker.
// ────────────────────────────────────────────────────────────────────────────
export { MemoryFilesList, MemoryReaderModal } from "@/components/familiars-memory-files";
