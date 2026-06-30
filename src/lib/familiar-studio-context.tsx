"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type FamiliarStudioTab = "identity" | "look" | "brain" | "lifecycle" | "memory" | "projects" | "contract" | "vault";

const TAB_STORAGE_KEY = "cave:familiar-studio-tab:v1";
const DEFAULT_TAB: FamiliarStudioTab = "identity";

/**
 * One-shot handoff for "Open Brain Studio": the right-side drawer (Workspace
 * provider) writes the familiar id here before a full navigation to
 * `/settings#familiars`, and the Settings inline panel (a separate, isolated
 * provider — so `activeFamiliarId` does not carry over) reads it once to select
 * the same familiar, then clears it.
 */
export const BRAIN_STUDIO_FAMILIAR_KEY = "cave:brain-studio-familiar:v1";

type Ctx = {
  /** `null` means closed; a string id means open for a specific familiar. */
  activeFamiliarId: string | null;
  /** `true` means open in no-familiar list view (Lifecycle tab only). */
  listView: boolean;
  activeTab: FamiliarStudioTab;
  openFamiliarStudio: (id: string, tab?: FamiliarStudioTab) => void;
  openFamiliarStudioListView: () => void;
  closeFamiliarStudio: () => void;
  setActiveTab: (tab: FamiliarStudioTab) => void;
};

const StudioContext = createContext<Ctx | null>(null);

export function FamiliarStudioProvider({
  children,
  redirectToSettings = false,
}: {
  children: ReactNode;
  /**
   * When true (the workspace-level provider), opening a familiar no longer
   * pops a drawer — there is no drawer. Instead it hands the familiar/tab off
   * to Settings → Familiars (the single source of truth) and navigates there,
   * reusing the same `BRAIN_STUDIO_FAMILIAR_KEY` / tab handoff the Settings
   * inline panel already reads. The Settings provider leaves this false so the
   * inline panel keeps its in-place tab/familiar navigation.
   */
  redirectToSettings?: boolean;
}) {
  const [activeFamiliarId, setActiveFamiliarId] = useState<string | null>(null);
  const [listView, setListView] = useState(false);
  const [activeTab, setActiveTabState] = useState<FamiliarStudioTab>(DEFAULT_TAB);

  // Restore last-used tab on mount.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(TAB_STORAGE_KEY);
    if (
      stored === "identity" ||
      stored === "look" ||
      stored === "brain" ||
      stored === "lifecycle" ||
      stored === "memory" ||
      stored === "projects" ||
      stored === "contract" ||
      stored === "vault"
    ) {
      setActiveTabState(stored);
    }
  }, []);

  const setActiveTab = useCallback((tab: FamiliarStudioTab) => {
    setActiveTabState(tab);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(TAB_STORAGE_KEY, tab);
    }
  }, []);

  const openFamiliarStudio = useCallback(
    (id: string, tab?: FamiliarStudioTab) => {
      if (redirectToSettings) {
        if (typeof window !== "undefined") {
          window.localStorage.setItem(BRAIN_STUDIO_FAMILIAR_KEY, id);
          if (tab) window.localStorage.setItem(TAB_STORAGE_KEY, tab);
          window.location.assign("/settings#familiars");
        }
        return;
      }
      setActiveFamiliarId(id);
      setListView(false);
      if (tab) setActiveTab(tab);
    },
    [setActiveTab, redirectToSettings],
  );

  const openFamiliarStudioListView = useCallback(() => {
    if (redirectToSettings) {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(TAB_STORAGE_KEY, "lifecycle");
        window.location.assign("/settings#familiars");
      }
      return;
    }
    setActiveFamiliarId(null);
    setListView(true);
    setActiveTab("lifecycle");
  }, [setActiveTab, redirectToSettings]);

  const closeFamiliarStudio = useCallback(() => {
    setActiveFamiliarId(null);
    setListView(false);
  }, []);

  const value = useMemo<Ctx>(
    () => ({
      activeFamiliarId,
      listView,
      activeTab,
      openFamiliarStudio,
      openFamiliarStudioListView,
      closeFamiliarStudio,
      setActiveTab,
    }),
    [activeFamiliarId, listView, activeTab, openFamiliarStudio, openFamiliarStudioListView, closeFamiliarStudio, setActiveTab],
  );

  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}

export function useFamiliarStudio(): Ctx {
  const ctx = useContext(StudioContext);
  if (!ctx) {
    throw new Error("useFamiliarStudio must be used within a FamiliarStudioProvider");
  }
  return ctx;
}
