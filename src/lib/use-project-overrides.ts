"use client";

import { useEffect, useState } from "react";
import {
  CHAT_PROJECT_OVERRIDES_EVENT,
  readProjectOverrides,
  type ProjectOverrides,
} from "./chat-project-overrides.ts";

/**
 * Subscribe to the Cave-local chat→project overrides. Returns a fresh object on
 * every change (so it's a safe useMemo dependency) and loads after mount to keep
 * SSR and first client render in agreement.
 */
export function useProjectOverrides(): ProjectOverrides {
  const [overrides, setOverrides] = useState<ProjectOverrides>({});
  useEffect(() => {
    setOverrides(readProjectOverrides());
    const onChange = () => setOverrides(readProjectOverrides());
    window.addEventListener(CHAT_PROJECT_OVERRIDES_EVENT, onChange);
    window.addEventListener("storage", onChange); // cross-tab
    return () => {
      window.removeEventListener(CHAT_PROJECT_OVERRIDES_EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);
  return overrides;
}
