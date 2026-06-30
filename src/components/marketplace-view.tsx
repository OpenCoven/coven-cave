"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@/lib/icon";
import { SearchInput } from "@/components/ui/search-input";
import { EmptyState } from "@/components/ui/empty-state";
import { Tabs } from "@/components/ui/tabs";
import { MarketplaceCard } from "@/components/marketplace/marketplace-card";
import { MarketplaceDetail } from "@/components/marketplace/marketplace-detail";
import { MarketplaceConfigure } from "@/components/marketplace/marketplace-configure";
import { CollectionStrip } from "@/components/marketplace/collection-strip";
import {
  categoriesFrom,
  filterPlugins,
  sortPlugins,
  countByKind,
  resolveCollection,
  COLLECTIONS,
  type KindFilter,
  type SortKey,
  type MarketplacePlugin,
} from "@/lib/marketplace-catalog";

const KIND_TABS: ReadonlyArray<{ id: KindFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "mcp", label: "MCP servers" },
  { id: "skill", label: "Skills" },
];

const SORT_OPTIONS: ReadonlyArray<{ id: SortKey; label: string }> = [
  { id: "recommended", label: "Recommended" },
  { id: "name", label: "Name (A–Z)" },
  { id: "installed", label: "Installed first" },
];

export function MarketplaceViewSurface() {
  const [plugins, setPlugins] = useState<MarketplacePlugin[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [kind, setKind] = useState<KindFilter>("all");
  const [sort, setSort] = useState<SortKey>("recommended");
  const [collectionId, setCollectionId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [configuringId, setConfiguringId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoaded(false);
    try {
      const res = await fetch("/api/marketplace", { cache: "no-store" });
      const json = (await res.json()) as { ok?: boolean; plugins?: MarketplacePlugin[]; error?: string };
      if (!json.ok) throw new Error(json.error ?? `marketplace http ${res.status}`);
      setPlugins(json.plugins ?? []);
      setError(null);
    } catch (err) {
      setPlugins([]);
      setError(err instanceof Error ? err.message : "marketplace unavailable");
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const categories = useMemo(() => categoriesFrom(plugins), [plugins]);
  const kindCounts = useMemo(() => countByKind(plugins), [plugins]);
  const installedCount = useMemo(() => plugins.filter((p) => p.installed).length, [plugins]);

  const activeCollection = useMemo(
    () => COLLECTIONS.find((c) => c.id === collectionId) ?? null,
    [collectionId],
  );
  const collectionIds = useMemo(
    () => (activeCollection ? resolveCollection(plugins, activeCollection).map((p) => p.id) : undefined),
    [plugins, activeCollection],
  );

  const filtered = useMemo(() => {
    const matched = filterPlugins(plugins, {
      query,
      category: activeCollection ? "All" : category,
      kind,
      ids: collectionIds,
    });
    return sortPlugins(matched, sort);
  }, [plugins, query, category, kind, sort, collectionIds, activeCollection]);

  const selectedPlugin = useMemo(() => plugins.find((p) => p.id === selected) ?? null, [plugins, selected]);
  const configuringPlugin = useMemo(() => plugins.find((p) => p.id === configuringId) ?? null, [plugins, configuringId]);

  // The featured strip only makes sense on the unfiltered default landing.
  const showFeatured = !activeCollection && !query && category === "All" && kind === "all";

  const setInstalled = useCallback((id: string, installed: boolean) => {
    setPlugins((prev) => prev.map((p) => (p.id === id ? { ...p, installed } : p)));
  }, []);

  const add = useCallback(async (id: string) => {
    setBusyId(id);
    setInstalled(id, true);
    try {
      const res = await fetch("/api/marketplace/install", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!json.ok) throw new Error(json.error ?? "install failed");
    } catch (err) {
      setInstalled(id, false);
      setError(err instanceof Error ? err.message : "install failed");
    } finally {
      setBusyId(null);
    }
  }, [setInstalled]);

  const remove = useCallback(async (id: string) => {
    setBusyId(id);
    setInstalled(id, false);
    try {
      const res = await fetch("/api/marketplace/uninstall", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!json.ok) throw new Error(json.error ?? "uninstall failed");
    } catch (err) {
      setInstalled(id, true);
      setError(err instanceof Error ? err.message : "uninstall failed");
    } finally {
      setBusyId(null);
    }
  }, [setInstalled]);

  return (
    <section className="marketplace-view flex min-h-0 flex-1 flex-col bg-[var(--bg-base)]">
      <div className="border-b border-[var(--border-hairline)] px-4 py-3 sm:px-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">Marketplace</p>
            <h2 className="text-[20px] font-semibold text-[var(--text-primary)]">Add tools to your familiars</h2>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-[var(--text-muted)]">
              <span>{plugins.length} plugins</span>
              <span aria-hidden>·</span>
              <span>{kindCounts.mcp} MCP servers</span>
              <span aria-hidden>·</span>
              <span>{kindCounts.skill} skills</span>
              {installedCount > 0 ? (
                <>
                  <span aria-hidden>·</span>
                  <span className="text-[var(--text-primary)]">{installedCount} added</span>
                </>
              ) : null}
            </p>
          </div>
          <SearchInput
            value={query}
            onValueChange={setQuery}
            onClear={() => setQuery("")}
            placeholder="Search plugins"
            containerClassName="lg:w-80"
            aria-label="Search plugins"
          />
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <Tabs
            items={KIND_TABS}
            value={kind}
            onChange={setKind}
            variant="segment"
            size="sm"
            bordered={false}
            ariaLabel="Filter plugins by type"
          />
          <label className="flex items-center gap-2 text-[12px] text-[var(--text-muted)]">
            <span className="sr-only">Sort plugins</span>
            <Icon name="ph:sort-ascending" width={14} aria-hidden />
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              aria-label="Sort plugins"
              className="focus-ring cursor-pointer rounded-md border border-[var(--border-hairline)] bg-[var(--bg-panel)] px-2 py-1 text-[12px] text-[var(--text-primary)]"
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-3 flex flex-wrap gap-1">
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => {
                setCategory(cat);
                setCollectionId(null);
              }}
              className={`focus-ring rounded-md px-3 py-1.5 text-[12px] transition-colors ${
                !activeCollection && category === cat
                  ? "bg-[var(--text-primary)] text-[var(--bg-base)]"
                  : "text-[var(--text-muted)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {error ? (
          <p className="mt-3 rounded-md border border-[var(--danger-border)] bg-[var(--danger-bg)] px-3 py-2 text-[12px] text-[var(--danger-text)]">
            {error}
          </p>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
        {showFeatured && plugins.length > 0 ? (
          <CollectionStrip
            collections={COLLECTIONS}
            plugins={plugins}
            onOpen={(id) => {
              setCollectionId(id);
              setCategory("All");
              setKind("all");
            }}
          />
        ) : null}

        {activeCollection ? (
          <div className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-panel)] px-4 py-3">
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--bg-elevated)]">
                <Icon name={activeCollection.icon} width={18} className="text-[var(--text-primary)]" />
              </span>
              <div>
                <p className="text-[14px] font-semibold text-[var(--text-primary)]">{activeCollection.title}</p>
                <p className="text-[12px] text-[var(--text-muted)]">{activeCollection.description}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setCollectionId(null)}
              className="focus-ring inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[12px] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              <Icon name="ph:arrow-left" width={12} aria-hidden /> All plugins
            </button>
          </div>
        ) : null}

        {!loaded ? (
          <p className="text-[12px] text-[var(--text-muted)]">Loading…</p>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon="ph:puzzle-piece-bold"
            headline={query || category !== "All" || kind !== "all" || activeCollection ? "No matching plugins" : "No plugins available"}
            subtitle={query || category !== "All" || kind !== "all" || activeCollection ? "Try a different search, type, or category." : "The catalog is empty."}
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map((plugin) => (
              <MarketplaceCard
                key={plugin.id}
                plugin={plugin}
                busy={busyId === plugin.id}
                onOpen={() => setSelected(plugin.id)}
                onAdd={() => void add(plugin.id)}
                onRemove={() => void remove(plugin.id)}
                onConfigure={() => setConfiguringId(plugin.id)}
              />
            ))}
          </div>
        )}
      </div>

      {selectedPlugin ? (
        <MarketplaceDetail
          plugin={selectedPlugin}
          busy={busyId === selectedPlugin.id}
          onClose={() => setSelected(null)}
          onAdd={() => void add(selectedPlugin.id)}
          onRemove={() => void remove(selectedPlugin.id)}
        />
      ) : null}

      {configuringPlugin ? (
        <MarketplaceConfigure
          pluginId={configuringPlugin.id}
          displayName={configuringPlugin.displayName}
          open={true}
          onClose={() => setConfiguringId(null)}
          onChanged={() => void load()}
        />
      ) : null}
    </section>
  );
}
