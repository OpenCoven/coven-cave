import type { ReactNode } from "react";
import { FamiliarStudioMemoryTab } from "@/components/familiar-studio-memory-tab";
import { FamiliarStudioLookTab } from "@/components/familiar-studio-look-tab";
import { FamiliarStudioInlinePanel } from "@/components/familiar-studio-inline";
import { FamiliarMemoryOverlay } from "@/components/familiars-view-sections";
import { IssueDetailModal } from "@/components/familiar-work-queue-sections";
import { HarnessAuthVaultButton } from "@/components/harness-auth-vault-button";
import { FamiliarStudioProvider } from "@/lib/familiar-studio-context";
import { resolveFamiliar } from "@/lib/familiar-resolve";
import type { Familiar } from "@/lib/types";
import { studioFamiliarId, studioMemoryEntries } from "./modal-studio-data";
import "@/styles/settings-familiars.css";
import "@/styles/familiar-work-queue.css";

const familiar: Familiar = { id: studioFamiliarId, display_name: "Review familiar", role: "Review plans and preserve authored decisions", harness: "codex" };
const resolved = resolveFamiliar(familiar, { archived: false });
const noop = () => {};

export function modalStudioFixtures(onClose: () => void): Record<string, ReactNode> {
  return {
    "studio-note": <FamiliarStudioMemoryTab familiar={resolved} allFamiliars={[familiar]} />,
    "studio-look": <FamiliarStudioLookTab familiar={resolved} allFamiliars={[resolved]} />,
    "studio-test": <div style={{ position: "fixed", inset: 0, display: "flex" }}><FamiliarStudioProvider><FamiliarStudioInlinePanel familiars={[familiar]} resolved={[resolved]} /></FamiliarStudioProvider></div>,
    "familiar-memory": <FamiliarMemoryOverlay familiars={[resolved]} familiar={resolved} memoryFeed={{ files: { state: "ready", entries: studioMemoryEntries }, lastLoadedAt: "2026-10-24T09:00:00.000Z", reload: async () => {} }} onClose={onClose} onOpenMemoryFile={noop} />,
    "queue-issue": <IssueDetailModal id="fixture-issue" projectRoot="/fixture/project" onClose={onClose} onClaim={noop} />,
    "auth-vault": <HarnessAuthVaultButton familiarId={familiar.id} className="ui-btn" />,
    "auth-vault-add": <HarnessAuthVaultButton familiarId={familiar.id} className="ui-btn" />,
  };
}
