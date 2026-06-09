"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@/lib/icon";
import type { Familiar } from "@/lib/types";
import { MemoryGraph3D } from "@/components/memory-graph-3d";
import { buildMemoryGraphModel, resolveMemoryFamiliarFilter } from "@/lib/memory-graph-3d-model";
import type { MemoryGraphMemoryNode } from "@/lib/memory-graph-3d-model";
import type { CovenMemoryEntry } from "@/components/agents-view-stats";
import { MarkdownBlock } from "@/components/message-bubble";

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
  /** Lock to a specific view mode; when set, hides the mode toggle. */
  mode?: "list" | "graph";
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

export function AgentsMemoryView({ familiars, activeFamiliar, onOpenMemoryFile, mode, limit, lockToFamiliar, compact }: Props) {
  const [covenEntries, setCovenEntries] = useState<CovenMemoryEntry[]>([]);
  const [fileEntries, setFileEntries] = useState<FileMemoryEntry[]>([]);
  const [query, setQuery] = useState("");
  const [familiarFilter, setFamiliarFilter] = useState<string>(activeFamiliar?.id ?? familiars[0]?.id ?? "");
  const [viewMode, setViewMode] = useState<"list" | "graph">("graph");
  const [selectedMemoryId, setSelectedMemoryId] = useState<string | null>(null);
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const effectiveViewMode = mode ?? viewMode;
  const effectiveLimit = limit ?? Infinity;
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
    }
  }, []);

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

  const visibleFiles = useMemo(
    () =>
      fileEntries
        .filter((entry) => entry.familiarId === familiarFilter)
        .filter((entry) => memoryMatches(entry, q))
        .sort((a, b) => (a.modified < b.modified ? 1 : -1)),
    [familiarFilter, fileEntries, q],
  );

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
    const next = resolveMemoryFamiliarFilter({
      familiars,
      covenEntries,
      currentFamiliarId: familiarFilter,
      activeFamiliarId: activeFamiliar?.id ?? null,
    });
    if (next && next !== familiarFilter) setFamiliarFilter(next);
  }, [activeFamiliar?.id, covenEntries, familiarFilter, familiars]);

  const selectedFamiliar = familiarById.get(familiarFilter) ?? null;
  const familiarOptions = useMemo(() => {
    const options = familiarsWithMemory.length > 0 ? familiarsWithMemory : familiars;
    if (!selectedFamiliar || options.some((familiar) => familiar.id === selectedFamiliar.id)) return options;
    return [selectedFamiliar, ...options];
  }, [familiars, familiarsWithMemory, selectedFamiliar]);

  const memoryGraph = useMemo(
    () =>
      buildMemoryGraphModel({
        familiars,
        covenEntries,
        fileEntries,
        query,
        familiarFilter,
        maxLeavesPerHub: 24,
      }),
    [covenEntries, familiarFilter, familiars, fileEntries, query],
  );

  const selectedMemory = useMemo(
    () =>
      memoryGraph.nodes.find(
        (node): node is MemoryGraphMemoryNode => node.kind === "memory" && node.id === selectedMemoryId,
      ) ?? null,
    [memoryGraph, selectedMemoryId],
  );
  const firstMemoryId = useMemo(
    () => memoryGraph.nodes.find((node) => node.kind === "memory")?.id ?? null,
    [memoryGraph],
  );

  useEffect(() => {
    if (selectedMemoryId && selectedMemory) return;
    setSelectedMemoryId(firstMemoryId);
  }, [firstMemoryId, selectedMemory, selectedMemoryId]);

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
            <div className="flex items-center gap-2">
              {!mode && (
                <div className="flex overflow-hidden rounded-md border border-[var(--border-hairline)]">
                  {(["list", "graph"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setViewMode(m)}
                      className={[
                        "focus-ring-inset inline-flex h-7 items-center gap-1.5 px-2.5 text-[11px] capitalize transition-colors",
                        viewMode === m
                          ? "bg-[var(--accent-presence)] text-white"
                          : "bg-[var(--bg-raised)]/30 text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]",
                      ].join(" ")}
                    >
                      <Icon name={m === "list" ? "ph:list-bullets" : "ph:graph"} width={12} />
                      {m}
                    </button>
                  ))}
                </div>
              )}
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
            className="mt-3 flex flex-wrap items-baseline gap-x-5 gap-y-1 text-[11px] text-[var(--text-secondary)]"
          >
            <span><span className="text-[var(--text-muted)]">Agent memories</span> <span className="ml-1 font-semibold text-[var(--text-primary)]">{visibleCoven.length}</span></span>
            <span><span className="text-[var(--text-muted)]">Coven origin</span> <span className="ml-1 font-semibold text-[var(--text-primary)]">{fileSourceCounts.covenOrigin}</span></span>
            <span><span className="text-[var(--text-muted)]">External harnesses</span> <span className="ml-1 font-semibold text-[var(--text-primary)]">{fileSourceCounts.externalHarnesses}</span></span>
            <span><span className="text-[var(--text-muted)]">Runtime memory</span> <span className="ml-1 font-semibold text-[var(--text-primary)]">{fileSourceCounts.runtimeMemory}</span></span>
          </div>
        )}

        <div className={`${compact ? "" : "mt-3"} flex flex-wrap items-center gap-2`}>
          <div className={`relative ${compact ? "min-w-0" : "min-w-[220px]"} flex-1`}>
            <Icon name="ph:magnifying-glass" width={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={lockToFamiliar && selectedFamiliar?.display_name ? `Search ${selectedFamiliar.display_name}'s memory...` : "Search memory..."}
              className="focus-ring h-8 w-full rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)]/40 pl-7 pr-3 text-[12px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-presence)]"
            />
          </div>
          {lockToFamiliar ? null : (
            <select
              value={familiarFilter}
              onChange={(event) => setFamiliarFilter(event.target.value)}
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

      {effectiveViewMode === "graph" ? (
        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <section className="min-h-[560px] overflow-hidden rounded-lg border border-[var(--border-hairline)]">
            <MemoryGraph3D
              graph={memoryGraph}
              familiars={familiarById}
              selectedFamiliarId={familiarFilter}
              selectedMemoryId={selectedMemoryId}
              onSelectFamiliar={(familiarId) => setFamiliarFilter(familiarId)}
              onSelectMemory={setSelectedMemoryId}
              onOpenMemoryFile={onOpenMemoryFile}
            />
          </section>
          <aside className="min-h-0">
            <section className="rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-raised)]/30 p-3">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-secondary)]">
                Selected memory
              </div>
              {selectedMemory ? (
                <div className="mt-3">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="line-clamp-3 text-[15px] font-semibold leading-5 text-[var(--text-primary)]">
                      {selectedMemory.title}
                    </h3>
                    <Icon
                      name={selectedMemory.source === "file" ? "ph:file-text" : "ph:brain"}
                      width={15}
                      className="mt-0.5 shrink-0 text-[var(--accent-presence)]"
                    />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-[var(--text-muted)]">
                    <span className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[var(--text-secondary)]">
                      {selectedFamiliar?.display_name ?? selectedMemory.familiarId ?? "Memory"}
                    </span>
                    <span className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5">
                      {selectedMemory.source === "file" ? selectedMemory.rootLabel ?? "File" : "Coven memory"}
                    </span>
                    <span className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5">{age(selectedMemory.updatedAt)}</span>
                  </div>
                  {selectedMemory.excerpt ? (
                    <p className="mt-3 line-clamp-6 text-[12px] leading-5 text-[var(--text-secondary)]">
                      {selectedMemory.excerpt}
                    </p>
                  ) : null}
                  {selectedMemory.sourceContext ? (
                    <div className="mt-3 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-elevated)]/40 px-2.5 py-2">
                      <div className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-secondary)]">
                        Provenance
                      </div>
                      <code className="mt-1 block break-all font-mono text-[11px] leading-4 text-[var(--text-primary)]">
                        {selectedMemory.sourceContext}
                      </code>
                    </div>
                  ) : null}
                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => onOpenMemoryFile?.(selectedMemory.path)}
                      className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-hairline)] px-2.5 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
                    >
                      <Icon name="ph:file-text" width={13} />
                      Open memory
                    </button>
                    <ExpandMemoryButton path={selectedMemory.path} title={selectedMemory.title} />
                  </div>
                </div>
              ) : (
                <div className="mt-3 rounded-md border border-dashed border-[var(--border-hairline)] px-3 py-6 text-center text-[12px] text-[var(--text-muted)]">
                  {loaded ? "Select a memory card in the graph." : "Loading memories..."}
                </div>
              )}
            </section>

            <section className="mt-4">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-[11px] font-semibold uppercase tracking-widest text-[var(--text-secondary)]">
                  Recent in view
                </h3>
                <span className="text-[10px] text-[var(--text-muted)]">{visibleCoven.length} visible</span>
              </div>
              <div className="max-h-[420px] overflow-y-auto rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-raised)]/25">
              {visibleCoven.slice(0, 18).map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => setSelectedMemoryId(`memory:coven:${entry.id}`)}
                  className="focus-ring-inset flex w-full items-start gap-2 border-b border-[var(--border-hairline)] px-3 py-2 text-left hover:bg-[var(--bg-raised)]"
                >
                  <Icon name="ph:brain" width={13} className="mt-0.5 shrink-0 text-[var(--accent-presence)]" />
                  <span className="min-w-0 flex-1">
                    <span className="block line-clamp-2 text-[12px] text-[var(--text-primary)]">{entry.title}</span>
                    <span className="mt-0.5 block text-[10px] text-[var(--text-muted)]">{familiarById.get(entry.familiar_id)?.display_name ?? entry.familiar_id} · {age(entry.updated_at)}</span>
                  </span>
                </button>
              ))}
              {visibleCoven.length === 0 ? (
                <div className="px-3 py-8 text-center text-[12px] text-[var(--text-muted)]">
                  {loaded ? (error ? "Couldn’t load memories. See the error above and try again." : "No memories match this agent view.") : "Loading memories..."}
                </div>
              ) : null}
              </div>
            </section>
          </aside>
        </div>
      ) : (
      <div className={`min-h-0 flex-1 ${compact ? "flex flex-col gap-4 overflow-y-auto p-4" : selectedRowId ? "grid gap-4 overflow-y-auto p-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(280px,360px)]" : "grid gap-4 overflow-y-auto p-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"}`}>
        {compact && loaded && visibleCoven.length === 0 && visibleFiles.length === 0 ? (
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
            <div className="grid gap-2 md:grid-cols-2">
              {visibleCoven.slice(0, effectiveLimit === Infinity ? 80 : effectiveLimit).map((entry) => {
                const familiar = familiarById.get(entry.familiar_id);
                return (
                  <article
                    key={entry.id}
                    onClick={() => { if (!compact) setSelectedRowId(`coven:${entry.id}`); }}
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
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section className="min-h-0">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[11px] font-semibold uppercase tracking-widest text-[var(--text-secondary)]">Memory files</h3>
            <span className="text-[10px] text-[var(--text-muted)]">{visibleFiles.length} visible</span>
          </div>
          <MemoryFilesList
            entries={visibleFiles}
            onOpen={onOpenMemoryFile}
            loaded={loaded}
            error={error}
            limit={effectiveLimit === Infinity ? 160 : effectiveLimit}
            activeFamiliarId={familiarFilter}
            onSelect={compact ? undefined : (rowId) => setSelectedRowId(rowId)}
            selectedRowId={compact ? null : selectedRowId}
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
                      <span className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5">{age(entry.modified)}</span>
                    </div>
                    <div className="mt-3 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-elevated)]/40 px-2.5 py-2">
                      <div className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-secondary)]">Path</div>
                      <code className="mt-1 block break-all font-mono text-[11px] leading-4 text-[var(--text-primary)]">{compactPath(entry.fullPath)}</code>
                    </div>
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
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Rail variant — most-recent memory writes, no graph.
// The full 3D constellation stays as the detail-pane Memory view; the rail
// tab is a quick "what changed" feed.
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
          mode="list"
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
}: MemoryFilesListProps) {
  const sliced = entries.slice(0, limit ?? entries.length);
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
          {sliced.map((entry) => (
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
                  <span className="block truncate text-[12px] text-[var(--text-primary)]">{entry.relPath}</span>
                  <span className="mt-0.5 block truncate font-mono text-[10px] text-[var(--text-muted)]">
                    {entry.sourceKindLabel} · {entry.rootLabel} · {compactPath(entry.fullPath)}
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
              <div className="flex items-center pr-2">
                <ExpandMemoryButton path={entry.fullPath} title={entry.relPath} variant="compact" />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
