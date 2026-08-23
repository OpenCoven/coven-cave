"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  nextUnreadReviewPath,
  parseReviewProgress,
  serializeReviewProgress,
} from "./review-progress";

function readStored(key: string): unknown {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw == null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Keep the in-memory progress when storage is unavailable.
  }
}

export function useReviewProgress(input: {
  familiarId: string;
  sourceId: string | null;
  revision: string | null;
  readablePaths: readonly string[];
}) {
  const { familiarId, sourceId, revision, readablePaths } = input;
  const storageKey = sourceId
    ? `cave:review-progress:${familiarId}:${sourceId}`
    : null;
  const [reviewed, setReviewed] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const reviewedRef = useRef(reviewed);
  reviewedRef.current = reviewed;
  const pathsKey = readablePaths.join("\0");

  useEffect(() => {
    if (!storageKey || !revision) {
      const empty = new Set<string>();
      reviewedRef.current = empty;
      setReviewed(empty);
      return;
    }
    const next = parseReviewProgress(
      readStored(storageKey),
      revision,
      readablePaths,
    );
    reviewedRef.current = next;
    setReviewed(next);
    // `pathsKey` is the stable identity of the readable file set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, revision, pathsKey]);

  const persist = useCallback(
    (next: ReadonlySet<string>) => {
      if (!storageKey || !revision) return;
      writeStored(storageKey, serializeReviewProgress(revision, next));
    },
    [revision, storageKey],
  );

  const toggle = useCallback(
    (path: string) => {
      if (!readablePaths.includes(path)) {
        return { reviewed: false, completed: false };
      }
      const next = new Set(reviewedRef.current);
      const nowReviewed = !next.has(path);
      if (nowReviewed) next.add(path);
      else next.delete(path);
      reviewedRef.current = next;
      setReviewed(next);
      persist(next);
      return {
        reviewed: nowReviewed,
        completed:
          nowReviewed &&
          readablePaths.length > 0 &&
          next.size === readablePaths.length,
      };
    },
    [persist, readablePaths],
  );

  return useMemo(
    () => ({
      reviewed,
      reviewedCount: reviewed.size,
      readableCount: readablePaths.length,
      complete:
        readablePaths.length > 0 && reviewed.size === readablePaths.length,
      toggle,
      nextUnread: (current: string | null, direction: 1 | -1) =>
        nextUnreadReviewPath(
          readablePaths,
          reviewedRef.current,
          current,
          direction,
        ),
    }),
    [readablePaths, reviewed, toggle],
  );
}
