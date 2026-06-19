"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Icon, type IconName } from "@/lib/icon";
import { useUndoDelete } from "@/lib/use-undo-delete";
import { LibraryUndoToast } from "@/components/library-undo-toast";
import type { LibraryReadingItem, ReadingStatus } from "@/lib/library-types";
import { useIsCoarsePointer } from "@/lib/use-viewport";

// ── Helpers ────────────────────────────────────────────────────────────────

type SortKey = "title" | "status" | "addedAt";
type SortDir = "asc" | "desc";
type GroupBy = "status" | "sourceType" | "none";
const INLINE_STATUS_OPTIONS = ["want-to-read", "reading", "done"] as const;
type InlineStatus = (typeof INLINE_STATUS_OPTIONS)[number];

// Inline 3-way status toggle: full label for the active state + tooltip, short
// label for the segmented control, icon for the compact/touch layout.
const STATUS_META: Record<InlineStatus, { label: string; short: string; icon: IconName }> = {
  "want-to-read": { label: "Want to read", short: "Want", icon: "ph:bookmark-simple" },
  reading: { label: "Reading", short: "Reading", icon: "ph:book-open" },
  done: { label: "Read", short: "Read", icon: "ph:check-circle" },
};

const STATUS_ORDER: Record<ReadingStatus, number> = {
  "want-to-read": 0,
  reading: 1,
  done: 2,
  abandoned: 3,
};

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

function sortItems(items: LibraryReadingItem[], key: SortKey, dir: SortDir): LibraryReadingItem[] {
  return [...items].sort((a, b) => {
    let cmp = 0;
    if (key === "title") cmp = (a.title ?? "").localeCompare(b.title ?? "");
    else if (key === "status") cmp = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    else cmp = (a.addedAt ?? "").localeCompare(b.addedAt ?? "");
    return dir === "asc" ? cmp : -cmp;
  });
}

function groupItems(items: LibraryReadingItem[], by: GroupBy): { key: string; label: string; items: LibraryReadingItem[] }[] {
  if (by === "none") return [{ key: "all", label: "", items }];
  const map = new Map<string, LibraryReadingItem[]>();
  for (const item of items) {
    const key = by === "status" ? item.status : item.sourceType;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(item);
  }
  let entries = [...map.entries()].map(([key, items]) => ({
    key,
    label: key.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    items,
  }));
  if (by === "status") entries.sort((a, b) => (STATUS_ORDER[a.key as ReadingStatus] ?? 9) - (STATUS_ORDER[b.key as ReadingStatus] ?? 9));
  else entries.sort((a, b) => (a.label ?? "").localeCompare(b.label ?? ""));
  return entries;
}

function filterItems(items: LibraryReadingItem[], query: string): LibraryReadingItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) =>
    `${item.title} ${item.author ?? ""} ${item.tags.join(" ")}`.toLowerCase().includes(q),
  );
}

function statusBadgeStyle(status: ReadingStatus): React.CSSProperties {
  switch (status) {
    case "reading":       return { background: "color-mix(in oklch, var(--accent-presence) 14%, var(--bg-raised))", border: "1px solid color-mix(in oklch, var(--accent-presence) 30%, transparent)" };
    case "done":          return { background: "color-mix(in oklch, var(--color-success, #34d399) 14%, var(--bg-raised))", border: "1px solid color-mix(in oklch, var(--color-success, #34d399) 30%, transparent)" };
    case "abandoned":     return { background: "color-mix(in oklch, var(--color-danger) 10%, var(--bg-raised))", border: "1px solid color-mix(in oklch, var(--color-danger) 25%, transparent)" };
    case "want-to-read":  return { background: "var(--bg-raised)", border: "1px solid var(--border-strong)" };
    default: return {};
  }
}

function sourceIcon(sourceType: LibraryReadingItem["sourceType"]) {
  switch (sourceType) {
    case "paper":   return <Icon name="ph:graduation-cap" width={12} />;
    case "book":    return <Icon name="ph:book-open" width={12} />;
    case "video":   return <Icon name="ph:video" width={12} />;
    case "thread":  return <Icon name="ph:chat-centered-text" width={12} />;
    case "article": return <Icon name="ph:newspaper" width={12} />;
    default:        return <Icon name="ph:file" width={12} />;
  }
}

// ── Add form ───────────────────────────────────────────────────────────────

