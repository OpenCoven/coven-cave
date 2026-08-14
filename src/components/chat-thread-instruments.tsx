"use client";

import "@/styles/cave-chat/thread-instruments.css";

// ── Chat thread instruments (Chat.dc.html 2a, cave-j86la) ────────────────────
// Two overlays that turn a long transcript into a navigable run:
//
//   • ChatThreadSpine — the left gutter wears one node per turn (operator or
//     familiar), each with its tool calls rolled into a proportional category
//     stack. Click a node to jump the pane to that turn.
//   • ChatThreadMinimap — the right edge wears one bar per event (prompt,
//     each tool call, answer), the whole thread at a glance. Click to jump;
//     the caret tracks the reading position; ↑/↓ step events.
//
// Both derive everything from the SAME Turn[] the transcript renders (the
// pure model in src/lib/chat-thread-instruments.ts) — no fetches — and both
// live in the transcript's existing side gutters as overlays, so they add no
// layout shift and simply stay home on panes too narrow to have gutters.

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { Icon } from "@/lib/icon";
import { useUserProfile, userDisplayName } from "@/lib/user-profile";
import type { Turn } from "@/lib/chat-turn-state";
import {
  spineSegmentHeights,
  spineNodes,
  spineStackHeight,
  threadMapEvents,
  type SpineNode,
  type ThreadMapEvent,
} from "@/lib/chat-thread-instruments";

/** Instruments need real side gutters: the reading column is ~860px, the
 *  spine wants 64px and the map 84px, so anything narrower than this keeps
 *  the transcript clean. (The env HUD's own gate is 1536 — the map clears it
 *  via CSS when both show.) */
export const THREAD_INSTRUMENTS_MIN_WIDTH = 1360;
/** The spine reads as an instrument, not a decoration, from a few turns up. */
const SPINE_MIN_TURNS = 2;
// Floor for the stamp lane, in characters: the 24-hour "23:00" every locale
// falls back to. Keeps the gutter from collapsing on a thread whose stamps are
// all missing, which would put the ring back where the clock belongs.
const SPINE_STAMP_MIN_CHARS = 5;
const MAP_MIN_EVENTS = 4;
/** Map row height (px) — mirrors the design's 15px rows. */
const MAP_ROW_H = 15;

type ScrollerRef = React.RefObject<HTMLDivElement | null>;

/** Observe the scroller's content-box width so both instruments share one
 *  wide-pane gate. */
function useScrollerWidth(scrollRef: ScrollerRef): number | null {
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [scrollRef]);
  return width;
}

function jumpToTurn(scroller: HTMLDivElement | null, turnId: string) {
  if (!scroller) return;
  const el = scroller.querySelector<HTMLElement>(`[data-turn-id="${CSS.escape(turnId)}"]`);
  if (!el) return;
  const top = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
  scroller.scrollTo({ top: Math.max(0, top - 24), behavior: "smooth" });
}

// ── Spine ────────────────────────────────────────────────────────────────────

/** Measured y-offset (content coordinates) for each rendered turn. Re-measured
 *  when the turn list changes and whenever the thread resizes (streaming
 *  growth, images loading, pane resize). */
