"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@/lib/icon";
import type { Familiar } from "@/lib/types";
import { MemoryGraph3D } from "@/components/memory-graph-3d";
import { buildMemoryGraphModel, resolveMemoryFamiliarFilter } from "@/lib/memory-graph-3d-model";

type CovenMemoryEntry = {
  id: string;
  familiar_id: string;
  title: string;
  path: string;
  updated_at: string;
  excerpt?: string;
};

type FileMemoryEntry = {
  root: string;
  rootLabel: string;
  relPath: string;
  fullPath: string;
  size: number;
  modified: string;
};

type Props = {
  familiars: Familiar[];
  activeFamiliar: Familiar | null;
  onOpenMemoryFile?: (path: string) => void;
  /** Lock to a specific view mode; when set, hides the mode toggle. */
  mode?: "list" | "graph";
  /** Cap the number of entries rendered per section. */
  limit?: number;
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
  return path.replace(/^\/Users\/[^/]+/, "~");
}

function memoryMatches(entry: CovenMemoryEntry | FileMemoryEntry, query: string): boolean {
  if (!query) return true;
  if ("familiar_id" in entry) {
    return [
      entry.title,
      entry.excerpt ?? "",
      entry.familiar_id,
      entry.path,
    ].some((value) => value.toLowerCase().includes(query));
  }
  return [
    entry.rootLabel,
    entry.relPath,
    entry.fullPath,
  ].some((value) => value.toLowerCase().includes(query));
}

