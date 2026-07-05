"use client";

import { Icon } from "@/lib/icon";
import {
  resolveCollection,
  type Collection,
  type MarketplacePlugin,
} from "@/lib/marketplace-catalog";

type Props = {
  collections: readonly Collection[];
  plugins: MarketplacePlugin[];
  onOpen: (id: string) => void;
};

/**
 * Featured-collections strip shown on the marketplace landing. Each card is a
 * curated bundle; clicking it filters the grid to that collection's members.
 * Collections that resolve to nothing (ids absent from the catalog) are hidden.
 */
export function CollectionStrip({ collections, plugins, onOpen }: Props) {
  const resolved = collections
    .map((c) => ({ collection: c, members: resolveCollection(plugins, c) }))
    .filter((r) => r.members.length > 0);

  if (resolved.length === 0) return null;

  return (
    <div className="mb-5">
      <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">
        Recommended groups
      </p>
      {/* Container-query columns — track the marketplace pane, not the viewport. */}
      <div className="grid grid-cols-1 gap-3 @min-[560px]/marketplace:grid-cols-2 @min-[1100px]/marketplace:grid-cols-3">
        {resolved.map(({ collection, members }) => {
          const added = members.filter((m) => m.installed).length;
          return (
            <button
              key={collection.id}
              type="button"
              onClick={() => onOpen(collection.id)}
              className="focus-ring group flex flex-col gap-2 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-panel)] p-4 text-left transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-raised)]"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--bg-elevated)]">
                  <Icon name={collection.icon} width={18} className="text-[var(--text-primary)]" />
                </span>
                <Icon
                  name="ph:caret-right"
                  width={14}
                  aria-hidden
                  className="text-[var(--text-muted)] transition-transform group-hover:translate-x-0.5"
                />
              </div>
              <span className="text-[14px] font-semibold text-[var(--text-primary)]">{collection.title}</span>
              <span className="line-clamp-2 text-[12px] text-[var(--text-muted)]">{collection.description}</span>
              <span className="mt-1 text-[11px] text-[var(--text-muted)]">
                {members.length} {members.length === 1 ? "plugin" : "plugins"}
                {added > 0 ? ` · ${added} added` : ""}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