function useTurnOffsets(scrollRef: ScrollerRef, turns: Turn[]): Map<string, number> {
  const [offsets, setOffsets] = useState<Map<string, number>>(() => new Map());
  const frameRef = useRef<number | null>(null);

  const measure = useCallback(() => {
    // rAF-coalesced; the ref is nulled on BOTH run and cancel (the #2659
    // lesson: cancel-without-null wedges the guard for the component's life).
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      const scroller = scrollRef.current;
      if (!scroller) return;
      const scrollerTop = scroller.getBoundingClientRect().top;
      const next = new Map<string, number>();
      for (const el of scroller.querySelectorAll<HTMLElement>("[data-turn-id]")) {
        const id = el.dataset.turnId;
        if (!id) continue;
        next.set(id, el.getBoundingClientRect().top - scrollerTop + scroller.scrollTop);
      }
      setOffsets((prev) => {
        if (prev.size === next.size) {
          let same = true;
          for (const [k, v] of next) {
            if (Math.abs((prev.get(k) ?? Number.NaN) - v) > 1) {
              same = false;
              break;
            }
          }
          if (same) return prev;
        }
        return next;
      });
    });
  }, [scrollRef]);

  useEffect(() => {
    measure();
    const scroller = scrollRef.current;
    if (!scroller) return;
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    const thread = scroller.querySelector<HTMLElement>(".cave-chat-thread");
    if (thread) observer.observe(thread);
    return () => {
      observer.disconnect();
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [measure, scrollRef, turns]);

  return offsets;
}

function SpineNodeButton({
  node,
  top,
  onJump,
}: {
  node: SpineNode;
  top: number;
  onJump: () => void;
}) {
  const stackH = spineStackHeight(node.total);
  const segmentHeights = spineSegmentHeights(node.cats);
  return (
    <button
      type="button"
      className={`cave-thread-spine__node focus-ring is-${node.role}${node.error ? " is-error" : ""}`}
      style={{ top }}
      title={`${node.name}${node.time ? ` · ${node.time}` : ""} — click to jump`}
      aria-label={`Jump to ${node.name}'s turn${node.time ? ` at ${node.time}` : ""}`}
      onClick={onJump}
    >
      <span className="cave-thread-spine__dot" aria-hidden>
        <Icon name={node.role === "user" ? "ph:user" : "ph:sparkle"} width={node.role === "user" ? 10 : 12} aria-hidden />
      </span>
      {node.time ? (
        <span className="cave-thread-spine__time" aria-hidden>
          {node.time}
        </span>
      ) : null}
      {node.total > 0 ? (
        <span className="cave-thread-spine__stack" style={{ height: stackH }} aria-hidden>
          {node.cats.map((c, index) => (
            <span
              key={c.cat}
              className={`cave-thread-spine__seg is-${c.cat}`}
              style={{ height: `${segmentHeights[index] ?? 0}%` }}
              title={`${c.cat} · ${c.count}`}
            />
          ))}
        </span>
      ) : null}
      <span className="cave-thread-spine__card" aria-hidden>
        <span className="cave-thread-spine__card-head">
          <span className="cave-thread-spine__card-name">{node.name}</span>
          {node.time ? <span className="cave-thread-spine__card-time">{node.time}</span> : null}
        </span>
        {node.summary ? <span className="cave-thread-spine__card-summary">{node.summary}</span> : null}
        {node.cats.length > 0 ? (
          <span className="cave-thread-spine__card-breakdown">
            {node.cats.map((c) => (
              <span key={c.cat} className="cave-thread-spine__card-row">
                <span className={`cave-thread-spine__card-swatch is-${c.cat}`} />
                <span className="cave-thread-spine__card-cat">{c.cat}</span>
                <span className="cave-thread-spine__card-n">{c.count}</span>
              </span>
            ))}
          </span>
        ) : null}
      </span>
    </button>
  );
}

export function ChatThreadSpine({
  turns,
  scrollRef,
  familiarName,
}: {
  turns: Turn[];
  scrollRef: ScrollerRef;
  familiarName: string;
}) {
  const operatorName = userDisplayName(useUserProfile()?.profile);
  const width = useScrollerWidth(scrollRef);
  const nodes = useMemo(
    () => spineNodes(turns, { operatorName, familiarName }),
    [turns, operatorName, familiarName],
  );
  const offsets = useTurnOffsets(scrollRef, turns);
  if (width == null || width < THREAD_INSTRUMENTS_MIN_WIDTH) return null;
  if (nodes.length < SPINE_MIN_TURNS) return null;
  const placed = nodes.filter((n) => offsets.has(n.turnId));
  if (placed.length < SPINE_MIN_TURNS) return null;
  const lineEnd = Math.max(...placed.map((n) => offsets.get(n.turnId)!)) + 40;
  // Size the stamp lane from the clock strings this thread ACTUALLY renders.
  // The format is the reader's own (12- vs 24-hour, and a locale may append a
  // narrow no-break space before AM/PM), so the width cannot be known at
  // author time: "23:00" is 5 characters where "11:00 PM" is 8. A machine
  // whose clock is wider than the CSS default would otherwise clip its own
  // timestamps — the failure this lane was introduced to end.
  const stampChars = Math.max(
    SPINE_STAMP_MIN_CHARS,
    ...placed.map((n) => n.time?.length ?? 0),
  );

  return (
    <nav
      className="cave-thread-spine"
      aria-label="Turns in this thread"
      style={{ "--cave-spine-stamp-chars": stampChars } as CSSProperties}
    >
      <span className="cave-thread-spine__line" style={{ height: lineEnd }} aria-hidden />
      {placed.map((node) => (
        <SpineNodeButton
          key={node.turnId}
          node={node}
          top={offsets.get(node.turnId)! + 6}
          onJump={() => jumpToTurn(scrollRef.current, node.turnId)}
        />
      ))}
    </nav>
  );
}

// ── Minimap ──────────────────────────────────────────────────────────────────

export function ChatThreadMinimap({
  turns,
  scrollRef,
  familiarName,
}: {
  turns: Turn[];
  scrollRef: ScrollerRef;
  familiarName: string;
}) {
  const operatorName = userDisplayName(useUserProfile()?.profile);
  const width = useScrollerWidth(scrollRef);
  const [paneHeight, setPaneHeight] = useState<number | null>(null);
  const [selected, setSelected] = useState(0);
  /** One shared hover card for the whole rail — the rows scroll inside an
   *  overflow container, so a per-row absolute card would clip; the shared
   *  card hangs off the rail itself and follows the hovered row's y. */
  const [hovered, setHovered] = useState<{ index: number; y: number } | null>(null);
  const events = useMemo(
    () => threadMapEvents(turns, { operatorName, familiarName }),
    [turns, operatorName, familiarName],
  );

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setPaneHeight(el.clientHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [scrollRef]);

  // Track the reading position: the caret follows the topmost visible turn's
  // first event. Passive listener + rAF coalescing (ref nulled on cancel).
  const frameRef = useRef<number | null>(null);
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const onScroll = () => {
      if (frameRef.current !== null) return;
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        const scrollerTop = scroller.getBoundingClientRect().top;
        let currentTurn: string | null = null;
        for (const el of scroller.querySelectorAll<HTMLElement>("[data-turn-id]")) {
          const top = el.getBoundingClientRect().top - scrollerTop;
          if (top <= 48) currentTurn = el.dataset.turnId ?? currentTurn;
          else break;
        }
        if (!currentTurn) return;
        const idx = events.findIndex((e) => e.turnId === currentTurn);
        if (idx >= 0) {
          setSelected((prev) => (prev === idx ? prev : idx));
          // Keep the caret in the rail's viewport — a 200-event thread scrolls
          // its own body, and a caret parked off-screen tracks nothing.
          const body = scroller.querySelector<HTMLElement>(".cave-thread-map__body");
          if (body) {
            const target = idx * MAP_ROW_H + 8 - body.clientHeight / 2;
            body.scrollTo({ top: Math.max(0, target) });
          }
        }
      });
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [scrollRef, events]);

  if (width == null || width < THREAD_INSTRUMENTS_MIN_WIDTH) return null;
  if (events.length < MAP_MIN_EVENTS || paneHeight == null) return null;

  const jumpToEvent = (idx: number) => {
    const event = events[idx];
    if (!event) return;
    setSelected(idx);
    jumpToTurn(scrollRef.current, event.turnId);
  };

  const hoveredEvent = hovered ? events[hovered.index] : null;

  return (
    <div className="cave-thread-map-anchor" aria-hidden={false}>
      <div className="cave-thread-map" style={{ height: paneHeight }}>
        <div className="cave-thread-map__head">Thread</div>
        <div className="cave-thread-map__body" onMouseLeave={() => setHovered(null)}>
          <span
            className="cave-thread-map__caret"
            style={{ top: selected * MAP_ROW_H + 8 }}
            aria-hidden
          />
          {events.map((event, i) => (
            <MapRow
              key={event.id}
              event={event}
              onJump={() => jumpToEvent(i)}
              onHover={(y) => setHovered({ index: i, y })}
            />
          ))}
        </div>
        {hoveredEvent ? (
          <MapHoverCard event={hoveredEvent} index={hovered!.index} count={events.length} y={hovered!.y} />
        ) : null}
        <div className="cave-thread-map__foot">
          <button
            type="button"
            className="cave-thread-map__step focus-ring"
            title="Previous event"
            aria-label="Previous event"
            onClick={() => jumpToEvent((selected - 1 + events.length) % events.length)}
          >
            <Icon name="ph:caret-up" width={9} aria-hidden />
          </button>
          <span className="cave-thread-map__pos">{`${selected + 1}/${events.length}`}</span>
          <button
            type="button"
            className="cave-thread-map__step focus-ring"
            title="Next event"
            aria-label="Next event"
            onClick={() => jumpToEvent((selected + 1) % events.length)}
          >
            <Icon name="ph:caret-down" width={9} aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}

