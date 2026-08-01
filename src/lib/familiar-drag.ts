/**
 * familiar-drag — the protocol that lets a familiar be dragged out of the rail's
 * switcher popover and dropped into a chat thread, turning that solo session
 * into a coven.
 *
 * Same shape as `page-drag` and for the same reason: the drag *source* (the
 * familiar switcher, in the shell's nav rail) and the drop *target* (the chat
 * transcript) live in different panels, so they coordinate over window
 * CustomEvents plus a DataTransfer MIME rather than React props.
 *
 * This is a second affordance, never the only one — the participants cluster's
 * `+` remains the primary, keyboard-reachable path to the same outcome
 * (cave-9xadi). Drag is a shortcut for people already holding a mouse.
 */

/** DataTransfer type carried by a familiar drag (value = the familiar id). */
export const FAMILIAR_DRAG_MIME = "application/x-cave-familiar";

/** Fired on the window when a familiar drag starts. */
export const FAMILIAR_DRAG_START = "cave:familiar-drag-start";

/** Fired on the window when a familiar drag ends (drop or cancel). */
export const FAMILIAR_DRAG_END = "cave:familiar-drag-end";

export type FamiliarDragDetail = {
  /** The familiar being dragged. */
  id: string;
  /** Display name, for the drop hint ("Add {name} to this chat"). */
  name: string;
};

export function emitFamiliarDragStart(detail: FamiliarDragDetail): void {
  window.dispatchEvent(new CustomEvent<FamiliarDragDetail>(FAMILIAR_DRAG_START, { detail }));
}

export function emitFamiliarDragEnd(): void {
  window.dispatchEvent(new Event(FAMILIAR_DRAG_END));
}

/**
 * Read the dragged familiar id out of a DataTransfer.
 *
 * `getData` is only readable on `drop` in most browsers — during `dragover` the
 * payload is protected and reads back empty — so callers must gate the drop
 * zone on the *event* (which carries the id) rather than on the transfer, and
 * use this only to confirm at drop time.
 */
export function readFamiliarDrag(transfer: Pick<DataTransfer, "getData">): string | null {
  const id = transfer.getData(FAMILIAR_DRAG_MIME);
  return id ? id : null;
}

/**
 * Whether a dragged familiar may be dropped into this thread.
 *
 * Mirrors `addableFamiliars` — the rule the `+` already enforces — so the two
 * affordances can never disagree about who is addable. The host cannot be
 * added to their own thread, and an id that is not a known familiar is not a
 * drop target at all.
 */
export function canDropFamiliar(input: {
  draggedId: string | null;
  hostId: string;
  addableIds: readonly string[];
}): boolean {
  const { draggedId, hostId, addableIds } = input;
  if (!draggedId || draggedId === hostId) return false;
  return addableIds.includes(draggedId);
}
