"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@/lib/icon";
import type { Familiar } from "@/lib/types";
import type { CovenMemoryEntry } from "@/components/agents-view-stats";
import { MarkdownBlock } from "@/components/message-bubble";
import { useUndoDelete } from "@/lib/use-undo-delete";
import { LibraryUndoToast } from "./library-undo-toast";
import {
  classifyProtection,
  detectStale,
  groupMemories,
  normalizeCovenEntry,
  normalizeFileEntry,
  sortMemories,
  type GroupBy,
} from "@/lib/memory-management";
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

function age(iso: string | undefined): string {
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

export function AgentsMemoryView({ familiars, activeFamiliar, onOpenMemoryFile, limit, lockToFamiliar, compact }: Props) {
  const [covenEntries, setCovenEntries] = useState<CovenMemoryEntry[]>([]);
  const [fileEntries, setFileEntries] = useState<FileMemoryEntry[]>([]);
  const [query, setQuery] = useState("");
  const [familiarFilter, setFamiliarFilter] = useState<string>(activeFamiliar?.id ?? familiars[0]?.id ?? "");
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState<"all" | FileMemoryEntry["sourceKind"]>("all");
  const [sortMode, setSortMode] = useState<"recent" | "oldest" | "name" | "size" | "staleFirst">("recent");
  const [groupMode, setGroupMode] = useState<GroupBy>("none");
  const [staleOnly, setStaleOnly] = useState(false);
  const { pending: undoPending, scheduleDelete, undo: undoDelete, commit: commitDelete } = useUndoDelete<{ key: string }>();
  const [lastLoadedAt, setLastLoadedAt] = useState<string | null>(null);
  const effectiveLimit = limit ?? Infinity;
  const fullView = effectiveLimit === Infinity;
  // Incremental render caps for the full view (rail/compact use `limit` instead).
  const FILE_PAGE = 80;
  const FAMILIAR_PAGE = 80;
  const [fileLimit, setFileLimit] = useState(FILE_PAGE);
  const [familiarLimit, setFamiliarLimit] = useState(FAMILIAR_PAGE);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

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
  const q = query.trim().toLowerCase();

  const visibleCoven = useMemo(
    () =>
      covenEntries
        .filter((entry) => entry.familiar_id === familiarFilter)
        .filter((entry) => memoryMatches(entry, q))
        .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1)),
    [covenEntries, familiarFilter, q],
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
    return fileEntries
      .filter((entry) => sourceFilter === "all" || entry.sourceKind === sourceFilter)
      .filter((entry) => memoryMatches(entry, q))
      .filter((entry) => !staleOnly || detectStale(normalizeFileEntry(entry)).stale)
      .sort(cmp[sortMode]);
  }, [fileEntries, q, sourceFilter, sortMode, staleOnly]);

  // Reset pagination whenever the result set changes underneath the user.
  useEffect(() => { setFileLimit(FILE_PAGE); }, [q, sourceFilter, familiarFilter]);
  useEffect(() => { setFamiliarLimit(FAMILIAR_PAGE); }, [q, familiarFilter]);

  const familiarsWithMemory = useMemo(() => {
    const ids = new Set(covenEntries.map((entry) => entry.familiar_id));
    return familiars.filter((familiar) => ids.has(familiar.id));
  }, [covenEntries, familiars]);

  const fileSourceCounts = useMemo(() => ({
    covenOrigin: fileEntries.filter((entry) => entry.sourceKind === "coven-origin").length,
    externalHarnesses: fileEntries.filter((entry) => entry.sourceKind === "external-harness").length,
    runtimeMemory: fileEntries.filter((entry) => entry.sourceKind === "runtime").length,
  }), [fileEntries]);

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

  const selectedFamiliar = familiarById.get(familiarFilter) ?? null;
  const familiarOptions = useMemo(() => {
    const options = familiarsWithMemory.length > 0 ? familiarsWithMemory : familiars;
    if (!selectedFamiliar || options.some((familiar) => familiar.id === selectedFamiliar.id)) return options;
    return [selectedFamiliar, ...options];
  }, [familiars, familiarsWithMemory, selectedFamiliar]);

  // When the active familiar has no memories, the familiar column collapses so the
  // (typically much larger) memory-files list claims the freed width instead of
  // leaving a half-empty grid track. The drawer still gets its own track when open.
  const hasFamiliar = visibleCoven.length > 0;
  const contentClass = compact
    ? "flex flex-col gap-4 overflow-y-auto p-4"
    : hasFamiliar
      ? selectedRowId
        ? "grid gap-4 overflow-y-auto p-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(280px,360px)]"
        : "grid gap-4 overflow-y-auto p-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
      : selectedRowId
        ? "grid gap-4 overflow-y-auto p-4 xl:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]"
        : "grid gap-4 overflow-y-auto p-4";

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[var(--bg-base)]">
      <div className={`shrink-0 border-b border-[var(--border-hairline)] ${compact ? "px-3 py-2" : "px-4 py-3"}`}>
        {compact ? null : (
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <Icon name="ph:brain-bold" width={15} className="text-[var(--accent-presence)]" />
                <h2 className="text-[14px] font-semibold text-[var(--text-primary)]">Agent Memory</h2>
              </div>
              <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                Focused recall for one agent at a time, with local memory files kept in the list surface.
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
        )}

        {compact ? null : (
          <div
            data-testid="memory-stats-inline"
            className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[11px] text-[var(--text-secondary)]"
          >
            <span className="inline-flex items-baseline gap-1 px-1"><span className="text-[var(--text-muted)]">Agent memories</span> <span className="font-semibold text-[var(--text-primary)]">{visibleCoven.length}</span></span>
            <span aria-hidden className="text-[var(--border-strong)]">·</span>
            <span className="mr-0.5 text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Files</span>
            <SourceFilterChip label="Coven origin" count={fileSourceCounts.covenOrigin} active={sourceFilter === "coven-origin"} onClick={() => setSourceFilter((s) => (s === "coven-origin" ? "all" : "coven-origin"))} />
            <SourceFilterChip label="External harnesses" count={fileSourceCounts.externalHarnesses} active={sourceFilter === "external-harness"} onClick={() => setSourceFilter((s) => (s === "external-harness" ? "all" : "external-harness"))} />
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
        )}

        <div className={`${compact ? "" : "mt-3"} flex flex-wrap items-center gap-2`}>
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
        {error ? <div className="mt-2 text-[11px] text-[var(--color-warning)]">{error}</div> : null}
      </div>

      <div className={`min-h-0 flex-1 ${contentClass}`}>
        {compact && loaded && !error && visibleCoven.length === 0 && visibleFiles.length === 0 ? (
          <div className="grid place-items-center rounded-lg border border-dashed border-[var(--border-hairline)] bg-[var(--bg-raised)]/25 px-4 py-10 text-center">
            <Icon name="ph:brain" width={22} className="text-[var(--text-muted)]" />
            <div className="mt-3 text-[13px] font-medium text-[var(--text-primary)]">
              No memories yet for {selectedFamiliar?.display_name ?? "this familiar"}
            </div>
            <p className="mt-1 max-w-[280px] text-[11px] leading-5 text-[var(--text-muted)]">
              Familiar memories are saved during chats. Memory files appear when the agent's harness writes to disk.
            </p>
          </div>
        ) : (
          <>
        {!compact && !hasFamiliar ? (
          <div className="xl:col-[1/-1] flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-dashed border-[var(--border-hairline)] bg-[var(--bg-raised)]/20 px-3.5 py-2.5 text-[11px] leading-5">
            <Icon name="ph:brain" width={14} className="shrink-0 text-[var(--text-muted)]" />
            {loaded ? (
              error ? (
                <span className="text-[var(--color-warning)]">Couldn’t load familiar memories. See the error above and try again.</span>
              ) : query ? (
                <span className="text-[var(--text-muted)]">No familiar memories match “{query.trim()}”.</span>
              ) : (
                <span className="text-[var(--text-muted)]">
                  <span className="font-medium text-[var(--text-secondary)]">No familiar memories yet for {selectedFamiliar?.display_name ?? "this familiar"}.</span>{" "}
                  They’re saved during chats; harness-written memory files appear in the list below.
                </span>
              )
            ) : (
              <span className="text-[var(--text-muted)]">Loading memories…</span>
            )}
          </div>
        ) : null}
        {compact || hasFamiliar ? (
        <section className="min-h-0">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[11px] font-semibold uppercase tracking-widest text-[var(--text-secondary)]">Familiar memory</h3>
            <span className="text-[10px] text-[var(--text-muted)]">{visibleCoven.length} visible</span>
          </div>
          {visibleCoven.length === 0 ? (
            <div className="grid place-items-center rounded-lg border border-dashed border-[var(--border-hairline)] px-4 py-6 text-center text-[12px] text-[var(--text-muted)]">
              {loaded ? (error ? "Couldn’t load familiar memories. See the error above and try again." : "No familiar memories match this view.") : "Loading memories..."}
            </div>
          ) : (
            <>
            <div className="grid gap-2 md:grid-cols-2">
              {visibleCoven.slice(0, fullView ? familiarLimit : effectiveLimit).map((entry) => {
                const familiar = familiarById.get(entry.familiar_id);
                return (
                  <article
                    key={entry.id}
                    role={compact ? undefined : "button"}
                    tabIndex={compact ? undefined : 0}
                    onClick={() => { if (!compact) setSelectedRowId(`coven:${entry.id}`); }}
                    onKeyDown={(e) => {
                      if (compact) return;
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedRowId(`coven:${entry.id}`);
                      }
                    }}
                    className={`rounded-lg border p-3 transition-colors ${compact ? "border-[var(--border-hairline)] bg-[var(--bg-raised)]/35" : selectedRowId === `coven:${entry.id}` ? "cursor-pointer border-[var(--accent-presence)] bg-[var(--bg-raised)]/55" : "cursor-pointer border-[var(--border-hairline)] bg-[var(--bg-raised)]/35 hover:bg-[var(--bg-raised)]/50"}`}
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
                      {classifyProtection(entry.path) !== "structural" && (
                        <button
                          type="button"
                          className="memory-card-delete focus-ring inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--border-hairline)] text-[var(--text-muted)] hover:text-[var(--color-warning)]"
                          aria-label={`Delete ${entry.title}`}
                          onClick={(e) => { e.stopPropagation(); handleDelete(entry.path, entry.id, "coven"); }}
                        >
                          <Icon name="ph:trash" width={12} aria-hidden />
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
            {fullView && visibleCoven.length > familiarLimit ? (
              <button
                type="button"
                onClick={() => setFamiliarLimit((n) => n + FAMILIAR_PAGE)}
                className="focus-ring mt-2 inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border-hairline)] px-2.5 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
              >
                <Icon name="ph:caret-down" width={11} />
                Show more · {familiarLimit} of {visibleCoven.length}
              </button>
            ) : null}
            </>
          )}
        </section>
        ) : null}

        <section className="min-h-0">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-widest text-[var(--text-secondary)]">Memory files</h3>
            <div className="flex items-center gap-2">
              {compact ? null : (
                <label className="flex items-center gap-1 text-[10px] text-[var(--text-muted)]">
                  <span className="sr-only">Sort memory files</span>
                  <Icon name="ph:caret-up-down" width={11} aria-hidden />
                  <select
                    value={sortMode}
                    onChange={(event) => setSortMode(event.target.value as typeof sortMode)}
                    aria-label="Sort memory files"
                    className="focus-ring rounded border border-[var(--border-hairline)] bg-[var(--bg-raised)]/40 py-0.5 pl-1 pr-4 text-[10px] text-[var(--text-secondary)]"
                  >
                    <option value="recent">Recent</option>
                    <option value="name">Name</option>
                    <option value="size">Size</option>
                  </select>
                </label>
              )}
              <span className="text-[10px] text-[var(--text-muted)]">
                {fullView && visibleFiles.length > fileLimit
                  ? `${fileLimit} of ${visibleFiles.length}`
                  : `${visibleFiles.length} visible`}
              </span>
            </div>
          </div>
          <MemoryFilesList
            entries={visibleFiles}
            onOpen={onOpenMemoryFile}
            loaded={loaded}
            error={error}
            limit={fullView ? fileLimit : effectiveLimit}
            onShowMore={fullView ? () => setFileLimit((n) => n + FILE_PAGE) : undefined}
            activeFamiliarId={familiarFilter}
            onSelect={compact ? undefined : (rowId) => setSelectedRowId(rowId)}
            selectedRowId={compact ? null : selectedRowId}
            onDelete={compact ? undefined : (p) => handleDelete(p, p, "file")}
          />
        </section>
        {!compact && selectedRowId ? (
          <aside data-testid="memory-list-drawer" className="min-h-0 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-raised)]/30 p-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-widest text-[var(--text-secondary)]">Selected</h3>
              <button
                type="button"
                onClick={() => setSelectedRowId(null)}
                className="focus-ring inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
                aria-label="Close drawer"
              >
                <Icon name="ph:x-bold" width={11} />
              </button>
            </div>
            {(() => {
              if (selectedRowId.startsWith("coven:")) {
                const id = selectedRowId.slice("coven:".length);
                const entry = visibleCoven.find((c) => c.id === id);
                if (!entry) return <div className="mt-3 text-[12px] text-[var(--text-muted)]">Memory no longer in view.</div>;
                const familiar = familiarById.get(entry.familiar_id);
                return (
                  <div className="mt-3">
                    <h4 className="line-clamp-3 text-[14px] font-semibold leading-5 text-[var(--text-primary)]">{entry.title}</h4>
                    <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-[var(--text-muted)]">
                      <span className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[var(--text-secondary)]">{familiar?.display_name ?? entry.familiar_id}</span>
                      <span className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5">Coven memory</span>
                      <span className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5">{age(entry.updated_at)}</span>
                    </div>
                    {entry.excerpt ? <p className="mt-3 line-clamp-6 text-[12px] leading-5 text-[var(--text-secondary)]">{entry.excerpt}</p> : null}
                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => onOpenMemoryFile?.(entry.path)}
                        className="focus-ring inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border-hairline)] px-2 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
                      >
                        <Icon name="ph:file-text" width={12} />
                        Open memory
                      </button>
                      <ExpandMemoryButton path={entry.path} title={entry.title} />
                    </div>
                  </div>
                );
              }
              if (selectedRowId.startsWith("file:")) {
                const fullPath = selectedRowId.slice("file:".length);
                const entry = visibleFiles.find((f) => f.fullPath === fullPath);
                if (!entry) return <div className="mt-3 text-[12px] text-[var(--text-muted)]">File no longer in view.</div>;
                return (
                  <div className="mt-3">
                    <h4 className="line-clamp-3 text-[14px] font-semibold leading-5 text-[var(--text-primary)]">{entry.relPath}</h4>
                    <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-[var(--text-muted)]">
                      <span className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[var(--text-secondary)]">{entry.sourceKindLabel}</span>
                      <span className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5">{entry.rootLabel}</span>
                      {formatBytes(entry.size) ? <span className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5">{formatBytes(entry.size)}</span> : null}
                      <span className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5">{age(entry.modified)}</span>
                    </div>
                    <div className="mt-3 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-elevated)]/40 px-2.5 py-2">
                      <div className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-secondary)]">Path</div>
                      <code className="mt-1 block break-all font-mono text-[11px] leading-4 text-[var(--text-primary)]">{compactPath(entry.fullPath)}</code>
                    </div>
                    <MemoryFilePreview path={entry.fullPath} />
                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => onOpenMemoryFile?.(entry.fullPath)}
                        className="focus-ring inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border-hairline)] px-2 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
                      >
                        <Icon name="ph:file-text" width={12} />
                        Open file
                      </button>
                      <ExpandMemoryButton path={entry.fullPath} title={entry.relPath} />
                    </div>
                  </div>
                );
              }
              return null;
            })()}
          </aside>
        ) : null}
          </>
        )}
      </div>
      {undoPending ? (
        <LibraryUndoToast
          label={undoPending.label}
          onUndo={handleUndoDelete}
          onDismiss={commitDelete}
        />
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
        <AgentsMemoryView
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
// Standalone file-list — reusable by the Agents detail panel without the
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
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    setText(null);
    setError(null);
    void (async () => {
      try {
        const res = await fetch(`/api/memory/file?path=${encodeURIComponent(path)}`, { cache: "no-store" });
        const json = await res.json();
        if (cancelled) return;
        if (json.ok) setText(typeof json.text === "string" ? json.text : "");
        else setError(json.error ?? "Failed to load memory");
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load memory");
      }
    })();
    return () => { cancelled = true; };
  }, [path]);

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

function MemoryFilePreview({ path }: { path: string }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setText(null);
    setError(null);
    void (async () => {
      try {
        const res = await fetch(`/api/memory/file?path=${encodeURIComponent(path)}`, { cache: "no-store" });
        const json = await res.json();
        if (cancelled) return;
        if (json.ok) setText(typeof json.text === "string" ? json.text : "");
        else setError(json.error ?? "Failed to load preview");
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load preview");
      }
    })();
    return () => { cancelled = true; };
  }, [path]);

  const MAX_LINES = 40;
  const lines = text?.split("\n") ?? [];
  const clipped = lines.length > MAX_LINES;
  const preview = clipped ? lines.slice(0, MAX_LINES).join("\n") : text ?? "";

  return (
    <div className="mt-3">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-secondary)]">Preview</div>
      <div className="mt-1 max-h-[280px] overflow-auto rounded-md border border-[var(--border-hairline)] bg-[var(--bg-elevated)]/40 p-2">
        {error ? (
          <p className="text-[11px] text-[var(--color-warning)]">{error}</p>
        ) : text === null ? (
          <p className="text-[11px] text-[var(--text-muted)]">Loading preview…</p>
        ) : preview.trim() === "" ? (
          <p className="text-[11px] text-[var(--text-muted)]">Empty file.</p>
        ) : (
          <pre className="whitespace-pre-wrap break-words font-mono text-[10px] leading-4 text-[var(--text-secondary)]">{preview}</pre>
        )}
      </div>
      {clipped ? (
        <p className="mt-1 text-[10px] text-[var(--text-muted)]">Showing first {MAX_LINES} lines — Expand for the full file.</p>
      ) : null}
    </div>
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
        <div className="px-3 py-8 text-center text-[12px] text-[var(--text-muted)]">
          {loaded
            ? error
              ? "Couldn't load memory files. See the error above and try again."
              : "No memory files match this view."
            : "Loading files..."}
        </div>
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
                      {entry.harnessId ? <span className="rounded bg-[var(--bg-elevated)] px-1 py-0.5">harness:{entry.harnessId}</span> : null}
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
