"use client";

import { useEffect } from "react";
import {
  READING_ALIGN_KEY,
  applyReadingAlign,
  readReadingAlign,
} from "@/lib/reading-align";

/**
 * Applies the saved reading text-alignment on load and keeps it in sync across
 * tabs. Mounted in the root layout (mirrors ReadingTrackingController) so the
 * `--cave-reading-align` var is set on cold load — reading surfaces (chat,
 * memory) render outside Settings, so the picker's own mount effect
 * isn't enough.
 */
export function ReadingAlignController() {
  useEffect(() => {
    applyReadingAlign(readReadingAlign(), { persist: false });

    const onStorage = (event: StorageEvent) => {
      if (event.key !== READING_ALIGN_KEY) return;
      applyReadingAlign(readReadingAlign(), { persist: false });
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return null;
}
