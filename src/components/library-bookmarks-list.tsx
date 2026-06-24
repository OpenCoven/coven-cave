"use client";


import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Popover, PopoverBody, PopoverItem, PopoverLabel } from "@/components/ui/popover";
import { Icon, type IconName } from "@/lib/icon";
import { useUndoDelete } from "@/lib/use-undo-delete";
import { LibraryUndoToast } from "@/components/library-undo-toast";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { SkeletonRows } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { RelativeTime } from "@/components/ui/relative-time";
import type { LibraryBookmark } from "@/lib/library-types";
import { useIsCoarsePointer } from "@/lib/use-viewport";

// ── Helpers ────────────────────────────────────────────────────────────────

type SortKey = "title" | "domain" | "savedAt";
type SortDir = "asc" | "desc";
type GroupBy = "tags" | "domain" | "none";

const BOOKMARK_GROUP_OPTIONS: Array<{ id: GroupBy; label: string; icon: IconName }> = [
  { id: "tags", label: "Group: Tags", icon: "ph:tag-bold" },
  { id: "domain", label: "Group: Domain", icon: "ph:globe" },
  { id: "none", label: "No grouping", icon: "ph:list-bullets" },
];

function sortItems(items: LibraryBookmark[], key: SortKey, dir: SortDir): LibraryBookmark[] {
  return [...items].sort((a, b) => {
    let cmp = 0;
    if (key === "title") cmp = (a.title ?? "").localeCompare(b.title ?? "");
    else if (key === "domain") cmp = (a.domain ?? "").localeCompare(b.domain ?? "");
    else cmp = (a.savedAt ?? "").localeCompare(b.savedAt ?? "");
    return dir === "asc" ? cmp : -cmp;
  });
}

function bookmarkTags(item: LibraryBookmark): string[] {
  return Array.isArray(item.tags)
    ? item.tags
      .filter((tag): tag is string => typeof tag === "string")
      .map((tag) => tag.trim())
      .filter(Boolean)
    : [];
}

function displayDomain(item: LibraryBookmark): string {
  const domain = item.domain?.trim();
  if (domain) return domain;
  try { return new URL(item.url).hostname.replace(/^www\./, ""); }
  catch { return "(unknown)"; }
}

function groupItems(items: LibraryBookmark[], by: GroupBy): { key: string; label: string; items: LibraryBookmark[] }[] {
  if (by === "none") return [{ key: "all", label: "", items }];
  const map = new Map<string, LibraryBookmark[]>();
  for (const item of items) {
    const tags = bookmarkTags(item);
    const domain = displayDomain(item);
    const keys = by === "domain" ? [domain] : (tags.length > 0 ? tags : ["(untagged)"]);
    for (const k of keys) {
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(item);
    }
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, items]) => ({ key, label: key, items }));
}

function filterItems(items: LibraryBookmark[], query: string): LibraryBookmark[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) => {
    const tags = bookmarkTags(item);
    return `${item.title ?? ""} ${displayDomain(item)} ${tags.join(" ")}`.toLowerCase().includes(q);
  });
}


// ── Favicon ───────────────────────────────────────────────────────────────

const INITIAL_COLORS = [
  "#5b5bd6", "#7c3aed", "#db2777", "#ea580c",
  "#16a34a", "#0891b2", "#4f46e5", "#0d9488",
];

function initialColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return INITIAL_COLORS[Math.abs(h) % INITIAL_COLORS.length];
}

function ItemFavicon({ url, title }: { url: string; title: string }) {
  const letter = (title || url).trim().slice(0, 1).toUpperCase() || "?";
  return (
    <span
      className="library-favicon-initial"
      style={{ background: initialColor(title || url) }}
      aria-hidden
    >
      {letter}
    </span>
  );
}

// ── Add form ───────────────────────────────────────────────────────────────

