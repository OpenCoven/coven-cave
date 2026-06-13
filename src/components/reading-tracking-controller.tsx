"use client";

import { useEffect } from "react";
import {
  READING_TRACKING_KEY,
  applyReadingTracking,
  readReadingTracking,
} from "@/lib/reading-tracking";

/**
 * Applies the saved reading letter-spacing on load and keeps it in sync across
 * tabs. Mounted in the root layout (mirrors ReadingLeadingController) so the
 * `--cave-reading-tracking` var is set on cold load — reading surfaces (chat,
 * library, memory) render outside Settings, so the picker's own mount effect
 * isn't enough.
 */
export function ReadingTrackingController() {
  useEffect(() => {
    applyReadingTracking(readReadingTracking());

    const onStorage = (event: StorageEvent) => {
      if (event.key !== READING_TRACKING_KEY) return;
      applyReadingTracking(readReadingTracking());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return null;
}
