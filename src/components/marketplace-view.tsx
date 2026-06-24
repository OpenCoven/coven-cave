"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { SearchInput } from "@/components/ui/search-input";
import { EmptyState } from "@/components/ui/empty-state";
import { MarketplaceCard } from "@/components/marketplace/marketplace-card";
import { MarketplaceDetail } from "@/components/marketplace/marketplace-detail";
import {
  categoriesFrom,
  filterPlugins,
  type MarketplacePlugin,
} from "@/lib/marketplace-catalog";

export function MarketplaceViewSurface() {
  const [plugins, setPlugins] = useState<MarketplacePlugin[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [selected, setSelected] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

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
  const filtered = useMemo(() => filterPlugins(plugins, { query, category }), [plugins, query, category]);
  const selectedPlugin = useMemo(() => plugins.find((p) => p.id === selected) ?? null, [plugins, selected]);

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
            <p className="mt-1 text-[12px] text-[var(--text-muted)]">{filtered.length} of {plugins.length} plugins</p>
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
        <div className="mt-4 flex flex-wrap gap-1">
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategory(cat)}
              className={`focus-ring rounded-md px-3 py-1.5 text-[12px] transition-colors ${
                category === cat
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
        {!loaded ? (
          <p className="text-[12px] text-[var(--text-muted)]">Loading…</p>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon="ph:puzzle-piece-bold"
            headline={query || category !== "All" ? "No matching plugins" : "No plugins available"}
            subtitle={query || category !== "All" ? "Try a different search or category." : "The catalog is empty."}
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
    </section>
  );
}