function MapRow({
  event,
  onJump,
  onHover,
}: {
  event: ThreadMapEvent;
  onJump: () => void;
  onHover: (y: number) => void;
}) {
  const isTurn = event.kind === "turn" || event.kind === "answer";
  const reportHover = (el: HTMLElement) => {
    // The card hangs off the rail (outside this scroll container), so it
    // anchors to the row's y within the rail, not within the scrolled body.
    const rail = el.closest(".cave-thread-map");
    if (!rail) return;
    onHover(el.getBoundingClientRect().top - rail.getBoundingClientRect().top);
  };
  return (
    <button
      type="button"
      className={`cave-thread-map__row focus-ring is-${event.kind}${event.error ? " is-error" : ""}`}
      title={`${event.label} — click to jump`}
      aria-label={`Jump to ${event.label}`}
      onClick={onJump}
      onMouseEnter={(e) => reportHover(e.currentTarget)}
      onFocus={(e) => reportHover(e.currentTarget)}
    >
      <span
        className="cave-thread-map__bar"
        style={{ width: `${event.width}%`, height: isTurn ? 3 : 5 }}
        aria-hidden
      />
      {event.turnLabel ? (
        <span className="cave-thread-map__turn-label" aria-hidden>
          {event.turnLabel}
        </span>
      ) : null}
    </button>
  );
}

