"use client";

/**
 * Indexer Surface — an interactive archive.
 *
 * Long-term knowledge, memory, indexes, and provenance for the familiar.
 * Left rail: real knowledge collections (the familiar's memory inventory
 * grouped by source). Center: semantic clustering workspace over those
 * collections. Right sidebar: the selected memory's details, provenance, and
 * local tags. Bottom drawer: indexing health and recent changes.
 *
 * All inventory data is the familiar's real memory (via the shared
 * MemoryAccess adapter). Embeddings, merge/split, and background indexing
 * have no backing services yet — those panels say so instead of pretending.
 */

import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/lib/icon";
import type { RoleSurfaceContext, SurfaceMemoryEntry } from "@/lib/role-surfaces";
import { useRoleSurfaceState } from "@/lib/role-surface-state";
import { RailSection, SurfaceCanvas, SurfaceEmpty, SurfaceRail, SurfaceRoom } from "./surface-room";
import { INDEXER_SURFACE_ID } from "./ids";

export type IndexerState = {
  selectedCollection: string | null;
  selectedPath: string | null;
  filter: string;
  /** Local semantic tags: memory path -> tags. Real analyst data, kept per familiar. */
  tags: Record<string, string[]>;
  drawerOpen: boolean;
};

export const INDEXER_INITIAL_STATE: IndexerState = {
  selectedCollection: null,
  selectedPath: null,
  filter: "",
  tags: {},
  drawerOpen: false,
};

/** Group the inventory into collections by source kind. Pure — unit-testable. */
export function groupMemoryCollections(
  entries: readonly SurfaceMemoryEntry[],
): Array<{ name: string; entries: SurfaceMemoryEntry[] }> {
  const groups = new Map<string, SurfaceMemoryEntry[]>();
  for (const entry of entries) {
    const key = entry.sourceKindLabel || "Other";
    const group = groups.get(key);
    if (group) group.push(entry);
    else groups.set(key, [entry]);
  }
  return [...groups.entries()]
    .map(([name, grouped]) => ({ name, entries: grouped }))
    .sort((a, b) => b.entries.length - a.entries.length || a.name.localeCompare(b.name));
}

