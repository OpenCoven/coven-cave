"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Icon, type IconName } from "@/lib/icon";
import { FamiliarAvatar } from "@/components/familiar-avatar";
import { useFamiliarImageUpload, FAMILIAR_IMAGE_ACCEPT } from "@/lib/familiar-image-upload";
import { useFamiliarStudio, type FamiliarStudioTab } from "@/lib/familiar-studio-context";
import { useRovingTabIndex } from "@/lib/use-roving-tabindex";
import { useResolvedFamiliars, type ResolvedFamiliar } from "@/lib/familiar-resolve";
import {
  setFamiliarOverride,
  clearFamiliarOverrideField,
} from "@/lib/cave-familiar-overrides";
import { useDaemonSyncStatus } from "@/lib/daemon-sync-status";
import { useIsCoarsePointer } from "@/lib/use-viewport";
import { FamiliarStudioIdentityTab } from "./familiar-studio-identity-tab";
import { FamiliarStudioLookTab } from "./familiar-studio-look-tab";
import { FamiliarStudioBrainTab } from "./familiar-studio-brain-tab";
import { FamiliarStudioLifecycleTab } from "./familiar-studio-lifecycle-tab";
import { FamiliarStudioMemoryTab } from "./familiar-studio-memory-tab";
import { FamiliarStudioContractTab } from "./familiar-studio-contract-tab";
import type { Familiar } from "@/lib/types";

type Props = {
  familiars: Familiar[];
};

