/**
 * Thread-signal review-queue dismissals ("acknowledge") — pure helpers only.
 *
 * Review-queue items are derived aggregates, not stored rows, so a dismissal
 * is keyed by the signal's stable identity (kind + title; details drift with
 * frequencies) and persisted per familiar in localStorage. Storage is
 * injected (see {@link DismissStorage}, same contract as chat-archive-nudge)
 * so this module stays trivially testable in node.
 *
 * The UI pairs these with use-undo-delete: dismissing schedules the persist
 * behind a 4s undo toast; committing calls {@link addSignalDismissal}.
 */

import type { ThreadSignalReviewItem } from "@/lib/thread-self-report";

export type DismissStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** dismissed identity → ISO time of dismissal. */
export type SignalDismissalMap = Record<string, string>;

/** Newest-first cap so an old install can't grow the map without bound. */
export const SIGNAL_DISMISSAL_CAP = 100;

export function signalDismissalKey(familiarId: string): string {
  return `cave:thread-signals:dismissed:${familiarId}`;
}

/** Stable identity for a derived review item — kind + upstream sourceId
 *  (blocker id / skill id / capability name), never the display title:
 *  titles aren't enforced unique, and a collision would dismiss strangers. */
export function signalIdentity(item: Pick<ThreadSignalReviewItem, "kind" | "sourceId">): string {
  return `${item.kind}:${item.sourceId}`;
}

export function loadSignalDismissals(
  familiarId: string,
  storage: DismissStorage | null | undefined,
): SignalDismissalMap {
  if (!storage) return {};
  try {
    const raw = storage.getItem(signalDismissalKey(familiarId));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    // Null prototype: stored keys are attacker-ish input ("__proto__" et al.
    // must stay plain data); invalid timestamps would NaN-poison pruning.
    const map: SignalDismissalMap = Object.create(null) as SignalDismissalMap;
    for (const [identity, dismissedAt] of Object.entries(parsed)) {
      if (typeof dismissedAt !== "string" || !Number.isFinite(Date.parse(dismissedAt))) continue;
      map[identity] = dismissedAt;
    }
    return map;
  } catch {
    return {};
  }
}

function persist(
  familiarId: string,
  storage: DismissStorage | null | undefined,
  map: SignalDismissalMap,
): void {
  if (!storage) return;
  try {
    if (Object.keys(map).length === 0) storage.removeItem(signalDismissalKey(familiarId));
    else storage.setItem(signalDismissalKey(familiarId), JSON.stringify(map));
  } catch {
    /* swallow — storage may be unavailable (private mode, quota) */
  }
}

/** Cap the map at {@link SIGNAL_DISMISSAL_CAP}, dropping the oldest entries. */
export function pruneSignalDismissals(map: SignalDismissalMap): SignalDismissalMap {
  const entries = Object.entries(map);
  if (entries.length <= SIGNAL_DISMISSAL_CAP) return map;
  entries.sort((a, b) => new Date(b[1]).getTime() - new Date(a[1]).getTime());
  return Object.fromEntries(entries.slice(0, SIGNAL_DISMISSAL_CAP));
}

/** Persist one dismissal; returns the updated map. */
export function addSignalDismissal(
  familiarId: string,
  item: Pick<ThreadSignalReviewItem, "kind" | "sourceId">,
  storage: DismissStorage | null | undefined,
  now: number = Date.now(),
): SignalDismissalMap {
  const next = pruneSignalDismissals({
    ...loadSignalDismissals(familiarId, storage),
    [signalIdentity(item)]: new Date(now).toISOString(),
  });
  persist(familiarId, storage, next);
  return next;
}

/** Clear every dismissal for a familiar (the "restore" affordance); returns {}. */
export function clearSignalDismissals(
  familiarId: string,
  storage: DismissStorage | null | undefined,
): SignalDismissalMap {
  persist(familiarId, storage, {});
  return {};
}

/** Split a review queue into visible and dismissed halves. */
export function partitionDismissedSignals<T extends Pick<ThreadSignalReviewItem, "kind" | "sourceId">>(
  items: T[],
  dismissals: SignalDismissalMap,
): { visible: T[]; dismissed: T[] } {
  const visible: T[] = [];
  const dismissed: T[] = [];
  for (const item of items) {
    (dismissals[signalIdentity(item)] ? dismissed : visible).push(item);
  }
  return { visible, dismissed };
}
