"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
// Shared relative-time formatter, imported as `age` so the call sites read the
// same — standardizes this surface on the app-wide "2m ago / 3h ago / Jun 12" style.
import { relativeTime as age } from "@/lib/relative-time";
import type { Familiar } from "@/lib/types";
import type { CovenMemoryEntry } from "@/components/familiars-view-stats";
import { MarkdownBlock } from "@/components/message-bubble";
import { useUndoDelete } from "@/lib/use-undo-delete";
import { useMemoryFile } from "@/lib/use-memory-file";
import { LibraryUndoToast } from "./library-undo-toast";
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
import { MemoryReaderPane } from "@/components/familiars-memory-reader";
import "@/styles/library.css";

export type FileMemoryEntry = {
  root: string;
  rootLabel: string;
  relPath: string;
  fullPath: string;
  size: number;
  modified: string;
  sourceId: string;
  sourceKind: "coven-origin" | "external-harness" | "runtime";
  sourceKindLabel: string;
  rootPath: string;
  origin?: "coven";
  harnessId?: string;
  runtimeId?: string;
  sourceContext?: string;
  familiarId?: string;
};

type Props = {
  familiars: Familiar[];
  activeFamiliar: Familiar | null;
  onOpenMemoryFile?: (path: string) => void;
  /** Cap the number of entries rendered per section. */
  limit?: number;
  /** Suppress the familiar <select>; render the active familiar as a chip. */
  lockToFamiliar?: boolean;
  /** Compact header for narrow surfaces like the companion rail. */
  compact?: boolean;
};

type CovenMemoryResponse =
  | { ok: true; entries: CovenMemoryEntry[] }
  | { ok: false; entries?: CovenMemoryEntry[]; error?: string };

type FileMemoryResponse =
  | { ok: true; entries: FileMemoryEntry[] }
  | { ok: false; entries?: FileMemoryEntry[]; error?: string };

function compactPath(path: string): string {
  const collapsed = path.replace(/^\/Users\/[^/]+/, "~");
  const THRESHOLD = 52;
  if (collapsed.length <= THRESHOLD) return collapsed;
  const segments = collapsed.split("/").filter(Boolean);
  if (segments.length <= 4) return collapsed;
  const first = collapsed.startsWith("~") ? "~" : `/${segments[0]}`;
  const last = segments.slice(-3);
  return `${first}/…/${last.join("/")}`;
}

function fileBase(p: string): string {
  const segments = p.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? p;
}

/** Directory portion of a full path, collapsed to ~ and ellipsized. "" when at root. */
function fileDir(fullPath: string): string {
  const base = fileBase(fullPath);
  const parent = fullPath.slice(0, Math.max(0, fullPath.length - base.length)).replace(/\/$/, "");
  return parent ? compactPath(parent) : "";
}

