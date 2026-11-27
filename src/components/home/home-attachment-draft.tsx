"use client";

import { createContext, useCallback, useContext, useEffect, type ReactNode } from "react";
import { useAttachmentStaging } from "@/lib/use-attachment-staging";
import { useAnnouncer } from "@/components/ui/live-region";

const HomeAttachmentDraftContext = createContext<ReturnType<typeof useAttachmentStaging> | null>(null);

/** Own the Home draft for this document, including reads still in flight when
 * its composer unmounts. Nothing is uploaded or persisted by this provider. */
export function HomeAttachmentDraftProvider({ children }: { children: ReactNode }) {
  const { announce } = useAnnouncer();
  const onAdded = useCallback((count: number) => {
    announce(`Attached ${count} file${count === 1 ? "" : "s"} to the Home draft.`, "polite");
  }, [announce]);
  const staging = useAttachmentStaging({ onAdded });
  const hasUnsavedFiles = staging.attachments.length > 0 || staging.isReading;
  useEffect(() => {
    if (!hasUnsavedFiles) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [hasUnsavedFiles]);
  return <HomeAttachmentDraftContext.Provider value={staging}>{children}</HomeAttachmentDraftContext.Provider>;
}

export function useHomeAttachmentDraft() {
  return useContext(HomeAttachmentDraftContext);
}
