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
import {
  markFamiliarSettingsPending,
  type FamiliarSettingsTab,
} from "@/lib/chat-tab-events";
import { setFamiliarScope } from "@/lib/familiar-memory";

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
 * Chat → Familiar → Settings consumes the familiar/tab handoff after the
 * workspace boots the selected scope.
 */
export const BRAIN_STUDIO_FAMILIAR_KEY = "cave:brain-studio-familiar:v1";

/**
 * Hard-navigate to Chat → Familiar → Settings with an optional studio tab and
 * familiar preselected. This is the single handoff path shared by workspace
 * surfaces that retired their own Familiar editor in favor of Chat.
 */
export function openFamiliarStudioSettingsTab(tab?: FamiliarStudioTab, familiarId?: string): void {
  if (typeof window === "undefined") return;
  try {
    if (familiarId) window.localStorage.setItem(BRAIN_STUDIO_FAMILIAR_KEY, familiarId);
    if (tab) window.localStorage.setItem(TAB_STORAGE_KEY, tab);
  } catch {
    /* storage may be unavailable */
  }
  if (familiarId) setFamiliarScope([familiarId]);
  markFamiliarSettingsPending(chatSettingsTabFor(tab));
  window.location.assign("/?mode=chat");
}

function chatSettingsTabFor(tab?: FamiliarStudioTab): FamiliarSettingsTab | undefined {
  switch (tab) {
    case "brain":
      return "brain";
    case "memory":
      return "memory";
    case "projects":
      return "projects";
    case "vault":
      return "vault";
    case "identity":
    case "contract":
      return "identity";
    default:
      return undefined;
  }
}

type Ctx = {
  /** `null` means closed; a string id means open for a specific familiar. */
  activeFamiliarId: string | null;
  activeTab: FamiliarStudioTab;
  openFamiliarStudio: (id: string, tab?: FamiliarStudioTab) => void;
  /** Opens Chat → Familiar → Settings without forcing a nested tab. */
  openFamiliarStudioListView: () => void;
  closeFamiliarStudio: () => void;
  setActiveTab: (tab: FamiliarStudioTab) => void;
};

const StudioContext = createContext<Ctx | null>(null);

export function FamiliarStudioProvider({
  children,
  redirectToChat = false,
}: {
  children: ReactNode;
  /**
   * When true, opening a familiar hands the familiar/tab off to Chat →
   * Familiar → Settings. The Chat surface consumes the one-shot target after
   * the workspace switches to the active familiar.
   */
  redirectToChat?: boolean;
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
      if (redirectToChat) {
        openFamiliarStudioSettingsTab(tab, id);
        return;
      }
      setActiveFamiliarId(id);
      if (tab) setActiveTab(tab);
    },
    [setActiveTab, redirectToChat],
  );

  // "Manage familiars" entry point: open the Chat Familiar settings surface.
  const openFamiliarStudioListView = useCallback(() => {
    if (redirectToChat) {
      openFamiliarStudioSettingsTab();
      return;
    }
    setActiveFamiliarId(null);
  }, [redirectToChat]);

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
