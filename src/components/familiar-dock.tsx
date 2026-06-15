"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import { FamiliarAvatar } from "@/components/familiar-avatar";
import { useFamiliarStudio } from "@/lib/familiar-studio-context";
import { computeDockInlineCount } from "@/lib/familiar-dock-overflow";
import { computePresence, REMOTE_HARNESSES } from "@/lib/presence";
import { Popover, PopoverBody, PopoverLabel, PopoverSeparator } from "@/components/ui/popover";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";
import type { SessionRow } from "@/lib/types";

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

        {inline.map((f) => {
          const active = f.id === activeFamiliarId;
          const needsReply = responseNeeded?.has(f.id) ?? false;
          const presence = computePresence({
            familiar: f,
            sessions,
            needsReply,
            isRemoteHarness: f.harness ? REMOTE_HARNESSES.has(f.harness) : false,
          });
          return (
            <button
              key={f.id}
              type="button"
              data-id={f.id}
              style={{ ["--familiar-accent" as string]: f.color }}
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
        })}

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
                <Icon name="ph:arrows-out-line-vertical" width={11} aria-hidden /> Reorder
              </button>
            </div>
          </PopoverBody>
        </div>
      </Popover>
    </div>
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
