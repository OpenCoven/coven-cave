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

export type FamiliarStudioTab = "identity" | "look" | "brain" | "lifecycle";

const TAB_STORAGE_KEY = "cave:familiar-studio-tab:v1";
const DEFAULT_TAB: FamiliarStudioTab = "identity";

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

export function FamiliarStudioProvider({ children }: { children: ReactNode }) {
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
      stored === "lifecycle"
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
      setActiveFamiliarId(id);
      setListView(false);
      if (tab) setActiveTab(tab);
    },
    [setActiveTab],
  );

  const openFamiliarStudioListView = useCallback(() => {
    setActiveFamiliarId(null);
    setListView(true);
    setActiveTab("lifecycle");
  }, [setActiveTab]);

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
