"use client";

/**
 * use-deck-buckets — GitHub's own state for every pull request on the deck.
 *
 * The summary strip buckets each queue row, so it needs GitHub state for all of
 * them, not just the selected one. The full readiness fan-out is three requests
 * per pull request — far too many to spend across a queue against the
 * unauthenticated 60/hr budget. This hook reads one request each
 * (`/api/github/item?pull=1`), bounded by a cap and a small worker pool, the
 * same shape the activity route already uses for its CI enrichment.
 *
 * Rows past the cap, and rows still in flight, stay `unread` — the strip leaves
 * them out of its counts rather than guessing a bucket for a pull request it
 * has not read.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { PrBucketFacts } from "./review-readiness";

/** How many pull requests the deck reads state for. */
export const BUCKET_READ_CAP = 12;
/** Concurrent reads — enough to feel instant, few enough to be a polite client. */
const CONCURRENCY = 3;

export type DeckBuckets = {
  /** Keyed by "owner/repo#number". Absent means unread. */
  facts: ReadonlyMap<string, PrBucketFacts>;
  /** Pull requests the cap left unread — surfaced so the caption can say so. */
  skipped: number;
  loading: boolean;
};

export function prKey(pr: { repo: string; number: number }): string {
  return `${pr.repo}#${pr.number}`;
}

type ItemWire = {
  ok?: boolean;
  state?: string;
  draft?: boolean;
  merged?: boolean;
  isPull?: boolean;
  pull?: {
    baseRef?: string;
    mergeable?: boolean | null;
    mergeableState?: string;
    reviews?: { approved?: number; changesRequested?: number; commented?: number };
  } | null;
};

async function readFacts(pr: { repo: string; number: number }): Promise<PrBucketFacts | null> {
  try {
    const res = await fetch(
      `/api/github/item?repo=${encodeURIComponent(pr.repo)}&number=${encodeURIComponent(String(pr.number))}&pull=1`,
      { cache: "no-store" },
    );
    const json = (await res.json().catch(() => null)) as ItemWire | null;
    if (!json?.ok || !json.isPull) return null;
    const pull = json.pull ?? null;
    return {
      state: json.state ?? "open",
      draft: json.draft === true,
      merged: json.merged === true,
      baseRef: pull?.baseRef ?? "",
      mergeable: typeof pull?.mergeable === "boolean" ? pull.mergeable : null,
      mergeableState: pull?.mergeableState ?? "unknown",
      reviews: {
        approved: pull?.reviews?.approved ?? 0,
        changesRequested: pull?.reviews?.changesRequested ?? 0,
        commented: pull?.reviews?.commented ?? 0,
      },
    };
  } catch {
    return null;
  }
}

export function useDeckBuckets(pullRequests: ReadonlyArray<{ repo: string; number: number }>): DeckBuckets {
  const [facts, setFacts] = useState<ReadonlyMap<string, PrBucketFacts>>(() => new Map());
  const [loading, setLoading] = useState(false);
  // Reads are cached for the life of the surface: a queue that reshuffles must
  // not re-spend a request on a pull request whose state is already known.
  const cache = useRef(new Map<string, PrBucketFacts>());
  const inFlight = useRef(new Set<string>());

  const wanted = useMemo(
    () => pullRequests.slice(0, BUCKET_READ_CAP).map((pr) => ({ pr, key: prKey(pr) })),
    [pullRequests],
  );
  const signature = wanted.map((entry) => entry.key).join(",");

  useEffect(() => {
    let cancelled = false;
    const queue = wanted.filter((entry) => !cache.current.has(entry.key) && !inFlight.current.has(entry.key));
    if (queue.length === 0) return;
    for (const entry of queue) inFlight.current.add(entry.key);
    setLoading(true);

    let next = 0;
    const worker = async () => {
      for (;;) {
        const index = next;
        next += 1;
        if (index >= queue.length || cancelled) return;
        const entry = queue[index];
        const read = await readFacts(entry.pr);
        inFlight.current.delete(entry.key);
        if (cancelled || !read) continue;
        cache.current.set(entry.key, read);
        setFacts(new Map(cache.current));
      }
    };

    void Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker)).then(() => {
      if (!cancelled) setLoading(false);
    });

    return () => {
      cancelled = true;
      for (const entry of queue) inFlight.current.delete(entry.key);
    };
    // `signature` is the identity of the queue — the array itself is rebuilt
    // every render, and depending on it would restart the pool endlessly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  return useMemo(
    () => ({ facts, skipped: Math.max(0, pullRequests.length - BUCKET_READ_CAP), loading }),
    [facts, pullRequests.length, loading],
  );
}