function AddReadingForm({ onAdd, onCancel }: {
  onAdd: (title: string, sourceType: LibraryReadingItem["sourceType"], status: ReadingStatus, url?: string) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [sourceType, setSourceType] = useState<LibraryReadingItem["sourceType"]>("article");
  const [status, setStatus] = useState<ReadingStatus>("want-to-read");
  const coarse = useIsCoarsePointer();

  function resetForm() {
    setTitle("");
    setUrl("");
    setSourceType("article");
    setStatus("want-to-read");
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    const trimmedUrl = url.trim();
    onAdd(title.trim(), sourceType, status, trimmedUrl || undefined);
    resetForm();
  }

  function handleCancel() {
    resetForm();
    onCancel();
  }

  return (
    <form className="library-reading-add-form" onSubmit={handleSubmit} onReset={resetForm}>
      <input
        autoFocus={!coarse}
        aria-label="Reading title"
        className="library-reading-add-input"
        placeholder="Title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <input
        aria-label="Reading URL or DOI"
        className="library-reading-add-input"
        inputMode="url"
        placeholder="URL or DOI"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        type="text"
      />
      <select
        aria-label="Reading source type"
        className="library-reading-add-select"
        value={sourceType}
        onChange={(e) => setSourceType(e.target.value as LibraryReadingItem["sourceType"])}
      >
        <option value="article">Article</option>
        <option value="paper">Paper</option>
        <option value="book">Book</option>
        <option value="thread">Thread</option>
        <option value="video">Video</option>
        <option value="other">Other</option>
      </select>
      <select
        aria-label="Reading status"
        className="library-reading-add-select"
        value={status}
        onChange={(e) => setStatus(e.target.value as ReadingStatus)}
      >
        <option value="want-to-read">Want to read</option>
        <option value="reading">Reading</option>
        <option value="done">Done</option>
        <option value="abandoned">Abandoned</option>
      </select>
      <div className="library-reading-add-actions">
        <button
          type="submit"
          className="library-reading-add-button library-reading-add-button--primary"
          disabled={!title.trim()}
        >
          <Icon name="ph:check" width={12} /> Save
        </button>
        <button type="button" className="library-reading-add-button" onClick={handleCancel}>
          <Icon name="ph:x" width={12} /> Cancel
        </button>
      </div>
    </form>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

type Props = {
  selectedId: string | null;
  onSelect: (item: LibraryReadingItem) => void;
  onDelete?: (id: string) => void;
};

const COLS: { key: SortKey; label: string; className: string; width?: string }[] = [
  { key: "title",   label: "Title",  className: "library-reading-col-title" },
  { key: "status",  label: "Status", className: "library-reading-col-status", width: "128px" },
  { key: "addedAt", label: "Added",  className: "library-reading-col-added",  width: "64px" },
];

export function LibraryReadingList({ selectedId, onSelect, onDelete }: Props) {
  const [items, setItems] = useState<LibraryReadingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("addedAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [groupBy, setGroupBy] = useState<GroupBy>("status");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/library/reading", { cache: "no-store" });
      const json = await res.json();
      if (json.ok) {
        setItems(json.items ?? []);
        setError(null);
      } else {
        setError("Failed to load. Try again.");
      }
    } catch { setError("Failed to load. Try again."); } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => filterItems(items, query), [items, query]);
  const sorted = useMemo(() => sortItems(filtered, sortKey, sortDir), [filtered, sortKey, sortDir]);
  const groups = useMemo(() => groupItems(sorted, groupBy), [sorted, groupBy]);

  function handleCol(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  }

  function toggleGroup(key: string) {
    setCollapsed((prev) => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  }

  async function handleAdd(title: string, sourceType: LibraryReadingItem["sourceType"], status: ReadingStatus, url?: string) {
    setAdding(false);
    const res = await fetch("/api/library/reading", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, sourceType, status, url: url || undefined }),
    });
    const json = await res.json();
    if (json.ok) setItems((prev) => [json.item, ...prev]);
  }

  async function handleStatusChange(item: LibraryReadingItem, status: ReadingStatus) {
    const previous = items;
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status } : i)));
    try {
      const res = await fetch("/api/library/reading", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: item.id, status }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error("status update failed");
      setItems((prev) => prev.map((i) => (i.id === item.id ? json.item : i)));
    } catch {
      setItems(previous);
    }
  }

  const { pending: undoPending, scheduleDelete, undo: undoDelete, commit: commitDelete } = useUndoDelete<LibraryReadingItem>();

  function handleDelete(item: LibraryReadingItem) {
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    scheduleDelete(
      item,
      item.title,
      () => fetch(`/api/library/reading?id=${encodeURIComponent(item.id)}`, { method: "DELETE" }).then(() => {}),
    );
  }

  function handleUndoDelete() {
    if (!undoPending) return;
    setItems((prev) => [undoPending.item, ...prev]);
    undoDelete();
  }

  return (
    <div className="library-list-shell">
      {/* Header */}
      <div className="library-list-header">
        <span className="library-list-header-title">
          <Icon name="ph:books" width={14} />
          Reading
          <span className="board-table-group-badge">{items.length}</span>
        </span>
        <div className="library-list-header-controls">
          <button type="button" className="board-toolbar-btn" onClick={() => setAdding((v) => !v)}>
            <Icon name="ph:plus" width={12} /> Add
          </button>
        </div>
      </div>

      <div className="library-doclist-search">
        <Icon name="ph:magnifying-glass" width={13} className="library-doclist-search-icon" />
        <input
          type="text"
          className="library-doclist-search-input"
          placeholder="Search reading…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          spellCheck={false}
          aria-label="Search reading"
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
        <AddReadingForm onAdd={handleAdd} onCancel={() => setAdding(false)} />
      )}

      {/* Table */}
      {loading ? (
        <div className="library-list-empty">Loading…</div>
      ) : error ? (
        <div className="library-list-empty" role="alert">
          <div className="library-list-error-title">
            <Icon name="ph:warning-circle" width={13} aria-hidden />
            Couldn&rsquo;t load reading.
          </div>
          <div className="library-list-error-message">{error}</div>
          <button
            type="button"
            onClick={() => { void load(); }}
            className="library-list-retry-btn"
          >
            <Icon name="ph:arrow-clockwise" width={11} />
            Retry
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="library-list-empty">No reading list items yet. Add one above.</div>
      ) : filtered.length === 0 ? (
        <div className="library-list-empty">No results for &quot;{query}&quot;.</div>
      ) : (
        <div className="board-table-wrap">
          <table aria-label="Reading list" className="board-table library-reading-table">
            <thead>
              <tr>
                {COLS.map((col) => (
                  <th key={col.key} style={col.width ? { width: col.width } : undefined}
                    className={`${col.className}${sortKey === col.key ? " sorted" : ""}`}
                    onClick={() => handleCol(col.key)}>
                    {col.label}
                    <span className="board-table-sort-icon">
                      {sortKey === col.key
                        ? <Icon name={sortDir === "asc" ? "ph:caret-up" : "ph:caret-down-fill"} width={9} />
                        : <Icon name="ph:caret-up-down" width={9} />}
                    </span>
                  </th>
                ))}
                <th className="library-reading-col-source" style={{ width: "92px" }}>Type</th>
                <th className="library-reading-col-progress" style={{ width: "70px" }}>Progress</th>
                <th className="library-reading-col-actions" style={{ width: "32px" }} />
              </tr>
            </thead>
            <tbody>
              {groups.map(({ key, label, items: gi }) => (
                <React.Fragment key={key}>
                  {groupBy !== "none" && (
                    <tr className="board-table-group-row" onClick={() => toggleGroup(key)}>
                      <td colSpan={6}>
                        <span className="board-table-group-caret">
                          <Icon name={collapsed.has(key) ? "ph:caret-right" : "ph:caret-down"} width={10} />
                        </span>
                        {label}
                        <span className="board-table-group-badge">{gi.length}</span>
                      </td>
                    </tr>
                  )}
                  {!collapsed.has(key) && gi.map((item) => (
                    <tr key={item.id}
                      className={`library-reading-row${item.id === selectedId ? " selected" : ""}`}
                      onClick={() => onSelect(item)}>
                      <td className="library-reading-col-title">
                        <span className="board-table-title library-reading-title">{item.title}</span>
                        {item.author && (
                          <div className="board-table-muted library-reading-author">{item.author}</div>
                        )}
                      </td>
                      <td className="library-reading-col-status">
                        <div
                          className="library-status-toggle"
                          role="radiogroup"
                          aria-label={`Status for ${item.title}`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {INLINE_STATUS_OPTIONS.map((status) => {
                            const meta = STATUS_META[status];
                            const active = item.status === status;
                            return (
                              <button
                                key={status}
                                type="button"
                                role="radio"
                                aria-checked={active}
                                data-status={status}
                                className={`library-status-toggle__opt${active ? " is-active" : ""}`}
                                style={active ? statusBadgeStyle(status) : undefined}
                                title={meta.label}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (!active) void handleStatusChange(item, status);
                                }}
                              >
                                <Icon name={meta.icon} width={13} aria-hidden />
                                {active && (
                                  <span className="library-status-toggle__label">{meta.short}</span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </td>
                      <td className="library-reading-col-added">
                        <span className="board-table-muted">{relTime(item.addedAt)}</span>
                      </td>
                      <td className="library-reading-col-source" title={item.sourceType}>
                        <span className="board-table-muted library-source-type" aria-label={`Type: ${item.sourceType}`}>
                          {sourceIcon(item.sourceType)}
                          <span className="library-source-type__label">{item.sourceType}</span>
                        </span>
                      </td>
                      <td className="library-reading-col-progress">
                        {item.status === "done" ? (
                          <span style={{ color: "var(--color-success)", display:"inline-flex", alignItems:"center" }}><Icon name="ph:check" width={13} /></span>
                        ) : item.status === "reading" && item.progress != null ? (
                          <div className="library-progress-bar library-progress-bar--lg">
                            <div className="library-progress-fill" style={{ width: `${item.progress}%` }} />
                          </div>
                        ) : (
                          <span className="board-table-muted">—</span>
                        )}
                      </td>
                      <td className="library-reading-col-actions" onClick={(e) => { e.stopPropagation(); handleDelete(item); }}>
                        <span className="library-row-delete" title="Remove">
                          <Icon name="ph:x" width={11} />
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
