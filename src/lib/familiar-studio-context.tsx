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

export type FamiliarStudioTab =
  | "identity" | "brain" | "memory" | "projects" | "contract" | "vault";

const STUDIO_TABS: readonly FamiliarStudioTab[] = [
  "identity", "brain", "memory", "projects", "contract", "vault",
];

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

/**
 * Hard-navigate to Settings → Familiars with an optional studio tab and
 * familiar preselected. This is the single redirect path shared by the
 * workspace-level provider (`redirectToSettings`) and workspace surfaces that
 * retired their own page in favor of the studio.
 */
export function openFamiliarStudioSettingsTab(tab?: FamiliarStudioTab, familiarId?: string): void {
  if (typeof window === "undefined") return;
  try {
    if (familiarId) window.localStorage.setItem(BRAIN_STUDIO_FAMILIAR_KEY, familiarId);
    if (tab) window.localStorage.setItem(TAB_STORAGE_KEY, tab);
  } catch {
    /* storage may be unavailable */
  }
  window.location.assign("/settings#familiars");
}

type Ctx = {
  /** `null` means closed; a string id means open for a specific familiar. */
  activeFamiliarId: string | null;
  activeTab: FamiliarStudioTab;
  openFamiliarStudio: (id: string, tab?: FamiliarStudioTab) => void;
  /** Opens the familiars manager (Settings → Familiars) without forcing a tab. */
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
  const [activeTab, setActiveTabState] = useState<FamiliarStudioTab>(DEFAULT_TAB);

  // Restore last-used tab on mount.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(TAB_STORAGE_KEY);
    if ((STUDIO_TABS as readonly string[]).includes(stored ?? "")) {
      setActiveTabState(stored as FamiliarStudioTab);
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
        openFamiliarStudioSettingsTab(tab, id);
        return;
      }
      setActiveFamiliarId(id);
      if (tab) setActiveTab(tab);
    },
    [setActiveTab, redirectToSettings],
  );

  // "Manage familiars" entry point: with the roster manager retired, this just
  // opens Settings → Familiars (keeping the last-used tab); the inline panel
  // auto-selects a familiar.
  const openFamiliarStudioListView = useCallback(() => {
    if (redirectToSettings) {
      openFamiliarStudioSettingsTab();
      return;
    }
    setActiveFamiliarId(null);
  }, [redirectToSettings]);

  const closeFamiliarStudio = useCallback(() => {
    setActiveFamiliarId(null);
  }, []);

  const value = useMemo<Ctx>(
    () => ({
      activeFamiliarId,
      activeTab,
      openFamiliarStudio,
      openFamiliarStudioListView,
      closeFamiliarStudio,
      setActiveTab,
    }),
    [activeFamiliarId, activeTab, openFamiliarStudio, openFamiliarStudioListView, closeFamiliarStudio, setActiveTab],
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
