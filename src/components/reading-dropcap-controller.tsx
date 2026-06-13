"use client";

import { useEffect } from "react";
import {
  READING_DROPCAP_KEY,
  applyReadingDropcap,
  readReadingDropcap,
} from "@/lib/reading-dropcap";

/**
 * Applies the saved drop-cap setting on load and keeps it in sync across tabs.
 * Mounted in the root layout (mirrors ReadingHyphensController) so the
 * `data-reading-dropcap` attribute is set on cold load — the library reader
 * renders outside Settings.
 */
export function ReadingDropcapController() {
  useEffect(() => {
    applyReadingDropcap(readReadingDropcap());

    const onStorage = (event: StorageEvent) => {
      if (event.key !== READING_DROPCAP_KEY) return;
      applyReadingDropcap(readReadingDropcap());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return null;
}
