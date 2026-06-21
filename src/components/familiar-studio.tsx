"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Icon, type IconName } from "@/lib/icon";
import { FamiliarAvatar } from "@/components/familiar-avatar";
import { useFamiliarImageUpload, FAMILIAR_IMAGE_ACCEPT } from "@/lib/familiar-image-upload";
import { useFamiliarStudio, type FamiliarStudioTab } from "@/lib/familiar-studio-context";
import { useResolvedFamiliars, type ResolvedFamiliar } from "@/lib/familiar-resolve";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { Tabs } from "@/components/ui/tabs";
import {
  setFamiliarOverride,
  clearFamiliarOverrideField,
} from "@/lib/cave-familiar-overrides";
import { useDaemonSyncStatus } from "@/lib/daemon-sync-status";
import { useIsCoarsePointer } from "@/lib/use-viewport";
import { FamiliarStudioIdentityTab } from "./familiar-studio-identity-tab";
import { FamiliarStudioLookTab } from "./familiar-studio-look-tab";
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
  const drawerActiveTab = activeTab === "brain" ? "identity" : activeTab;
  const openBrainStudio = useCallback(() => {
    setActiveTab("brain");
    window.location.assign("/settings");
  }, [setActiveTab]);

  // Trap keyboard focus inside the open drawer, focus it on open, wire Escape,
  // and restore focus to the trigger on close — matching every other modal
  // (capabilities, board-inspector, …). Replaces the ad-hoc Escape listener.
  const drawerRef = useRef<HTMLElement | null>(null);
  useFocusTrap(drawerOpen, drawerRef, { onEscape: closeFamiliarStudio });

  // No drawer when nothing is open.
  if (!drawerOpen) return null;

  // Open-for-id-that-no-longer-exists empty state.
  if (activeFamiliarId && !familiar) {
    return (
      <>
        <StudioScrim onClose={closeFamiliarStudio} />
      <aside
        ref={drawerRef}
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
      ref={drawerRef}
      role="dialog"
      aria-label={`Familiar Studio${familiar ? ` — ${familiar.display_name}` : ""}`}
      className="familiar-studio__drawer"
      style={familiar ? ({ ["--familiar-accent"]: familiar.color } as CSSProperties) : undefined}
    >
      {/* Tabstrip */}
        <Tabs
          variant="underline"
          orientation="vertical"
          idPrefix="familiar-studio"
          ariaLabel="Studio sections"
          value={drawerActiveTab}
          onChange={setActiveTab}
          items={TABS.map((t) => ({
            id: t.id,
            label: t.label,
            icon: t.icon,
            disabled: disableNonLifecycle && t.id !== "lifecycle",
          }))}
        />

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
              <button
                type="button"
                className="familiar-studio__brain-link"
                onClick={openBrainStudio}
                title="Open Brain in full Familiar Studio"
              >
                <Icon name="ph:brain" width={13} aria-hidden />
                <span>Open Brain Studio</span>
              </button>
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
          id={`familiar-studio-panel-${drawerActiveTab}`}
          aria-labelledby={`familiar-studio-tab-${drawerActiveTab}`}
          className="familiar-studio__body"
        >
          {/* Tab body slots — wired in later tasks. */}
          {drawerActiveTab === "identity" && familiar ? (
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
          {drawerActiveTab === "look" && familiar ? (
            <FamiliarStudioLookTab familiar={familiar} allFamiliars={resolved} />
          ) : null}
          {drawerActiveTab === "lifecycle" ? (
            <FamiliarStudioLifecycleTab familiar={familiar} allResolved={resolved} />
          ) : null}
          {drawerActiveTab === "memory" && familiar ? (
            <FamiliarStudioMemoryTab familiar={familiar} allFamiliars={familiars} />
          ) : null}
          {drawerActiveTab === "contract" && familiar ? (
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
  // Return focus to the name button when the edit input closes, so keyboard
  // focus doesn't drop to <body> after committing/cancelling a rename.
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const refocusRef = useRef(false);
  useEffect(() => {
    if (!editing && refocusRef.current) {
      refocusRef.current = false;
      buttonRef.current?.focus();
    }
  }, [editing]);

  function enter() {
    setDraft(familiar.display_name);
    setEditing(true);
  }

  function commit() {
    refocusRef.current = true;
    setEditing(false);
    if (draft.trim() === "") {
      clearFamiliarOverrideField(familiar.id, "display_name");
    } else if (draft !== familiar.display_name) {
      setFamiliarOverride(familiar.id, { display_name: draft });
    }
  }

  function cancel() {
    refocusRef.current = true;
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
      ref={buttonRef}
      type="button"
      className="familiar-studio__name"
      onClick={enter}
      title="Click to rename"
    >
      {familiar.display_name}
    </button>
  );
}
