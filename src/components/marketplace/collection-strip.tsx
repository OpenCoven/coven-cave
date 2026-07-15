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
              className="focus-ring group flex flex-col gap-1.5 rounded-lg border border-transparent px-3 py-3 text-left transition-colors hover:border-[var(--border-hairline)] hover:bg-[color-mix(in_oklch,var(--foreground)_4%,transparent)]"
            >
              <span className="flex items-center gap-2">
                <Icon name={collection.icon} width={15} aria-hidden className="shrink-0 text-[var(--text-secondary)]" />
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--text-primary)]">
                  {collection.title}
                </span>
                <Icon
                  name="ph:caret-right"
                  width={13}
                  aria-hidden
                  className="shrink-0 text-[var(--text-muted)] opacity-0 transition-[opacity,transform] group-hover:translate-x-0.5 group-hover:opacity-100 group-focus-visible:opacity-100"
                />
              </span>
              <span className="line-clamp-2 text-[12px] leading-snug text-[var(--text-muted)]">
                {collection.description}
              </span>
              <span className="text-[11px] text-[var(--text-muted)] opacity-80">
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