function MapHoverCard({
  event,
  index,
  count,
  y,
}: {
  event: ThreadMapEvent;
  index: number;
  count: number;
  y: number;
}) {
  const isTurn = event.kind === "turn" || event.kind === "answer";
  return (
    <span
      className={`cave-thread-map__card is-${event.kind}${event.error ? " is-error" : ""}`}
      style={{ top: Math.max(4, y - 4) }}
      aria-hidden
    >
      <span className="cave-thread-map__card-head">
        <span className="cave-thread-map__card-cat">
          {isTurn ? (event.kind === "turn" ? "turn start" : "answer") : event.kind}
        </span>
        <span className="cave-thread-map__card-idx">{`${index + 1} / ${count}`}</span>
      </span>
      <span className="cave-thread-map__card-label">{event.label}</span>
      <span className="cave-thread-map__card-rows">
        <span className="cave-thread-map__card-row">
          <span className="cave-thread-map__card-k">turn</span>
          <span className="cave-thread-map__card-v">{event.ownerName}</span>
        </span>
        {event.ownerTime ? (
          <span className="cave-thread-map__card-row">
            <span className="cave-thread-map__card-k">at</span>
            <span className="cave-thread-map__card-v">{event.ownerTime}</span>
          </span>
        ) : null}
        {event.took ? (
          <span className="cave-thread-map__card-row">
            <span className="cave-thread-map__card-k">took</span>
            <span className="cave-thread-map__card-v">{event.took}</span>
          </span>
        ) : null}
      </span>
      <span className="cave-thread-map__card-hint">click to jump</span>
    </span>
  );
}
