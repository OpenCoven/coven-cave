"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FamiliarAvatar } from "@/components/familiar-avatar";
import { Popover, PopoverBody, PopoverItem, usePopoverInitialFocus } from "@/components/ui/popover";
import { Icon } from "@/lib/icon";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";
import { selectAll, toggleFamiliarSelection } from "@/lib/familiar-multiselect";

type Props = {
  familiars: ResolvedFamiliar[];
  /** Empty set = "All". */
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  /** How many crons each familiar owns — drawn on the card's count pill. */
  countById: ReadonlyMap<string, number>;
  /** Total cron count, for the "All" card. */
  totalCount: number;
};

/**
 * FamiliarPicker · carousel density, from `Rituals Redesign.dc.html`.
 *
 * A full-bleed strip of familiar cards above the crons list. Cards rest small
 * (name only) and grow to show role + cron count while the pointer is anywhere
 * in the row — one shared hover state rather than per-card, so the strip never
 * reflows under the cursor. Selection semantics are unchanged from the chip
 * picker this replaces (`@/lib/familiar-multiselect`): plain click scopes to one
 * familiar, ⌘/Ctrl-click combines, empty = All.
 *
 * The frame's "+ combine" card opens a checkable menu over the same set rather
 * than only teaching a gesture — the ⌘-click path still works, but the popover
 * makes multi-select reachable by keyboard and by pointer users who never learn
 * it.
 *
 * Not adopted from the frame: the sparkle burst that fires on select. It is
 * decoration on a filter that already announces itself through the card's
 * checked state and the list re-rendering beneath it, and it would be the only
 * particle effect on the surface.
 */
