"use client";

import { useEffect } from "react";
import {
  READING_WEIGHT_KEY,
  applyReadingWeight,
  readReadingWeight,
} from "@/lib/reading-weight";

/**
 * Applies the saved reading font-weight on load and keeps it in sync across
 * tabs. Mounted in the root layout (mirrors ReadingWidthController) so the
 * `--cave-reading-weight` var is set on cold load — reading surfaces (chat,
 * library, memory) render outside Settings.
 */
export function ReadingWeightController() {
  useEffect(() => {
    applyReadingWeight(readReadingWeight());

    const onStorage = (event: StorageEvent) => {
      if (event.key !== READING_WEIGHT_KEY) return;
      applyReadingWeight(readReadingWeight());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return null;
}
