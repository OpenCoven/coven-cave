"use client";

import { useRef, useState } from "react";
import type { Familiar, SessionRow } from "@/lib/types";
import type { Card, CardStatus, CardPriority } from "@/lib/cave-board-types";
import { LifecycleBadge } from "@/components/ui/lifecycle-badge";
import { Icon } from "@/lib/icon";
import type { GroupBy } from "@/components/board-table";

const COLUMNS: { id: CardStatus; label: string; hint: string }[] = [
  { id: "backlog",  label: "Backlog",  hint: "Ideas and work not ready to dispatch." },
  { id: "inbox",    label: "Inbox",    hint: "Ready for a familiar to pick up." },
  { id: "running",  label: "Running",  hint: "In use by a familiar right now." },
  { id: "review",   label: "Review",   hint: "Needs human or maintainer review." },
  { id: "blocked",  label: "Blocked",  hint: "Waiting, failed, cancelled, or needs help." },
  { id: "done",     label: "Done",     hint: "Completed work." },
];

const PRIORITIES: { id: CardPriority; label: string; pill: string }[] = [
  { id: "urgent", label: "Urgent", pill: "bg-muted text-foreground border-border-strong" },
  { id: "high",   label: "High",   pill: "bg-card text-foreground border-border-strong" },
  { id: "medium", label: "Medium", pill: "bg-card text-muted-foreground border-border" },
  { id: "low",    label: "Low",    pill: "bg-card text-muted-foreground border-border" },
];

type Props = {
  cards: Card[];
  familiars: Familiar[];
  sessions: SessionRow[];
  groupBy: GroupBy;
  selectedCardId: string | null;
  onSelect: (id: string) => void;
  onMoveStatus: (id: string, status: CardStatus) => void;
  onNewCard: (status: CardStatus) => void;
  onJumpToSession?: (sessionId: string, familiarId: string | null) => void;
};

function getGroups(cards: Card[], by: GroupBy, familiars: Familiar[]): { key: string; label: string; cards: Card[] }[] {
  if (by === "none") return [{ key: "all", label: "", cards }];
  if (by === "status") return [{ key: "all", label: "Status", cards }];
  const map = new Map<string, Card[]>();
  for (const c of cards) {
    const key = by === "familiar" ? (c.familiarId ?? "__unassigned__") : c.priority;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(c);
  }
  return [...map.entries()].map(([key, cards]) => ({
    key,
    label: by === "familiar"
      ? (key === "__unassigned__" ? "Unassigned" : (familiars.find((f) => f.id === key)?.display_name ?? key))
      : key.charAt(0).toUpperCase() + key.slice(1),
    cards,
  }));
}

