"use client";
import { useEffect, useRef, useState } from "react";
import { resolveCodeRail, type CodeRailState, type CodeRailTab } from "@/lib/code-rail";

export const CODE_RAIL_PIN_KEY = "cave:code-rail:pinned:v1";
export function parsePinned(raw: string | null): boolean {
  return raw === "true";
}
export function serializePinned(pinned: boolean): string {
  return pinned ? "true" : "false";
}

export type UseCodeRailArgs = {
  /** Active session's project_root (null/undefined = not repo-linked). */
  projectRoot: string | null | undefined;
  /** Pending edit count for this session (0 = none). Caller polls /api/changes. */
  changeCount: number;
  terminalActive: boolean;
};

export function useCodeRail({ projectRoot, changeCount, terminalActive }: UseCodeRailArgs) {
  const [pinned, setPinned] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [activeTab, setActiveTab] = useState<CodeRailTab>("files");
  const prevRef = useRef<CodeRailState | null>(null);

  // Hydrate pin after mount (SSR-safe).
  useEffect(() => {
    setPinned(parsePinned(window.localStorage.getItem(CODE_RAIL_PIN_KEY)));
  }, []);

  const state = resolveCodeRail(
    { hasRepo: Boolean(projectRoot), changeCount, terminalActive, pinned, dismissed },
    prevRef.current,
  );

  // Commit the resolved state as `prev` on EVERY render so the pure fn always
  // sees the real previous changeCount. If this were gated on a partial deps
  // array, a 2→0→3 edit sequence would leave `prev.changeCount` stale and miss
  // the fresh-batch re-reveal.
  useEffect(() => {
    prevRef.current = state;
  });

  // React to reveals: force the tab on a fresh edit batch, and clear a stale
  // dismissal once the rail re-opens. Deliberately NOT keyed on `activeTab` —
  // keying on it would revert a manual tab click back to the resolved tab
  // (state.activeTab is otherwise a fixed point between edit batches).
  useEffect(() => {
    if (state.available && state.activeTab !== activeTab) setActiveTab(state.activeTab);
    if (state.open && dismissed) setDismissed(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see comment above
  }, [state.available, state.open, state.activeTab]);

  const togglePin = () => {
    setPinned((p) => {
      const next = !p;
      window.localStorage.setItem(CODE_RAIL_PIN_KEY, serializePinned(next));
      if (next) setDismissed(false);
      return next;
    });
  };
  const collapse = () => setDismissed(true);
  const reopen = () => setDismissed(false);

  return {
    available: state.available,
    open: state.open,
    pinned,
    activeTab,
    setActiveTab,
    togglePin,
    collapse,
    reopen,
  };
}
