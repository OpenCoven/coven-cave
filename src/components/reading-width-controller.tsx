"use client";

import { useEffect } from "react";
import {
  READING_WIDTH_KEY,
  applyReadingWidth,
  readReadingWidth,
} from "@/lib/reading-width";

/**
 * Applies the saved max reading width on load and keeps it in sync across tabs.
 * Mounted in the root layout (mirrors ReadingAlignController) so the
 * `--cave-reading-width` var is set on cold load — reading surfaces (chat,
 * library, memory) render outside Settings.
 */
export function ReadingWidthController() {
  useEffect(() => {
    applyReadingWidth(readReadingWidth());

    const onStorage = (event: StorageEvent) => {
      if (event.key !== READING_WIDTH_KEY) return;
      applyReadingWidth(readReadingWidth());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return null;
}
