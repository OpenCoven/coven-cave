"use client";

import "@/styles/cave-composer.css";

// Composer Options menu — a single icon-only trigger that collapses the chat
// composer's response controls (Host · Access · Model · Thinking · Speed) into
// one popover panel. ComposerResponseSections is the reusable body; this wrapper
// keeps the trigger, open state, prompt-snippets action, and sibling connect
// dialog. Each control is an inline radiogroup, so there are no nested popovers
// (the shared Popover treats a portaled child popover's clicks as "outside" and
// would close — see ui/popover.tsx).

import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { Icon } from "@/lib/icon";
import { Popover, PopoverBody, usePopoverInitialFocus } from "@/components/ui/popover";
import {
  ComposerHostChoices,
  ConnectHostDialog,
  useComposerHosts,
} from "@/components/composer-host-chip";
import { LOCAL_HOST_ID, type ChatHostOption } from "@/lib/chat-hosts";

export type ComposerOptionChoice = { value: string; label: string };

export type ComposerOptionSection = {
  /** Stable id (React key) — accessible name comes from `label`. */
  id: string;
  label: string;
  value: string;
  options: ComposerOptionChoice[];
  onChange: (value: string) => void;
};

/** One labeled single-select rendered as a proper radiogroup: roving tabindex
 *  plus arrow-key navigation, so keyboard users move between options with one
 *  Tab stop per group rather than tabbing through every pill. */