export function FamiliarCarousel({ familiars, selected, onChange, countById, totalCount }: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const combineRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [combineOpen, setCombineOpen] = useState(false);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);
  // The popover is portaled to the end of <body>, so without this a keyboard
  // user who opens Combine keeps focus on the trigger and has to tab through
  // the whole page to reach the options they just asked for.
  usePopoverInitialFocus(combineOpen, ".rituals-fam-combine-panel");

  // Which edge fades and arrows are live is a measurement, not a guess: a strip
  // that already fits shows neither, and both update as the row scrolls or the
  // pane resizes under an opening detail rail.
  //
  // "At the start" is NOT scrollLeft === 0. The strip carries the list gutter as
  // inline padding and its cards snap to `start`, so the browser settles the
  // resting position at scrollLeft === padding-left — leaving a back-arrow
  // painted over the first card with nothing behind it to scroll to. Measure the
  // threshold off the real padding instead of assuming zero.
  const measure = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const restingLeft = Number.parseFloat(getComputedStyle(el).paddingLeft) || 0;
    setAtStart(el.scrollLeft <= restingLeft + 1);
    setAtEnd(max <= 1 || el.scrollLeft >= max - 1);
  }, []);

  useEffect(() => {
    measure();
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure, familiars.length]);

  const scrollBy = (direction: -1 | 1) => {
    // Smooth scrolling is enhancement, not meaning — honour the same preference
    // the stylesheet does for the card transitions.
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    scrollRef.current?.scrollBy({ left: direction * 240, behavior: reduced ? "auto" : "smooth" });
  };

  const allSelected = selected.size === 0;

  return (
    <div
      className={`rituals-fam-carousel${open ? " rituals-fam-carousel--open" : ""}`}
      onPointerEnter={() => setOpen(true)}
      onPointerLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <span aria-hidden className="rituals-fam-carousel__fade rituals-fam-carousel__fade--left" hidden={atStart} />
      <span aria-hidden className="rituals-fam-carousel__fade rituals-fam-carousel__fade--right" hidden={atEnd} />
      <button
        type="button"
        className="rituals-fam-carousel__nav rituals-fam-carousel__nav--prev focus-ring"
        aria-label="Scroll familiars left"
        hidden={atStart}
        onClick={() => scrollBy(-1)}
      >
        <Icon name="ph:caret-left" width={15} aria-hidden />
      </button>
      <button
        type="button"
        className="rituals-fam-carousel__nav rituals-fam-carousel__nav--next focus-ring"
        aria-label="Scroll familiars right"
        hidden={atEnd}
        onClick={() => scrollBy(1)}
      >
        <Icon name="ph:caret-right" width={15} aria-hidden />
      </button>

      {/* A GROUP of toggle buttons, not a listbox. The strip also carries the
          "combine" action, which is not an option — a non-option child makes a
          listbox structurally invalid and assistive tech may drop it. The
          toggle-group shape is what the chip picker this replaces already used
          (`FamiliarMultiSelect`), it is what a filter actually is, and
          `aria-pressed` describes a multi-select honestly where a radio-ish
          `aria-selected` does not. */}
      <div
        ref={scrollRef}
        onScroll={measure}
        role="group"
        aria-label="Filter crons by familiar"
        className="rituals-fam-carousel__scroll"
      >
        <button
          type="button"
          aria-pressed={allSelected}
          className="rituals-fam-card focus-ring"
          onClick={() => onChange(selectAll())}
        >
          <span aria-hidden className="rituals-fam-card__art">
            <Icon name="ph:moon" width={22} aria-hidden />
          </span>
          <span className="rituals-fam-card__body">
            <span className="rituals-fam-card__name">All</span>
            <span className="rituals-fam-card__meta">
              <span className="rituals-fam-card__role">the coven</span>
              <span className="rituals-fam-card__count">
                {totalCount} cron{totalCount === 1 ? "" : "s"}
              </span>
            </span>
          </span>
        </button>

        {familiars.map((familiar) => {
          const active = selected.has(familiar.id);
          const count = countById.get(familiar.id) ?? 0;
          return (
            <button
              key={familiar.id}
              type="button"
              aria-pressed={active}
              aria-label={`${familiar.display_name} — ${count} cron${count === 1 ? "" : "s"}. Click to scope, ⌘-click to combine.`}
              className="rituals-fam-card focus-ring"
              onClick={(event) =>
                onChange(toggleFamiliarSelection(selected, familiar.id, event.metaKey || event.ctrlKey))
              }
            >
              <span aria-hidden className="rituals-fam-card__art">
                <FamiliarAvatar familiar={familiar} size="lg" />
                {active ? (
                  <span className="rituals-fam-card__check">
                    <Icon name="ph:check" width={10} aria-hidden />
                  </span>
                ) : null}
              </span>
              <span className="rituals-fam-card__body">
                <span className="rituals-fam-card__name">{familiar.display_name}</span>
                <span className="rituals-fam-card__meta">
                  <span className="rituals-fam-card__role">{familiar.role}</span>
                  <span className="rituals-fam-card__count">
                    {count} cron{count === 1 ? "" : "s"}
                  </span>
                </span>
              </span>
            </button>
          );
        })}

        {familiars.length > 1 ? (
          <>
            <button
              ref={combineRef}
              type="button"
              className="rituals-fam-card rituals-fam-card--combine focus-ring"
              aria-haspopup="menu"
              aria-expanded={combineOpen}
              onClick={() => setCombineOpen((value) => !value)}
            >
              <span aria-hidden className="rituals-fam-card__art">
                <span className="rituals-fam-card__plus">
                  <Icon name="ph:plus" width={15} aria-hidden />
                </span>
              </span>
              <span className="rituals-fam-card__body">
                <span className="rituals-fam-card__name">combine</span>
                <span className="rituals-fam-card__meta">
                  <span className="rituals-fam-card__role">⌘-click cards</span>
                </span>
              </span>
            </button>
            <Popover
              open={combineOpen}
              onOpenChange={setCombineOpen}
              anchorRef={combineRef}
              placement="bottom-start"
              minWidth={200}
              ariaLabel="Combine familiars"
              className="rituals-fam-combine-panel"
            >
              <PopoverBody role="menu" ariaLabel="Combine familiars">
                {familiars.map((familiar) => (
                  <PopoverItem
                    key={familiar.id}
                    checked={selected.has(familiar.id)}
                    onSelect={() => onChange(toggleFamiliarSelection(selected, familiar.id, true))}
                  >
                    {familiar.display_name}
                  </PopoverItem>
                ))}
              </PopoverBody>
            </Popover>
          </>
        ) : null}
      </div>
    </div>
  );
}
