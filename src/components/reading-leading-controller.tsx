"use client";

import { useEffect } from "react";
import {
  READING_LEADING_KEY,
  applyReadingLeading,
  readReadingLeading,
} from "@/lib/reading-leading";

/**
 * Applies the saved reading line-spacing on load and keeps it in sync across
 * tabs. Mounted in the root layout (mirrors ScreenMagnificationController) so
 * the `--cave-reading-leading` var is set on cold load — reading surfaces
 * (chat, library, memory) render outside Settings, so the picker's own mount
 * effect isn't enough.
 */
export function ReadingLeadingController() {
  useEffect(() => {
    applyReadingLeading(readReadingLeading());

    const onStorage = (event: StorageEvent) => {
      if (event.key !== READING_LEADING_KEY) return;
      applyReadingLeading(readReadingLeading());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return null;
}
