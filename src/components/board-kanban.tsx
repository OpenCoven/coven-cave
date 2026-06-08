"use client";

import { useRef, useState } from "react";
import type { Familiar, SessionRow } from "@/lib/types";
import type { Card, CardStatus, CardPriority } from "@/lib/cave-board-types";
import { LifecycleBadge } from "@/components/ui/lifecycle-badge";
import { Icon } from "@/lib/icon";
import type { GroupBy } from "@/components/board-table";
import { FamiliarAvatar } from "@/components/familiar-avatar";
import { useResolvedFamiliars } from "@/lib/familiar-resolve";

const COLUMNS: { id: CardStatus; label: string; hint: string }[] = [
  { id: "backlog",  label: "Backlog",  hint: "Ideas and work not ready to dispatch." },
  { id: "inbox",    label: "Inbox",    hint: "Ready for a familiar to pick up." },
  { id: "running",  label: "Running",  hint: "In use by a familiar right now." },
  { id: "review",   label: "Review",   hint: "Needs human or maintainer review." },
  { id: "blocked",  label: "Blocked",  hint: "Waiting, failed, cancelled, or needs help." },
  { id: "done",     label: "Done",     hint: "Completed work." },
];

const PRIORITIES: { id: CardPriority; label: string }[] = [
  { id: "urgent", label: "Urgent" },
  { id: "high",   label: "High" },
  { id: "medium", label: "Medium" },
  { id: "low",    label: "Low" },
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
  onOpenTaskChat?: (id: string) => Promise<void>;
  chatLinkingId?: string | null;
};

function getGroups(cards: Card[], by: GroupBy, familiars: Familiar[]): { key: string; label: string; cards: Card[] }[] {
  if (by === "status") return [{ key: "all", label: "", cards }];
  // by === "familiar"
  const map = new Map<string, Card[]>();
  for (const c of cards) {
    const key = c.familiarId ?? "__unassigned__";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(c);
  }
  return [...map.entries()].map(([key, grpCards]) => ({
    key,
    label: key === "__unassigned__" ? "Unassigned" : (familiars.find((f) => f.id === key)?.display_name ?? key),
    cards: grpCards,
  }));
}

