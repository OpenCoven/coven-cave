/**
 * Registry of in-surface navigation levels (cave nav-history phase 1).
 *
 * The Workspace tracks two levels itself: the mode, and — inside Chat — the
 * session id. Everything below that is a tab strip or section picker owned by
 * the surface component, which the Workspace cannot reach through props
 * without threading state through every surface it renders.
 *
 * So surfaces register their level here instead. `useSurfaceHistory` does the
 * registration; the Workspace only asks "can anything deeper move?" and
 * "move the deepest thing that can". Deeper levels win, so Back steps up one
 * level at a time: session → scope → mode.
 */

export type SurfaceHistoryLevel = {
  id: string;
  /** Larger is deeper. Traversal tries the deepest movable level first. */
  depth: number;
  canMove: (direction: -1 | 1) => boolean;
  move: (direction: -1 | 1) => boolean;
};

/**
 * The Workspace's own chat-session stack, named here so a surface can gate it.
 *
 * The session level is deeper than the chat scope strip only while the strip is
 * showing the conversation. On Projects or Familiar there is no visible session
 * to step back through, so traversing it there would swallow the Back press and
 * leave the strip where it was.
 */
export const CHAT_SESSION_LEVEL = "chat:session";

const levels = new Map<string, SurfaceHistoryLevel>();
const gates = new Map<string, () => boolean>();
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

/** Register a level. Returns the unregister function for effect cleanup. */
export function registerSurfaceHistoryLevel(level: SurfaceHistoryLevel): () => void {
  levels.set(level.id, level);
  notify();
  return () => {
    // Only drop it if it is still ours — a remount can register the
    // replacement before the previous effect's cleanup runs.
    if (levels.get(level.id) === level) {
      levels.delete(level.id);
      notify();
    }
  };
}

/** Levels deepest-first. */
function ordered(): SurfaceHistoryLevel[] {
  return [...levels.values()].sort((a, b) => b.depth - a.depth);
}

export function canMoveSurfaceHistory(direction: -1 | 1): boolean {
  return ordered().some((level) => level.canMove(direction));
}

/** Move the deepest level that can move. Returns false if none could. */
export function moveSurfaceHistory(direction: -1 | 1): boolean {
  for (const level of ordered()) {
    if (level.canMove(direction) && level.move(direction)) {
      // A traversal changes what Back and Forward can reach next, and the
      // shell disables both buttons off those flags. Without this the Forward
      // button stays dead after the first Back.
      notify();
      return true;
    }
  }
  return false;
}

/**
 * Gate a level the Workspace owns on state only a surface knows.
 *
 * Returns the unregister function for effect cleanup. A level with no gate is
 * always reachable.
 */
export function registerSurfaceHistoryGate(id: string, isOpen: () => boolean): () => void {
  gates.set(id, isOpen);
  notify();
  return () => {
    if (gates.get(id) === isOpen) {
      gates.delete(id);
      notify();
    }
  };
}

export function surfaceHistoryGateOpen(id: string): boolean {
  const gate = gates.get(id);
  return gate ? gate() : true;
}

/** Subscribe to registration changes so derived can-go-back state re-renders. */
export function subscribeSurfaceHistory(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** A level's stack changed shape without registering or unregistering. */
export function notifySurfaceHistoryChanged() {
  notify();
}

/** Test seam — drops every registration. */
export function resetSurfaceHistoryForTest() {
  levels.clear();
  gates.clear();
  notify();
}
