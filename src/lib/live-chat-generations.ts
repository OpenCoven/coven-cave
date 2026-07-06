/**
 * Module-scope registry for in-flight chat generations.
 *
 * A chat generation is CLIENT-OWNED: the ChatView instance that sent the
 * prompt holds the SSE reader loop for /api/chat/send in a closure. This
 * registry is what lets that stream outlive the component: switching threads
 * or navigating to another surface unmounts (or re-targets) the view, while
 * the orphaned closure keeps consuming chunks and accumulating them HERE —
 * never through the unmounted instance's setState, which React silently
 * drops (cave-0er). The view that next mounts on the session adopts the
 * snapshot and mirrors subsequent updates via `subscribe`.
 *
 * Generic over the turn shape so the accumulation/notification rules can be
 * unit-tested without React or ChatView's Turn type; the caller supplies the
 * turn-clone function used to isolate snapshots from component-state mutation.
 * The staleness rule for adopting a snapshot lives in
 * @/lib/live-chat-snapshot (isLiveSnapshotActive).
 */

export type LiveGenerationSnapshot<T> = {
  sessionId: string;
  turns: T[];
  activeLeafId: string;
  controller: AbortController;
  updatedAt: number;
};

export type LiveGenerationListener<T> = (snapshot: LiveGenerationSnapshot<T> | null) => void;

export type LiveGenerationRegistry<T> = {
  read(sessionId: string): LiveGenerationSnapshot<T> | null;
  /** Store a snapshot (turns are defensively cloned). Returns the stored
   *  snapshot — the same object listeners receive — so a caller can mirror
   *  it into component state without triggering a second render when its
   *  own notification arrives. */
  record(snapshot: LiveGenerationSnapshot<T>): LiveGenerationSnapshot<T>;
  /** Apply `updater` to the session's snapshot turns and stamp `updatedAt`.
   *  Returns the stored snapshot, or null when the stream already settled /
   *  the snapshot was evicted. */
  advance(
    sessionId: string,
    updater: (prev: T[]) => T[],
    nextActiveLeafId: string,
  ): LiveGenerationSnapshot<T> | null;
  clear(sessionId: string | null | undefined): void;
  /** Listen for snapshot updates (record/advance) and settle (clear → null).
   *  Notifications are delivered on a microtask. Returns an unsubscriber. */
  subscribe(sessionId: string, listener: LiveGenerationListener<T>): () => void;
};

export function createLiveGenerationRegistry<T>(cloneTurn: (turn: T) => T): LiveGenerationRegistry<T> {
  const snapshots = new Map<string, LiveGenerationSnapshot<T>>();
  const listeners = new Map<string, Set<LiveGenerationListener<T>>>();

  function notify(sessionId: string, snapshot: LiveGenerationSnapshot<T> | null) {
    const set = listeners.get(sessionId);
    if (!set?.size) return;
    for (const listener of set) listener(snapshot);
  }

  function record(snapshot: LiveGenerationSnapshot<T>): LiveGenerationSnapshot<T> {
    const next = {
      ...snapshot,
      turns: snapshot.turns.map(cloneTurn),
    };
    snapshots.set(snapshot.sessionId, next);
    queueMicrotask(() => notify(snapshot.sessionId, next));
    return next;
  }

  return {
    read(sessionId) {
      return snapshots.get(sessionId) ?? null;
    },
    record,
    advance(sessionId, updater, nextActiveLeafId) {
      const snap = snapshots.get(sessionId);
      if (!snap) return null; // stream already settled / snapshot evicted
      return record({
        ...snap,
        turns: updater(snap.turns),
        activeLeafId: nextActiveLeafId,
        updatedAt: Date.now(),
      });
    },
    clear(sessionId) {
      if (!sessionId) return;
      // Notify even when the entry was already evicted (e.g. a remounted
      // view expired a quiet snapshot while the orphaned stream kept
      // running): the settle signal is what tells adopters to reconcile
      // from disk, and it must fire exactly once per clear call.
      snapshots.delete(sessionId);
      queueMicrotask(() => notify(sessionId, null));
    },
    subscribe(sessionId, listener) {
      const set = listeners.get(sessionId) ?? new Set<LiveGenerationListener<T>>();
      set.add(listener);
      listeners.set(sessionId, set);
      return () => {
        set.delete(listener);
        if (set.size === 0) listeners.delete(sessionId);
      };
    },
  };
}
