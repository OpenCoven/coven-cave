"use client";

import { useEffect, useMemo, useState } from "react";
import { Icon, type IconName } from "@/lib/icon";
import { FamiliarAvatar } from "@/components/familiar-avatar";
import { useFamiliarStudio, type FamiliarStudioTab } from "@/lib/familiar-studio-context";
import { useResolvedFamiliars, type ResolvedFamiliar } from "@/lib/familiar-resolve";
import {
  setFamiliarOverride,
  clearFamiliarOverrideField,
} from "@/lib/cave-familiar-overrides";
import { useDaemonSyncStatus } from "@/lib/daemon-sync-status";
import { FamiliarStudioIdentityTab } from "./familiar-studio-identity-tab";
import { FamiliarStudioLookTab } from "./familiar-studio-look-tab";
import { FamiliarStudioBrainTab } from "./familiar-studio-brain-tab";
import { FamiliarStudioLifecycleTab } from "./familiar-studio-lifecycle-tab";
import type { Familiar } from "@/lib/types";

type Props = {
  familiars: Familiar[];
};

const TABS: Array<{ id: FamiliarStudioTab; label: string; icon: IconName }> = [
  { id: "identity", label: "Identity", icon: "ph:user" },
  { id: "look", label: "Look", icon: "ph:paint-brush" },
  { id: "brain", label: "Brain", icon: "ph:brain" },
  { id: "lifecycle", label: "Lifecycle", icon: "ph:arrows-clockwise" },
];

export function FamiliarStudio({ familiars }: Props) {
  const {
    activeFamiliarId,
    listView,
    activeTab,
    setActiveTab,
    closeFamiliarStudio,
  } = useFamiliarStudio();
  const daemonSync = useDaemonSyncStatus();

  // Resolve with archived included so the Lifecycle list view can show them.
  const resolved = useResolvedFamiliars(familiars, { includeArchived: true });
  const familiar = useMemo(
    () => resolved.find((f) => f.id === activeFamiliarId) ?? null,
    [resolved, activeFamiliarId],
  );

  // Esc to close
  useEffect(() => {
    if (!activeFamiliarId && !listView) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeFamiliarStudio();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeFamiliarId, listView, closeFamiliarStudio]);

  // No drawer when nothing is open.
  if (!activeFamiliarId && !listView) return null;

  // Open-for-id-that-no-longer-exists empty state.
  if (activeFamiliarId && !familiar) {
    return (
      <aside
        role="dialog"
        aria-label="Familiar Studio"
        className="familiar-studio__drawer familiar-studio__drawer--empty"
      >
        <header className="familiar-studio__header">
          <span className="familiar-studio__title">Familiar Studio</span>
          <button onClick={closeFamiliarStudio} aria-label="Close" className="familiar-studio__close">
            <Icon name="ph:x-bold" />
          </button>
        </header>
        <div className="familiar-studio__empty">
          This familiar is no longer available.
        </div>
      </aside>
    );
  }

  const disableNonLifecycle = listView && !familiar;

  return (
    <aside
      role="dialog"
      aria-label={`Familiar Studio${familiar ? ` — ${familiar.display_name}` : ""}`}
      className="familiar-studio__drawer"
    >
      {/* Tabstrip */}
      <nav className="familiar-studio__tabstrip" aria-label="Studio sections">
        {TABS.map((t) => {
          const disabled = disableNonLifecycle && t.id !== "lifecycle";
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => !disabled && setActiveTab(t.id)}
              aria-current={activeTab === t.id ? "page" : undefined}
              disabled={disabled}
              className={`familiar-studio__tab${activeTab === t.id ? " familiar-studio__tab--active" : ""}`}
            >
              <Icon name={t.icon} width={18} />
              <span>{t.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Main column */}
      <div className="familiar-studio__main">
        <header className="familiar-studio__header">
          {familiar ? (
            <>
              <FamiliarAvatar familiar={familiar} size="lg" />
              <div className="familiar-studio__heading">
                <HeaderName familiar={familiar} />
                <span className="familiar-studio__role">{familiar.role}</span>
              </div>
            </>
          ) : (
            <span className="familiar-studio__title">Manage familiars</span>
          )}
          <button
            onClick={closeFamiliarStudio}
            aria-label="Close"
            className="familiar-studio__close"
          >
            <Icon name="ph:x-bold" />
          </button>
        </header>

        <div className="familiar-studio__body">
          {/* Tab body slots — wired in later tasks. */}
          {activeTab === "identity" && familiar ? (
            <FamiliarStudioIdentityTab
              familiar={familiar}
              rawDaemonValues={{
                display_name: familiars.find((f) => f.id === familiar.id)?.display_name,
                role: familiars.find((f) => f.id === familiar.id)?.role,
                pronouns: familiars.find((f) => f.id === familiar.id)?.pronouns,
                description: familiars.find((f) => f.id === familiar.id)?.description,
              }}
            />
          ) : null}
          {activeTab === "look" && familiar ? <FamiliarStudioLookTab familiar={familiar} /> : null}
          {activeTab === "brain" && familiar ? <FamiliarStudioBrainTab familiar={familiar} /> : null}
          {activeTab === "lifecycle" ? (
            <FamiliarStudioLifecycleTab familiar={familiar} allResolved={resolved} />
          ) : null}
        </div>

        <footer className="familiar-studio__footer">
          <span className="familiar-studio__autosave">Changes save automatically</span>
          {daemonSync.offline ? (
            <span
              className="familiar-studio__sync-warn"
              title={daemonSync.reason ?? undefined}
              aria-live="polite"
            >
              <Icon name="ph:warning-circle" width={11} />
              Saved locally, daemon offline
            </span>
          ) : null}
        </footer>
      </div>
    </aside>
  );
}

function HeaderName({ familiar }: { familiar: ResolvedFamiliar }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(familiar.display_name);

  function enter() {
    setDraft(familiar.display_name);
    setEditing(true);
  }

  function commit() {
    setEditing(false);
    if (draft.trim() === "") {
      clearFamiliarOverrideField(familiar.id, "display_name");
    } else if (draft !== familiar.display_name) {
      setFamiliarOverride(familiar.id, { display_name: draft });
    }
  }

  function cancel() {
    setDraft(familiar.display_name);
    setEditing(false);
  }

  if (editing) {
    return (
      <input
        autoFocus
        className="familiar-studio__name familiar-studio__name--editing"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.currentTarget as HTMLInputElement).blur();
          } else if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
        }}
        aria-label="Edit display name"
      />
    );
  }

  return (
    <button
      type="button"
      className="familiar-studio__name"
      onClick={enter}
      title="Click to rename"
    >
      {familiar.display_name}
    </button>
  );
}
