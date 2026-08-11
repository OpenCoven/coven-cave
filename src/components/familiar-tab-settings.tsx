"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { FamiliarStudioBrainTab } from "@/components/familiar-studio-brain-tab";
import { FamiliarStudioIdentityTab } from "@/components/familiar-studio-identity-tab";
import { FamiliarStudioMemoryTab } from "@/components/familiar-studio-memory-tab";
import { SkeletonRows } from "@/components/ui/skeleton";
import { VaultPanel } from "@/components/vault-panel";
import { Tabs } from "@/components/ui/tabs";
import type { FamiliarSettingsTab } from "@/lib/chat-tab-events";
import { CHAT_OPEN_PROJECTS_EVENT, markProjectsTabPending } from "@/lib/chat-tab-events";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";
import type { Familiar } from "@/lib/types";

export type { FamiliarSettingsTab } from "@/lib/chat-tab-events";

// Projects is deliberately absent: project access, access groups, and the
// access history all live on Chat → Projects now. A `projects` target
// redirects there (see the effect below) rather than rendering a second copy
// of the grant matrix here.
const SETTINGS_TABS: Array<{ id: FamiliarSettingsTab; label: string }> = [
  { id: "chat", label: "Chat" },
  { id: "identity", label: "Identity" },
  { id: "brain", label: "Brain" },
  { id: "memory", label: "Memory" },
  { id: "vault", label: "Vault" },
];

const ChatSettingsView = dynamic(
  () =>
    import("@/components/chat-settings-view").then(
      (module) => module.ChatSettingsView,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-0 flex-col gap-3 p-6" aria-hidden>
        <SkeletonRows count={6} />
      </div>
    ),
  },
);

/**
 * The selected familiar's editable Studio controls, embedded in Chat's
 * Familiar tab. The Chat roster owns selection; these bodies remain the
 * canonical settings writers shared with the retired Settings → Familiars
 * surface.
 */
export function FamiliarSettingsSection({
  familiar,
  familiars,
  allFamiliars,
  localDaemonReady,
  initialTab,
  onRosterChanged,
}: {
  familiar: ResolvedFamiliar;
  familiars: Familiar[];
  allFamiliars: ResolvedFamiliar[];
  localDaemonReady: boolean;
  initialTab?: FamiliarSettingsTab;
  onRosterChanged?: () => void;
}) {
  const [tab, setTab] = useState<FamiliarSettingsTab>(
    initialTab && initialTab !== "projects" ? initialTab : "identity",
  );
  useEffect(() => {
    // `projects` no longer names a tab here. Rather than silently landing on
    // Identity, hand the request to the surface that owns project access now.
    if (initialTab === "projects") {
      markProjectsTabPending();
      window.dispatchEvent(new CustomEvent(CHAT_OPEN_PROJECTS_EVENT));
      return;
    }
    if (initialTab) setTab(initialTab);
  }, [initialTab]);
  const raw = useMemo(
    () => familiars.find((item) => item.id === familiar.id),
    [familiars, familiar.id],
  );

  return (
    <section className="familiar-tab__settings" aria-label={`Settings for ${familiar.display_name}`}>
      <div className="familiar-tab__settings-heading">
        <div>
          <h3 className="familiar-tab__card-title">Settings</h3>
          <p className="familiar-tab__settings-copy">
            Tune {familiar.display_name} without leaving Chat.
          </p>
        </div>
      </div>

      <div className="familiar-tab__settings-tabs">
        <Tabs<FamiliarSettingsTab>
          variant="underline"
          idPrefix="familiar-settings"
          ariaLabel="Familiar settings"
          value={tab}
          onChange={setTab}
          items={SETTINGS_TABS}
        />
      </div>

      <div
        role="tabpanel"
        id={`familiar-settings-panel-${tab}`}
        aria-labelledby={`familiar-settings-tab-${tab}`}
        className="familiar-tab__settings-body familiar-studio__body"
      >
        {tab === "chat" ? <ChatSettingsView /> : null}
        {tab === "identity" ? (
          <FamiliarStudioIdentityTab
            key={`${familiar.id}:identity`}
            familiar={familiar}
            rawDaemonValues={{
              display_name: raw?.display_name,
              role: raw?.role,
              pronouns: raw?.pronouns,
              description: raw?.description,
            }}
            allFamiliars={allFamiliars}
            onRosterChanged={onRosterChanged}
          />
        ) : null}
        {tab === "brain" ? <FamiliarStudioBrainTab key={`${familiar.id}:brain`} familiar={familiar} /> : null}
        {tab === "memory" ? (
          <FamiliarStudioMemoryTab
            key={`${familiar.id}:memory`}
            familiar={familiar}
            allFamiliars={familiars}
            localDaemonReady={localDaemonReady}
          />
        ) : null}
        {tab === "vault" ? <VaultPanel key={`${familiar.id}:vault`} familiarId={familiar.id} /> : null}
      </div>
    </section>
  );
}
