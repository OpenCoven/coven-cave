"use client";

import React, { useMemo, useState } from "react";
import type { Familiar } from "@/lib/types";
import type { Card, CardStatus, CardPriority } from "@/lib/cave-board-types";
import { LifecycleBadge } from "@/components/ui/lifecycle-badge";
import { Icon } from "@/lib/icon";

export type GroupBy = "status" | "familiar" | "priority" | "none";
export type SortKey = "title" | "status" | "priority" | "familiar" | "lifecycle" | "updatedAt";
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
      case "lifecycle": cmp = a.lifecycle.localeCompare(b.lifecycle); break;
      case "updatedAt": cmp = (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""); break;
    }
    return dir === "asc" ? cmp : -cmp;
  });
}

function groupCards(cards: Card[], by: GroupBy, familiars: Familiar[]): { key: string; label: string; cards: Card[] }[] {
  if (by === "none") return [{ key: "all", label: "", cards }];
  const map = new Map<string, Card[]>();
  for (const c of cards) {
    const key = by === "status" ? c.status : by === "priority" ? c.priority : (c.familiarId ?? "__unassigned__");
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(c);
  }
  const entries = [...map.entries()].map(([key, cards]) => {
    let label = key;
    if (by === "familiar") label = key === "__unassigned__" ? "Unassigned" : (familiars.find((f) => f.id === key)?.display_name ?? key);
    else label = key.charAt(0).toUpperCase() + key.slice(1);
    return { key, label, cards };
  });
  if (by === "status") entries.sort((a, b) => (STATUS_ORDER[a.key as CardStatus] ?? 9) - (STATUS_ORDER[b.key as CardStatus] ?? 9));
  if (by === "priority") entries.sort((a, b) => (PRIORITY_ORDER[a.key as CardPriority] ?? 9) - (PRIORITY_ORDER[b.key as CardPriority] ?? 9));
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
  { key: "lifecycle", label: "Lifecycle", width: "100px" },
  { key: "updatedAt", label: "Updated",   width: "80px" },
];

type Props = {
  cards: Card[];
  familiars: Familiar[];
  groupBy: GroupBy;
  selectedCardId: string | null;
  onSelect: (id: string) => void;
};

export function BoardTable({ cards, familiars, groupBy, selectedCardId, onSelect }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("updatedAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set(["done"]));

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
              {groupBy !== "none" && (
                <tr key={`g-${key}`} className="board-table-group-row" onClick={() => toggleGroup(key)}>
                  <td colSpan={COLS.length}>
                    <span className="board-table-group-caret">
                      <Icon name={collapsed.has(key) ? "ph:caret-right" : "ph:caret-down"} width={10} />
                    </span>
                    {label}
                    <span className="board-table-group-badge">{gc.length}</span>
                  </td>
                </tr>
              )}
              {!collapsed.has(key) && gc.map((card) => {
                const familiar = familiars.find((f) => f.id === card.familiarId);
                return (
                  <tr key={card.id} className={selectedCardId === card.id ? "selected" : ""}
                    onClick={() => onSelect(card.id)}>
                    <td><span className="board-table-title">{card.title}</span></td>
                    <td><span className="board-table-muted">{card.status.charAt(0).toUpperCase() + card.status.slice(1)}</span></td>
                    <td><span className="board-table-muted">{card.priority.charAt(0).toUpperCase() + card.priority.slice(1)}</span></td>
                    <td><span className="board-table-muted">{familiar?.display_name ?? <span style={{ opacity: 0.4 }}>—</span>}</span></td>
                    <td><LifecycleBadge lifecycle={card.lifecycle} needsHuman={card.needsHuman} /></td>
                    <td style={{ textAlign: "right" }}><span className="board-table-muted">{relTime(card.updatedAt)}</span></td>
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
