"use client";

import { useMemo, useState } from "react";
import { AccessGroupsSection } from "@/components/access-groups-section";
import { FamiliarStudioBrainTab } from "@/components/familiar-studio-brain-tab";
import { FamiliarStudioIdentityTab } from "@/components/familiar-studio-identity-tab";
import { FamiliarStudioMemoryTab } from "@/components/familiar-studio-memory-tab";
import { FamiliarStudioProjectsTab } from "@/components/familiar-studio-projects-tab";
import { ChatSettingsView } from "@/components/lazy-surfaces";
import { VaultPanel } from "@/components/vault-panel";
import { Tabs } from "@/components/ui/tabs";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";
import type { Familiar } from "@/lib/types";

type FamiliarSettingsTab = "chat" | "identity" | "brain" | "memory" | "projects" | "vault";

const SETTINGS_TABS: Array<{ id: FamiliarSettingsTab; label: string }> = [
  { id: "chat", label: "Chat" },
  { id: "identity", label: "Identity" },
  { id: "brain", label: "Brain" },
  { id: "memory", label: "Memory" },
  { id: "projects", label: "Projects" },
  { id: "vault", label: "Vault" },
];

/**
 * The selected familiar's editable Studio controls, embedded in Chat's
 * Familiar tab. The Chat roster owns selection; these bodies remain the
 * canonical settings writers used by Settings → Familiars.
 */
export function FamiliarSettingsSection({
  familiar,
  familiars,
  allFamiliars,
  localDaemonReady,
  onRosterChanged,
}: {
  familiar: ResolvedFamiliar;
  familiars: Familiar[];
  allFamiliars: ResolvedFamiliar[];
  localDaemonReady: boolean;
  onRosterChanged?: () => void;
}) {
  const [tab, setTab] = useState<FamiliarSettingsTab>("identity");
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
          bordered={false}
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
        {tab === "projects" ? (
          <div className="familiar-studio-control__projects">
            <FamiliarStudioProjectsTab key={`${familiar.id}:projects`} familiar={familiar} />
            <AccessGroupsSection familiars={allFamiliars} />
          </div>
        ) : null}
        {tab === "vault" ? <VaultPanel key={`${familiar.id}:vault`} familiarId={familiar.id} /> : null}
      </div>
    </section>
  );
}
