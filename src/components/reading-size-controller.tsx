"use client";

import { useEffect } from "react";
import {
  applyReadingSize,
  READER_TEXT_SCALE_STORAGE_KEY,
  loadScaleIndex,
} from "@/lib/reader-text-scale";
import {
  readAppPreferences,
  subscribeAppPreferences,
} from "@/lib/app-preferences";

export { applyReadingSize } from "@/lib/reader-text-scale";

export function ReadingSizeController() {
  useEffect(() => {
    const replay = () => {
      applyReadingSize(readAppPreferences().appearance.reading.size);
    };
    replay();
    const unsubscribe = subscribeAppPreferences(replay);
    const onStorage = (event: StorageEvent) => {
      if (event.key === READER_TEXT_SCALE_STORAGE_KEY) {
        applyReadingSize(loadScaleIndex());
      }
    };
    window.addEventListener("storage", onStorage);
    return () => {
      unsubscribe();
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return null;
}