export function AgentsMemoryView({ familiars, activeFamiliar, onOpenMemoryFile, mode, limit }: Props) {
  const [covenEntries, setCovenEntries] = useState<CovenMemoryEntry[]>([]);
  const [fileEntries, setFileEntries] = useState<FileMemoryEntry[]>([]);
  const [query, setQuery] = useState("");
  const [familiarFilter, setFamiliarFilter] = useState<string>(activeFamiliar?.id ?? familiars[0]?.id ?? "");
  const [viewMode, setViewMode] = useState<"list" | "graph">("list");
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
        .filter((entry) => memoryMatches(entry, q))
        .sort((a, b) => (a.modified < b.modified ? 1 : -1)),
    [fileEntries, q],
  );

  const familiarsWithMemory = useMemo(() => {
    const ids = new Set(covenEntries.map((entry) => entry.familiar_id));
    return familiars.filter((familiar) => ids.has(familiar.id));
  }, [covenEntries, familiars]);

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

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[var(--bg-base)]">
      <div className="shrink-0 border-b border-[var(--border-hairline)] px-4 py-3">
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
                      "inline-flex h-7 items-center gap-1.5 px-2.5 text-[11px] capitalize transition-colors",
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
            <button type="button" onClick={() => void load()} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--border-hairline)] px-2.5 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]">
              <Icon name="ph:arrows-clockwise" width={12} />
              Refresh
            </button>
          </div>
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <div className="rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-raised)]/35 px-3 py-2">
            <div className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">Agent memories</div>
            <div className="mt-1 text-lg font-semibold text-[var(--text-primary)]">{visibleCoven.length}</div>
          </div>
          <div className="rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-raised)]/35 px-3 py-2">
            <div className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">Memory files</div>
            <div className="mt-1 text-lg font-semibold text-[var(--text-primary)]">{fileEntries.length}</div>
          </div>
          <div className="rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-raised)]/35 px-3 py-2">
            <div className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">Agents with memory</div>
            <div className="mt-1 text-lg font-semibold text-[var(--text-primary)]">{familiarsWithMemory.length}</div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Icon name="ph:magnifying-glass" width={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search memory..."
              className="h-8 w-full rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)]/40 pl-7 pr-3 text-[12px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--accent-presence)]"
            />
          </div>
          <select
            value={familiarFilter}
            onChange={(event) => setFamiliarFilter(event.target.value)}
            className="h-8 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)]/40 px-2 text-[12px] text-[var(--text-secondary)] outline-none focus:border-[var(--accent-presence)]"
          >
            {familiarOptions.map((familiar) => (
              <option key={familiar.id} value={familiar.id}>{familiar.display_name}</option>
            ))}
          </select>
        </div>
        {error ? <div className="mt-2 text-[11px] text-[var(--color-warning)]">{error}</div> : null}
      </div>

      {effectiveViewMode === "graph" ? (
        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <section className="min-h-[520px] overflow-hidden rounded-lg border border-[var(--border-hairline)]">
            <MemoryGraph3D
              graph={memoryGraph}
              familiars={familiarById}
              selectedFamiliarId={familiarFilter}
              onSelectFamiliar={(familiarId) => setFamiliarFilter(familiarId)}
              onOpenMemoryFile={onOpenMemoryFile}
            />
          </section>
          <aside className="hidden min-h-0 xl:block">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-[11px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
                {selectedFamiliar?.display_name ?? "Selected agent"}
              </h3>
              <span className="text-[10px] text-[var(--text-muted)]">{visibleCoven.length} visible</span>
            </div>
            <div className="max-h-[640px] overflow-y-auto rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-raised)]/25">
              {visibleCoven.slice(0, 18).map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => onOpenMemoryFile?.(entry.path)}
                  className="flex w-full items-start gap-2 border-b border-[var(--border-hairline)] px-3 py-2 text-left hover:bg-[var(--bg-raised)]"
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
          </aside>
        </div>
      ) : (
      <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
        <section className="min-h-0">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[11px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">Familiar memory</h3>
            <span className="text-[10px] text-[var(--text-muted)]">{visibleCoven.length} visible</span>
          </div>
          {visibleCoven.length === 0 ? (
            <div className="grid min-h-[180px] place-items-center rounded-lg border border-dashed border-[var(--border-hairline)] text-center text-[12px] text-[var(--text-muted)]">
              {loaded ? (error ? "Couldn’t load familiar memories. See the error above and try again." : "No familiar memories match this view.") : "Loading memories..."}
            </div>
          ) : (
            <div className="grid gap-2 md:grid-cols-2">
              {visibleCoven.slice(0, effectiveLimit === Infinity ? 80 : effectiveLimit).map((entry) => {
                const familiar = familiarById.get(entry.familiar_id);
                return (
                  <article key={entry.id} className="rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-raised)]/35 p-3">
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
                    <button
                      type="button"
                      onClick={() => onOpenMemoryFile?.(entry.path)}
                      className="mt-3 inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border-hairline)] px-2 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
                    >
                      <Icon name="ph:file-text" width={12} />
                      Open memory
                    </button>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section className="min-h-0">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[11px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">Memory files</h3>
            <span className="text-[10px] text-[var(--text-muted)]">{visibleFiles.length} visible</span>
          </div>
          <div className="rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-raised)]/25">
            {visibleFiles.length === 0 ? (
              <div className="px-3 py-8 text-center text-[12px] text-[var(--text-muted)]">
                {loaded ? (error ? "Couldn’t load memory files. See the error above and try again." : "No memory files match this view.") : "Loading files..."}
              </div>
            ) : (
              <ul className="max-h-[640px] divide-y divide-[var(--border-hairline)] overflow-y-auto">
                {visibleFiles.slice(0, effectiveLimit === Infinity ? 160 : effectiveLimit).map((entry) => (
                  <li key={entry.fullPath}>
                    <button
                      type="button"
                      onClick={() => onOpenMemoryFile?.(entry.fullPath)}
                      className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-[var(--bg-raised)]"
                    >
                      <Icon name="ph:file-text" width={13} className="mt-0.5 shrink-0 text-[var(--text-muted)]" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12px] text-[var(--text-primary)]">{entry.relPath}</span>
                        <span className="mt-0.5 block truncate font-mono text-[10px] text-[var(--text-muted)]">
                          {entry.rootLabel} · {compactPath(entry.fullPath)}
                        </span>
                      </span>
                      <span className="shrink-0 text-[10px] text-[var(--text-muted)]">{age(entry.modified)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
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
      <AgentsMemoryView
        familiars={familiars}
        activeFamiliar={familiar}
        mode="list"
        limit={20}
      />
      {onOpenFullView ? (
        <button
          type="button"
          className="rail-memory__open-full"
          onClick={onOpenFullView}
        >
          Open full memory →
        </button>
      ) : null}
    </div>
  );
}
