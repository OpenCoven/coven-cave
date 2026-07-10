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

export function isSplittablePage(mode: string): boolean {
  return workspacePageDefinition(mode) !== null;
}

export function emitPageDragStart(detail: PageDragDetail): void {
  window.dispatchEvent(new CustomEvent<PageDragDetail>(PAGE_DRAG_START, { detail }));
}

export function emitPageDragEnd(): void {
  window.dispatchEvent(new Event(PAGE_DRAG_END));
}
