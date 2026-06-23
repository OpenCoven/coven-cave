"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
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

type Props = {
  cards: Card[];
  familiars: Familiar[];
  projects: CaveProject[];
  groupBy: GroupBy;
  selectedCardId: string | null;
  onSelect: (id: string) => void;
  onPatch: (id: string, patch: Partial<Card>) => void;
};

export function BoardTable({ cards, familiars, projects, groupBy, selectedCardId, onSelect, onPatch }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("updatedAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set(["done"]));

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
      <table className="board-table">
        <thead>
          <tr>
            {COLS.map((col) => (
              <th key={col.key} style={col.width ? { width: col.width } : undefined}
                className={sortKey === col.key ? "sorted" : ""}
                aria-sort={sortKey === col.key ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
                <button type="button" className="board-table-sort-btn focus-ring" onClick={() => handleCol(col.key)}>
                  {col.label}
                  <span className="board-table-sort-icon">
                    {sortKey === col.key
                      ? <Icon name={sortDir === "asc" ? "ph:caret-up" : "ph:caret-down-fill"} width={9} />
                      : <Icon name="ph:caret-up-down" width={9} />}
                  </span>
                </button>
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
              {!collapsed.has(key) && gc.map((card) => {
                const resolvedFamiliar = card.familiarId ? resolvedByIdMap.get(card.familiarId) ?? null : null;
                return (
                  <tr key={card.id}
                    data-board-row="true"
                    data-card-id={card.id}
                    className={selectedCardId === card.id ? "selected" : ""}
                    onClick={() => onSelect(card.id)}>
                    <td><span className="board-table-title" title={card.title}>{card.title}</span></td>
                    <td>
                      <span className="board-table-cell-status">
                        <span className={`board-table-status-dot board-table-status-dot--${card.status}`} aria-hidden />
                        <span>{card.status.charAt(0).toUpperCase() + card.status.slice(1)}</span>
                      </span>
                    </td>
                    <td>
                      <span className="board-table-cell-priority">
                        <span className={`board-table-priority-flag board-table-priority-flag--${card.priority}`} aria-hidden />
                        <span>{card.priority.charAt(0).toUpperCase() + card.priority.slice(1)}</span>
                      </span>
                    </td>
                    <td>
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
                    </td>
                    <td><LifecycleBadge lifecycle={card.lifecycle} needsHuman={card.needsHuman} /></td>
                    <td><span className="board-table-cell-date">{formatBoardDate(card.startDate)}</span></td>
                    <td><span className="board-table-cell-date">{formatBoardDate(card.endDate)}</span></td>
                    <td style={{ textAlign: "right" }}><RelativeTime iso={card.updatedAt} className="board-table-cell-time" /></td>
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
