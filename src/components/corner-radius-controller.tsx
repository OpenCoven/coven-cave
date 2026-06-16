"use client";

import { useEffect } from "react";
import {
  CORNER_RADIUS_KEY,
  applyCornerRadius,
  readCornerRadius,
} from "@/lib/appearance-corner-radius";

/**
 * Applies the saved UI corner radius on load and keeps it in sync across tabs.
 * Mounted in the root layout (mirrors ReadingWidthController) so the radius
 * tokens are set app-wide — the shell chrome that consumes them renders outside
 * Settings.
 *
 * The flash-free first paint is handled by the inline block in ThemeScript; this
 * controller is the post-hydration / cross-tab sync path.
 */
export function CornerRadiusController() {
  useEffect(() => {
    applyCornerRadius(readCornerRadius());

    const onStorage = (event: StorageEvent) => {
      if (event.key !== CORNER_RADIUS_KEY) return;
      applyCornerRadius(readCornerRadius());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return null;
}
