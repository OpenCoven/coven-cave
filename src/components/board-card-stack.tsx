"use client";

import { useMemo, useRef, useState } from "react";
import type { Familiar, SessionRow } from "@/lib/types";
import type { Card, CardStatus } from "@/lib/cave-board-types";
import { Icon } from "@/lib/icon";
import { FamiliarAvatar } from "@/components/familiar-avatar";
import { LifecycleBadge } from "@/components/ui/lifecycle-badge";
import { Popover, PopoverBody, PopoverItem, PopoverLabel } from "@/components/ui/popover";
import { Tabs, type TabItem } from "@/components/ui/tabs";
import { useResolvedFamiliars } from "@/lib/familiar-resolve";

// Order mirrors BoardKanban's COLUMNS so users get a consistent left-to-
// right reading on desktop translating to top-to-bottom on phone.
const SECTIONS: { id: CardStatus; label: string }[] = [
  { id: "backlog", label: "Backlog" },
  { id: "inbox", label: "Inbox" },
  { id: "running", label: "Running" },
  { id: "review", label: "Review" },
  { id: "blocked", label: "Blocked" },
  { id: "done", label: "Done" },
];

function formatBoardDate(value: string | null | undefined): string {
  if (!value) return "";
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${month}/${day}`;
}

function scheduleLabel(startDate: string | null | undefined, endDate: string | null | undefined): string {
  if (startDate && endDate) {
    if (startDate === endDate) return formatBoardDate(startDate);
    return `${formatBoardDate(startDate)}-${formatBoardDate(endDate)}`;
  }
  if (startDate) return `Starts ${formatBoardDate(startDate)}`;
  if (endDate) return `Ends ${formatBoardDate(endDate)}`;
  return "";
}

type FilterValue = "all" | CardStatus;

type Props = {
  cards: Card[];
  familiars: Familiar[];
  sessions: SessionRow[];
  selectedCardId: string | null;
  onSelect: (id: string) => void;
  onMoveStatus: (id: string, status: CardStatus) => void;
  onNewCard: (status: CardStatus) => void;
  onJumpToSession?: (sessionId: string, familiarId: string | null) => void;
  onOpenTaskChat?: (id: string) => Promise<void>;
  chatLinkingId?: string | null;
};

/**
 * Mobile-first card list grouped by status. Replaces both the kanban
 * grid and the table on phone-class viewports — both of those hard-set
 * 560px+ widths that overflow a 360px screen. Each card opens the
 * inspector on tap and exposes a `⋯` menu for status changes (a drag
 * UX is unreliable on touch when the drop target is off-screen). The
 * status filter chip row at the top scrolls horizontally.
 */
export function BoardCardStack({
  cards,
  familiars,
  sessions,
  selectedCardId,
  onSelect,
  onMoveStatus,
  onNewCard,
  onJumpToSession,
  onOpenTaskChat,
  chatLinkingId,
}: Props) {
  const [filter, setFilter] = useState<FilterValue>("all");

  const counts = useMemo(() => {
    const acc: Record<CardStatus, number> = {
      backlog: 0, inbox: 0, running: 0, review: 0, blocked: 0, done: 0,
    };
    for (const c of cards) acc[c.status] += 1;
    return acc;
  }, [cards]);

  const filterTabs = useMemo<TabItem<FilterValue>[]>(
    () => [
      { id: "all", label: "All", count: cards.length },
      ...SECTIONS.map((s) => ({ id: s.id, label: s.label, count: counts[s.id] })),
    ],
    [cards.length, counts],
  );

  const sections = useMemo(() => {
    const grouped = new Map<CardStatus, Card[]>();
    for (const s of SECTIONS) grouped.set(s.id, []);
    for (const c of cards) grouped.get(c.status)?.push(c);
    return SECTIONS
      .filter((s) => filter === "all" || filter === s.id)
      .map((s) => ({ ...s, cards: grouped.get(s.id) ?? [] }));
  }, [cards, filter]);

  return (
    <div className="board-card-stack">
      {/* Status filter tabs — Vercel-style underline tabs. Horizontally
          scrollable so 7 tabs ("All" + 6 statuses) fit on a 360px screen
          without wrapping. */}
      <Tabs<FilterValue>
        className="board-card-stack__filters"
        ariaLabel="Filter by status"
        value={filter}
        onChange={setFilter}
        items={filterTabs}
      />

      {sections.map(({ id, label, cards: sectionCards }) => (
        <section key={id} className="board-card-stack__section">
          <header className="board-card-stack__section-header">
            <span className="board-card-stack__section-label">{label}</span>
            <span className="board-card-stack__section-count">{sectionCards.length}</span>
            <button
              type="button"
              className="board-card-stack__section-add"
              onClick={() => onNewCard(id)}
              aria-label={`New ${label} task`}
              title={`New ${label} task`}
            >
              <Icon name="ph:plus" width={12} />
            </button>
          </header>
          {sectionCards.length === 0 ? (
            <div className="board-card-stack__empty">No tasks.</div>
          ) : (
            <ul className="board-card-stack__list">
              {sectionCards.map((card) => (
                <BoardCardStackRow
                  key={card.id}
                  card={card}
                  familiars={familiars}
                  sessions={sessions}
                  isSelected={card.id === selectedCardId}
                  onSelect={() => onSelect(card.id)}
                  onMoveStatus={(status) => onMoveStatus(card.id, status)}
                  onJumpToSession={onJumpToSession}
                  onOpenTaskChat={onOpenTaskChat}
                  chatLinking={chatLinkingId === card.id}
                />
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

function BoardCardStackRow({
  card,
  familiars,
  sessions,
  isSelected,
  onSelect,
  onMoveStatus,
  onJumpToSession,
  onOpenTaskChat,
  chatLinking,
}: {
  card: Card;
  familiars: Familiar[];
  sessions: SessionRow[];
  isSelected: boolean;
  onSelect: () => void;
  onMoveStatus: (status: CardStatus) => void;
  onJumpToSession?: (sessionId: string, familiarId: string | null) => void;
  onOpenTaskChat?: (id: string) => Promise<void>;
  chatLinking: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);

  const rawFamiliar = familiars.find((f) => f.id === card.familiarId) ?? null;
  const resolvedFamiliars = useResolvedFamiliars(
    rawFamiliar ? [rawFamiliar] : [],
    { includeArchived: true },
  );
  const resolvedFamiliar = resolvedFamiliars[0] ?? null;
  const session = sessions.find((s) => s.id === card.sessionId) ?? null;
  const schedule = scheduleLabel(card.startDate, card.endDate);

  return (
    <li
      className={`board-card-stack__row board-card-stack__row--priority-${card.priority}${
        isSelected ? " board-card-stack__row--selected" : ""
      }`}
    >
      <button
        type="button"
        className="board-card-stack__row-main"
        onClick={onSelect}
        aria-pressed={isSelected}
      >
        <div className="board-card-stack__row-top">
          <span className={`board-card-stack__priority-pill board-card-stack__priority-pill--${card.priority}`}>
            {card.priority}
          </span>
          <LifecycleBadge lifecycle={card.lifecycle} needsHuman={card.needsHuman} />
        </div>
        <div className="board-card-stack__row-title">{card.title}</div>
        {card.notes ? (
          <p className="board-card-stack__row-notes">{card.notes}</p>
        ) : null}
        <div className="board-card-stack__row-footer">
          <span className="board-card-stack__row-familiar">
            <span className="board-card-stack__row-familiar-avatar">
              {resolvedFamiliar ? (
                <FamiliarAvatar familiar={resolvedFamiliar} size="sm" />
              ) : (
                <Icon name="ph:user" width={10} />
              )}
            </span>
            <span className="board-card-stack__row-familiar-name">
              {resolvedFamiliar?.display_name ?? "Unassigned"}
            </span>
          </span>
          {schedule ? (
            <span className="board-card-stack__row-schedule" title={`Scheduled ${schedule}`}>
              <Icon name="ph:calendar-blank" width={11} />
              {schedule}
            </span>
          ) : null}
          {session ? (
            <span
              className="board-card-stack__row-action board-card-stack__row-action--chat"
              role="link"
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation();
                onJumpToSession?.(session.id, session.familiarId ?? null);
              }}
            >
              <Icon name="ph:arrow-square-out" width={11} />
              Open
            </span>
          ) : (
            <span
              className="board-card-stack__row-action board-card-stack__row-action--chat"
              role="link"
              tabIndex={-1}
              title="Start chat"
              onClick={(e) => {
                e.stopPropagation();
                if (!chatLinking) void onOpenTaskChat?.(card.id);
              }}
            >
              <Icon name="ph:chat-circle-dots" width={11} />
              {chatLinking ? "Starting…" : "Start"}
            </span>
          )}
        </div>
      </button>
      <button
        ref={menuButtonRef}
        type="button"
        className="board-card-stack__row-menu-trigger"
        onClick={() => setMenuOpen((v) => !v)}
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        aria-label="Move task"
        title="Move task"
      >
        <Icon name="ph:dots-three-vertical" width={14} />
      </button>
      <Popover
        open={menuOpen}
        onOpenChange={setMenuOpen}
        anchorRef={menuButtonRef}
        placement="bottom-end"
        minWidth={180}
      >
        <PopoverBody>
          <PopoverLabel>Move to</PopoverLabel>
          {SECTIONS.map((s) => (
            <PopoverItem
              key={s.id}
              active={s.id === card.status}
              disabled={s.id === card.status}
              onSelect={() => {
                setMenuOpen(false);
                if (s.id !== card.status) onMoveStatus(s.id);
              }}
            >
              {s.label}
            </PopoverItem>
          ))}
        </PopoverBody>
      </Popover>
    </li>
  );
}