function formatBytes(n: number | undefined): string {
  if (!n || n < 0 || !Number.isFinite(n)) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function memoryMatches(entry: CovenMemoryEntry | FileMemoryEntry, query: string): boolean {
  if (!query) return true;
  if ("familiar_id" in entry) {
    return [
      entry.title,
      entry.excerpt ?? "",
      entry.familiar_id,
      entry.path,
      entry.source_context ?? "",
    ].some((value) => value.toLowerCase().includes(query));
  }
  return [
    entry.rootLabel,
    entry.sourceKindLabel,
    entry.harnessId ?? "",
    entry.runtimeId ?? "",
    entry.origin ?? "",
    entry.familiarId ?? "",
    entry.relPath,
    entry.fullPath,
    entry.sourceContext ?? "",
  ].some((value) => value.toLowerCase().includes(query));
}

export function FamiliarsMemoryView({ familiars, activeFamiliar, onOpenMemoryFile, limit, lockToFamiliar, compact }: Props) {
  const [covenEntries, setCovenEntries] = useState<CovenMemoryEntry[]>([]);
  const [fileEntries, setFileEntries] = useState<FileMemoryEntry[]>([]);
  const [query, setQuery] = useState("");
  const [familiarFilter, setFamiliarFilter] = useState<string>(activeFamiliar?.id ?? familiars[0]?.id ?? "");
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState<"all" | FileMemoryEntry["sourceKind"]>("all");
  const [sortMode, setSortMode] = useState<"recent" | "oldest" | "name" | "size" | "staleFirst">("recent");
  const [groupMode, setGroupMode] = useState<GroupBy>("none");
  const [staleOnly, setStaleOnly] = useState(false);
  const [expandRow, setExpandRow] = useState<MemoryRow | null>(null);
  const { pending: undoPending, scheduleDelete, undo: undoDelete, commit: commitDelete } = useUndoDelete<{ key: string }>();
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
      setError(errors.length > 0 ? errors.join(" · ") : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "memory unavailable");
    } finally {
      setLoaded(true);
      setLastLoadedAt(new Date().toISOString());
    }
  }, []);

  const handleDelete = useCallback(
    (path: string, key: string, source: "coven" | "file") => {
      // optimistic removal from the rendered lists
      if (source === "coven") setCovenEntries((prev) => prev.filter((e) => e.path !== path));
      else setFileEntries((prev) => prev.filter((e) => e.fullPath !== path));
      scheduleDelete({ key }, path.split("/").pop() ?? "entry", async () => {
        await fetch("/api/memory/delete", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path }),
        });
      });
    },
    [scheduleDelete],
  );

  const handleUndoDelete = useCallback(() => {
    undoDelete();
    void load(); // re-pull so the optimistically-removed row reappears
  }, [undoDelete, load]);

  useEffect(() => {
    void load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (activeFamiliar?.id) setFamiliarFilter(activeFamiliar.id);
  }, [activeFamiliar?.id]);

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
    () => fileEntries.filter((entry) => entry.familiarId == null || entry.familiarId === effectiveFamiliarFilter),
    [fileEntries, effectiveFamiliarFilter],
  );

  const visibleFiles = useMemo(() => {
    const cmp: Record<typeof sortMode, (a: FileMemoryEntry, b: FileMemoryEntry) => number> = {
      recent: (a, b) => (a.modified < b.modified ? 1 : a.modified > b.modified ? -1 : 0),
      oldest: (a, b) => (a.modified > b.modified ? 1 : a.modified < b.modified ? -1 : 0),
      name: (a, b) => fileBase(a.relPath).localeCompare(fileBase(b.relPath)),
      size: (a, b) => (b.size ?? 0) - (a.size ?? 0),
      staleFirst: (a, b) =>
        Number(detectStale(normalizeFileEntry(b)).stale) - Number(detectStale(normalizeFileEntry(a)).stale),
    };
    return familiarScopedFiles
      .filter((entry) => sourceFilter === "all" || entry.sourceKind === sourceFilter)
      .filter((entry) => memoryMatches(entry, q))
      .filter((entry) => !staleOnly || detectStale(normalizeFileEntry(entry)).stale)
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
    const familiarIds = new Set(familiars.map((familiar) => familiar.id));
    if (activeFamiliar?.id && familiarIds.has(activeFamiliar.id)) {
      if (activeFamiliar.id !== familiarFilter) setFamiliarFilter(activeFamiliar.id);
      return;
    }

    const memoryFamiliarIds = new Set(covenEntries.map((entry) => entry.familiar_id));
    if (
      familiarFilter &&
      familiarIds.has(familiarFilter) &&
      (memoryFamiliarIds.size === 0 || memoryFamiliarIds.has(familiarFilter))
    ) {
      return;
    }

    const next = familiars.find((familiar) => memoryFamiliarIds.has(familiar.id))?.id ?? familiars[0]?.id ?? "";
    if (next && next !== familiarFilter) setFamiliarFilter(next);
  }, [activeFamiliar?.id, covenEntries, familiarFilter, familiars]);

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
                  <h2 className="text-[14px] font-semibold text-[var(--text-primary)]">Familiar Memory</h2>
                </div>
                <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                  Focused recall for one familiar at a time, with local memory files kept in the list surface.
                </p>
              </div>
              <div className="flex items-center gap-2.5">
                {lastLoadedAt ? (
                  <span className="text-[10px] text-[var(--text-muted)]" title={`Last refreshed ${new Date(lastLoadedAt).toLocaleString()}`}>
                    Updated {age(lastLoadedAt)}
                  </span>
                ) : null}
                <button type="button" onClick={() => void load()} className="focus-ring inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--border-hairline)] px-2.5 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]">
                  <Icon name="ph:arrows-clockwise" width={12} />
                  Refresh
                </button>
              </div>
            </div>

            <div
              data-testid="memory-stats-inline"
              className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[11px] text-[var(--text-secondary)]"
            >
              <span className="inline-flex items-baseline gap-1 px-1"><span className="text-[var(--text-muted)]">Familiar memories</span> <span className="font-semibold text-[var(--text-primary)]">{visibleCoven.length}</span></span>
              <span aria-hidden className="text-[var(--border-strong)]">·</span>
              <span className="mr-0.5 text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Sources</span>
              <SourceFilterChip label="Coven origin" count={fileSourceCounts.covenOrigin} active={sourceFilter === "coven-origin"} onClick={() => setSourceFilter((s) => (s === "coven-origin" ? "all" : "coven-origin"))} />
              <SourceFilterChip label="External runtimes" count={fileSourceCounts.externalHarnesses} active={sourceFilter === "external-harness"} onClick={() => setSourceFilter((s) => (s === "external-harness" ? "all" : "external-harness"))} />
              <SourceFilterChip label="Runtime memory" count={fileSourceCounts.runtimeMemory} active={sourceFilter === "runtime"} onClick={() => setSourceFilter((s) => (s === "runtime" ? "all" : "runtime"))} />
              {sourceFilter !== "all" ? (
                <button
                  type="button"
                  onClick={() => setSourceFilter("all")}
                  className="focus-ring ml-0.5 inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
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
              className="focus-ring h-8 w-full rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)]/40 pl-7 pr-8 text-[12px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-presence)] [&::-webkit-search-cancel-button]:appearance-none"
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
            <select
              value={familiarFilter}
              onChange={(event) => setFamiliarFilter(event.target.value)}
              aria-label="Filter memory by familiar"
              className="focus-ring h-8 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)]/40 px-2 text-[12px] text-[var(--text-secondary)] focus:border-[var(--accent-presence)]"
            >
              {familiarOptions.map((familiar) => (
                <option key={familiar.id} value={familiar.id}>{familiar.display_name}</option>
              ))}
            </select>
          )}
        </div>
        {compact ? null : (
          <div className="memory-controls mt-3">
            <label className="memory-control">
              Group
              <select value={groupMode} onChange={(e) => setGroupMode(e.target.value as GroupBy)}>
                <option value="none">None</option>
                <option value="type">Type</option>
                <option value="source">Source</option>
                <option value="date">Date</option>
              </select>
            </label>
            <label className="memory-control">
              Sort
              <select value={sortMode} onChange={(e) => setSortMode(e.target.value as typeof sortMode)}>
                <option value="recent">Recent</option>
                <option value="oldest">Oldest</option>
                <option value="name">Name</option>
                <option value="size">Size</option>
                <option value="staleFirst">Stale first</option>
              </select>
            </label>
            <button
              type="button"
              aria-pressed={staleOnly}
              onClick={() => setStaleOnly((s) => !s)}
              className={`focus-ring inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] transition-colors ${
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
            className="mt-2 flex items-center gap-2 rounded-md border border-[var(--color-warning)]/35 bg-[var(--color-warning)]/10 px-2.5 py-1.5 text-[11px] text-[var(--text-secondary)]"
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
              subtitle="Familiar memories are saved during chats. Memory files appear when the familiar's harness writes to disk."
            />
          </div>
        ) : (
          !compact ? (
          <>
            {/* LIST PANE */}
            <section className={`min-h-0 flex-col ${selectedRowId ? "hidden @min-[1024px]/memview:flex" : "flex"}`}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-[11px] font-semibold uppercase tracking-widest text-[var(--text-secondary)]">Memories</h3>
                <div className="flex items-center gap-2">
                  {staleOnly && bulkDeletable.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => bulkDeletable.forEach((e) => handleDelete(e.path, e.key, e.source))}
                      className="focus-ring inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border-hairline)] px-2 text-[11px] text-[var(--color-warning)] hover:bg-[var(--bg-raised)]"
                    >
                      <Icon name="ph:trash" width={11} />
                      Delete {bulkDeletable.length} cleanable
                    </button>
                  ) : null}
                  <span className="text-[10px] text-[var(--text-muted)]">
                    {unifiedRows.length > fileLimit ? `${fileLimit} of ${unifiedRows.length}` : `${unifiedRows.length} shown`}
                  </span>
                </div>
              </div>
              <div onScroll={onListScroll} className="min-h-0 flex-1 overflow-y-auto border-t border-[var(--border-hairline)]">
                {unifiedRows.length === 0 ? (
                  !loaded ? (
                    <SkeletonRows count={6} className="p-3" />
                  ) : error ? (
                    <div className="px-3 py-8 text-center text-[12px] text-[var(--text-muted)]">
                      Couldn't load memories. See the error above and try again.
                    </div>
                  ) : (
                    <EmptyState compact icon="ph:brain" headline="No memories match this view." />
                  )
                ) : groupMode === "none" ? (
                  <ul className="divide-y divide-[var(--border-hairline)]">
                    {pagedRows.map((row, i) => {
                      const prev = pagedRows[i - 1];
                      const startsShared = row.ownership === "shared" && (!prev || prev.ownership === "owned");
                      return (
                        <Fragment key={row.rowId}>
                          {startsShared ? (
                            <li className="memory-shared-divider sticky top-0 z-[1] border-b border-[var(--border-hairline)] bg-[var(--bg-raised)]/95 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)] backdrop-blur">
                              Coven-wide memory · shared across all familiars
                            </li>
                          ) : null}
                          {renderRow(row)}
                        </Fragment>
                      );
                    })}
                  </ul>
                ) : (
                  <div>
                    {groupMemoryRows(pagedRows, groupMode).map((group) => (
                      <div key={group.key}>
                        <h4 className="sticky top-0 z-[1] flex items-center gap-1.5 border-b border-[var(--border-hairline)] bg-[var(--bg-raised)]/95 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-[var(--text-secondary)] backdrop-blur">
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
                    className="focus-ring flex w-full items-center justify-center gap-1.5 border-t border-[var(--border-hairline)] px-3 py-2 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
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
            <h3 className="text-[11px] font-semibold uppercase tracking-widest text-[var(--text-secondary)]">Familiar memory</h3>
            <span className="text-[10px] text-[var(--text-muted)]">{visibleCoven.length} visible</span>
          </div>
          {visibleCoven.length === 0 ? (
            !loaded ? (
              <SkeletonRows count={4} className="p-2" />
            ) : error ? (
              <div className="grid place-items-center rounded-lg border border-dashed border-[var(--border-hairline)] px-4 py-6 text-center text-[12px] text-[var(--text-muted)]">
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
                        <div className="flex items-center gap-1.5 text-[10px] text-[var(--text-muted)]">
                          <span className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[var(--text-secondary)]">
                            {familiar?.display_name ?? entry.familiar_id}
                          </span>
                          <span>{age(entry.updated_at)}</span>
                        </div>
                        <h4 className="mt-2 line-clamp-2 text-[13px] font-medium text-[var(--text-primary)]">{entry.title}</h4>
                      </div>
                      <Icon name="ph:brain" width={14} className="mt-0.5 shrink-0 text-[var(--text-muted)]" />
                    </div>
                    {entry.excerpt ? (
                      <p className="mt-2 line-clamp-4 text-[11px] leading-5 text-[var(--text-secondary)]">{entry.excerpt}</p>
                    ) : null}
                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onOpenMemoryFile?.(entry.path); }}
                        className="focus-ring inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border-hairline)] px-2 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
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
            <h3 className="text-[11px] font-semibold uppercase tracking-widest text-[var(--text-secondary)]">Memory files</h3>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-[var(--text-muted)]">{visibleFiles.length} visible</span>
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
        <LibraryUndoToast
          label={undoPending.label}
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
// Rail variant — most-recent memory writes, no graph.
// The full view uses the same list/reader surface; the rail tab is a quick
// "what changed" feed.
// ────────────────────────────────────────────────────────────────────────────

export function RailMemoryList({
  familiar,
  familiars = [],
  onOpenFullView,
}: {
  familiar: Familiar | null;
  familiars?: Familiar[];
  onOpenFullView?: () => void;
}) {
  if (!familiar) {
    return (
      <div className="rail-empty">
        <p>Pick a familiar.</p>
      </div>
    );
  }
  return (
    <div className="rail-memory">
      <div className="rail-memory__scroll">
        <FamiliarsMemoryView
          familiars={familiars}
          activeFamiliar={familiar}
          limit={20}
          compact
          lockToFamiliar
        />
      </div>
      {onOpenFullView ? (
        <button
          type="button"
          className="focus-ring rail-memory__open-full"
          onClick={onOpenFullView}
        >
          Open full memory →
        </button>
      ) : null}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Standalone file-list — reusable by the Familiars detail panel without the
// coven-memory half or the familiar <select>.
// ────────────────────────────────────────────────────────────────────────────

type MemoryFilesListProps = {
  entries: FileMemoryEntry[];
  onOpen?: (path: string) => void;
  loaded: boolean;
  error: string | null;
  limit?: number;
  className?: string;
  listClassName?: string;
  activeFamiliarId?: string | null;
  onSelect?: (rowId: string) => void;
  selectedRowId?: string | null;
  /** When set and entries exceed `limit`, render a footer button that reveals more. */
  onShowMore?: () => void;
  /** Soft-delete a file row by its full path. Structural entries hide the button. */
  onDelete?: (path: string) => void;
};

// ────────────────────────────────────────────────────────────────────────────
// MemoryReaderModal — fullscreen reader rendering a memory file's markdown
// via @create-markdown/preview (through MarkdownBlock).
// ────────────────────────────────────────────────────────────────────────────

type MemoryReaderModalProps = {
  path: string;
  title?: string;
  onClose: () => void;
};

export function MemoryReaderModal({ path, title, onClose }: MemoryReaderModalProps) {
  const { text, error } = useMemoryFile(path);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const heading = title ?? path.split("/").pop() ?? "Memory";

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Memory reader: ${heading}`}
    >
      <div
        className="relative flex h-[92vh] w-[94vw] max-w-[1100px] flex-col overflow-hidden rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-panel)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border-hairline)] px-4 py-2.5">
          <Icon name="ph:book-open" width={13} className="shrink-0 text-[var(--text-muted)]" aria-hidden />
          <span className="flex-1 truncate text-[12px] text-[var(--text-secondary)]" title={path}>
            {heading}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="ml-1 flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
            aria-label="Close memory reader"
          >
            <Icon name="ph:x-bold" width={11} aria-hidden />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
          <div className="mx-auto w-full max-w-[820px]">
            {error ? (
              <p className="text-[12px] text-[var(--color-warning)]">{error}</p>
            ) : text === null ? (
              <p className="text-[12px] text-[var(--text-muted)]">Loading memory…</p>
            ) : (
              <MarkdownBlock text={text} className="cave-md--expanded" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ExpandMemoryButton({
  path,
  title,
  variant = "default",
}: {
  path: string;
  title?: string;
  variant?: "default" | "compact";
}) {
  const [open, setOpen] = useState(false);
  const compact = variant === "compact";
  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        aria-label="Expand memory to reader view"
        title="Expand to reader view"
        className={
          compact
            ? "focus-ring inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--border-hairline)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
            : "focus-ring inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border-hairline)] px-2 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
        }
      >
        <Icon name="ph:arrows-out-simple" width={compact ? 12 : 11} />
        {compact ? null : "Expand"}
      </button>
      {open ? <MemoryReaderModal path={path} title={title} onClose={() => setOpen(false)} /> : null}
    </>
  );
}


function SourceFilterChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`focus-ring inline-flex h-6 items-center gap-1 rounded-md border px-1.5 text-[11px] transition-colors ${
        active
          ? "border-[var(--accent-presence)] bg-[var(--accent-presence)]/12 text-[var(--text-primary)]"
          : "border-transparent text-[var(--text-secondary)] hover:border-[var(--border-hairline)] hover:bg-[var(--bg-raised)]/50"
      }`}
    >
      <span className="text-[var(--text-muted)]">{label}</span>
      <span className="font-semibold text-[var(--text-primary)]">{count}</span>
    </button>
  );
}

