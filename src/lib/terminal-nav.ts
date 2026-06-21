// Pure spatial + ordinal navigation over the comux pane tree. The terminal
// surface needs tmux-grade movement — focus the pane to the left/right/up/down,
// cycle through panes, and jump to pane N — without any of the rendering layer.
// Everything here is computed from `TerminalLayoutState` (the same tree the view
// renders) so it's deterministic and unit-testable with no DOM.

import {
  terminalLayoutVisibleSessionIds,
  type TerminalLayoutNode,
  type TerminalLayoutState,
} from "./terminal-layout.ts";

export type PaneRect = {
  sessionId: string;
  /** Percent-of-viewport geometry: x/y top-left, w/h extent (0–100). */
  x: number;
  y: number;
  w: number;
  h: number;
};

export type PaneDirection = "left" | "right" | "up" | "down";

/**
 * Lay the pane tree out into percentage rectangles, mirroring how the resizable
 * Group/Panel renderer splits space: a `horizontal` branch divides width by its
 * children's sizes, a `vertical` branch divides height. Sizes are treated as
 * weights (normalized), matching `equalize`/react-resizable-panels behavior.
 */
export function paneRects(state: TerminalLayoutState): PaneRect[] {
  const out: PaneRect[] = [];
  walk(state.root, 0, 0, 100, 100, out);
  return out;
}

function walk(
  node: TerminalLayoutNode | null,
  x: number,
  y: number,
  w: number,
  h: number,
  out: PaneRect[],
): void {
  if (!node) return;
  if (node.kind === "leaf") {
    out.push({ sessionId: node.sessionId, x, y, w, h });
    return;
  }
  const total = node.children.reduce((sum, c) => sum + (c.size > 0 ? c.size : 0), 0);
  const weight = total > 0 ? total : node.children.length || 1;
  let cursor = node.kind === "horizontal" ? x : y;
  for (const childEntry of node.children) {
    const fraction = (childEntry.size > 0 ? childEntry.size : 0) / weight;
    if (node.kind === "horizontal") {
      const cw = w * fraction;
      walk(childEntry.node, cursor, y, cw, h, out);
      cursor += cw;
    } else {
      const ch = h * fraction;
      walk(childEntry.node, x, cursor, w, ch, out);
      cursor += ch;
    }
  }
}

function centerX(r: PaneRect): number {
  return r.x + r.w / 2;
}
function centerY(r: PaneRect): number {
  return r.y + r.h / 2;
}

/** Do two 1-D intervals [aStart,aEnd] and [bStart,bEnd] overlap, and by how much. */
function overlap(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

/**
 * The nearest visible pane in `direction` from `fromSessionId`, or null when
 * there's nothing that way. A candidate must lie on the correct side (its near
 * edge is beyond the source's center along the axis); among those we prefer the
 * one that overlaps the source's cross-axis span the most (so moving "right"
 * from a tall pane lands on the pane sharing the most height), breaking ties by
 * the smallest axis gap, then by cross-axis center distance.
 */
export function directionalNeighbor(
  state: TerminalLayoutState,
  fromSessionId: string,
  direction: PaneDirection,
): string | null {
  const rects = paneRects(state);
  const from = rects.find((r) => r.sessionId === fromSessionId);
  if (!from) return null;

  type Scored = { id: string; gap: number; cross: number; ocross: number };
  const scored: Scored[] = [];

  for (const r of rects) {
    if (r.sessionId === fromSessionId) continue;
    let onSide = false;
    let gap = 0;
    let crossOverlap = 0;
    let crossDist = 0;

    if (direction === "left") {
      onSide = r.x + r.w <= from.x + 0.01 + from.w / 2 && centerX(r) < centerX(from);
      gap = from.x - (r.x + r.w);
      crossOverlap = overlap(r.y, r.y + r.h, from.y, from.y + from.h);
      crossDist = Math.abs(centerY(r) - centerY(from));
    } else if (direction === "right") {
      onSide = r.x >= from.x + from.w / 2 - 0.01 && centerX(r) > centerX(from);
      gap = r.x - (from.x + from.w);
      crossOverlap = overlap(r.y, r.y + r.h, from.y, from.y + from.h);
      crossDist = Math.abs(centerY(r) - centerY(from));
    } else if (direction === "up") {
      onSide = r.y + r.h <= from.y + 0.01 + from.h / 2 && centerY(r) < centerY(from);
      gap = from.y - (r.y + r.h);
      crossOverlap = overlap(r.x, r.x + r.w, from.x, from.x + from.w);
      crossDist = Math.abs(centerX(r) - centerX(from));
    } else {
      onSide = r.y >= from.y + from.h / 2 - 0.01 && centerY(r) > centerY(from);
      gap = r.y - (from.y + from.h);
      crossOverlap = overlap(r.x, r.x + r.w, from.x, from.x + from.w);
      crossDist = Math.abs(centerX(r) - centerX(from));
    }

    if (!onSide) continue;
    scored.push({ id: r.sessionId, gap: Math.max(0, gap), cross: crossDist, ocross: crossOverlap });
  }

  if (scored.length === 0) return null;
  scored.sort((a, b) => {
    if (b.ocross !== a.ocross) return b.ocross - a.ocross; // most cross-axis overlap wins
    if (a.gap !== b.gap) return a.gap - b.gap; // then the closest along the axis
    return a.cross - b.cross; // then the closest cross-axis center
  });
  return scored[0].id;
}

/**
 * The next/previous visible pane in document order, wrapping around. `delta` is
 * +1 (next) or -1 (prev). Returns null when there are no panes; returns the
 * same id when there's only one.
 */
export function cycleVisibleSession(
  state: TerminalLayoutState,
  fromSessionId: string | null,
  delta: number,
): string | null {
  const ids = terminalLayoutVisibleSessionIds(state);
  if (ids.length === 0) return null;
  const step = delta < 0 ? -1 : 1;
  const idx = fromSessionId ? ids.indexOf(fromSessionId) : -1;
  if (idx < 0) return step > 0 ? ids[0] : ids[ids.length - 1];
  const next = (idx + step + ids.length) % ids.length;
  return ids[next];
}

/** 1-based pane numbers in visible document order, for badges + quick-jump. */
export function paneNumberMap(state: TerminalLayoutState): Map<string, number> {
  const map = new Map<string, number>();
  terminalLayoutVisibleSessionIds(state).forEach((id, index) => map.set(id, index + 1));
  return map;
}

/** The visible session at 1-based pane number `n` (⌘1…⌘9 quick-jump), or null. */
export function sessionAtPaneNumber(state: TerminalLayoutState, n: number): string | null {
  if (!Number.isInteger(n) || n < 1) return null;
  return terminalLayoutVisibleSessionIds(state)[n - 1] ?? null;
}
