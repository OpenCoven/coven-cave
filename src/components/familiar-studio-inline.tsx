"use client";

import { useEffect, useMemo, type CSSProperties } from "react";
import { Icon, type IconName } from "@/lib/icon";
import { Tabs } from "@/components/ui/tabs";
import { useFamiliarStudio, type FamiliarStudioTab } from "@/lib/familiar-studio-context";
import { useDaemonSyncStatus } from "@/lib/daemon-sync-status";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";
import { FamiliarStudioIdentityTab } from "./familiar-studio-identity-tab";
import { FamiliarStudioLookTab } from "./familiar-studio-look-tab";
import { FamiliarStudioBrainTab } from "./familiar-studio-brain-tab";
import { FamiliarStudioLifecycleTab } from "./familiar-studio-lifecycle-tab";
import { FamiliarStudioMemoryTab } from "./familiar-studio-memory-tab";
import type { Familiar } from "@/lib/types";

type Props = {
  /** Raw daemon roster — fed to the tab bodies that diff against pre-override values. */
  familiars: Familiar[];
  /** Resolved roster (cave overrides applied) — drives the master list + tab bodies. */
  resolved: ResolvedFamiliar[];
};

const TABS: Array<{ id: FamiliarStudioTab; label: string; icon: IconName }> = [
  { id: "identity", label: "Identity", icon: "ph:user" },
  { id: "look", label: "Look", icon: "ph:paint-brush" },
  { id: "brain", label: "Brain", icon: "ph:brain" },
  { id: "lifecycle", label: "Lifecycle", icon: "ph:arrows-clockwise" },
  { id: "memory", label: "Memory", icon: "ph:archive" },
];

/**
 * Inline, non-modal Familiar Studio for the Settings → Familiars section.
 *
 * Unlike the global `<FamiliarStudio>` drawer (mounted in the Workspace), this
 * is a master-detail panel: a familiar dropdown above the full five-tab studio
 * for the selected familiar. The Settings route mounts the
 * `FamiliarStudioProvider` but never the drawer, so the per-card "Edit" buttons
 * used to set context state that nothing rendered — this surface is what makes
 * editing a familiar actually work inside Settings.
 *
 * It reuses the same context for selection (so `activeTab` persistence and the
 * deep-link `openFamiliarStudio(id, tab)` semantics carry over) and the same
 * tab-body components as the drawer. The Settings provider instance is isolated
 * from the Workspace one, so selecting here never auto-opens the drawer there.
 */
export function FamiliarStudioInlinePanel({ familiars, resolved }: Props) {
  const { activeFamiliarId, activeTab, setActiveTab, openFamiliarStudio } = useFamiliarStudio();
  const daemonSync = useDaemonSyncStatus();

  const familiar = useMemo(
    () => resolved.find((f) => f.id === activeFamiliarId) ?? null,
    [resolved, activeFamiliarId],
  );

  // Auto-select the first familiar so the detail pane is never empty on entry,
  // and recover if the current selection vanishes (archived/removed) while open.
  useEffect(() => {
    if (resolved.length === 0) return;
    if (!activeFamiliarId || !resolved.some((f) => f.id === activeFamiliarId)) {
      openFamiliarStudio(resolved[0].id);
    }
  }, [resolved, activeFamiliarId, openFamiliarStudio]);

  if (resolved.length === 0) {
    return (
      <div className="settings-familiars-panel">
        <p className="settings-familiars-panel__empty">
          No familiars configured. Open onboarding to scaffold one.
        </p>
      </div>
    );
  }

  return (
    <div
      className="familiar-studio-inline"
      style={familiar ? ({ ["--familiar-accent"]: familiar.color } as CSSProperties) : undefined}
    >
      <div className="familiar-studio-inline__selector">
        <label className="familiar-studio-inline__selector-label" htmlFor="settings-familiar-select">
          Familiar
        </label>
        <div className="familiar-studio-inline__select-wrap">
          <select
            id="settings-familiar-select"
            className="familiar-studio-inline__select"
            aria-label="Choose familiar to edit"
            value={familiar?.id ?? ""}
            onChange={(e) => openFamiliarStudio(e.currentTarget.value, activeTab)}
          >
            {resolved.map((f) => (
              <option key={f.id} value={f.id}>
                {f.display_name}
                {f.role ? ` - ${f.role}` : ""}
              </option>
            ))}
          </select>
          <Icon name="ph:caret-up-down-bold" width={12} className="familiar-studio-inline__select-caret" aria-hidden />
        </div>
      </div>

      <div className="familiar-studio-inline__detail">
        {familiar ? (
          <>
            <Tabs
              variant="underline"
              idPrefix="familiar-studio-inline"
              ariaLabel="Studio sections"
              value={activeTab}
              onChange={setActiveTab}
              items={TABS.map((t) => ({ id: t.id, label: t.label, icon: t.icon }))}
            />

            <div
              role="tabpanel"
              id={`familiar-studio-inline-panel-${activeTab}`}
              aria-labelledby={`familiar-studio-inline-tab-${activeTab}`}
              className="familiar-studio__body familiar-studio-inline__body"
            >
              {activeTab === "identity" ? (
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
              {activeTab === "look" ? (
                <FamiliarStudioLookTab familiar={familiar} allFamiliars={resolved} />
              ) : null}
              {activeTab === "brain" ? <FamiliarStudioBrainTab familiar={familiar} /> : null}
              {activeTab === "lifecycle" ? (
                <FamiliarStudioLifecycleTab familiar={familiar} allResolved={resolved} />
              ) : null}
              {activeTab === "memory" ? (
                <FamiliarStudioMemoryTab familiar={familiar} allFamiliars={familiars} />
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
          </>
        ) : (
          <div className="familiar-studio__empty">Select a familiar to edit.</div>
        )}
      </div>
    </div>
  );
}
