"use client";

import { useEffect } from "react";
import {
  READING_HYPHENS_KEY,
  applyReadingHyphens,
  readReadingHyphens,
} from "@/lib/reading-hyphens";

/**
 * Applies the saved reading hyphenation on load and keeps it in sync across
 * tabs. Mounted in the root layout (mirrors ReadingWeightController) so the
 * `--cave-reading-hyphens` var is set on cold load — reading surfaces (chat,
 * library, memory) render outside Settings.
 */
export function ReadingHyphensController() {
  useEffect(() => {
    applyReadingHyphens(readReadingHyphens());

    const onStorage = (event: StorageEvent) => {
      if (event.key !== READING_HYPHENS_KEY) return;
      applyReadingHyphens(readReadingHyphens());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return null;
}