export function BoardKanban({ cards, familiars, sessions, groupBy, selectedCardId, onSelect, onMoveStatus, onNewCard, onJumpToSession, onOpenTaskChat, chatLinkingId }: Props) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<CardStatus | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const draggingIdRef = useRef<string | null>(null);
  const railRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const groups = getGroups(cards, groupBy, familiars);
  const showSwimlanes = true;

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
                  <div className="board-swimlane-scroll-group">
                    <button
                      type="button"
                      className="board-swimlane-scroll-btn"
                      aria-label="Scroll lane left"
                      onClick={(e) => { e.stopPropagation(); scroll(key, -1); }}
                    >
                      <Icon name="ph:arrow-left-bold" width={10} />
                    </button>
                    <button
                      type="button"
                      className="board-swimlane-scroll-btn"
                      aria-label="Scroll lane right"
                      onClick={(e) => { e.stopPropagation(); scroll(key, 1); }}
                    >
                      <Icon name="ph:arrow-right-bold" width={10} />
                    </button>
                  </div>
                )}
              </div>
            )}
            {!isCollapsed && (
              <div
                className={isMultiSwimlane ? "board-swimlane-rail" : "board-kanban-rail-wrap"}
                style={isMultiSwimlane ? {} : { flex: 1, minHeight: 0 }}
                ref={(el) => { if (el) railRefs.current.set(key, el); }}>
                <div className="board-kanban-rail" style={isMultiSwimlane ? { height: 320 } : { height: "100%" }}>
                  {COLUMNS.map((col) => {
                    const rows = grpGrouped.get(col.id) ?? [];
                    const isDrop = dropTarget === col.id;
                    return (
                      <div key={col.id}
                        onDragEnter={(e) => handleDragEnter(e, col.id)}
                        onDragOver={(e) => handleDragOver(e, col.id)}
                        onDragLeave={(e) => handleDragLeave(e, col.id)}
                        onDrop={(e) => handleDrop(e, col.id)}
                        className={`board-kanban-column${isDrop ? " board-kanban-column--drop" : ""}`}>
                        <div className="board-kanban-column-header">
                          <span className={`board-kanban-column-dot board-kanban-column-dot--${col.id}`} aria-hidden />
                          <span className="board-kanban-column-label" title={col.hint}>{col.label}</span>
                          <span className="board-kanban-column-count">{rows.length}</span>
                          <button
                            type="button"
                            onClick={() => onNewCard(col.id)}
                            title={`Add to ${col.label}`}
                            className="board-kanban-column-add"
                            aria-label={`Add to ${col.label}`}
                          >
                            <Icon name="ph:plus-bold" width={10} />
                          </button>
                        </div>
                        <ul className="board-kanban-list">
                          {rows.length === 0 && (
                            <li className={`board-kanban-empty${isDrop ? " board-kanban-empty--drop" : ""}`}>
                              {isDrop ? (
                                <>
                                  <Icon name="ph:arrow-down-bold" width={14} />
                                  <span>Drop here</span>
                                </>
                              ) : (
                                <span>{col.hint}</span>
                              )}
                            </li>
                          )}
                          {rows.map((card) => (
                            <KanbanCard key={card.id} card={card} familiars={familiars} sessions={sessions}
                              isDragging={draggingId === card.id} isSelected={selectedCardId === card.id}
                              onSelect={() => onSelect(card.id)}
                              onDragStart={(e) => handleDragStart(e, card.id)}
                              onDragEnd={handleDragEnd}
                              onJumpToSession={onJumpToSession}
                              onOpenTaskChat={onOpenTaskChat}
                              chatLinking={chatLinkingId === card.id} />
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

function KanbanCard({ card, familiars, sessions, isDragging, isSelected, onSelect, onDragStart, onDragEnd, onJumpToSession, onOpenTaskChat, chatLinking = false }: {
  card: Card; familiars: Familiar[]; sessions: SessionRow[];
  isDragging: boolean; isSelected: boolean;
  onSelect: () => void; onDragStart: (e: React.DragEvent) => void; onDragEnd: () => void;
  onJumpToSession?: (sessionId: string, familiarId: string | null) => void;
  onOpenTaskChat?: (id: string) => Promise<void>;
  chatLinking?: boolean;
}) {
  const draggedRef = useRef(false);
  const rawFamiliar = familiars.find((f) => f.id === card.familiarId) ?? null;
  const resolvedFamiliars = useResolvedFamiliars(rawFamiliar ? [rawFamiliar] : [], { includeArchived: true });
  const resolvedFamiliar = resolvedFamiliars[0] ?? null;
  const session = sessions.find((s) => s.id === card.sessionId) ?? null;
  const pri = PRIORITIES.find((p) => p.id === card.priority)!;
  const hasChips = !!card.cwd || card.links.length > 0 || card.labels.length > 0;

  return (
    <li draggable
      onDragStart={(e) => { draggedRef.current = true; onDragStart(e); }}
      onDragEnd={() => { setTimeout(() => { draggedRef.current = false; }, 0); onDragEnd(); }}
      onClick={() => { if (draggedRef.current) return; onSelect(); }}
      onKeyDown={(e) => { if (e.key !== "Enter" && e.key !== " ") return; e.preventDefault(); onSelect(); }}
      tabIndex={0} aria-selected={isSelected}
      className={`board-kanban-card board-kanban-card--priority-${card.priority}${
        isSelected ? " board-kanban-card--selected" : ""
      }${isDragging ? " board-kanban-card--dragging" : ""}`}
    >
      <div className="board-kanban-card-top">
        <span className={`board-kanban-priority-pill board-kanban-priority-pill--${card.priority}`}>{pri.label}</span>
        <LifecycleBadge lifecycle={card.lifecycle} needsHuman={card.needsHuman} />
      </div>
      <div className="board-kanban-card-title">{card.title}</div>
      {card.notes && <p className="board-kanban-card-notes">{card.notes}</p>}
      {hasChips && (
        <div className="board-kanban-card-chips">
          {card.cwd && (
            <span className="board-kanban-card-chip board-kanban-card-chip--path" title={card.cwd}>
              <Icon name="ph:folder" width={9} />
              {shortPath(card.cwd)}
            </span>
          )}
          {card.links.length > 0 && (
            <span className="board-kanban-card-chip">
              <Icon name="ph:link-simple" width={9} />
              {card.links.length}
            </span>
          )}
          {card.labels.slice(0, 2).map((l) => (
            <span key={l} className="board-kanban-card-chip">{l}</span>
          ))}
          {card.labels.length > 2 && (
            <span className="board-kanban-card-chip board-kanban-card-chip--more">+{card.labels.length - 2}</span>
          )}
        </div>
      )}
      <div className="board-kanban-card-footer">
        <span className="board-kanban-card-familiar">
          <span className={`board-kanban-card-familiar-avatar${resolvedFamiliar ? "" : " board-kanban-card-familiar-avatar--empty"}`}>
            {resolvedFamiliar ? <FamiliarAvatar familiar={resolvedFamiliar} size="sm" /> : <Icon name="ph:user" width={9} />}
          </span>
          <span className="board-kanban-card-familiar-name">{resolvedFamiliar?.display_name ?? "Unassigned"}</span>
        </span>
        {session ? (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onJumpToSession?.(session.id, session.familiarId ?? null); }}
            className="board-kanban-card-action"
          >
            <Icon name="ph:arrow-square-out" width={10} />
            Open
          </button>
        ) : (
          <button
            type="button"
            disabled={chatLinking}
            onClick={(e) => { e.stopPropagation(); void onOpenTaskChat?.(card.id); }}
            className="board-kanban-card-action board-kanban-card-action--chat"
          >
            <Icon name="ph:chat-circle-dots" width={10} />
            {chatLinking ? "Starting…" : "Chat"}
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
