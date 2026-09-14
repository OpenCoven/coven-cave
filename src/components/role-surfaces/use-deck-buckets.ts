"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { createDeckBucketStore, type DeckBucketSnapshot } from "./review-deck-store";

export { BUCKET_READ_CAP } from "./review-deck-store";
export { prKey } from "./review-deck";

export type DeckBuckets = DeckBucketSnapshot &
  Pick<ReturnType<typeof createDeckBucketStore>, "refresh" | "recordFacts">;

export function useDeckBuckets(pullRequests: ReadonlyArray<{ repo: string; number: number }>): DeckBuckets {
  const [store] = useState(() => createDeckBucketStore());
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  // Reordering duplicate sessions must not re-spend reads or restart a pool.
  const signature = JSON.stringify(pullRequests);
  useEffect(() => {
    store.setPullRequests(pullRequests);
    return store.cancel;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, signature]);
  return { ...snapshot, refresh: store.refresh, recordFacts: store.recordFacts };
}
