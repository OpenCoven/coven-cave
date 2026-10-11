"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { SkeletonRows } from "@/components/ui/skeleton";
import { Tabs } from "@/components/ui/tabs";
import { Icon } from "@/lib/icon";
import { useSurfaceHistory } from "@/lib/use-surface-history";
import type { FamiliarSettingsTab } from "@/lib/chat-tab-events";
import { CHAT_OPEN_PROJECTS_EVENT, markProjectsTabPending } from "@/lib/chat-tab-events";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";
import type { Familiar } from "@/lib/types";
import "@/styles/familiar-settings-navigation.css";

export type { FamiliarSettingsTab } from "@/lib/chat-tab-events";

const SETTINGS_TABS = [
  { id: "identity", label: "Identity", description: "Name, role, and appearance." },
  { id: "brain", label: "Brain", description: "Runtime, model, voice, and tools." },
  { id: "memory", label: "Memory", description: "Durable memory and daily notes." },
  { id: "vault", label: "Vault", description: "Credentials available to this familiar." },
  { id: "chat", label: "Chat", description: "Shared chat preferences for your Cave." },
] as const;
type VisibleTab = typeof SETTINGS_TABS[number]["id"];

function SettingsLoading() {
  return <div role="status" aria-label="Loading settings"><SkeletonRows count={4} /></div>;
}
const FamiliarStudioIdentityTab = dynamic(() => import("@/components/familiar-studio-identity-tab").then(module => module.FamiliarStudioIdentityTab), { loading: SettingsLoading, ssr: false });
const FamiliarStudioBrainTab = dynamic(() => import("@/components/familiar-studio-brain-tab").then(module => module.FamiliarStudioBrainTab), { loading: SettingsLoading, ssr: false });
const FamiliarStudioMemoryTab = dynamic(() => import("@/components/familiar-studio-memory-tab").then(module => module.FamiliarStudioMemoryTab), { loading: SettingsLoading, ssr: false });
const VaultPanel = dynamic(() => import("@/components/vault-panel").then(module => module.VaultPanel), { loading: SettingsLoading, ssr: false });
const ChatSettingsView = dynamic(() => import("@/components/chat-settings-view").then(module => module.ChatSettingsView), { loading: SettingsLoading, ssr: false });

type Props = {
  familiar: ResolvedFamiliar;
  familiars: Familiar[];
  allFamiliars: ResolvedFamiliar[];
  initialTab?: FamiliarSettingsTab;
  onRosterChanged?: () => void;
};

export function FamiliarSettingsSection(props: Props) {
  // A familiar switch never carries another familiar's drafts or disclosures.
  return <FamiliarSettingsBody key={props.familiar.id} {...props} />;
}

function FamiliarSettingsBody({ familiar, familiars, allFamiliars, initialTab, onRosterChanged }: Props) {
  const { value: tab, select, show } = useSurfaceHistory<FamiliarSettingsTab>({
    id: `familiar:settings:${familiar.id}`,
    initial: initialTab && initialTab !== "projects" ? initialTab : "identity",
  });
  const displayedTab: VisibleTab = tab === "contract" || tab === "projects" ? "identity" : tab;
  const current = SETTINGS_TABS.find(item => item.id === displayedTab)!;
  const idPrefix = useId();
  const body = useRef<HTMLDivElement>(null);
  const identityScroll = useRef(0);
  useLayoutEffect(() => {
    if (body.current) body.current.scrollTop = displayedTab === "identity" ? identityScroll.current : 0;
  }, [displayedTab]);
  // Identity owns explicit-save drafts and an undoable lifecycle transaction.
  // Keep it mounted when hidden: effect cleanup must not commit a pending
  // removal on a section switch. It has no background polling. Other editors
  // retain their existing autosave/unmount contract while absent.
  const [identityVisited, setIdentityVisited] = useState(displayedTab === "identity");
  useEffect(() => {
    if (displayedTab === "identity") setIdentityVisited(true);
  }, [displayedTab]);
  useEffect(() => {
    if (initialTab === "projects") {
      markProjectsTabPending();
      window.dispatchEvent(new CustomEvent(CHAT_OPEN_PROJECTS_EVENT));
    } else if (initialTab) show(initialTab);
  }, [initialTab, show]);
  const raw = useMemo(() => familiars.find(item => item.id === familiar.id), [familiars, familiar.id]);

  return (
    <section className="familiar-tab__settings" aria-label={`Settings for ${familiar.display_name}`}>
      <div className="familiar-settings-nav">
        <h3 className="familiar-tab__card-title">Settings</h3>
        <div className="familiar-settings-nav__wide">
          <Tabs<FamiliarSettingsTab> orientation="vertical" size="sm" idPrefix={idPrefix}
            ariaLabel="Familiar settings" value={displayedTab} onChange={select} items={SETTINGS_TABS} />
        </div>
        <label className="familiar-settings-nav__compact">
          <span className="sr-only">Settings section</span>
          <select className="focus-ring" value={displayedTab} onChange={event => select(event.target.value as VisibleTab)}>
            {SETTINGS_TABS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
          <Icon name="ph:caret-down" width={16} aria-hidden />
        </label>
      </div>
      <div className="familiar-settings-content">
        <header className="familiar-settings-content__heading">
          <h4>{current.label}</h4>
          <p>{current.description}</p>
        </header>
        <div ref={body} className="familiar-tab__settings-body familiar-studio__body"
          onScroll={event => { if (displayedTab === "identity") identityScroll.current = event.currentTarget.scrollTop; }}>
          {SETTINGS_TABS.map(item => (
            <div key={item.id} role="tabpanel" id={`${idPrefix}-panel-${item.id}`}
              aria-label={item.label} hidden={displayedTab !== item.id} tabIndex={0} className="familiar-settings-panel focus-ring-inset">
              {item.id === "identity" && (identityVisited || displayedTab === "identity") ? (
                  <FamiliarStudioIdentityTab familiar={familiar}
                    focusContract={tab === "contract"}
                    rawDaemonValues={{ display_name: raw?.display_name, role: raw?.role, pronouns: raw?.pronouns, description: raw?.description }}
                    allFamiliars={allFamiliars} onRosterChanged={onRosterChanged} />
              ) : null}
              {item.id === displayedTab && item.id === "brain" ? <FamiliarStudioBrainTab familiar={familiar} /> : null}
              {item.id === displayedTab && item.id === "memory" ? <FamiliarStudioMemoryTab familiar={familiar} allFamiliars={familiars} /> : null}
              {item.id === displayedTab && item.id === "vault" ? <VaultPanel familiarId={familiar.id} /> : null}
              {item.id === displayedTab && item.id === "chat" ? <ChatSettingsView /> : null}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
