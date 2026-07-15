// Persistent describe→arrival state (docs/craft-ux.md F2, CP4). The create
// drawer's arrival polling used to live in component state, so following the
// chat it had just opened (workspace setMode("chat") unmounts the
// marketplace) silently killed the loop. The watch now persists in
// sessionStorage: the drawer writes it at dispatch, the Crafts tab and a
// reopened drawer resume it, and only arrival, "stop waiting", or staleness
// clears it.

export type CraftArrivalWatch = {
  /** Draft ids that existed at dispatch — arrival = any NEW id. */
  baselineIds: string[];
  /** ISO timestamp of the dispatch, for staleness. */
  dispatchedAt: string;
  /** The operator's goal, so a resumed drawer can re-show it. */
  goal: string;
  familiar?: string;
};

export const CRAFT_ARRIVAL_KEY = "cave:craft-create:awaiting";

/** Watches older than this are dropped silently — the familiar either
 *  finished long ago or never will; a day-old spinner helps no one. */
export const CRAFT_ARRIVAL_MAX_AGE_MS = 60 * 60 * 1000;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function readCraftArrivalWatch(
  storage: StorageLike | null = defaultStorage(),
  now = Date.now(),
): CraftArrivalWatch | null {
  if (!storage) return null;
  let raw: string | null = null;
  try {
    raw = storage.getItem(CRAFT_ARRIVAL_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<CraftArrivalWatch>;
    if (
      !Array.isArray(parsed.baselineIds)
      || !parsed.baselineIds.every((id) => typeof id === "string")
      || typeof parsed.dispatchedAt !== "string"
      || typeof parsed.goal !== "string"
    ) {
      storage.removeItem(CRAFT_ARRIVAL_KEY);
      return null;
    }
    const age = now - Date.parse(parsed.dispatchedAt);
    if (!Number.isFinite(age) || age < 0 || age > CRAFT_ARRIVAL_MAX_AGE_MS) {
      storage.removeItem(CRAFT_ARRIVAL_KEY);
      return null;
    }
    return {
      baselineIds: parsed.baselineIds,
      dispatchedAt: parsed.dispatchedAt,
      goal: parsed.goal,
      ...(typeof parsed.familiar === "string" && parsed.familiar ? { familiar: parsed.familiar } : {}),
    };
  } catch {
    try {
      storage.removeItem(CRAFT_ARRIVAL_KEY);
    } catch {
      // Unreadable and unremovable — treat as absent.
    }
    return null;
  }
}

export function writeCraftArrivalWatch(
  watch: CraftArrivalWatch,
  storage: StorageLike | null = defaultStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(CRAFT_ARRIVAL_KEY, JSON.stringify(watch));
  } catch {
    // Quota/private-mode failures degrade to drawer-lifetime polling.
  }
}

export function clearCraftArrivalWatch(storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(CRAFT_ARRIVAL_KEY);
  } catch {
    // Nothing to clean if storage refuses.
  }
}

/** The first draft id not present at dispatch time, or null. */
export function findArrivedDraftId(
  watch: CraftArrivalWatch,
  draftIds: readonly (string | undefined)[],
): string | null {
  const baseline = new Set(watch.baselineIds);
  for (const id of draftIds) {
    if (id && !baseline.has(id)) return id;
  }
  return null;
}