export function BoardKanban({ cards, familiars, sessions, groupBy, selectedCardId, onSelect, onMoveStatus, onNewCard, onJumpToSession }: Props) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<CardStatus | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const draggingIdRef = useRef<string | null>(null);
  const railRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const groups = getGroups(cards, groupBy, familiars);
  const showSwimlanes = groupBy !== "none";

  const grouped = (gc: Card[]) => {
    const m = new Map<CardStatus, Card[]>();
    for (const col of COLUMNS) m.set(col.id, []);
    for (const c of gc) m.get(c.status)?.push(c);
    return m;
  };

  const handleDragStart = (e: React.DragEvent, id: string) => {
    draggingIdRef.current = id; setDraggingId(id);
    try { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", id); } catch {}
  };
  const handleDragEnd = () => { draggingIdRef.current = null; setDraggingId(null); setDropTarget(null); };
  const handleDragEnter = (e: React.DragEvent, s: CardStatus) => { e.preventDefault(); if (dropTarget !== s) setDropTarget(s); };
  const handleDragOver = (e: React.DragEvent, s: CardStatus) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (dropTarget !== s) setDropTarget(s); };
  const handleDragLeave = (e: React.DragEvent, s: CardStatus) => {
    const rel = e.relatedTarget as Node | null;
    if (rel && (e.currentTarget as Node).contains(rel)) return;
    if (dropTarget === s) setDropTarget(null);
  };
  const handleDrop = (e: React.DragEvent, s: CardStatus) => {
    e.preventDefault(); e.stopPropagation();
    const id = e.dataTransfer.getData("text/plain") || draggingIdRef.current || draggingId;
    draggingIdRef.current = null; setDraggingId(null); setDropTarget(null);
    if (!id) return;
    const card = cards.find((c) => c.id === id);
    if (!card || card.status === s) return;
    onMoveStatus(id, s);
  };

  const scroll = (key: string, dir: -1 | 1) => {
    const rail = railRefs.current.get(key);
    if (!rail) return;
    rail.scrollBy({ left: Math.max(rail.clientWidth * 0.72, 280) * dir, behavior: "smooth" });
  };

  const toggleGroup = (key: string) =>
    setCollapsedGroups((prev) => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; });

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflowY: showSwimlanes ? "auto" : "hidden" }}>
      {groups.map(({ key, label, cards: gc }) => {
        const isCollapsed = collapsedGroups.has(key);
        const grpGrouped = grouped(gc);
        const isStatusGroup = groupBy === "status"; // single-group, full-height
        const isMultiSwimlane = showSwimlanes && !isStatusGroup;
        return (
          <div key={key} className={isMultiSwimlane ? "board-swimlane" : ""} style={isMultiSwimlane ? {} : { display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
            {showSwimlanes && (
              <div className="board-swimlane-header" onClick={() => toggleGroup(key)}>
                <Icon name={isCollapsed ? "ph:caret-right" : "ph:caret-down"} width={10} />
                {label}
                <span className="board-swimlane-badge">{gc.length}</span>
                {isMultiSwimlane && (
                  <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                    <button type="button" onClick={(e) => { e.stopPropagation(); scroll(key, -1); }}
                      style={{ display: "grid", placeItems: "center", width: 20, height: 20, borderRadius: 4, border: "none", background: "transparent", color: "var(--text-muted)", cursor: "pointer" }}>
                      <Icon name="ph:arrow-left-bold" width={10} />
                    </button>
                    <button type="button" onClick={(e) => { e.stopPropagation(); scroll(key, 1); }}
                      style={{ display: "grid", placeItems: "center", width: 20, height: 20, borderRadius: 4, border: "none", background: "transparent", color: "var(--text-muted)", cursor: "pointer" }}>
                      <Icon name="ph:arrow-right-bold" width={10} />
                    </button>
                  </div>
                )}
              </div>
            )}
            {!isCollapsed && (
              <div
                className={isMultiSwimlane ? "board-swimlane-rail" : "h-full overflow-x-auto overflow-y-hidden scroll-smooth"}
                style={isMultiSwimlane ? {} : { flex: 1, minHeight: 0 }}
                ref={(el) => { if (el) railRefs.current.set(key, el); }}>
                <div className="flex gap-3 px-5 py-4" style={isMultiSwimlane ? { height: 320, minWidth: "max-content" } : { height: "100%", minWidth: "max-content" }}>
                  {COLUMNS.map((col) => {
                    const rows = grpGrouped.get(col.id) ?? [];
                    const isDrop = dropTarget === col.id;
                    return (
                      <div key={col.id}
                        onDragEnter={(e) => handleDragEnter(e, col.id)}
                        onDragOver={(e) => handleDragOver(e, col.id)}
                        onDragLeave={(e) => handleDragLeave(e, col.id)}
                        onDrop={(e) => handleDrop(e, col.id)}
                        className={`flex flex-shrink-0 flex-col rounded-lg border bg-card transition-colors ${isDrop ? "border-border-strong bg-muted" : "border-border"}`}
                        style={{ width: 280, height: "100%" }}>
                        <div className="flex items-center justify-between border-b border-border px-3 py-2">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-foreground" title={col.hint}>{col.label}</span>
                            <span className="rounded-full bg-muted px-1.5 py-px text-[10px] text-muted-foreground">{rows.length}</span>
                          </div>
                          <button onClick={() => onNewCard(col.id)} title={`Add to ${col.label}`}
                            className="grid h-5 w-5 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground">+</button>
                        </div>
                        <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
                          {rows.length === 0 && (
                            <li className={`rounded-md border border-dashed px-3 py-4 text-center text-[11px] ${isDrop ? "border-border-strong text-foreground" : "border-border text-muted-foreground"}`}>
                              {isDrop ? "Drop here" : col.hint}
                            </li>
                          )}
                          {rows.map((card) => (
                            <KanbanCard key={card.id} card={card} familiars={familiars} sessions={sessions}
                              isDragging={draggingId === card.id} isSelected={selectedCardId === card.id}
                              onSelect={() => onSelect(card.id)}
                              onDragStart={(e) => handleDragStart(e, card.id)}
                              onDragEnd={handleDragEnd}
                              onJumpToSession={onJumpToSession} />
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function KanbanCard({ card, familiars, sessions, isDragging, isSelected, onSelect, onDragStart, onDragEnd, onJumpToSession }: {
  card: Card; familiars: Familiar[]; sessions: SessionRow[];
  isDragging: boolean; isSelected: boolean;
  onSelect: () => void; onDragStart: (e: React.DragEvent) => void; onDragEnd: () => void;
  onJumpToSession?: (sessionId: string, familiarId: string | null) => void;
}) {
  const draggedRef = useRef(false);
  const familiar = familiars.find((f) => f.id === card.familiarId) ?? null;
  const session = sessions.find((s) => s.id === card.sessionId) ?? null;
  const pri = PRIORITIES.find((p) => p.id === card.priority)!;

  return (
    <li draggable
      onDragStart={(e) => { draggedRef.current = true; onDragStart(e); }}
      onDragEnd={() => { setTimeout(() => { draggedRef.current = false; }, 0); onDragEnd(); }}
      onClick={() => { if (draggedRef.current) return; onSelect(); }}
      onKeyDown={(e) => { if (e.key !== "Enter" && e.key !== " ") return; e.preventDefault(); onSelect(); }}
      tabIndex={0} aria-selected={isSelected}
      className={`cursor-grab rounded-lg border bg-background p-3 outline-none transition-all active:cursor-grabbing ${
        isSelected ? "border-border-strong bg-muted/60 ring-1 ring-border-strong" : "border-border hover:border-border-strong hover:bg-muted/30"
      } ${isDragging ? "opacity-40" : ""}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] uppercase tracking-widest ${pri.pill}`}>{pri.label}</span>
        <span className="text-[9px] uppercase tracking-widest text-muted-foreground">{card.status}</span>
      </div>
      <div className="min-w-0 text-[13px] font-medium leading-snug text-foreground">{card.title}</div>
      {card.notes && <p className="mt-2 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">{card.notes}</p>}
      {(card.cwd || card.links.length > 0) && (
        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
          {card.cwd && <span className="min-w-0 max-w-full truncate rounded border border-border bg-card px-1.5 py-px">{shortPath(card.cwd)}</span>}
          {card.links.length > 0 && <span className="rounded border border-border bg-card px-1.5 py-px">{card.links.length} link{card.links.length === 1 ? "" : "s"}</span>}
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <LifecycleBadge lifecycle={card.lifecycle} needsHuman={card.needsHuman} />
        {card.labels.slice(0, 3).map((l) => (
          <span key={l} className="rounded border border-border bg-card px-1.5 py-px text-[10px] text-foreground">{l}</span>
        ))}
        {card.labels.length > 3 && <span className="text-[10px] text-muted-foreground">+{card.labels.length - 3}</span>}
      </div>
      <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground">
        <span className="min-w-0 truncate">{familiar?.display_name ?? "unassigned"}</span>
        {session && (
          <button onClick={(e) => { e.stopPropagation(); onJumpToSession?.(session.id, session.familiarId ?? null); }}
            className="ml-auto rounded border border-border bg-card px-1.5 py-px text-foreground hover:bg-muted">
            open
          </button>
        )}
      </div>
    </li>
  );
}

function shortPath(value: string): string {
  const parts = value.split("/").filter(Boolean);
  return parts.length >= 2 ? parts.slice(-2).join("/") : value;
}
