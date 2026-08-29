/**
 * global-search-request — the relocation bridge from collection search
 * shortcuts to the one global search surface (cave-ychtl.6).
 *
 * The spec relocates, it does not remove: chat/sidebar search shortcuts focus
 * global search with type:chat plus the applicable context chips, tasks with
 * type:task, project files with type:file and the current project scope, and
 * familiar collection search with type:familiar. A control that only narrows
 * an already-rendered collection may stay, but it uses the canonical
 * `Filter <items>…` copy and does not claim global scope.
 *
 * This module is the seam between the two: a named DOM event any nested
 * surface can dispatch (it must not import the palette), and workspace-level
 * code listens for. The detail is a tiny, pure shape so tests can assert the
 * contract without a browser.
 */

/** DOM event name. Workspace listens; chat/tasks/files/familiars surfaces dispatch. */
export const GLOBAL_SEARCH_REQUEST_EVENT = "cave:global-search-request";

export type GlobalSearchRequest = {
  /**
   * The query the surface wants global search to start with, e.g. `type:chat`
   * or `type:file project:"psyche-build"`. Plain text is valid too — the
   * palette parses whatever arrives.
   */
  query: string;
};

/** Build the event detail. Pure, so it is testable without a DOM. */
export function globalSearchRequestDetail(query: string): GlobalSearchRequest {
  return { query };
}

/**
 * Read the query out of an unknown event detail (anything off a CustomEvent).
 * Returns null when the detail is not a well-formed request, so a listener can
 * ignore foreign events on the same channel without guessing.
 */
export function globalSearchRequestFromDetail(detail: unknown): string | null {
  if (typeof detail !== "object" || detail === null) return null;
  const query = (detail as { query?: unknown }).query;
  return typeof query === "string" && query.trim().length > 0 ? query : null;
}

/**
 * Ask global search to open with a preset query. Thin DOM wrapper; surfaces
 * that cannot reach the workspace's state directly use this.
 */
export function requestGlobalSearch(query: string): void {
  const detail = globalSearchRequestDetail(query);
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<GlobalSearchRequest>(GLOBAL_SEARCH_REQUEST_EVENT, { detail }));
}