function AddBookmarkForm({ onAdd, onCancel }: { onAdd: (url: string, title: string, tags: string[]) => void; onCancel: () => void }) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [tags, setTags] = useState("");
  const coarse = useIsCoarsePointer();

  function handleUrlBlur() {
    if (url && !title) {
      try { setTitle(new URL(url).hostname.replace(/^www\./, "")); } catch { /* keep blank */ }
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    onAdd(url.trim(), title.trim(), tags.split(",").map((t: string) => t.trim()).filter(Boolean));
  }

  return (
    <form className="library-list-add-form" onSubmit={handleSubmit}>
      <input
        autoFocus={!coarse}
        className="board-drawer-field-input library-list-add-input"
        placeholder="https://…"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onBlur={handleUrlBlur}
        type="url"
      />
      <input
        className="board-drawer-field-input library-list-add-input"
        placeholder="Title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <input
        className="board-drawer-field-input library-list-add-input"
        placeholder="Tags (comma-separated)"
        value={tags}
        onChange={(e) => setTags(e.target.value)}
      />
      <button type="submit" className="board-toolbar-btn board-toolbar-btn--active">Save</button>
      <button type="button" className="board-toolbar-btn" onClick={onCancel}>Cancel</button>
    </form>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

type Props = {
  selectedId: string | null;
  onSelect: (item: LibraryBookmark) => void;
  onDelete?: (id: string) => void;
  onAddToBoard?: (bookmark: LibraryBookmark) => void;
};

const COLS: { key: SortKey; label: string; width?: string }[] = [
  { key: "title",   label: "Title" },
  { key: "domain",  label: "Domain",  width: "112px" },
  { key: "savedAt", label: "Saved",   width: "64px" },
];

export function LibraryBookmarksList({ selectedId, onSelect, onDelete, onAddToBoard }: Props) {
  const [items, setItems] = useState<LibraryBookmark[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("savedAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [groupBy, setGroupBy] = useState<GroupBy>("tags");
  const [groupSelectorOpen, setGroupSelectorOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [addedToBoardId, setAddedToBoardId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const groupSelectorRef = useRef<HTMLButtonElement | null>(null);
  const loadRequestRef = useRef(0);

  const load = useCallback(async (signal?: AbortSignal) => {
    const requestId = ++loadRequestRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/library/bookmarks", { cache: "no-store", signal });
      const json = await res.json();
      if (requestId !== loadRequestRef.current || signal?.aborted) return;
      if (json.ok) {
        setItems(json.items ?? []);
        setError(null);
      } else {
        setError("Failed to load. Try again.");
      }
    } catch {
      if (requestId !== loadRequestRef.current || signal?.aborted) return;
      setError("Failed to load. Try again.");
    } finally {
      if (requestId === loadRequestRef.current && !signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    void load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  const filtered = useMemo(() => filterItems(items, query), [items, query]);
  const sorted = useMemo(() => sortItems(filtered, sortKey, sortDir), [filtered, sortKey, sortDir]);
  const groups = useMemo(() => groupItems(sorted, groupBy), [sorted, groupBy]);
  const activeGroupOption = BOOKMARK_GROUP_OPTIONS.find((option) => option.id === groupBy) ?? BOOKMARK_GROUP_OPTIONS[0];

  function handleCol(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  }

  function toggleGroup(key: string) {
    setCollapsed((prev) => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  }

  async function handleAdd(url: string, title: string, tags: string[]) {
    setAddError(null);
    try {
      const res = await fetch("/api/library/bookmarks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url, title, tags }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        setAddError(json?.error ?? "Couldn't save the bookmark — try again.");
        return;
      }
      setItems((prev) => [json.item, ...prev]);
      setAdding(false);
    } catch {
      setAddError("Couldn't save the bookmark — network error.");
    }
  }

  const { pending: undoPending, scheduleDelete, undo: undoDelete, commit: commitDelete } = useUndoDelete<LibraryBookmark>();

  function handleDelete(item: LibraryBookmark) {
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    scheduleDelete(
      item,
      item.title || item.url,
      () => fetch(`/api/library/bookmarks?id=${encodeURIComponent(item.id)}`, { method: "DELETE" }).then(() => {}),
    );
  }

  function handleUndoDelete() {
    if (!undoPending) return;
    setItems((prev) => [undoPending.item, ...prev]);
    undoDelete();
  }

  // Bulk-select: pick several bookmarks and remove them at once.
  const allSelected = items.length > 0 && items.every((i) => selectedIds.has(i.id));
  const selectedCount = items.filter((i) => selectedIds.has(i.id)).length;
  const toggleSelect = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const exitSelect = () => { setSelectMode(false); setSelectedIds(new Set()); };
  const toggleSelectAll = () =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) items.forEach((i) => next.delete(i.id));
      else items.forEach((i) => next.add(i.id));
      return next;
    });
  function bulkDelete() {
    const ids = items.filter((i) => selectedIds.has(i.id)).map((i) => i.id);
    if (ids.length === 0) return;
    setItems((prev) => prev.filter((i) => !ids.includes(i.id)));
    void Promise.all(
      ids.map((id) =>
        fetch(`/api/library/bookmarks?id=${encodeURIComponent(id)}`, { method: "DELETE" }).then(() => {}).catch(() => {}),
      ),
    );
    exitSelect();
  }

  return (
    <div className="library-list-shell">
      {/* Header */}
      <div className="library-list-header">
        <span className="library-list-header-title">
          <Icon name="ph:bookmark-simple" width={14} />
          Bookmarks
          <span className="board-table-group-badge">{items.length}</span>
        </span>
        <div className="library-list-header-controls">
          {items.length > 0 ? (
            <button
              type="button"
              className="board-toolbar-btn"
              onClick={() => { setSelectMode((v) => !v); setSelectedIds(new Set()); }}
              aria-pressed={selectMode}
              aria-label={selectMode ? "Exit select mode" : "Select multiple bookmarks"}
              title={selectMode ? "Exit select" : "Select multiple"}
            >
              <Icon name="ph:list-checks-bold" width={12} />
            </button>
          ) : null}
          <div className="library-bookmark-selector">
            <button
              ref={groupSelectorRef}
              type="button"
              className="library-bookmark-selector__trigger focus-ring"
              aria-haspopup="menu"
              aria-expanded={groupSelectorOpen}
              aria-label="Group bookmarks"
              onClick={() => setGroupSelectorOpen((open) => !open)}
            >
              <Icon name={activeGroupOption.icon} width={12} aria-hidden />
              <span>{activeGroupOption.label}</span>
              <Icon
                name="ph:caret-down"
                width={10}
                aria-hidden
                className="library-bookmark-selector__caret"
              />
            </button>
            <Popover
              open={groupSelectorOpen}
              onOpenChange={setGroupSelectorOpen}
              anchorRef={groupSelectorRef}
              placement="bottom-start"
              className="library-bookmark-selector__popover"
              minWidth={180}
              ariaLabel="Choose bookmark group"
            >
              <PopoverBody>
                <PopoverLabel>Group bookmarks</PopoverLabel>
                {BOOKMARK_GROUP_OPTIONS.map((option) => (
                  <PopoverItem
                    key={option.id}
                    icon={option.icon}
                    active={option.id === groupBy}
                    onSelect={() => {
                      setGroupBy(option.id);
                      setGroupSelectorOpen(false);
                    }}
                  >
                    {option.label}
                  </PopoverItem>
                ))}
              </PopoverBody>
            </Popover>
          </div>
          <button
            type="button"
            className="board-toolbar-btn library-list-add-btn"
            onClick={() => setAdding((v) => !v)}
            aria-label="Add bookmark"
            title="Add bookmark"
          >
            <Icon name="ph:plus" width={12} />
            <span className="library-list-add-btn__label">Add</span>
          </button>
        </div>
      </div>

      {selectMode ? (
        <div className="library-bulk-bar">
          <div className="library-bulk-bar__left">
            <button type="button" className="library-bulk-bar__link" onClick={toggleSelectAll}>
              {allSelected ? "Clear" : "Select all"}
            </button>
            <span className="library-bulk-bar__count">{selectedCount} selected</span>
          </div>
          <div className="library-bulk-bar__right">
            <button type="button" className="library-bulk-bar__link" onClick={exitSelect}>Cancel</button>
            <button type="button" className="library-bulk-bar__delete" disabled={selectedCount === 0} onClick={bulkDelete}>
              <Icon name="ph:trash" width={11} aria-hidden />
              Remove{selectedCount ? ` ${selectedCount}` : ""}
            </button>
          </div>
        </div>
      ) : null}

      <div className="library-doclist-search">
        <Icon name="ph:magnifying-glass" width={13} className="library-doclist-search-icon" />
        <input
          type="text"
          className="library-doclist-search-input"
          placeholder="Search bookmarks…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          spellCheck={false}
          aria-label="Search bookmarks"
        />
        {query && (
          <button
            type="button"
            className="library-doclist-search-clear"
            onClick={() => setQuery("")}
            aria-label="Clear search"
          >
            <Icon name="ph:x" width={11} />
          </button>
        )}
      </div>

      {/* Add form */}
      {adding && (
        <>
          <AddBookmarkForm onAdd={handleAdd} onCancel={() => { setAdding(false); setAddError(null); }} />
          {addError && (
            <p role="alert" className="px-3 py-1.5 text-[11px] text-[var(--color-danger)]">{addError}</p>
          )}
        </>
      )}

      {/* Table */}
      {loading ? (
        <SkeletonRows count={5} className="library-list-skeleton" />
      ) : error ? (
        <ErrorState
          icon="ph:warning-circle"
          headline={<>Couldn&rsquo;t load bookmarks.</>}
          subtitle={error}
          actions={
            <Button size="xs" leadingIcon="ph:arrow-clockwise" onClick={() => { void load(); }}>
              Retry
            </Button>
          }
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon="ph:bookmark-simple"
          headline="No bookmarks yet"
          subtitle="Save links you want to keep close at hand."
          actions={
            <Button size="sm" leadingIcon="ph:plus" onClick={() => setAdding(true)}>
              Add bookmark
            </Button>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState compact icon="ph:magnifying-glass" headline={`No results for “${query}”`} />
      ) : (
        <div className="board-table-wrap">
          <table aria-label="Bookmarks" className="board-table library-bookmarks-table">
            <thead>
              <tr>
                {COLS.map((col) => (
                  <th key={col.key} style={col.width ? { width: col.width } : undefined}
                    className={sortKey === col.key ? "sorted" : ""}
                    onClick={() => handleCol(col.key)}>
                    {col.label}
                    <span className="board-table-sort-icon">
                      {sortKey === col.key
                        ? <Icon name={sortDir === "asc" ? "ph:caret-up" : "ph:caret-down-fill"} width={9} />
                        : <Icon name="ph:caret-up-down" width={9} />}
                    </span>
                  </th>
                ))}
                <th style={{ width: "56px" }} />
              </tr>
            </thead>
            <tbody>
              {groups.map(({ key, label, items: gi }) => (
                <React.Fragment key={key}>
                  {groupBy !== "none" && (
                    <tr
                      className="board-table-group-row focus-ring-inset"
                      role="button"
                      tabIndex={0}
                      aria-expanded={!collapsed.has(key)}
                      onClick={() => toggleGroup(key)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleGroup(key); }
                      }}
                    >
                      <td colSpan={4}>
                        <span className="board-table-group-caret">
                          <Icon name={collapsed.has(key) ? "ph:caret-right" : "ph:caret-down"} width={10} />
                        </span>
                        {label}
                        <span className="board-table-group-badge">{gi.length}</span>
                      </td>
                    </tr>
                  )}
                  {!collapsed.has(key) && gi.map((item) => (
                    <tr key={`${key}:${item.id || item.url}`}
                      className={`${item.id === selectedId ? "selected" : ""}${selectMode && selectedIds.has(item.id) ? " is-selected" : ""}`}
                      aria-selected={selectMode ? selectedIds.has(item.id) : undefined}
                      onClick={() => { if (selectMode) { toggleSelect(item.id); return; } onSelect(item); }}>
                      <td>
                        <span className="board-table-title library-title-cell">
                          {selectMode ? (
                            <span aria-hidden className="library-bulk-check" data-checked={selectedIds.has(item.id) ? "true" : undefined}>
                              <Icon name="ph:check-bold" width={10} aria-hidden />
                            </span>
                          ) : null}
                          <ItemFavicon url={item.url} title={item.title} />
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="library-bookmark-link"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {item.title}
                          </a>
                        </span>
                      </td>
                      <td>
                        <span className="board-table-muted library-domain-cell">
                          {item.domain}
                        </span>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <RelativeTime iso={item.savedAt} className="board-table-muted" />
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        {selectMode ? null : (
                        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          {onAddToBoard && (
                            addedToBoardId === item.id ? (
                              <span
                                className="library-row-delete"
                                title="Added to Board"
                                style={{ color: "var(--color-success, #34d399)", cursor: "default" }}
                              >
                                <Icon name="ph:check" width={11} />
                              </span>
                            ) : (
                              <button
                                type="button"
                                className="library-row-delete"
                                title="Add to Board"
                                aria-label={`Add "${item.title}" to Board`}
                                onClick={() => {
                                  onAddToBoard(item);
                                  setAddedToBoardId(item.id);
                                  setTimeout(() => setAddedToBoardId((prev) => prev === item.id ? null : prev), 3000);
                                }}
                              >
                                <Icon name="ph:kanban" width={11} />
                              </button>
                            )
                          )}
                          <button
                            type="button"
                            className="library-row-delete"
                            title="Remove"
                            aria-label={`Remove "${item.title}"`}
                            onClick={() => { handleDelete(item); }}
                          >
                            <Icon name="ph:x" width={11} />
                          </button>
                        </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
          {undoPending && (
        <LibraryUndoToast
          label={undoPending.label}
          onUndo={handleUndoDelete}
          onDismiss={commitDelete}
        />
      )}
</div>
  );
}
