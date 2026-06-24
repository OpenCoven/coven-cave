"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Familiar } from "@/lib/types";
import type { Card, CardStatus, CardPriority } from "@/lib/cave-board-types";
import type { CaveProject } from "@/lib/cave-projects";
import { LifecycleBadge } from "@/components/ui/lifecycle-badge";
import { Icon } from "@/lib/icon";
import { FamiliarAvatar } from "@/components/familiar-avatar";
import { useResolvedFamiliars } from "@/lib/familiar-resolve";
import { useRovingTabIndex } from "@/lib/use-roving-tabindex";
import { RelativeTime } from "@/components/ui/relative-time";

export type GroupBy = "status" | "familiar" | "project";
export type SortKey = "title" | "status" | "priority" | "familiar" | "lifecycle" | "startDate" | "endDate" | "updatedAt";
export type SortDir = "asc" | "desc";

const STATUS_ORDER: Record<CardStatus, number> = { backlog: 0, inbox: 1, running: 2, review: 3, blocked: 4, done: 5 };
const PRIORITY_ORDER: Record<CardPriority, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

function sortCards(cards: Card[], key: SortKey, dir: SortDir, familiars: Familiar[]): Card[] {
  // Precompute id->name once (O(M)) instead of an O(M) find per comparison
  // (which made the "familiar" sort O(N log N · M)).
  const nameById = new Map(familiars.map((f) => [f.id, f.display_name]));
  const fname = (id: string | null) => (id ? nameById.get(id) ?? "" : "");
  return [...cards].sort((a, b) => {
    let cmp = 0;
    switch (key) {
      case "title":    cmp = a.title.localeCompare(b.title); break;
      case "status":   cmp = STATUS_ORDER[a.status] - STATUS_ORDER[b.status]; break;
      case "priority": cmp = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]; break;
      case "familiar": cmp = fname(a.familiarId).localeCompare(fname(b.familiarId)); break;
      case "lifecycle": cmp = a.lifecycle.localeCompare(b.lifecycle); break;
      case "startDate": cmp = (a.startDate ?? "9999-12-31").localeCompare(b.startDate ?? "9999-12-31"); break;
      case "endDate": cmp = (a.endDate ?? "9999-12-31").localeCompare(b.endDate ?? "9999-12-31"); break;
      case "updatedAt": cmp = (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""); break;
    }
    return dir === "asc" ? cmp : -cmp;
  });
}

const NO_PROJECT_KEY = "__noproject__";

function groupCards(cards: Card[], by: GroupBy, familiars: Familiar[], projects: CaveProject[]): { key: string; label: string; cards: Card[] }[] {
  const map = new Map<string, Card[]>();
  for (const c of cards) {
    const key = by === "status"
      ? c.status
      : by === "familiar"
        ? (c.familiarId ?? "__unassigned__")
        : (c.projectId ?? NO_PROJECT_KEY);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(c);
  }
  const entries = [...map.entries()].map(([key, grpCards]) => {
    let label: string;
    if (by === "familiar") {
      label = key === "__unassigned__" ? "Unassigned" : (familiars.find((f) => f.id === key)?.display_name ?? key);
    } else if (by === "project") {
      label = key === NO_PROJECT_KEY ? "No project" : (projects.find((p) => p.id === key)?.name ?? key);
    } else {
      label = key.charAt(0).toUpperCase() + key.slice(1);
    }
    return { key, label, cards: grpCards };
  });
  if (by === "status") {
    entries.sort((a, b) => (STATUS_ORDER[a.key as CardStatus] ?? 9) - (STATUS_ORDER[b.key as CardStatus] ?? 9));
  } else if (by === "project") {
    // Named projects alphabetically; the "No project" bucket always last.
    entries.sort((a, b) => {
      if (a.key === NO_PROJECT_KEY) return 1;
      if (b.key === NO_PROJECT_KEY) return -1;
      return a.label.localeCompare(b.label);
    });
  }
  return entries;
}

