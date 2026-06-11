"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@/lib/icon";
import type { LibraryBookmark } from "@/lib/library-types";
import { useIsCoarsePointer } from "@/lib/use-viewport";

// ── Helpers ────────────────────────────────────────────────────────────────

type SortKey = "title" | "domain" | "savedAt";
type SortDir = "asc" | "desc";
type GroupBy = "tags" | "domain" | "none";

function relTime(iso: string): string {
  try {
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 60) return `${Math.round(s)}s`;
    if (s < 3600) return `${Math.round(s / 60)}m`;
    if (s < 86400) return `${Math.round(s / 3600)}h`;
    const d = Math.round(s / 86400);
    return d < 30 ? `${d}d` : `${Math.round(d / 30)}mo`;
  } catch { return ""; }
}

function sortItems(items: LibraryBookmark[], key: SortKey, dir: SortDir): LibraryBookmark[] {
  return [...items].sort((a, b) => {
    let cmp = 0;
    if (key === "title") cmp = (a.title ?? "").localeCompare(b.title ?? "");
    else if (key === "domain") cmp = (a.domain ?? "").localeCompare(b.domain ?? "");
    else cmp = (a.savedAt ?? "").localeCompare(b.savedAt ?? "");
    return dir === "asc" ? cmp : -cmp;
  });
}

function groupItems(items: LibraryBookmark[], by: GroupBy): { key: string; label: string; items: LibraryBookmark[] }[] {
  if (by === "none") return [{ key: "all", label: "", items }];
  const map = new Map<string, LibraryBookmark[]>();
  for (const item of items) {
    const keys = by === "domain" ? [item.domain] : (item.tags.length > 0 ? item.tags : ["(untagged)"]);
    for (const k of keys) {
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(item);
    }
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, items]) => ({ key, label: key, items }));
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

function googleFavicon(url: string): string {
  try { return `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=32`; }
  catch { return ""; }
}

function ItemFavicon({ url, title }: { url: string; title: string }) {
  const [failed, setFailed] = React.useState(false);
  const src = googleFavicon(url);
  if (!src || failed) {
    const letter = (title || url).trim().slice(0, 1).toUpperCase() || "?";
    return (
      <span
        className="library-favicon-initial"
        style={{ background: initialColor(title || url) }}
      >
        {letter}
      </span>
    );
  }
  return (
    <img
      src={src}
      alt=""
      width={14}
      height={14}
      className="library-favicon"
      onError={() => setFailed(true)}
    />
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
  { key: "domain",  label: "Domain",  width: "140px" },
  { key: "savedAt", label: "Saved",   width: "80px" },
];

export function LibraryBookmarksList({ selectedId, onSelect, onDelete, onAddToBoard }: Props) {
  const [items, setItems] = useState<LibraryBookmark[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("savedAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [groupBy, setGroupBy] = useState<GroupBy>("tags");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [addedToBoardId, setAddedToBoardId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/library/bookmarks", { cache: "no-store" });
      const json = await res.json();
      if (json.ok) setItems(json.items ?? []);
    } catch { /* keep */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const sorted = useMemo(() => sortItems(items, sortKey, sortDir), [items, sortKey, sortDir]);
  const groups = useMemo(() => groupItems(sorted, groupBy), [sorted, groupBy]);

  function handleCol(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  }

  function toggleGroup(key: string) {
    setCollapsed((prev) => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  }

  async function handleAdd(url: string, title: string, tags: string[]) {
    setAdding(false);
    const res = await fetch("/api/library/bookmarks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url, title, tags }),
    });
    const json = await res.json();
    if (json.ok) setItems((prev) => [json.item, ...prev]);
  }

  async function handleDelete(id: string) {
    await fetch(`/api/library/bookmarks?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    setItems((prev) => prev.filter((i) => i.id !== id));
    onDelete?.(id);
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
          <select
            className="board-toolbar-select"
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as GroupBy)}
          >
            <option value="tags">Group: Tags</option>
            <option value="domain">Group: Domain</option>
            <option value="none">No grouping</option>
          </select>
          <button type="button" className="board-toolbar-btn" onClick={() => setAdding((v) => !v)}>
            <Icon name="ph:plus" width={12} /> Add
          </button>
        </div>
      </div>

      {/* Add form */}
      {adding && (
        <AddBookmarkForm onAdd={handleAdd} onCancel={() => setAdding(false)} />
      )}

      {/* Table */}
      {loading ? (
        <div className="library-list-empty">Loading…</div>
      ) : items.length === 0 ? (
        <div className="library-list-empty">No bookmarks yet. Add one above.</div>
      ) : (
        <div className="board-table-wrap">
          <table aria-label="Bookmarks" className="board-table">
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
                <th style={{ width: "160px" }}>Tags</th>
                <th style={{ width: "64px" }} />
              </tr>
            </thead>
            <tbody>
              {groups.map(({ key, label, items: gi }) => (
                <React.Fragment key={key}>
                  {groupBy !== "none" && (
                    <tr className="board-table-group-row" onClick={() => toggleGroup(key)}>
                      <td colSpan={5}>
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
                      className={item.id === selectedId ? "selected" : ""}
                      onClick={() => onSelect(item)}>
                      <td>
                        <span className="board-table-title library-title-cell">
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
                        <span className="board-table-muted">{relTime(item.savedAt)}</span>
                      </td>
                      <td>
                        <div className="library-tag-chips">
                          {item.tags.slice(0, 3).map((t: string) => (
                            <span key={t} className="library-doclist-tag">{t}</span>
                          ))}
                          {item.tags.length > 3 && (
                            <span className="board-table-muted">+{item.tags.length - 3}</span>
                          )}
                        </div>
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
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
                              <span
                                className="library-row-delete"
                                title="Add to Board"
                                onClick={() => {
                                  onAddToBoard(item);
                                  setAddedToBoardId(item.id);
                                  setTimeout(() => setAddedToBoardId((prev) => prev === item.id ? null : prev), 3000);
                                }}
                              >
                                <Icon name="ph:kanban" width={11} />
                              </span>
                            )
                          )}
                          <span
                            className="library-row-delete"
                            title="Remove"
                            onClick={() => { void handleDelete(item.id); }}
                          >
                            <Icon name="ph:x" width={11} />
                          </span>
                        </span>
                      </td>
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
