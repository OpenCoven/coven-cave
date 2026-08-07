/**
 * Chronological journal of in-surface navigation (cave nav-history).
 *
 * The Workspace tracks two levels itself: the mode, and — inside Chat — the
 * session id. Everything below that is a tab strip, section picker, filter, or
 * overlay owned by a surface component, which the Workspace cannot reach
 * through props without threading state through every surface it renders.
 *
 * Surfaces register their level here instead, and every recorded move lands in
 * ONE ordered journal rather than a stack per level. That ordering is the whole
 * point: with a stack per level, "filter, then switch tab, then Back" undoes
 * whichever level the traversal happened to consult first, which is not what
 * the user did last. The journal always steps back the most recent move.
 *
 * A level that unmounts drops its entries. Leaving Chat therefore does not
 * leave Back trying to restore a tab strip that is no longer on screen — the
 * press falls through to the Workspace's mode history, which is correct.
 */

/**
 * The Workspace's own chat-session stack, named here so a surface can gate it.
 *
 * The session level is deeper than the chat scope strip only while the strip is
 * showing the conversation. On Projects or Familiar there is no visible session
 * to step back through, so traversing it there would swallow the Back press and
 * leave the strip where it was.
 */
export const CHAT_SESSION_LEVEL = "chat:session";

export type SurfaceHistoryLevel = {
  id: string;
  /** Restore a value. Must not record — this is a traversal, not a move. */
  apply: (value: unknown) => void;
};

type Transition = { levelId: string; prev: unknown; next: unknown; at: number };

const levels = new Map<string, SurfaceHistoryLevel>();
const gates = new Map<string, () => boolean>();
const listeners = new Set<() => void>();

let journal: Transition[] = [];
/** Number of applied transitions; journal[cursor - 1] is the most recent. */
let cursor = 0;
/** Monotonic stamp for coalescing. Not wall-clock — only differences matter. */
let clock = 0;

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
    if (levels.get(level.id) !== level) return;
    levels.delete(level.id);
    // The surface is gone, so its entries can no longer be restored. Drop them
    // and pull the cursor back past any that were already applied.
    let removedBeforeCursor = 0;
    const kept: Transition[] = [];
    journal.forEach((entry, index) => {
      if (entry.levelId !== level.id) {
        kept.push(entry);
        return;
      }
      if (index < cursor) removedBeforeCursor += 1;
    });
    journal = kept;
    cursor -= removedBeforeCursor;
    notify();
  };
}

/**
 * Record a user-initiated move.
 *
 * `coalesceMs` collapses a burst on the same level into one entry, so dragging
 * through four filter chips does not cost four Back presses. Zero disables it,
 * which is what every tab strip wants.
 */
export function recordSurfaceHistory(
  levelId: string,
  prev: unknown,
  next: unknown,
  coalesceMs = 0,
) {
  if (Object.is(prev, next)) return;
  clock += 1;
  const last = cursor > 0 ? journal[cursor - 1] : null;
  if (
    last &&
    coalesceMs > 0 &&
    last.levelId === levelId &&
    cursor === journal.length &&
    clock - last.at <= coalesceMs
  ) {
    // Extend the existing entry rather than adding one. Its `prev` still points
    // at where the burst started, which is where Back should land.
    last.next = next;
    last.at = clock;
    notify();
    return;
  }
  journal = journal.slice(0, cursor);
  journal.push({ levelId, prev, next, at: clock });
  cursor = journal.length;
  notify();
}

export function canMoveSurfaceHistory(direction: -1 | 1): boolean {
  return direction === -1 ? cursor > 0 : cursor < journal.length;
}

/** Step one recorded move. Returns false when there is nothing left. */
export function moveSurfaceHistory(direction: -1 | 1): boolean {
  if (!canMoveSurfaceHistory(direction)) return false;
  const entry = direction === -1 ? journal[cursor - 1] : journal[cursor];
  const level = levels.get(entry.levelId);
  if (!level) {
    // Should not happen — unregistering drops entries — but never strand the
    // cursor on an entry nothing can apply.
    cursor += direction;
    notify();
    return moveSurfaceHistory(direction);
  }
  level.apply(direction === -1 ? entry.prev : entry.next);
  cursor += direction;
  notify();
  return true;
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

/** Subscribe to journal and registration changes so derived flags re-render. */
export function subscribeSurfaceHistory(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test seam — drops every registration and the journal. */
export function resetSurfaceHistoryForTest() {
  levels.clear();
  gates.clear();
  journal = [];
  cursor = 0;
  clock = 0;
  notify();
}

/** Test seam — the recorded moves, oldest first, and the cursor. */
export function surfaceHistoryJournalForTest() {
  return { entries: journal.map((e) => ({ ...e })), cursor };
}
