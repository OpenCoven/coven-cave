"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Icon } from "@/lib/icon";
import { FamiliarAvatar } from "@/components/familiar-avatar";
import { useFamiliarStudio } from "@/lib/familiar-studio-context";
import { computeDockInlineCount } from "@/lib/familiar-dock-overflow";
import { computePresence, REMOTE_HARNESSES } from "@/lib/presence";
import { Popover, PopoverBody, PopoverLabel, PopoverSeparator } from "@/components/ui/popover";
import { setFamiliarOrder } from "@/lib/cave-familiar-order";
import { useRovingTabIndex } from "@/lib/use-roving-tabindex";
import {
  DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors, closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, useSortable, arrayMove, sortableKeyboardCoordinates,
  horizontalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";
import type { SessionRow } from "@/lib/types";

type Presence = { label: string; dot: string };

type Props = {
  familiars: ResolvedFamiliar[];
  activeFamiliarId?: string | null;
  sessions: SessionRow[];
  responseNeeded?: Set<string>;
  onFamiliarScopeChange: (id: string | null) => void;
};

export function FamiliarDock({
  familiars,
  activeFamiliarId,
  sessions,
  responseNeeded,
  onFamiliarScopeChange,
}: Props) {
  const { openFamiliarStudio, openFamiliarStudioListView } = useFamiliarStudio();
  const rowRef = useRef<HTMLDivElement | null>(null);
  const overflowBtnRef = useRef<HTMLButtonElement | null>(null);
  const [popoverOpen, setPopoverOpen] = useState(false);

  const [rowWidth, setRowWidth] = useState(0);
  useEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) setRowWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const ITEM_WIDTH = 38;
  const RESERVED = 146;
  const inlineCount = computeDockInlineCount({
    containerWidth: rowWidth,
    itemWidth: ITEM_WIDTH,
    reservedWidth: RESERVED,
    total: familiars.length,
  });
  const inline = useMemo(() => familiars.slice(0, inlineCount), [familiars, inlineCount]);
  const overflow = useMemo(() => familiars.slice(inlineCount), [familiars, inlineCount]);
  const overflowCount = overflow.length;

  const [query, setQuery] = useState("");
  const [reordering, setReordering] = useState(false);
  const q = query.trim().toLowerCase();
  const matches = (f: ResolvedFamiliar) =>
    !q || f.display_name.toLowerCase().includes(q) || (f.role ?? "").toLowerCase().includes(q);
  const overflowMatches = overflow.filter(matches);
  const inlineMatches = inline.filter(matches);

  useRovingTabIndex({
    containerRef: rowRef,
    itemSelector: ".familiar-dock__avatar:not([disabled])",
    orientation: "horizontal",
  });
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const familiarIds = useMemo(() => familiars.map((f) => f.id), [familiars]);
  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = familiarIds.indexOf(String(active.id));
    const newIndex = familiarIds.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    setFamiliarOrder(arrayMove(familiarIds, oldIndex, newIndex));
  }

  const presenceFor = (f: ResolvedFamiliar, needsReply: boolean): Presence =>
    computePresence({
      familiar: f,
      sessions,
      needsReply,
      isRemoteHarness: f.harness ? REMOTE_HARNESSES.has(f.harness) : false,
    });

  return (
    <div className="familiar-dock" aria-label="Familiars">
      <div className="familiar-dock__row" ref={rowRef} role="toolbar" aria-label="Familiar scope">
        <button
          type="button"
          className={`familiar-dock__all${activeFamiliarId == null ? " familiar-dock__all--active" : ""}`}
          aria-pressed={activeFamiliarId == null}
          onClick={() => onFamiliarScopeChange(null)}
          title="All familiars"
        >
          <Icon name="ph:sparkle" width={13} aria-hidden />
          <span>All</span>
        </button>

        {reordering ? (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={inline.map((f) => f.id)} strategy={horizontalListSortingStrategy}>
              {inline.map((f) => {
                const needsReply = responseNeeded?.has(f.id) ?? false;
                return (
                  <SortableDockAvatar
                    key={f.id}
                    familiar={f}
                    active={f.id === activeFamiliarId}
                    needsReply={needsReply}
                    presence={presenceFor(f, needsReply)}
                    onSelect={() => onFamiliarScopeChange(f.id)}
                    onOpenStudio={() => openFamiliarStudio(f.id, "identity")}
                  />
                );
              })}
            </SortableContext>
          </DndContext>
        ) : (
          inline.map((f) => {
            const active = f.id === activeFamiliarId;
            const needsReply = responseNeeded?.has(f.id) ?? false;
            const presence = presenceFor(f, needsReply);
            return (
              <button
                key={f.id}
                type="button"
                data-id={f.id}
                style={{ ["--familiar-accent" as string]: f.color } as CSSProperties}
                className={`familiar-dock__avatar${active ? " familiar-dock__avatar--active" : ""}`}
                aria-pressed={active}
                aria-label={`Filter by ${f.display_name}${needsReply ? " — reply needed" : ""}`}
                title={`${f.display_name} · ${presence.label}`}
                onClick={() => onFamiliarScopeChange(f.id)}
                onContextMenu={(e) => { e.preventDefault(); openFamiliarStudio(f.id, "identity"); }}
              >
                <FamiliarAvatar familiar={f} size="sm" />
                <span className={`familiar-dock__presence ${presence.dot}`} aria-hidden />
                {needsReply ? <span className="familiar-dock__unread" aria-hidden /> : null}
              </button>
            );
          })
        )}

        {overflowCount > 0 ? (
          <button
            type="button"
            ref={overflowBtnRef}
            className="familiar-dock__overflow"
            aria-label={`Show ${overflowCount} more familiars`}
            aria-haspopup="menu"
            aria-expanded={popoverOpen}
            onClick={() => setPopoverOpen((o) => !o)}
          >
            <Icon name="ph:dots-three-bold" width={14} aria-hidden />
            <span className="familiar-dock__overflow-badge">{overflowCount}</span>
          </button>
        ) : null}

        <button
          type="button"
          className="familiar-dock__add"
          aria-label="Add familiar"
          title="Add familiar"
          onClick={() => openFamiliarStudioListView()}
        >
          <Icon name="ph:plus-bold" width={12} aria-hidden />
        </button>

        {reordering ? (
          <button type="button" className="familiar-dock__done" onClick={() => setReordering(false)}>Done</button>
        ) : null}
      </div>

      <Popover open={popoverOpen} onOpenChange={setPopoverOpen} anchorRef={overflowBtnRef} placement="bottom-end" minWidth={280}>
        <div className="familiar-dock__pop">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter familiars…"
            aria-label="Filter familiars"
            className="familiar-dock__pop-search"
            autoFocus
          />
          <PopoverBody>
            {overflowMatches.length > 0 ? (
              <>
                <PopoverLabel>Not shown in dock</PopoverLabel>
                {overflowMatches.map((f) => (
                  <PopoverFamiliarRow
                    key={f.id}
                    familiar={f}
                    active={f.id === activeFamiliarId}
                    needsReply={responseNeeded?.has(f.id) ?? false}
                    onSelect={() => { onFamiliarScopeChange(f.id); setPopoverOpen(false); }}
                    onCustomize={() => { openFamiliarStudio(f.id, "identity"); setPopoverOpen(false); }}
                  />
                ))}
              </>
            ) : null}
            {inlineMatches.length > 0 ? (
              <>
                <PopoverLabel>In dock</PopoverLabel>
                {inlineMatches.map((f) => (
                  <PopoverFamiliarRow
                    key={f.id}
                    familiar={f}
                    active={f.id === activeFamiliarId}
                    needsReply={responseNeeded?.has(f.id) ?? false}
                    onSelect={() => { onFamiliarScopeChange(f.id); setPopoverOpen(false); }}
                    onCustomize={() => { openFamiliarStudio(f.id, "identity"); setPopoverOpen(false); }}
                  />
                ))}
              </>
            ) : null}
            <PopoverSeparator />
            <div className="familiar-dock__pop-foot">
              <button type="button" className="familiar-dock__pop-btn familiar-dock__pop-btn--pri"
                onClick={() => { openFamiliarStudioListView(); setPopoverOpen(false); }}>
                <Icon name="ph:plus-bold" width={11} aria-hidden /> New
              </button>
              <button type="button" className="familiar-dock__pop-btn"
                onClick={() => { openFamiliarStudioListView(); setPopoverOpen(false); }}>
                <Icon name="ph:list-bullets" width={11} aria-hidden /> Manage
              </button>
              <button type="button" className="familiar-dock__pop-btn"
                onClick={() => { setReordering(true); setPopoverOpen(false); }}>
                <Icon name="ph:dots-six-vertical" width={11} aria-hidden /> Reorder
              </button>
            </div>
          </PopoverBody>
        </div>
      </Popover>
    </div>
  );
}

