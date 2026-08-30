"use client";

import "@/styles/cave-chat/thread-instruments.css";

// ── Chat turn spine (Chat.dc.html 2a, cave-j86la) ────────────────────────────
// ChatThreadSpine — the transcript's LEFT gutter wears one node per turn
// (operator or familiar), each with that turn's tool calls rolled into a
// proportional category stack. Click a node to jump the pane to that turn.
//
// A second instrument, ChatThreadMinimap, used to live here on the right edge:
// one bar per event, a caret tracking the reading position, ↑/↓ stepping. It is
// permanently removed (cave-5m5hv) — the Design run rail
// (`components/chat-run-rail.tsx`) is the right-side instrument now, it is
// automatic rather than preference-gated, and there is no toggle, flag or
// stored key left that can bring the minimap back. The spine survives the
// replacement because it never competed with the rail: it annotates the left
// gutter, which the rail does not occupy.
//
// The spine derives everything from the SAME Turn[] the transcript renders (the
// pure model in src/lib/chat-thread-instruments.ts) — no fetches — and lives in
// the transcript's existing left gutter as an overlay, so it adds no layout
// shift and simply stays home on panes too narrow to have gutters.

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { Icon } from "@/lib/icon";
import { useUserProfile, userDisplayName } from "@/lib/user-profile";
import type { Turn } from "@/lib/chat-turn-state";
import {
  spineSegmentHeights,
  spineNodes,
  spineStackHeight,
  type SpineNode,
} from "@/lib/chat-thread-instruments";

/** The spine needs a real side gutter: the reading column is ~860px and the
 *  spine wants 64px beside it, so anything narrower than this keeps the
 *  transcript clean. */
export const THREAD_INSTRUMENTS_MIN_WIDTH = 1360;
/** The spine reads as an instrument, not a decoration, from a few turns up. */
const SPINE_MIN_TURNS = 2;
// Floor for the stamp lane, in characters: the 24-hour "23:00" every locale
// falls back to. Keeps the gutter from collapsing on a thread whose stamps are
// all missing, which would put the ring back where the clock belongs.
const SPINE_STAMP_MIN_CHARS = 5;

type ScrollerRef = React.RefObject<HTMLDivElement | null>;

/** Observe the scroller's content-box width so the spine's wide-pane gate
 *  tracks the reading column it hangs beside. */
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