const TABS: Array<{ id: FamiliarStudioTab; label: string; icon: IconName }> = [
  { id: "identity", label: "Identity", icon: "ph:user" },
  { id: "look", label: "Look", icon: "ph:paint-brush" },
  { id: "brain", label: "Brain", icon: "ph:brain" },
  { id: "lifecycle", label: "Lifecycle", icon: "ph:arrows-clockwise" },
  { id: "memory", label: "Memory", icon: "ph:archive" },
  { id: "contract", label: "Contract", icon: "ph:seal-check" },
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
  const drawerOpen = Boolean(activeFamiliarId || listView);
  const disableNonLifecycle = listView && !familiar;

  // Roving tabindex over the tablist. Arrow keys move focus across enabled
  // tabs; Home/End jump to ends. We pair this with an effect below to also
  // switch the active tab when focus moves (automatic activation per APG).
  const tablistRef = useRef<HTMLDivElement | null>(null);
  const { activeIndex } = useRovingTabIndex({
    containerRef: tablistRef,
    itemSelector: '[role="tab"]:not([aria-disabled="true"])',
    // Tabstrip is visually a column (`flex-direction: column`), so vertical
    // arrow keys move focus across tabs. aria-orientation below mirrors this.
    orientation: "vertical",
  });

  // Esc to close
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeFamiliarStudio();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen, closeFamiliarStudio]);

  // Automatic activation: switch activeTab whenever the roving focus lands on
  // a new tab. Studio tab panels are cheap, so APG recommends auto activation.
  useEffect(() => {
    if (!drawerOpen) return;
    const enabledTabs = TABS.filter((t) =>
      disableNonLifecycle ? t.id === "lifecycle" : true,
    );
    const target = enabledTabs[activeIndex];
    if (target && target.id !== activeTab) {
      setActiveTab(target.id);
    }
    // Intentionally omit activeTab/setActiveTab from deps: this effect drives
    // activeTab from activeIndex, not the other way around.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex, disableNonLifecycle, drawerOpen]);

  // No drawer when nothing is open.
  if (!drawerOpen) return null;

  // Open-for-id-that-no-longer-exists empty state.
  if (activeFamiliarId && !familiar) {
    return (
      <>
        <StudioScrim onClose={closeFamiliarStudio} />
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
      </>
    );
  }

  return (
    <>
      <StudioScrim onClose={closeFamiliarStudio} />
    <aside
      role="dialog"
      aria-label={`Familiar Studio${familiar ? ` — ${familiar.display_name}` : ""}`}
      className="familiar-studio__drawer"
      style={familiar ? ({ ["--familiar-accent"]: familiar.color } as CSSProperties) : undefined}
    >
      {/* Tabstrip */}
      <div
        role="tablist"
        aria-label="Studio sections"
        aria-orientation="vertical"
        ref={tablistRef}
        className="familiar-studio__tabstrip"
      >
        {TABS.map((t) => {
          const disabled = disableNonLifecycle && t.id !== "lifecycle";
          const selected = activeTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`familiar-studio-tab-${t.id}`}
              aria-selected={selected}
              aria-controls={`familiar-studio-panel-${t.id}`}
              aria-disabled={disabled ? true : undefined}
              onClick={() => !disabled && setActiveTab(t.id)}
              className={`familiar-studio__tab${selected ? " familiar-studio__tab--active" : ""}`}
            >
              <Icon name={t.icon} width={18} />
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>

      {/* Main column */}
      <div className="familiar-studio__main">
        <header className="familiar-studio__header">
          {familiar ? (
            <>
              <StudioHeaderAvatar familiar={familiar} />
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

        <div
          role="tabpanel"
          id={`familiar-studio-panel-${activeTab}`}
          aria-labelledby={`familiar-studio-tab-${activeTab}`}
          className="familiar-studio__body"
        >
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
          {activeTab === "look" && familiar ? (
            <FamiliarStudioLookTab familiar={familiar} allFamiliars={resolved} />
          ) : null}
          {activeTab === "brain" && familiar ? <FamiliarStudioBrainTab familiar={familiar} /> : null}
          {activeTab === "lifecycle" ? (
            <FamiliarStudioLifecycleTab familiar={familiar} allResolved={resolved} />
          ) : null}
          {activeTab === "memory" && familiar ? (
            <FamiliarStudioMemoryTab familiar={familiar} allFamiliars={familiars} />
          ) : null}
          {activeTab === "contract" && familiar ? (
            <FamiliarStudioContractTab familiar={familiar} />
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
    </>
  );
}

/**
 * Dimming scrim behind the drawer. Adopts the app-wide `--backdrop-scrim`
 * convention (see `.ui-modal-backdrop` / `.mobile-drawer-backdrop`) so the
 * Studio reads as a modal surface and closes on outside click — matching every
 * other drawer/modal in the app. Click-away + the existing Esc handler are the
 * two dismiss paths; the X button is the third.
 */
function StudioScrim({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      aria-label="Close Familiar Studio"
      tabIndex={-1}
      className="familiar-studio__scrim"
      onClick={onClose}
    />
  );
}

// The header avatar doubles as an upload affordance: clicking it (or the
// keyboard activation) opens the native file picker and commits a new avatar
// image for this familiar. A hover/focus camera overlay signals it's clickable.
// The avatar itself updates reactively (useResolvedFamiliars reads the image
// store), so no local preview state is needed here.
function StudioHeaderAvatar({ familiar }: { familiar: ResolvedFamiliar }) {
  const { onFile, toast } = useFamiliarImageUpload(familiar.id);
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <div className="familiar-studio__avatar-wrap">
      <button
        type="button"
        className="familiar-studio__avatar-btn focus-ring"
        onClick={() => inputRef.current?.click()}
        aria-label={`Change ${familiar.display_name}'s avatar image`}
        title="Upload a new image"
      >
        <FamiliarAvatar familiar={familiar} size="lg" />
        <span className="familiar-studio__avatar-overlay" aria-hidden>
          <Icon name="ph:camera" width={14} />
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={FAMILIAR_IMAGE_ACCEPT}
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void onFile(file);
          e.target.value = "";
        }}
      />
      {toast ? <span className="familiar-studio__avatar-toast" role="status">{toast}</span> : null}
    </div>
  );
}

function HeaderName({ familiar }: { familiar: ResolvedFamiliar }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(familiar.display_name);
  const coarse = useIsCoarsePointer();

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
        autoFocus={!coarse}
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
