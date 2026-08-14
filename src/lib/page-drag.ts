/**
 * page-drag — the tiny protocol that lets a left-sidebar nav row be dragged
 * into the main area to open that page in a split. The drag *source* (a sidebar
 * row) and the drop *target* (the detail area) live in different Shell panels,
 * so they coordinate over window CustomEvents + a DataTransfer MIME type rather
 * than React props.
 */

import { workspacePageDefinition } from "./workspace-page-registry.ts";

/** DataTransfer type carried by a page drag (value = the page/mode id). */
export const PAGE_DRAG_MIME = "application/x-cave-page";

/** Fired on the window when a sidebar page-drag starts. */
export const PAGE_DRAG_START = "cave:page-drag-start";

/** Fired on the window when a page-drag ends (drop or cancel). */
export const PAGE_DRAG_END = "cave:page-drag-end";

export type PageDragDetail = {
  /** The workspace mode / page id being dragged. */
  mode: string;
  /** Human label for the drop hint ("Open {label} here"). */
  label: string;
};

/** Pages that should never be openable in a split (heavy/stateful surfaces, or
 *  modes that redirect out of the workspace — journal is a tab inside Memories).
 *  Role Surface rooms (`surface:<id>`) are excluded for the same reason they
 *  always were: they are per-familiar workspaces, not draggable pages.
 *
 *  cave-x6rw replaced this predicate with a bare registry lookup, which made
 *  every registered page splittable — including terminal, journal and every
 *  surface:* room. The registry gate is the right addition (only known pages
 *  can be dragged); it just is not a substitute for the exclusions, and the
 *  registry cannot express one today: its `split` field is "always" |
 *  "contextual", with no "none", and nothing reads it (see cave-ktvy0). */
const NON_SPLITTABLE = new Set(["terminal", "journal"]);

export function isSplittablePage(mode: string): boolean {
  if (NON_SPLITTABLE.has(mode) || mode.startsWith("surface:")) return false;
  return workspacePageDefinition(mode) !== null;
}

export function emitPageDragStart(detail: PageDragDetail): void {
  window.dispatchEvent(new CustomEvent<PageDragDetail>(PAGE_DRAG_START, { detail }));
}

export function emitPageDragEnd(): void {
  window.dispatchEvent(new Event(PAGE_DRAG_END));
}
