/**
 * Tell workspace-owned board consumers that a write completed outside
 * BoardView. This invalidates a warmed board snapshot before the user returns
 * to Tasks, and also lets a mounted board reconcile the change.
 */
export function publishBoardChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("cave:board:reload"));
  }
}

/** Notify the workspace cache that an external automation write completed. */
export function publishSchedulesChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("cave:schedules:reload"));
  }
}
