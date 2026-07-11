/**
 * chat-split — the drag protocol + pure layout logic that lets a conversation
 * be dragged from the thread rail onto the chat surface and *snapped* into a
 * split pane (left / right / above / below).
 *
 * Mirrors the workspace page-drag idiom (`page-drag.ts` + DetailSplitHost):
 * the drag *source* (a thread-rail row) and the drop *target* (the chat area)
 * live in different components, so they coordinate over window CustomEvents +
 * a DataTransfer MIME type rather than React props. All geometry/layout math
 * lives here as pure functions so it is unit-testable without a DOM.
 */

/** DataTransfer type carried by a conversation drag (value = the session id). */
export const CHAT_SESSION_DRAG_MIME = "application/x-cave-chat-session";

/** Fired on the window when a thread-rail conversation drag starts. */
export const CHAT_SESSION_DRAG_START = "cave:chat-session-drag-start";

/** Fired on the window when a conversation drag ends (drop or cancel). */
export const CHAT_SESSION_DRAG_END = "cave:chat-session-drag-end";

export type ChatSessionDragDetail = {
  /** The conversation/session id being dragged. */
  sessionId: string;
  /** Human label for the drop hint ("Open {title} …"). */
  title: string;
};

export function emitChatSessionDragStart(detail: ChatSessionDragDetail): void {
  window.dispatchEvent(new CustomEvent<ChatSessionDragDetail>(CHAT_SESSION_DRAG_START, { detail }));
}

export function emitChatSessionDragEnd(): void {
  window.dispatchEvent(new Event(CHAT_SESSION_DRAG_END));
}

// ── Drop-zone geometry ───────────────────────────────────────────────────────

export type ChatDropZone = "left" | "right" | "top" | "bottom";

/** row = panes side by side · column = panes stacked. */
export type ChatSplitAxis = "row" | "column";

/**
 * Resolve which snap zone the pointer is in, by the *closest edge* of the
 * chat area — the "intelligent" part of the snap: the whole surface is live,
 * and the nearest edge wins. Ties break horizontal-first (left, then right)
 * because a side-by-side split is the common intent on a landscape surface.
 * Returns null when the point is outside the rect or the rect is degenerate.
 */
export function resolveChatDropZone(
  width: number,
  height: number,
  x: number,
  y: number,
): ChatDropZone | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > width || y > height) {
    return null;
  }
  const nx = x / width;
  const ny = y / height;
  const dist: Array<[ChatDropZone, number]> = [
    ["left", nx],
    ["right", 1 - nx],
    ["top", ny],
    ["bottom", 1 - ny],
  ];
  let best = dist[0]!;
  for (const entry of dist) if (entry[1] < best[1]) best = entry;
  return best[0];
}

/**
 * Where to draw the live snap preview for a zone, as percentages of the chat
 * area (0..100). Each zone highlights the half the dropped conversation will
 * occupy, so the drop reads exactly like the resulting split.
 */
export function chatDropPreviewRect(zone: ChatDropZone): {
  left: number;
  top: number;
  width: number;
  height: number;
} {
  switch (zone) {
    case "left":
      return { left: 0, top: 0, width: 50, height: 100 };
    case "right":
      return { left: 50, top: 0, width: 50, height: 100 };
    case "top":
      return { left: 0, top: 0, width: 100, height: 50 };
    case "bottom":
      return { left: 0, top: 50, width: 100, height: 50 };
  }
}

/** Human wording for the drop hint ("Open {title} {label}"). */
export function chatDropZoneLabel(zone: ChatDropZone): string {
  if (zone === "top") return "above";
  if (zone === "bottom") return "below";
  return zone;
}

// ── Split layout state ───────────────────────────────────────────────────────

/** Sentinel pane id for the live primary chat view. */
export const CHAT_SPLIT_PRIMARY = "primary";

/** Hard cap on visible chat panes (primary included) — mirrors workspace tiles. */
export const MAX_CHAT_SPLIT_PANES = 4;

export type ChatSplitLayout = {
  axis: ChatSplitAxis;
  /** Pane ids in layout order: CHAT_SPLIT_PRIMARY plus dropped session ids. */
  panes: string[];
};

export function emptyChatSplitLayout(): ChatSplitLayout {
  return { axis: "row", panes: [CHAT_SPLIT_PRIMARY] };
}

export function hasChatSplit(layout: ChatSplitLayout): boolean {
  return layout.panes.length > 1;
}

export function chatSplitAxisForZone(zone: ChatDropZone): ChatSplitAxis {
  return zone === "left" || zone === "right" ? "row" : "column";
}

/** The dropped-session pane ids, in layout order (primary excluded). */
export function chatSplitSessionIds(layout: ChatSplitLayout): string[] {
  return layout.panes.filter((id) => id !== CHAT_SPLIT_PRIMARY);
}

/**
 * Drop a conversation into the split at `zone`.
 *
 *  - left/top insert the pane at the start of the strip, right/bottom at the
 *    end — the pane lands exactly where the preview showed it.
 *  - A session already open in a pane is *moved* to the drop edge (dedupe),
 *    never duplicated.
 *  - The first split sets the axis from the zone; a later drop on the
 *    perpendicular orientation reorients the whole strip (one axis at a time —
 *    honest and predictable rather than a nested tiling tree).
 *  - At the MAX_CHAT_SPLIT_PANES cap, the endmost *secondary* pane on the far
 *    edge (furthest from the drop) is evicted to make room; the primary pane
 *    is never evicted.
 */
export function dropSessionIntoChatSplit(
  layout: ChatSplitLayout,
  sessionId: string,
  zone: ChatDropZone,
): ChatSplitLayout {
  const sid = sessionId.trim();
  if (!sid || sid === CHAT_SPLIT_PRIMARY) return layout;
  let panes = layout.panes.filter((id) => id !== sid);
  // The axis always follows the latest drop's orientation: the first split
  // sets it, and a perpendicular drop reorients the existing strip.
  const axis = chatSplitAxisForZone(zone);
  const atStart = zone === "left" || zone === "top";
  if (panes.length >= MAX_CHAT_SPLIT_PANES) {
    // Evict the endmost secondary pane on the opposite edge from the drop.
    const candidates = panes
      .map((id, index) => ({ id, index }))
      .filter((entry) => entry.id !== CHAT_SPLIT_PRIMARY);
    const evict = atStart ? candidates.at(-1) : candidates[0];
    if (!evict) return layout; // all-primary (impossible) — refuse rather than overflow
    panes = panes.filter((_, index) => index !== evict.index);
  }
  return { axis, panes: atStart ? [sid, ...panes] : [...panes, sid] };
}

/** Close one dropped pane. The primary sentinel cannot be removed. */
export function removeChatSplitPane(layout: ChatSplitLayout, sessionId: string): ChatSplitLayout {
  if (sessionId === CHAT_SPLIT_PRIMARY) return layout;
  const panes = layout.panes.filter((id) => id !== sessionId);
  if (panes.length === layout.panes.length) return layout;
  return { axis: layout.axis, panes };
}
