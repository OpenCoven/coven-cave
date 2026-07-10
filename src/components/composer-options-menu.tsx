"use client";

// Composer Options menu — a single icon-only trigger that collapses the chat
// composer's response controls (Host · Access · Model · Thinking · Speed) into
// one popover panel. Each control is an inline radiogroup, so there are no
// nested popovers (the shared Popover treats a portaled child popover's clicks
// as "outside" and would close — see ui/popover.tsx). The Host picker reuses the
// inline choices extracted from ComposerHostChip; its Connect-new-host dialog is
// rendered as a sibling of the Popover so it survives the panel closing.

import { useRef, useState, type KeyboardEvent } from "react";
import { Icon } from "@/lib/icon";
import { Popover, PopoverBody } from "@/components/ui/popover";
import {
  ComposerHostChoices,
  ConnectHostDialog,
  useComposerHosts,
} from "@/components/composer-host-chip";
import { LOCAL_HOST_ID } from "@/lib/chat-hosts";

type Choice = { value: string; label: string };

export type ComposerOptionSection = {
  /** Stable id (React key) — accessible name comes from `label`. */
  id: string;
  label: string;
  value: string;
  options: Choice[];
  onChange: (value: string) => void;
};

/** One labeled single-select rendered as a proper radiogroup: roving tabindex
 *  plus arrow-key navigation, so keyboard users move between options with one
 *  Tab stop per group rather than tabbing through every pill. */
function OptionRadioGroup({ label, value, options, onChange }: ComposerOptionSection) {
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

export function ComposerOptionsMenu({
  hostValue,
  onHostPick,
  sections,
  indicator,
  disabled,
  onOpenPromptSnippets,
  onSaveAsTemplate,
  saveAsTemplateDisabled,
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
}) {
  const [open, setOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const { options: hostOptions, load, removeHost } = useComposerHosts(hostValue);

  const showDot = Boolean(indicator) || hostValue !== LOCAL_HOST_ID;

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className="cave-composer-icon-button composer-options__trigger focus-ring relative grid h-[30px] w-[30px] place-items-center rounded-full border border-[var(--border-hairline)] hover:bg-[var(--bg-raised)] disabled:opacity-40"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Composer options"
        title="Composer options"
        onClick={() => {
          void load();
          setOpen((v) => !v);
        }}
      >
        <Icon name="ph:sliders-horizontal" width={15} aria-hidden />
        {showDot ? <span className="composer-options__dot" aria-hidden /> : null}
      </button>
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
          {onSaveAsTemplate ? (
            <button
              type="button"
              className="composer-options__action focus-ring disabled:opacity-40"
              disabled={saveAsTemplateDisabled}
              onClick={() => {
                setOpen(false);
                onSaveAsTemplate();
              }}
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
              onRemoveHost={(host) => void removeHost(host)}
              onPick={onHostPick}
              onConnectNew={() => {
                setOpen(false);
                setConnectOpen(true);
              }}
            />
          </div>
          {sections.map((section) => (
            <OptionRadioGroup key={section.id} {...section} />
          ))}
        </PopoverBody>
      </Popover>
      {connectOpen && (
        <ConnectHostDialog
          onClose={() => setConnectOpen(false)}
          onConnected={(host) => {
            onHostPick(host);
            void load(true);
          }}
        />
      )}
    </>
  );
}
