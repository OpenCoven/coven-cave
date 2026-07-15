"use client";

import { useEffect } from "react";
import {
  DEFAULT_SCREEN_SCALE,
  SCREEN_SCALE_KEY,
  applyScreenScale,
  readScreenScale,
  stepScreenScale,
} from "@/lib/screen-magnification";

function isEditableTarget(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

export function ScreenMagnificationController() {
  useEffect(() => {
    applyScreenScale(readScreenScale(), { persist: false });

    const onStorage = (event: StorageEvent) => {
      if (event.key !== SCREEN_SCALE_KEY) return;
      applyScreenScale(readScreenScale(), { persist: false });
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      if (!meta || event.altKey || isEditableTarget(event.target)) return;
      const key = event.key;
      if (key !== "=" && key !== "+" && key !== "-" && key !== "_" && key !== "0") return;
      event.preventDefault();
      if (key === "0") {
        applyScreenScale(DEFAULT_SCREEN_SCALE);
        return;
      }
      const current = readScreenScale();
      const direction = key === "-" || key === "_" ? -1 : 1;
      applyScreenScale(stepScreenScale(current, direction));
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return null;
}
