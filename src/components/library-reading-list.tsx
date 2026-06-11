"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@/lib/icon";
import type { LibraryReadingItem, ReadingStatus } from "@/lib/library-types";
import { useIsCoarsePointer } from "@/lib/use-viewport";

// ── Helpers ────────────────────────────────────────────────────────────────

type SortKey = "title" | "status" | "addedAt";
type SortDir = "asc" | "desc";
type GroupBy = "status" | "sourceType" | "none";

const STATUS_ORDER: Record<ReadingStatus, number> = {
  reading: 0,
  "want-to-read": 1,
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
  onAdd: (title: string, sourceType: LibraryReadingItem["sourceType"], status: ReadingStatus) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [sourceType, setSourceType] = useState<LibraryReadingItem["sourceType"]>("article");
  const [status, setStatus] = useState<ReadingStatus>("want-to-read");
  const coarse = useIsCoarsePointer();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    onAdd(title.trim(), sourceType, status);
  }

  return (
    <form className="library-list-add-form" onSubmit={handleSubmit}>
      <input
        autoFocus={!coarse}
        className="board-drawer-field-input library-list-add-input"
        placeholder="Title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <select
        className="board-toolbar-select"
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
        className="board-toolbar-select"
        value={status}
        onChange={(e) => setStatus(e.target.value as ReadingStatus)}
      >
        <option value="want-to-read">Want to read</option>
        <option value="reading">Reading</option>
        <option value="done">Done</option>
        <option value="abandoned">Abandoned</option>
      </select>
      <button type="submit" className="board-toolbar-btn board-toolbar-btn--active">Save</button>
      <button type="button" className="board-toolbar-btn" onClick={onCancel}>Cancel</button>
    </form>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

type Props = {
  selectedId: string | null;
  onSelect: (item: LibraryReadingItem) => void;
  onDelete?: (id: string) => void;
};

const COLS: { key: SortKey; label: string; width?: string }[] = [
  { key: "title",   label: "Title" },
  { key: "status",  label: "Status",   width: "110px" },
  { key: "addedAt", label: "Added",    width: "80px" },
];

export function LibraryReadingList({ selectedId, onSelect, onDelete }: Props) {
  const [items, setItems] = useState<LibraryReadingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("addedAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [groupBy, setGroupBy] = useState<GroupBy>("status");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/library/reading", { cache: "no-store" });
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

  async function handleAdd(title: string, sourceType: LibraryReadingItem["sourceType"], status: ReadingStatus) {
    setAdding(false);
    const res = await fetch("/api/library/reading", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, sourceType, status }),
    });
    const json = await res.json();
    if (json.ok) setItems((prev) => [json.item, ...prev]);
  }

  async function handleDelete(id: string) {
    await fetch(`/api/library/reading?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    setItems((prev) => prev.filter((i) => i.id !== id));
    onDelete?.(id);
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

      {/* Add form */}
      {adding && (
        <AddReadingForm onAdd={handleAdd} onCancel={() => setAdding(false)} />
      )}

      {/* Table */}
      {loading ? (
        <div className="library-list-empty">Loading…</div>
      ) : items.length === 0 ? (
        <div className="library-list-empty">No reading list items yet. Add one above.</div>
      ) : (
        <div className="board-table-wrap">
          <table aria-label="Reading list" className="board-table">
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
                <th style={{ width: "80px" }}>Type</th>
                <th style={{ width: "70px" }}>Progress</th>
                <th style={{ width: "32px" }} />
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
                      className={item.id === selectedId ? "selected" : ""}
                      onClick={() => onSelect(item)}>
                      <td>
                        <span className="board-table-title">{item.title}</span>
                        {item.author && (
                          <div className="board-table-muted" style={{ marginTop: 2 }}>{item.author}</div>
                        )}
                      </td>
                      <td>
                        <span className="library-status-badge" style={statusBadgeStyle(item.status)}>
                          {item.status.replace(/-/g, " ")}
                        </span>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <span className="board-table-muted">{relTime(item.addedAt)}</span>
                      </td>
                      <td>
                        <span className="board-table-muted library-source-type">
                          {sourceIcon(item.sourceType)}
                          <span style={{ marginLeft: 3 }}>{item.sourceType}</span>
                        </span>
                      </td>
                      <td>
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
                      <td onClick={(e) => { e.stopPropagation(); void handleDelete(item.id); }}>
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
    </div>
  );
}
