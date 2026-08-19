"use client";

import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_REVIEW_DIFF_PREFERENCES,
  parseReviewDiffPreferences,
  type ReviewDiffPreferences,
} from "./review-preferences";

const STORAGE_KEY = "cave:review-deck:diff-preferences";

export function useReviewPreferences() {
  const [preferences, setPreferences] = useState<ReviewDiffPreferences>(
    DEFAULT_REVIEW_DIFF_PREFERENCES,
  );

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw != null) {
        setPreferences(parseReviewDiffPreferences(JSON.parse(raw)));
      }
    } catch {
      setPreferences(DEFAULT_REVIEW_DIFF_PREFERENCES);
    }
  }, []);

  const patchPreferences = useCallback(
    (patch: Partial<ReviewDiffPreferences>) => {
      setPreferences((current) => {
        const next = parseReviewDiffPreferences({ ...current, ...patch });
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {
          // The active visit still owns the preference when storage is blocked.
        }
        return next;
      });
    },
    [],
  );

  return [preferences, patchPreferences] as const;
}
