"use client";

import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import { Icon, type IconName } from "@/lib/icon";
import { FamiliarAvatar } from "@/components/familiar-avatar";
import { useFamiliarStudio, type FamiliarStudioTab } from "@/lib/familiar-studio-context";
import { useRovingTabIndex } from "@/lib/use-roving-tabindex";
import { useDaemonSyncStatus } from "@/lib/daemon-sync-status";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";
import { FamiliarStudioIdentityTab } from "./familiar-studio-identity-tab";
import { FamiliarStudioLookTab } from "./familiar-studio-look-tab";
import { FamiliarStudioBrainTab } from "./familiar-studio-brain-tab";
import { FamiliarStudioLifecycleTab } from "./familiar-studio-lifecycle-tab";
import { FamiliarStudioMemoryTab } from "./familiar-studio-memory-tab";
import type { Familiar, SessionRow } from "@/lib/types";

type Props = {
  /** Raw daemon roster — fed to the tab bodies that diff against pre-override values. */
  familiars: Familiar[];
  /** Resolved roster (cave overrides applied) — drives the master list + tab bodies. */
  resolved: ResolvedFamiliar[];
  sessions: SessionRow[];
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
 * is a master-detail panel: the familiar roster on the left, the full five-tab
 * studio for the selected familiar on the right. The Settings route mounts the
 * `FamiliarStudioProvider` but never the drawer, so the per-card "Edit" buttons
 * used to set context state that nothing rendered — this surface is what makes
 * editing a familiar actually work inside Settings.
 *
 * It reuses the same context for selection (so `activeTab` persistence and the
 * deep-link `openFamiliarStudio(id, tab)` semantics carry over) and the same
 * tab-body components as the drawer. The Settings provider instance is isolated
 * from the Workspace one, so selecting here never auto-opens the drawer there.
 */
export function FamiliarStudioInlinePanel({ familiars, resolved, sessions }: Props) {
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

  const liveCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of sessions) {
      if (!s.familiarId || s.status !== "running") continue;
      m.set(s.familiarId, (m.get(s.familiarId) ?? 0) + 1);
    }
    return m;
  }, [sessions]);

  // Roving tabindex across the horizontal tabstrip (APG automatic activation).
  const tablistRef = useRef<HTMLDivElement | null>(null);
  const { activeIndex } = useRovingTabIndex({
    containerRef: tablistRef,
    itemSelector: '[role="tab"]',
    orientation: "horizontal",
  });
  useEffect(() => {
    const target = TABS[activeIndex];
    if (target && target.id !== activeTab) setActiveTab(target.id);
    // Drives activeTab from focus, not the reverse — omit activeTab/setActiveTab.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex]);

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
      <nav className="familiar-studio-inline__list" aria-label="Familiars">
        {resolved.map((f) => {
          const selected = f.id === activeFamiliarId;
          const live = liveCounts.get(f.id) ?? 0;
          return (
            <button
              key={f.id}
              type="button"
              aria-current={selected ? "true" : undefined}
              onClick={() => openFamiliarStudio(f.id, activeTab)}
              className={`familiar-studio-inline__item${selected ? " familiar-studio-inline__item--active" : ""}`}
            >
              <FamiliarAvatar familiar={f} size="sm" />
              <span className="familiar-studio-inline__item-text">
                <span className="familiar-studio-inline__item-name">{f.display_name}</span>
                <span className="familiar-studio-inline__item-role">{f.role}</span>
              </span>
              {live > 0 ? (
                <span className="familiar-studio-inline__item-live" title={`${live} live session${live === 1 ? "" : "s"}`}>
                  {live}
                </span>
              ) : null}
            </button>
          );
        })}
      </nav>

      <div className="familiar-studio-inline__detail">
        {familiar ? (
          <>
            <div
              role="tablist"
              aria-label="Studio sections"
              aria-orientation="horizontal"
              ref={tablistRef}
              className="familiar-studio-inline__tabs"
            >
              {TABS.map((t) => {
                const selected = activeTab === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    id={`familiar-studio-inline-tab-${t.id}`}
                    aria-selected={selected}
                    aria-controls={`familiar-studio-inline-panel-${t.id}`}
                    onClick={() => setActiveTab(t.id)}
                    className={`familiar-studio-inline__tab${selected ? " familiar-studio-inline__tab--active" : ""}`}
                  >
                    <Icon name={t.icon} width={15} />
                    <span>{t.label}</span>
                  </button>
                );
              })}
            </div>

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
