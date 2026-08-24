"use client";

/**
 * Remembers whether the composer's follow-up row is collapsed.
 *
 * The row is the largest reclaimable block in the composer — measured on a
 * production build it is 53px of a 211px panel — and unlike the rest of the
 * stack it cannot be shrunk by spacing. Its pills carry
 * `min-height: var(--touch-target)`, and `chat-follow-up-layout.test.ts` pins
 * that declaration with the message "composer follow-up pills stay touch-safe",
 * so trimming them would break a test written to prevent exactly that. Letting
 * the reader put the row away is the only way to get the height back without
 * spending a tap target.
 *
 * ## Why the initial render is always expanded
 *
 * `useState` starts from the default and the stored value is applied in an
 * effect, rather than reading localStorage during render. Reading storage in
 * the initial state would make the server-rendered markup and the first client
 * render disagree whenever the preference is set, which is a hydration
 * mismatch. The perf overlay resolves its `?perf=1` gate the same way and says
 * so. The cost is one frame of expanded row for readers who collapsed it; the
 * alternative is a React hydration error on a surface that renders on every
 * chat.
 */

import { useCallback, useEffect, useState } from "react";

/** `cave:`-prefixed, matching every other client preference key in the app. */
export const FOLLOWUPS_COLLAPSED_KEY = "cave:chat:followups-collapsed";

export type FollowUpsCollapsed = {
  collapsed: boolean;
  toggle: () => void;
};

export function useFollowUpsCollapsed(): FollowUpsCollapsed {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(FOLLOWUPS_COLLAPSED_KEY) === "1");
    } catch {
      // Storage can throw on access alone under some privacy settings. The
      // default (expanded) is the safe side to fail to: it shows the reader
      // their suggestions rather than hiding them.
    }
  }, []);

  const toggle = useCallback(() => {
    setCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(FOLLOWUPS_COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        // A preference that cannot be persisted still applies for this session.
      }
      return next;
    });
  }, []);

  return { collapsed, toggle };
}
