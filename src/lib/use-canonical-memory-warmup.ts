"use client";

import { useEffect } from "react";
import {
  clearCanonicalMemoryResources,
  warmCanonicalMemory,
} from "./canonical-memory-resources.ts";

export function useCanonicalMemoryWarmup(localDaemonReady: boolean): void {
  useEffect(() => {
    if (!localDaemonReady || typeof window === "undefined") {
      clearCanonicalMemoryResources();
      return () => clearCanonicalMemoryResources();
    }

    let active = true;
    let firstFrame: number | null = null;
    let secondFrame: number | null = null;

    firstFrame = window.requestAnimationFrame(() => {
      firstFrame = null;
      if (!active) return;
      secondFrame = window.requestAnimationFrame(() => {
        secondFrame = null;
        if (!active) return;
        void warmCanonicalMemory().catch(() => {
          // Background warmup is opportunistic. A direct read keeps its normal
          // typed error path and retries because failed cache loads are not data.
        });
      });
    });

    return () => {
      active = false;
      if (firstFrame !== null) window.cancelAnimationFrame(firstFrame);
      if (secondFrame !== null) window.cancelAnimationFrame(secondFrame);
      clearCanonicalMemoryResources();
    };
  }, [localDaemonReady]);
}