function SortableDockAvatar({
  familiar,
  active,
  needsReply,
  presence,
  onSelect,
  onOpenStudio,
}: {
  familiar: ResolvedFamiliar;
  active: boolean;
  needsReply: boolean;
  presence: Presence;
  onSelect: () => void;
  onOpenStudio: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: familiar.id });
  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    ["--familiar-accent" as string]: familiar.color,
  } as CSSProperties;
  return (
    <span ref={setNodeRef} style={style} className="familiar-dock__sortable" data-dragging={undefined}>
      <button
        type="button"
        data-id={familiar.id}
        className={`familiar-dock__avatar${active ? " familiar-dock__avatar--active" : ""}`}
        title={`${familiar.display_name} · ${presence.label}`}
        onClick={onSelect}
        onContextMenu={(e) => { e.preventDefault(); onOpenStudio(); }}
        {...attributes}
        {...listeners}
        aria-pressed={active}
        aria-label={`Reorder ${familiar.display_name}`}
      >
        <FamiliarAvatar familiar={familiar} size="sm" />
        <span className={`familiar-dock__presence ${presence.dot}`} aria-hidden />
        {needsReply ? <span className="familiar-dock__unread" aria-hidden /> : null}
      </button>
    </span>
  );
}

function PopoverFamiliarRow({
  familiar,
  active,
  needsReply,
  onSelect,
  onCustomize,
}: {
  familiar: ResolvedFamiliar;
  active: boolean;
  needsReply: boolean;
  onSelect: () => void;
  onCustomize: () => void;
}) {
  return (
    <div className={`familiar-dock__pop-row${active ? " familiar-dock__pop-row--active" : ""}`}>
      <button type="button" className="familiar-dock__pop-pick" onClick={onSelect} aria-pressed={active}>
        <FamiliarAvatar familiar={familiar} size="sm" />
        <span className="familiar-dock__pop-name">{familiar.display_name}</span>
        <span className="familiar-dock__pop-role">{familiar.role}</span>
        {needsReply ? <span className="familiar-dock__pop-unread" aria-hidden /> : null}
      </button>
      <button type="button" className="familiar-dock__pop-gear" aria-label={`Customize ${familiar.display_name}`} title="Customize" onClick={onCustomize}>
        <Icon name="ph:gear-six" width={12} aria-hidden />
      </button>
    </div>
  );
}