export function ComposerOptionRadioGroup({ label, value, options, onChange }: ComposerOptionSection) {
  const groupRef = useRef<HTMLDivElement | null>(null);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(e.key)) return;
    e.preventDefault();
    const idx = Math.max(0, options.findIndex((o) => o.value === value));
    const dir = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1;
    const nextIdx = (idx + dir + options.length) % options.length;
    const next = options[nextIdx];
    if (!next) return;
    onChange(next.value);
    groupRef.current
      ?.querySelectorAll<HTMLButtonElement>('[role="radio"]')
      ?.[nextIdx]?.focus();
  };

  return (
    <div className="composer-options__section">
      <span className="composer-options__label">{label}</span>
      <div
        ref={groupRef}
        className="composer-options__choices"
        role="radiogroup"
        aria-label={label}
        onKeyDown={onKeyDown}
      >
        {options.map((opt) => {
          const checked = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={checked ? 0 : -1}
              className={`composer-options__choice focus-ring${checked ? " is-selected" : ""}`}
              onClick={() => onChange(opt.value)}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export type ComposerResponseHostsController = {
  hostOptions: ChatHostOption[];
  load: (force?: boolean) => Promise<boolean>;
  removeHost: (host: string) => Promise<void>;
};

export function useComposerResponseHosts(hostValue: string): ComposerResponseHostsController {
  const { options: hostOptions, load, removeHost } = useComposerHosts(hostValue);
  return { hostOptions, load, removeHost };
}

export function ComposerResponseSections({
  hostValue,
  hostOptions,
  onHostPick,
  onRemoveHost,
  sections,
  onConnectNew,
  onSaveAsTemplate,
  saveAsTemplateDisabled,
}: {
  hostValue: string;
  hostOptions: ChatHostOption[];
  onHostPick: (id: string) => void;
  onRemoveHost?: (host: string) => void;
  sections: ComposerOptionSection[];
  onConnectNew: () => void;
  onSaveAsTemplate?: () => void;
  saveAsTemplateDisabled?: boolean;
}) {
  return (
    <>
      {onSaveAsTemplate ? (
        <button
          type="button"
          className="composer-options__action composer-actions__inline-action focus-ring disabled:opacity-40"
          disabled={saveAsTemplateDisabled}
          onClick={onSaveAsTemplate}
        >
          <Icon name="ph:floppy-disk-bold" width={14} aria-hidden />
          Save draft as template…
        </button>
      ) : null}
      <div className="composer-options__section">
        <span className="composer-options__label">Host</span>
        <ComposerHostChoices
          options={hostOptions}
          value={hostValue}
          onRemoveHost={onRemoveHost}
          onPick={onHostPick}
          onConnectNew={onConnectNew}
        />
      </div>
      {sections.map((section) => (
        <ComposerOptionRadioGroup key={section.id} {...section} />
      ))}
    </>
  );
}

export function ComposerOptionsMenu({
  hostValue,
  onHostPick,
  sections,
  indicator,
  disabled,
  onOpenPromptSnippets,
  onSaveAsTemplate,
  saveAsTemplateDisabled,
  open: controlledOpen,
  onOpenChange,
  anchorRef: externalAnchorRef,
}: {
  hostValue: string;
  onHostPick: (id: string) => void;
  /** Access, Model, Thinking, Speed (Model omitted when there are no models). */
  sections: ComposerOptionSection[];
  /** Show the "non-default" dot on the trigger (host-remote is added here). */
  indicator?: boolean;
  disabled?: boolean;
  /** When set, the menu opens with a "Prompt snippets…" action at the top — the
   *  composer's utility row folds its dedicated snippets button in here so the
   *  resting row is just attach · voice · this overflow (cave-xsq.4). */
  onOpenPromptSnippets?: () => void;
  /** When set, a "Save draft as template…" action follows the snippets one
   *  (cave-jg6k). Callers disable it while the draft is empty. */
  onSaveAsTemplate?: () => void;
  saveAsTemplateDisabled?: boolean;
  /** Controlled mode (chat revamp): when `anchorRef` is provided the menu
   *  renders no trigger of its own — the panel anchors to the caller's
   *  element (the composer "+" button) and open state is caller-owned via
   *  `open` / `onOpenChange` ("Model & tuning…" chaining). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  anchorRef?: RefObject<HTMLElement | null>;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const controlled = controlledOpen !== undefined;
  const open = controlled ? controlledOpen : uncontrolledOpen;
  const setOpen = (next: boolean) => {
    if (!controlled) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };
  const [connectOpen, setConnectOpen] = useState(false);
  const hostRefreshPending = useRef(false);
  const hostsLoaded = useRef(false);
  const internalAnchorRef = useRef<HTMLButtonElement | null>(null);
  const anchorRef = externalAnchorRef ?? internalAnchorRef;
  const { hostOptions, load, removeHost } = useComposerResponseHosts(hostValue);
  usePopoverInitialFocus(open, ".composer-options__panel");

  useEffect(() => {
    if (!open) return;
    const force = hostRefreshPending.current;
    if (hostsLoaded.current && !force) return;
    hostRefreshPending.current = false;
    if (force) hostsLoaded.current = false;
    let cancelled = false;
    void load(force).then((loaded) => {
      if (!cancelled && loaded) hostsLoaded.current = true;
    });
    return () => {
      cancelled = true;
    };
  }, [load, open]);

  const showDot = Boolean(indicator) || hostValue !== LOCAL_HOST_ID;

  return (
    <>
      {externalAnchorRef ? null : (
        <button
          ref={internalAnchorRef}
          type="button"
          className="cave-composer-icon-button composer-options__trigger focus-ring relative grid h-[30px] w-[30px] place-items-center rounded-[var(--radius-pill)] border border-[var(--border-hairline)] hover:bg-[var(--bg-raised)] disabled:opacity-40"
          disabled={disabled}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label="Composer options"
          title="Composer options"
          onClick={() => {
            setOpen(!open);
          }}
        >
          <Icon name="ph:sliders-horizontal" width={15} aria-hidden />
          {showDot ? <span className="composer-options__dot" aria-hidden /> : null}
        </button>
      )}
      <Popover
        open={open}
        onOpenChange={setOpen}
        anchorRef={anchorRef}
        placement="top-start"
        minWidth={288}
        ariaLabel="Composer options"
        className="composer-options__panel"
      >
        <PopoverBody ariaLabel="Composer options">
          {onOpenPromptSnippets ? (
            <button
              type="button"
              className="composer-options__action focus-ring"
              onClick={() => {
                setOpen(false);
                onOpenPromptSnippets();
              }}
            >
              <Icon name="ph:chat-centered-text" width={14} aria-hidden />
              Prompt snippets…
            </button>
          ) : null}
          <ComposerResponseSections
            hostValue={hostValue}
            hostOptions={hostOptions}
            onHostPick={onHostPick}
            onRemoveHost={(host) => void removeHost(host)}
            sections={sections}
            onConnectNew={() => {
              setOpen(false);
              setConnectOpen(true);
            }}
            onSaveAsTemplate={
              onSaveAsTemplate
                ? () => {
                    setOpen(false);
                    onSaveAsTemplate();
                  }
                : undefined
            }
            saveAsTemplateDisabled={saveAsTemplateDisabled}
          />
        </PopoverBody>
      </Popover>
      {connectOpen && (
        <ConnectHostDialog
          onClose={() => setConnectOpen(false)}
          onConnected={(host) => {
            onHostPick(host);
            hostRefreshPending.current = true;
          }}
        />
      )}
    </>
  );
}