export function IndexerSurface({ context }: { context: RoleSurfaceContext }) {
  const familiarId = context.activeFamiliar.id;
  const [state, patch] = useRoleSurfaceState<IndexerState>(familiarId, INDEXER_SURFACE_ID, INDEXER_INITIAL_STATE);

  const [entries, setEntries] = useState<SurfaceMemoryEntry[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    context.memory.listEntries().then((loaded) => {
      if (!cancelled) setEntries(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [context.memory]);

  const collections = useMemo(() => groupMemoryCollections(entries ?? []), [entries]);

  const filtered = useMemo(() => {
    const base =
      state.selectedCollection == null
        ? (entries ?? [])
        : (collections.find((c) => c.name === state.selectedCollection)?.entries ?? []);
    const needle = state.filter.trim().toLowerCase();
    return needle ? base.filter((e) => e.relPath.toLowerCase().includes(needle)) : base;
  }, [entries, collections, state.selectedCollection, state.filter]);

  const selected = useMemo(
    () => (entries ?? []).find((e) => e.fullPath === state.selectedPath) ?? null,
    [entries, state.selectedPath],
  );

  // Selected memory content, read through the shared adapter (redacted).
  const [content, setContent] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setContent(null);
    if (!selected) return;
    context.memory.readFile(selected.fullPath).then((file) => {
      if (!cancelled) setContent(file?.content ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [selected, context.memory]);

  const [tagDraft, setTagDraft] = useState("");
  const selectedTags = selected ? (state.tags[selected.fullPath] ?? []) : [];

  const addTag = () => {
    if (!selected) return;
    const tag = tagDraft.trim().toLowerCase();
    if (!tag || selectedTags.includes(tag)) return;
    patch({ tags: { ...state.tags, [selected.fullPath]: [...selectedTags, tag] } });
    setTagDraft("");
  };

  const recentChanges = useMemo(
    () =>
      [...(entries ?? [])]
        .sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime())
        .slice(0, 8),
    [entries],
  );

  // Tag-derived clusters: every local tag becomes a semantic cluster.
  const clusters = useMemo(() => {
    const byTag = new Map<string, string[]>();
    for (const [path, tags] of Object.entries(state.tags)) {
      for (const tag of tags) {
        const paths = byTag.get(tag);
        if (paths) paths.push(path);
        else byTag.set(tag, [path]);
      }
    }
    return [...byTag.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [state.tags]);

  return (
    <SurfaceRoom
      accentHue={158}
      drawerTitle="Indexing activity"
      drawerOpen={state.drawerOpen}
      onToggleDrawer={() => patch({ drawerOpen: !state.drawerOpen })}
      drawer={
        <div className="role-surface-drawer-grid">
          <RailSection title="Background indexing" iconName="ph:database">
            <SurfaceEmpty
              title="No background indexing jobs."
              hint="Embedding and index pipelines will report here when the daemon grows them."
            />
          </RailSection>
          <RailSection title="Recent changes" iconName="ph:clock">
            {recentChanges.length === 0 ? (
              <SurfaceEmpty title="No recorded changes." />
            ) : (
              <ul className="role-surface-list">
                {recentChanges.map((entry) => (
                  <li key={entry.fullPath} className="role-surface-list-row">
                    <span>{entry.relPath}</span>
                    <span className="role-surface-tag">{new Date(entry.modified).toLocaleDateString()}</span>
                  </li>
                ))}
              </ul>
            )}
          </RailSection>
        </div>
      }
    >
      <SurfaceRail side="left" label="Collections">
        <RailSection title="Knowledge collections" iconName="ph:folder">
          {entries == null ? (
            <SurfaceEmpty title="Loading inventory…" />
          ) : collections.length === 0 ? (
            <SurfaceEmpty title="No memory on file for this familiar." />
          ) : (
            <ul className="role-surface-list">
              <li>
                <button
                  type="button"
                  className={`role-surface-row-btn focus-ring-inset${state.selectedCollection == null ? " role-surface-row-btn--active" : ""}`}
                  onClick={() => patch({ selectedCollection: null })}
                >
                  All
                  <span className="role-surface-tag">{entries.length}</span>
                </button>
              </li>
              {collections.map((collection) => (
                <li key={collection.name}>
                  <button
                    type="button"
                    className={`role-surface-row-btn focus-ring-inset${state.selectedCollection === collection.name ? " role-surface-row-btn--active" : ""}`}
                    onClick={() => patch({ selectedCollection: collection.name })}
                  >
                    {collection.name}
                    <span className="role-surface-tag">{collection.entries.length}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </RailSection>
        <RailSection title="Embeddings & indexes" iconName="ph:graph">
          <SurfaceEmpty title="No embedding indexes yet." hint="Semantic search arrives with the daemon's embedding store." />
        </RailSection>
      </SurfaceRail>

      <SurfaceCanvas label="Clustering workspace">
        <div className="role-surface-canvas-stack">
          <div className="role-surface-inline-form">
            <input
              value={state.filter}
              onChange={(e) => patch({ filter: e.target.value })}
              placeholder="Filter memories…"
              aria-label="Filter memories"
            />
          </div>
          {clusters.length > 0 && (
            <div className="role-surface-clusters" aria-label="Semantic clusters">
              {clusters.map(([tag, paths]) => (
                <span key={tag} className="role-surface-cluster">
                  <Icon name="ph:tag" width={12} height={12} aria-hidden />
                  {tag}
                  <span className="role-surface-tag">{paths.length}</span>
                </span>
              ))}
            </div>
          )}
          {entries == null ? (
            <SurfaceEmpty title="Loading inventory…" />
          ) : filtered.length === 0 ? (
            <SurfaceEmpty
              iconName="ph:tree-structure"
              title="Nothing matches."
              hint={state.filter ? "Loosen the filter." : "This collection is empty."}
            />
          ) : (
            <ul className="role-surface-grid" aria-label="Memories">
              {filtered.slice(0, 60).map((entry) => (
                <li key={entry.fullPath}>
                  <button
                    type="button"
                    className={`role-surface-card focus-ring${entry.fullPath === state.selectedPath ? " role-surface-card--active" : ""}`}
                    onClick={() => patch({ selectedPath: entry.fullPath })}
                  >
                    <span className="role-surface-memory-path">{entry.relPath}</span>
                    {entry.excerpt && <span className="role-surface-memory-excerpt">{entry.excerpt}</span>}
                    {(state.tags[entry.fullPath] ?? []).length > 0 && (
                      <span className="role-surface-card-tags">
                        {(state.tags[entry.fullPath] ?? []).map((tag) => (
                          <span key={tag} className="role-surface-tag">{tag}</span>
                        ))}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SurfaceCanvas>

      <SurfaceRail side="right" label="Memory details">
        {!selected ? (
          <RailSection title="Details" iconName="ph:note">
            <SurfaceEmpty title="Select a memory to inspect it." />
          </RailSection>
        ) : (
          <>
            <RailSection title="Selected memory" iconName="ph:note">
              <p className="role-surface-memory-path">{selected.relPath}</p>
              <dl className="role-surface-facts">
                <dt>Provenance</dt>
                <dd>
                  {selected.rootLabel} · {selected.sourceKindLabel}
                </dd>
                <dt>Modified</dt>
                <dd>{new Date(selected.modified).toLocaleString()}</dd>
                <dt>Size</dt>
                <dd>{selected.size.toLocaleString()} bytes</dd>
                <dt>Access</dt>
                <dd>Local file — readable by this Cave, redacted on display.</dd>
                <dt>Embeddings</dt>
                <dd>None — no embedding store yet.</dd>
                <dt>Relationships</dt>
                <dd>None recorded.</dd>
              </dl>
            </RailSection>
            <RailSection title="Semantic tags" iconName="ph:tag">
              <form
                className="role-surface-inline-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  addTag();
                }}
              >
                <input
                  value={tagDraft}
                  onChange={(e) => setTagDraft(e.target.value)}
                  placeholder="Add tag…"
                  aria-label="Add semantic tag"
                />
                <button type="submit" className="role-surface-chip focus-ring">Tag</button>
              </form>
              {selectedTags.length === 0 ? (
                <SurfaceEmpty title="Untagged." />
              ) : (
                <div className="role-surface-clusters">
                  {selectedTags.map((tag) => (
                    <span key={tag} className="role-surface-cluster">
                      {tag}
                      <button
                        type="button"
                        className="role-surface-icon-btn focus-ring"
                        aria-label={`Remove tag ${tag}`}
                        onClick={() =>
                          patch({
                            tags: {
                              ...state.tags,
                              [selected.fullPath]: selectedTags.filter((t) => t !== tag),
                            },
                          })
                        }
                      >
                        <Icon name="ph:x" width={11} height={11} aria-hidden />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </RailSection>
            <RailSection title="Content" iconName="ph:files">
              {content == null ? (
                <SurfaceEmpty title="Loading…" hint="Content is shown redacted." />
              ) : (
                <pre className="role-surface-content">{content.slice(0, 4000)}</pre>
              )}
            </RailSection>
          </>
        )}
      </SurfaceRail>
    </SurfaceRoom>
  );
}
