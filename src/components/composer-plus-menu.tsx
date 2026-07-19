"use client";

import "@/styles/cave-composer.css";

// ComposerPlusMenu — the composer's single resting utility control (chat
// revamp 1d): a 30px "+" button that folds attach, dictation, voice call,
// prompt snippets, enhance, and the Model & tuning panel behind one labeled
// popover, so the resting row is just "+" · context pill · send. Each item
// keeps the exact behavior of the standalone button it replaced (disabled
// logic, dictation aria-pressed, voice-call mint guards) — relocated, not
// rewritten. "Model & tuning…" chains to the existing ComposerOptionsMenu
// popover, which the host anchors to this same trigger via `triggerRef`.

import { useRef, useState, type ReactNode, type RefObject } from "react";
import { Icon, type IconName } from "@/lib/icon";
import { Popover, PopoverBody, PopoverSeparator } from "@/components/ui/popover";
import { ENHANCE_INTENTS, type EnhanceIntent } from "@/lib/prompt-enhancer";

function PlusMenuRow({
  icon,
  label,
  hint,
  disabled,
  onSelect,
  ariaLabel,
  ariaPressed,
  role = "menuitem",
  checked,
  live,
}: {
  icon: IconName;
  label: ReactNode;
  /** Trailing shortcut hint, monospace muted (e.g. "⌘⇧A" or "/"). */
  hint?: string;
  disabled?: boolean;
  onSelect: () => void;
  ariaLabel?: string;
  /** Toggle items (dictation) keep their pressed state for AT parity. */
  ariaPressed?: boolean;
  role?: "menuitem" | "menuitemcheckbox";
  checked?: boolean;
  /** Accent-pulses the icon (live dictation). */
  live?: boolean;
}) {
  return (
    <button
      type="button"
      className="ui-popover-item composer-plus__item"
      role={role}
      aria-checked={role === "menuitemcheckbox" ? checked : undefined}
      aria-pressed={ariaPressed}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onSelect}
    >
      <Icon
        name={icon}
        width={14}
        aria-hidden
        className={live ? "composer-plus__icon--live" : undefined}
      />
      <span className="composer-plus__item-label">{label}</span>
      {hint ? (
        <span className="composer-plus__hint" aria-hidden>
          {hint}
        </span>
      ) : null}
    </button>
  );
}

export function ComposerPlusMenu({
  triggerRef,
  disabled,
  attach,
  dictation,
  call,
  promptSnippets,
  enhance,
  onOpenModelTuning,
}: {
  /** Shared anchor ref so the host can chain the Model & tuning popover
   *  (ComposerOptionsMenu) to the same trigger. */
  triggerRef?: RefObject<HTMLButtonElement | null>;
  disabled?: boolean;
  attach: {
    onSelect: () => void;
    disabled?: boolean;
    /** Platform-aware shortcut hint (e.g. "⌘⇧A"). */
    hint?: string;
  };
  /** Omit when no ears engine exists — mirrors the old mic's render gate. */
  dictation?: {
    listening: boolean;
    toggle: () => void;
    disabled?: boolean;
  };
  /** Voice call — omit when the surface has no call affordance. */
  call?: {
    onSelect: () => void;
    disabled?: boolean;
  };
  promptSnippets?: {
    onSelect: () => void;
  };
  /** The relocated enhance control: "Enhance prompt" opens an intent view
   *  (Smart enhance first) so the old split-button's intent menu survives. */
  enhance?: {
    onEnhance: (intent: EnhanceIntent) => void;
    disabled?: boolean;
    loading?: boolean;
  };
  /** Opens the existing composer options panel ("Model & tuning…"). */
  onOpenModelTuning: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"root" | "enhance">("root");
  const internalRef = useRef<HTMLButtonElement | null>(null);
  const anchorRef = triggerRef ?? internalRef;

  const close = () => {
    setOpen(false);
    setView("root");
  };

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className="cave-composer-plus focus-ring"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Composer actions"
        title="Attach, voice, snippets, and tuning"
        onClick={() => {
          setView("root");
          setOpen((v) => !v);
        }}
      >
        <Icon name="ph:plus" width={15} aria-hidden />
      </button>
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (!next) close();
          else setOpen(true);
        }}
        anchorRef={anchorRef}
        placement="top-start"
        minWidth={236}
        ariaLabel="Composer actions"
        className="composer-plus__panel"
      >
        <PopoverBody role="menu" ariaLabel="Composer actions">
          {view === "root" ? (
            <>
              <PlusMenuRow
                icon="ph:paperclip"
                label="Attach file"
                hint={attach.hint}
                ariaLabel="Attach images, videos, or files"
                disabled={attach.disabled}
                onSelect={() => {
                  close();
                  attach.onSelect();
                }}
              />
              {dictation ? (
                <PlusMenuRow
                  icon="ph:microphone"
                  label={dictation.listening ? "Stop dictation" : "Voice message"}
                  role="menuitemcheckbox"
                  checked={dictation.listening}
                  ariaLabel={dictation.listening ? "Stop dictation" : "Dictate your message"}
                  ariaPressed={dictation.listening}
                  live={dictation.listening}
                  disabled={dictation.disabled}
                  onSelect={() => {
                    close();
                    dictation.toggle();
                  }}
                />
              ) : null}
              {call ? (
                <PlusMenuRow
                  icon="ph:phone"
                  label="Start a call"
                  ariaLabel="Voice call"
                  disabled={call.disabled}
                  onSelect={() => {
                    close();
                    call.onSelect();
                  }}
                />
              ) : null}
              {promptSnippets ? (
                <PlusMenuRow
                  icon="ph:chat-centered-text"
                  label="Prompt snippets"
                  hint="/"
                  onSelect={() => {
                    close();
                    promptSnippets.onSelect();
                  }}
                />
              ) : null}
              <PopoverSeparator />
              <PlusMenuRow
                icon="ph:sliders-horizontal"
                label="Model & tuning…"
                onSelect={() => {
                  close();
                  onOpenModelTuning();
                }}
              />
              {enhance ? (
                <>
                  {/* Same split semantics the old sparkle control had: the
                      main item is one-click smart enhance; the options item
                      opens the intent list (Clarify, Expand, …). */}
                  <PlusMenuRow
                    icon="ph:sparkle"
                    label={enhance.loading ? "Enhancing…" : "Enhance prompt"}
                    live={enhance.loading}
                    disabled={enhance.disabled && !enhance.loading}
                    onSelect={() => {
                      close();
                      enhance.onEnhance("auto");
                    }}
                  />
                  <PlusMenuRow
                    icon="ph:caret-right"
                    label="Enhance options…"
                    disabled={enhance.disabled && !enhance.loading}
                    onSelect={() => setView("enhance")}
                  />
                </>
              ) : null}
            </>
          ) : (
            <>
              <PlusMenuRow
                icon="ph:caret-left"
                label="Enhance options"
                onSelect={() => setView("root")}
              />
              <PopoverSeparator />
              {ENHANCE_INTENTS.map((intent) => (
                <PlusMenuRow
                  key={intent.id}
                  icon="ph:sparkle"
                  label={intent.label}
                  disabled={enhance?.disabled && !enhance?.loading}
                  onSelect={() => {
                    close();
                    enhance?.onEnhance(intent.id);
                  }}
                />
              ))}
            </>
          )}
        </PopoverBody>
      </Popover>
    </>
  );
}