function formatBoardDate(value: string | null | undefined): string {
  if (!value) return "—";
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${month}/${day}/${year.slice(-2)}`;
}

type ColDef = { key: SortKey; label: string; width?: string };
const COLS: ColDef[] = [
  { key: "title",     label: "Title" },
  { key: "status",    label: "Status",    width: "100px" },
  { key: "priority",  label: "Priority",  width: "90px" },
  { key: "familiar",  label: "Familiar",  width: "130px" },
  { key: "lifecycle", label: "Lifecycle", width: "100px" },
  { key: "startDate", label: "Start",     width: "84px" },
  { key: "endDate",   label: "End",       width: "84px" },
  { key: "updatedAt", label: "Updated",   width: "80px" },
];

// Persisted, user-arrangeable column layout (order + per-column widths). Kept in
// localStorage so a reorder/resize survives reloads, like a spreadsheet.
const ORDER_KEY = "cave:board-table:order";
const WIDTHS_KEY = "cave:board-table:widths";
const MIN_COL_PX = 48;
const MAX_COL_PX = 680;

type Props = {
  cards: Card[];
  familiars: Familiar[];
  projects: CaveProject[];
  groupBy: GroupBy;
  selectedCardId: string | null;
  onSelect: (id: string) => void;
  /** Bulk-select mode: clicking a row toggles its checkbox instead of opening. */
  selectMode?: boolean;
  isSelected?: (id: string) => boolean;
  onToggleSelect?: (id: string) => void;
  onPatch: (id: string, patch: Partial<Card>) => void;
};

export function BoardTable({ cards, familiars, projects, groupBy, selectedCardId, onSelect, selectMode = false, isSelected, onToggleSelect, onPatch }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("updatedAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set(["done"]));

  // Column arrangement state (reorder + resize). Defaults match COLS for SSR;
  // the persisted layout is hydrated after mount to avoid a hydration mismatch.
  const [colOrder, setColOrder] = useState<SortKey[]>(() => COLS.map((c) => c.key));
  const [colWidths, setColWidths] = useState<Partial<Record<SortKey, number>>>({});
  const [dragOverKey, setDragOverKey] = useState<SortKey | null>(null);
  const hydratedRef = useRef(false);
  const dragKeyRef = useRef<SortKey | null>(null);
  const tableRef = useRef<HTMLTableElement | null>(null);
  const resizeRef = useRef<{ key: SortKey; startX: number; startW: number } | null>(null);

  const resolvedFamiliars = useResolvedFamiliars(familiars, { includeArchived: true });
  const resolvedByIdMap = useMemo(() => {
    const m = new Map(resolvedFamiliars.map((f) => [f.id, f]));
    return m;
  }, [resolvedFamiliars]);

  const sorted = useMemo(() => sortCards(cards, sortKey, sortDir, familiars), [cards, sortKey, sortDir, familiars]);
  const groups = useMemo(() => groupCards(sorted, groupBy, familiars, projects), [sorted, groupBy, familiars, projects]);
  // The familiar <select> options are identical for every row — build them once
  // instead of rebuilding M <option> elements per row on each render.
  const familiarOptions = useMemo(
    () => familiars.map((f) => <option key={f.id} value={f.id}>{f.display_name}</option>),
    [familiars],
  );

  // Columns rendered in the user's saved order; any unknown/new key is dropped
  // and any column missing from the saved order is appended so the table is
  // always complete even if COLS changes between releases.
  const orderedCols = useMemo(() => {
    const byKey = new Map(COLS.map((c) => [c.key, c]));
    const seen = new Set<SortKey>();
    const out: ColDef[] = [];
    for (const k of colOrder) {
      const col = byKey.get(k);
      if (col && !seen.has(k)) { out.push(col); seen.add(k); }
    }
    for (const col of COLS) if (!seen.has(col.key)) out.push(col);
    return out;
  }, [colOrder]);

  // Hydrate the persisted layout once, after mount.
  useEffect(() => {
    try {
      const o = localStorage.getItem(ORDER_KEY);
      if (o) {
        const arr = JSON.parse(o);
        if (Array.isArray(arr) && arr.length) setColOrder(arr as SortKey[]);
      }
      const w = localStorage.getItem(WIDTHS_KEY);
      if (w) {
        const obj = JSON.parse(w);
        if (obj && typeof obj === "object") setColWidths(obj as Partial<Record<SortKey, number>>);
      }
    } catch {
      /* ignore malformed prefs */
    }
    hydratedRef.current = true;
  }, []);

  useEffect(() => {
    if (!hydratedRef.current) return;
    try { localStorage.setItem(ORDER_KEY, JSON.stringify(colOrder)); } catch { /* ignore */ }
  }, [colOrder]);
  useEffect(() => {
    if (!hydratedRef.current) return;
    try { localStorage.setItem(WIDTHS_KEY, JSON.stringify(colWidths)); } catch { /* ignore */ }
  }, [colWidths]);

  const tbodyRef = useRef<HTMLTableSectionElement | null>(null);
  useRovingTabIndex({
    containerRef: tbodyRef,
    itemSelector: 'tr[data-board-row="true"]',
    orientation: "vertical",
  });

  useEffect(() => {
    const tbody = tbodyRef.current;
    if (!tbody) return;
    const onKey = (e: KeyboardEvent) => {
      const target = document.activeElement as HTMLElement | null;
      if (!target || !tbody.contains(target)) return;
      if (e.key === "Enter") {
        const cardId = target.dataset.cardId;
        if (cardId) {
          e.preventDefault();
          onSelect(cardId);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        onSelect("");
      }
    };
    tbody.addEventListener("keydown", onKey);
    return () => tbody.removeEventListener("keydown", onKey);
  }, [onSelect]);

  const handleCol = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  };

  const toggleGroup = (key: string) =>
    setCollapsed((prev) => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; });

  // ── Column reorder (drag a header onto another) ─────────────────────────────
  const onColDrop = (key: SortKey) => {
    const from = dragKeyRef.current;
    dragKeyRef.current = null;
    setDragOverKey(null);
    if (!from || from === key) return;
    setColOrder((prev) => {
      const arr = prev.filter((k): k is SortKey => COLS.some((c) => c.key === k));
      // Ensure completeness before splicing.
      for (const c of COLS) if (!arr.includes(c.key)) arr.push(c.key);
      const fi = arr.indexOf(from);
      const ti = arr.indexOf(key);
      if (fi < 0 || ti < 0) return prev;
      const next = [...arr];
      next.splice(fi, 1);
      next.splice(ti, 0, from);
      return next;
    });
  };

  // ── Column resize (drag the right edge) + autofit (double-click) ────────────
  const onResizeMove = useCallback((e: MouseEvent) => {
    const r = resizeRef.current;
    if (!r) return;
    const next = Math.max(MIN_COL_PX, Math.min(MAX_COL_PX, Math.round(r.startW + (e.clientX - r.startX))));
    setColWidths((prev) => ({ ...prev, [r.key]: next }));
  }, []);
  const onResizeUp = useCallback(() => {
    resizeRef.current = null;
    window.removeEventListener("mousemove", onResizeMove);
    window.removeEventListener("mouseup", onResizeUp);
    document.body.style.userSelect = "";
  }, [onResizeMove]);
  const startResize = useCallback((e: React.MouseEvent, key: SortKey) => {
    e.preventDefault();
    e.stopPropagation();
    const th = (e.currentTarget as HTMLElement).closest("th");
    const startW = th ? Math.round(th.getBoundingClientRect().width) : (colWidths[key] ?? 120);
    resizeRef.current = { key, startX: e.clientX, startW };
    window.addEventListener("mousemove", onResizeMove);
    window.addEventListener("mouseup", onResizeUp);
    document.body.style.userSelect = "none";
  }, [onResizeMove, onResizeUp, colWidths]);

  // Autofit: size the column to its widest content, like double-clicking an
  // Excel column border. Measures the inner element's scrollWidth (the natural
  // text width, even when the cell is currently clipping it).
  const autofitCol = (key: SortKey) => {
    const table = tableRef.current;
    if (!table) return;
    const idx = orderedCols.findIndex((c) => c.key === key);
    if (idx < 0) return;
    let max = 0;
    const head = table.querySelectorAll("thead th")[idx] as HTMLElement | undefined;
    if (head) {
      const btn = head.querySelector(".board-table-sort-btn") as HTMLElement | null;
      max = Math.max(max, (btn?.scrollWidth ?? head.scrollWidth) + 14);
    }
    table.querySelectorAll("tbody tr").forEach((tr) => {
      const cells = tr.children;
      if (cells.length !== orderedCols.length) return; // skip the single-cell group rows
      const cell = cells[idx] as HTMLElement;
      const inner = cell.firstElementChild as HTMLElement | null;
      max = Math.max(max, inner?.scrollWidth ?? cell.scrollWidth);
    });
    const next = Math.min(MAX_COL_PX, Math.max(MIN_COL_PX, max + 22));
    setColWidths((prev) => ({ ...prev, [key]: next }));
  };

  if (cards.length === 0) {
    return (
      <div className="board-empty">
        <Icon name="ph:kanban" width={32} className="opacity-30" />
        <p>No cards match the current filters.</p>
      </div>
    );
  }

  return (
    <div className="board-table-wrap">
      <table className="board-table board-table--grid" ref={tableRef}>
        <colgroup>
          {orderedCols.map((col) => {
            const w = colWidths[col.key] ?? (col.width ? parseInt(col.width, 10) : undefined);
            return <col key={col.key} style={w ? { width: `${w}px` } : undefined} />;
          })}
        </colgroup>
        <thead>
          <tr>
            {orderedCols.map((col) => (
              <th key={col.key}
                className={`${sortKey === col.key ? "sorted" : ""}${dragOverKey === col.key ? " board-table-col--dragover" : ""}`.trim()}
                aria-sort={sortKey === col.key ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                onDragOver={(e) => { e.preventDefault(); if (dragOverKey !== col.key) setDragOverKey(col.key); }}
                onDrop={() => onColDrop(col.key)}>
                <span
                  className="board-table-col-head"
                  draggable
                  onDragStart={(e) => { dragKeyRef.current = col.key; e.dataTransfer.effectAllowed = "move"; }}
                  onDragEnd={() => { dragKeyRef.current = null; setDragOverKey(null); }}
                  title="Drag to reorder column"
                >
                  <button type="button" className="board-table-sort-btn focus-ring" onClick={() => handleCol(col.key)}>
                    {col.label}
                    <span className="board-table-sort-icon">
                      {sortKey === col.key
                        ? <Icon name={sortDir === "asc" ? "ph:caret-up" : "ph:caret-down-fill"} width={9} />
                        : <Icon name="ph:caret-up-down" width={9} />}
                    </span>
                  </button>
                </span>
                <span
                  className="board-table-col-resize"
                  role="separator"
                  aria-orientation="vertical"
                  aria-label={`Resize ${col.label} column — double-click to autofit`}
                  title="Drag to resize · double-click to autofit"
                  onMouseDown={(e) => startResize(e, col.key)}
                  onDoubleClick={(e) => { e.preventDefault(); e.stopPropagation(); autofitCol(col.key); }}
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody ref={tbodyRef}>
          {groups.map(({ key, label, cards: gc }) => (
            <React.Fragment key={key}>
              <tr key={`g-${key}`} className="board-table-group-row" role="button" tabIndex={0}
                aria-expanded={!collapsed.has(key)}
                onClick={() => toggleGroup(key)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleGroup(key); } }}>
                <td colSpan={COLS.length}>
                  <span className="board-table-group-caret">
                    <Icon name={collapsed.has(key) ? "ph:caret-right" : "ph:caret-down"} width={10} />
                  </span>
                  {groupBy === "status" && (
                    <span className={`board-table-group-dot board-table-group-dot--${key}`} aria-hidden />
                  )}
                  {label}
                  <span className="board-table-group-badge">{gc.length}</span>
                </td>
              </tr>
              {!collapsed.has(key) && gc.map((card, rowIdx) => {
                const resolvedFamiliar = card.familiarId ? resolvedByIdMap.get(card.familiarId) ?? null : null;
                const rowChecked = selectMode && !!isSelected?.(card.id);
                const isSel = selectMode ? rowChecked : selectedCardId === card.id;
                return (
                  <tr key={card.id}
                    data-board-row="true"
                    data-card-id={card.id}
                    role={selectMode ? "checkbox" : undefined}
                    aria-checked={selectMode ? rowChecked : undefined}
                    className={`${isSel ? "selected" : ""}${rowIdx % 2 === 1 ? " board-table-row--alt" : ""}`.trim()}
                    onClick={() => (selectMode ? onToggleSelect?.(card.id) : onSelect(card.id))}>
                    {orderedCols.map((col) => {
                      let content: React.ReactNode = null;
                      switch (col.key) {
                        case "title":
                          content = (
                            <span className="board-table-title-cell" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              {selectMode && (
                                <span
                                  aria-hidden
                                  style={{
                                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                                    height: 16, width: 16, flexShrink: 0, borderRadius: 4,
                                    border: `1px solid ${rowChecked ? "var(--accent-presence)" : "var(--border-strong)"}`,
                                    background: rowChecked ? "var(--accent-presence)" : "transparent",
                                  }}
                                >
                                  {rowChecked && <Icon name="ph:check-bold" width={11} className="text-white" />}
                                </span>
                              )}
                              <span className="board-table-title" title={card.title}>{card.title}</span>
                            </span>
                          );
                          break;
                        case "status":
                          content = (
                            <span className="board-table-cell-status">
                              <span className={`board-table-status-dot board-table-status-dot--${card.status}`} aria-hidden />
                              <span>{card.status.charAt(0).toUpperCase() + card.status.slice(1)}</span>
                            </span>
                          );
                          break;
                        case "priority":
                          content = (
                            <span className="board-table-cell-priority">
                              <span className={`board-table-priority-flag board-table-priority-flag--${card.priority}`} aria-hidden />
                              <span>{card.priority.charAt(0).toUpperCase() + card.priority.slice(1)}</span>
                            </span>
                          );
                          break;
                        case "familiar":
                          content = (
                            <span className="board-table-cell-familiar">
                              <span className={`board-table-familiar-avatar${resolvedFamiliar ? "" : " board-table-familiar-avatar--empty"}`} aria-hidden>
                                {resolvedFamiliar ? <FamiliarAvatar familiar={resolvedFamiliar} size="sm" /> : <Icon name="ph:user" width={9} />}
                              </span>
                              <select
                                className="board-table-familiar-select"
                                value={card.familiarId ?? ""}
                                aria-label={`Assign familiar for ${card.title}`}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => onPatch(card.id, { familiarId: e.target.value || null })}
                              >
                                <option value="">Unassigned</option>
                                {familiarOptions}
                              </select>
                            </span>
                          );
                          break;
                        case "lifecycle":
                          content = <LifecycleBadge lifecycle={card.lifecycle} needsHuman={card.needsHuman} />;
                          break;
                        case "startDate":
                          content = <span className="board-table-cell-date">{formatBoardDate(card.startDate)}</span>;
                          break;
                        case "endDate":
                          content = <span className="board-table-cell-date">{formatBoardDate(card.endDate)}</span>;
                          break;
                        case "updatedAt":
                          content = <RelativeTime iso={card.updatedAt} className="board-table-cell-time" />;
                          break;
                      }
                      return (
                        <td key={col.key} style={col.key === "updatedAt" ? { textAlign: "right" } : undefined}>
                          {content}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