export function MemoryFilesList({
  entries,
  onOpen,
  loaded,
  error,
  limit,
  className,
  listClassName,
  activeFamiliarId,
  onSelect,
  selectedRowId,
  onShowMore,
  onDelete,
}: MemoryFilesListProps) {
  const sliced = entries.slice(0, limit ?? entries.length);
  const hidden = entries.length - sliced.length;
  return (
    <div
      className={[
        "rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-raised)]/25",
        className ?? "",
      ].join(" ")}
    >
      {sliced.length === 0 ? (
        !loaded ? (
          <SkeletonRows count={5} className="p-3" />
        ) : error ? (
          <div className="px-3 py-8 text-center text-[12px] text-[var(--text-muted)]">
            Couldn't load memory files. See the error above and try again.
          </div>
        ) : (
          <EmptyState compact icon="ph:file-text" headline="No memory files match this view." />
        )
      ) : (
        <ul className={listClassName ?? "max-h-[640px] divide-y divide-[var(--border-hairline)] overflow-y-auto"}>
          {sliced.map((entry) => {
            const base = fileBase(entry.relPath);
            const dir = fileDir(entry.fullPath);
            const size = formatBytes(entry.size);
            return (
            <li
              key={entry.fullPath}
              className={`flex min-w-0 items-stretch gap-1 px-1 ${selectedRowId === `file:${entry.fullPath}` ? "bg-[var(--bg-raised)]/60" : "hover:bg-[var(--bg-raised)]"}`}
            >
              <button
                type="button"
                onClick={() => (onSelect ? onSelect(`file:${entry.fullPath}`) : onOpen?.(entry.fullPath))}
                className="focus-ring-inset flex min-w-0 flex-1 items-start gap-2 px-2 py-2 text-left"
              >
                <Icon name="ph:file-text" width={13} className="mt-0.5 shrink-0 text-[var(--text-muted)]" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-medium text-[var(--text-primary)]" title={entry.relPath}>{base}</span>
                  <span className="mt-0.5 block truncate font-mono text-[10px] text-[var(--text-muted)]">
                    {entry.sourceKindLabel}
                    {dir ? <> · {dir}</> : null}
                    {size ? <> · {size}</> : null}
                  </span>
                  {(entry.harnessId || entry.runtimeId || entry.origin || (entry.familiarId && entry.familiarId !== activeFamiliarId)) ? (
                    <span className="mt-1 flex flex-wrap gap-1 text-[10px] text-[var(--text-muted)]">
                      {entry.origin ? <span className="rounded bg-[var(--bg-elevated)] px-1 py-0.5">origin:{entry.origin}</span> : null}
                      {entry.harnessId ? <span className="rounded bg-[var(--bg-elevated)] px-1 py-0.5">runtime:{entry.harnessId}</span> : null}
                      {entry.runtimeId ? <span className="rounded bg-[var(--bg-elevated)] px-1 py-0.5">runtime:{entry.runtimeId}</span> : null}
                      {entry.familiarId && entry.familiarId !== activeFamiliarId ? <span className="rounded bg-[var(--bg-elevated)] px-1 py-0.5">familiar:{entry.familiarId}</span> : null}
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 text-[10px] text-[var(--text-muted)]">{age(entry.modified)}</span>
              </button>
              <div className="flex items-center gap-1 pr-2">
                <ExpandMemoryButton path={entry.fullPath} title={entry.relPath} variant="compact" />
                {onDelete && classifyProtection(entry.fullPath) !== "structural" ? (
                  <button
                    type="button"
                    className="memory-card-delete focus-ring inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--border-hairline)] text-[var(--text-muted)] hover:text-[var(--color-warning)]"
                    aria-label={`Delete ${entry.relPath}`}
                    onClick={(e) => { e.stopPropagation(); onDelete(entry.fullPath); }}
                  >
                    <Icon name="ph:trash" width={12} aria-hidden />
                  </button>
                ) : null}
              </div>
            </li>
            );
          })}
        </ul>
      )}
      {onShowMore && hidden > 0 ? (
        <button
          type="button"
          onClick={onShowMore}
          className="focus-ring flex w-full items-center justify-center gap-1.5 border-t border-[var(--border-hairline)] px-3 py-2 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
        >
          <Icon name="ph:caret-down" width={11} />
          Show {Math.min(hidden, 80)} more · {sliced.length} of {entries.length}
        </button>
      ) : null}
    </div>
  );
}
