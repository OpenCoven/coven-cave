// Pure geometry + placement helpers for the Triage Canvas surface.
//
// The canvas is an infinite, freeform spatial board. Behind the draggable
// issue nodes sit vertical "triage bands" — one per card status, laid out
// left → right in workflow order (Inbox … Done). A card's status is decided
// by which band its horizontal center falls into, so dragging a card from one
// band to the next IS the triage gesture. Everything here is framework- and
// filesystem-free so it can be unit-tested in isolation (CodeQL/CI run these
// without a DOM or React Flow).

import type { CardStatus } from "@/lib/cave-board-types";

export type CanvasPosition = { x: number; y: number; width?: number; height?: number };
export type CanvasPositions = Record<string, CanvasPosition>;

// Triage flow, left → right. New work lands in Inbox and moves rightward as it
// is triaged toward Done. Order matters: band index is derived from this array.
export const CANVAS_BANDS: CardStatus[] = [
  "inbox",
  "backlog",
  "running",
  "review",
  "blocked",
  "done",
];

export const BAND_LABELS: Record<CardStatus, string> = {
  inbox: "Inbox",
  backlog: "Backlog",
  running: "Running",
  review: "Review",
  blocked: "Blocked",
  done: "Done",
};

// World-space (pre-zoom) dimensions, in px.
export const CANVAS_NODE_WIDTH = 264;
export const CANVAS_NODE_HEIGHT = 132;
export const BAND_WIDTH = 320;
// Top padding before the first auto-arranged row, leaving room for the band
// header label that floats at the top of each column.
export const ARRANGE_TOP = 88;
export const ARRANGE_GAP_Y = 20;

/** Left world-x of band `index` (bands are contiguous, no gap). */
export function bandLeft(index: number): number {
  return index * BAND_WIDTH;
}

/** Band index for a status, clamped to a valid band (defaults to Inbox). */
export function bandIndexForStatus(status: CardStatus): number {
  const i = CANVAS_BANDS.indexOf(status);
  return i === -1 ? 0 : i;
}

/**
 * Status whose band contains world-x `centerX`. Coordinates left of the first
 * band clamp to the first status; coordinates past the last band clamp to the
 * last — there is nowhere else for a card to land.
 */
export function bandForX(centerX: number): CardStatus {
  const idx = Math.floor(centerX / BAND_WIDTH);
  const clamped = Math.max(0, Math.min(CANVAS_BANDS.length - 1, idx));
  return CANVAS_BANDS[clamped];
}

/** Centered world-x for a node placed in band `index`. */
function nodeXForBand(index: number): number {
  return bandLeft(index) + (BAND_WIDTH - CANVAS_NODE_WIDTH) / 2;
}

/** World-y for the `row`-th card stacked in a band. */
function nodeYForRow(row: number): number {
  return ARRANGE_TOP + row * (CANVAS_NODE_HEIGHT + ARRANGE_GAP_Y);
}

type PlaceableCard = { id: string; status: CardStatus };

/**
 * Tidy grid layout: every card is dropped into its status band and stacked
 * vertically in array order. Used by the "Auto-arrange" action and as the
 * first-run layout. Returns a fresh position map for every card passed in.
 */
export function autoArrange(cards: PlaceableCard[]): CanvasPositions {
  const nextRow: Record<number, number> = {};
  const out: CanvasPositions = {};
  for (const card of cards) {
    const band = bandIndexForStatus(card.status);
    const row = nextRow[band] ?? 0;
    nextRow[band] = row + 1;
    out[card.id] = { x: nodeXForBand(band), y: nodeYForRow(row) };
  }
  return out;
}

/**
 * Resolve the position for every card: keep any saved position as-is, and
 * auto-place cards that have none (e.g. a card created on the Board since the
 * last canvas visit) into their status band, stacked below whatever is already
 * parked there so new arrivals never land on top of existing nodes.
 */
export function resolvePositions(
  cards: PlaceableCard[],
  saved: CanvasPositions,
): CanvasPositions {
  // Seed the per-band row counter from saved cards so auto-placed nodes append
  // below them. We count by the band each saved card *currently* belongs to.
  const byId = new Map(cards.map((c) => [c.id, c] as const));
  const nextRow: Record<number, number> = {};
  for (const id of Object.keys(saved)) {
    const card = byId.get(id);
    if (!card) continue;
    const band = bandIndexForStatus(card.status);
    nextRow[band] = (nextRow[band] ?? 0) + 1;
  }

  const out: CanvasPositions = {};
  for (const card of cards) {
    const existing = saved[card.id];
    if (existing && Number.isFinite(existing.x) && Number.isFinite(existing.y)) {
      out[card.id] = { x: existing.x, y: existing.y };
      continue;
    }
    const band = bandIndexForStatus(card.status);
    const row = nextRow[band] ?? 0;
    nextRow[band] = row + 1;
    out[card.id] = { x: nodeXForBand(band), y: nodeYForRow(row) };
  }
  return out;
}

/** Drop entries whose card no longer exists, keeping the saved map bounded. */
export function pruneOrphanPositions(
  positions: CanvasPositions,
  liveIds: Iterable<string>,
): CanvasPositions {
  const live = new Set(liveIds);
  const out: CanvasPositions = {};
  for (const [id, pos] of Object.entries(positions)) {
    if (live.has(id)) out[id] = pos;
  }
  return out;
}
