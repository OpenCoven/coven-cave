"use client";

import React, { useMemo, useState } from "react";
import type { Familiar } from "@/lib/types";
import type { Card, CardStatus, CardPriority } from "@/lib/cave-board-types";
import { LifecycleBadge } from "@/components/ui/lifecycle-badge";
import { Icon } from "@/lib/icon";
import { FamiliarAvatar } from "@/components/familiar-avatar";
import { useResolvedFamiliars } from "@/lib/familiar-resolve";

export type GroupBy = "status" | "familiar";
export type SortKey = "title" | "status" | "priority" | "familiar" | "cwd" | "links" | "lifecycle" | "updatedAt";
export type SortDir = "asc" | "desc";

const STATUS_ORDER: Record<CardStatus, number> = { backlog: 0, inbox: 1, running: 2, review: 3, blocked: 4, done: 5 };
const PRIORITY_ORDER: Record<CardPriority, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

function sortCards(cards: Card[], key: SortKey, dir: SortDir, familiars: Familiar[]): Card[] {
  const fname = (id: string | null) => familiars.find((f) => f.id === id)?.display_name ?? "";
  return [...cards].sort((a, b) => {
    let cmp = 0;
    switch (key) {
      case "title":    cmp = a.title.localeCompare(b.title); break;
      case "status":   cmp = STATUS_ORDER[a.status] - STATUS_ORDER[b.status]; break;
      case "priority": cmp = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]; break;
      case "familiar": cmp = fname(a.familiarId).localeCompare(fname(b.familiarId)); break;
      case "cwd": cmp = (a.cwd ?? "").localeCompare(b.cwd ?? ""); break;
      case "links": cmp = a.links.length - b.links.length; break;
      case "lifecycle": cmp = a.lifecycle.localeCompare(b.lifecycle); break;
      case "updatedAt": cmp = (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""); break;
    }
    return dir === "asc" ? cmp : -cmp;
  });
}

function groupCards(cards: Card[], by: GroupBy, familiars: Familiar[]): { key: string; label: string; cards: Card[] }[] {
  const map = new Map<string, Card[]>();
  for (const c of cards) {
    const key = by === "status" ? c.status : (c.familiarId ?? "__unassigned__");
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(c);
  }
  const entries = [...map.entries()].map(([key, grpCards]) => {
    const label = by === "familiar"
      ? (key === "__unassigned__" ? "Unassigned" : (familiars.find((f) => f.id === key)?.display_name ?? key))
      : key.charAt(0).toUpperCase() + key.slice(1);
    return { key, label, cards: grpCards };
  });
  if (by === "status") entries.sort((a, b) => (STATUS_ORDER[a.key as CardStatus] ?? 9) - (STATUS_ORDER[b.key as CardStatus] ?? 9));
  return entries;
}

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

type ColDef = { key: SortKey; label: string; width?: string };
const COLS: ColDef[] = [
  { key: "title",     label: "Title" },
  { key: "status",    label: "Status",    width: "100px" },
  { key: "priority",  label: "Priority",  width: "90px" },
  { key: "familiar",  label: "Familiar",  width: "130px" },
  { key: "cwd",       label: "CWD",       width: "160px" },
  { key: "links",     label: "Links",     width: "70px" },
  { key: "lifecycle", label: "Lifecycle", width: "100px" },
  { key: "updatedAt", label: "Updated",   width: "80px" },
];

type Props = {
  cards: Card[];
  familiars: Familiar[];
  groupBy: GroupBy;
  selectedCardId: string | null;
  onSelect: (id: string) => void;
  onPatch: (id: string, patch: Partial<Card>) => void;
};

export function BoardTable({ cards, familiars, groupBy, selectedCardId, onSelect, onPatch }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("updatedAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set(["done"]));

  const resolvedFamiliars = useResolvedFamiliars(familiars, { includeArchived: true });
  const resolvedByIdMap = useMemo(() => {
    const m = new Map(resolvedFamiliars.map((f) => [f.id, f]));
    return m;
  }, [resolvedFamiliars]);

  const sorted = useMemo(() => sortCards(cards, sortKey, sortDir, familiars), [cards, sortKey, sortDir, familiars]);
  const groups = useMemo(() => groupCards(sorted, groupBy, familiars), [sorted, groupBy, familiars]);

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
                onClick={() => handleCol(col.key)}>
                {col.label}
                <span className="board-table-sort-icon">
                  {sortKey === col.key
                    ? <Icon name={sortDir === "asc" ? "ph:caret-up" : "ph:caret-down-fill"} width={9} />
                    : <Icon name="ph:caret-up-down" width={9} />}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map(({ key, label, cards: gc }) => (
            <React.Fragment key={key}>
              <tr key={`g-${key}`} className="board-table-group-row" onClick={() => toggleGroup(key)}>
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
                  <tr key={card.id} className={selectedCardId === card.id ? "selected" : ""}
                    onClick={() => onSelect(card.id)}>
                    <td><span className="board-table-title">{card.title}</span></td>
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
                          {familiars.map((f) => (
                            <option key={f.id} value={f.id}>{f.display_name}</option>
                          ))}
                        </select>
                      </span>
                    </td>
                    <td>
                      {card.cwd ? (
                        <span className="board-table-cell-path" title={card.cwd}>{shortPath(card.cwd)}</span>
                      ) : (
                        <span className="board-table-cell-empty">—</span>
                      )}
                    </td>
                    <td>
                      {card.links.length > 0 ? (
                        <span className="board-table-cell-links">
                          <Icon name="ph:link-simple" width={10} />
                          {card.links.length}
                        </span>
                      ) : (
                        <span className="board-table-cell-empty">—</span>
                      )}
                    </td>
                    <td><LifecycleBadge lifecycle={card.lifecycle} needsHuman={card.needsHuman} /></td>
                    <td style={{ textAlign: "right" }}><span className="board-table-cell-time">{relTime(card.updatedAt)}</span></td>
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

function shortPath(value: string): string {
  const parts = value.split("/").filter(Boolean);
  return parts.length >= 2 ? parts.slice(-2).join("/") : value;
}
