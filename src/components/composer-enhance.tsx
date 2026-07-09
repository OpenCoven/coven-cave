"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import { Popover, PopoverBody, PopoverItem, PopoverSeparator } from "@/components/ui/popover";
import { ENHANCE_INTENTS, type EnhanceIntent } from "@/lib/prompt-enhancer";
import type { PromptEnhanceState } from "@/lib/use-prompt-enhance";

// Shared Enhance UI (cave-b6c2): the sparkle control + the status strip, used
// identically by the home, chat, and quick-chat composers so the premium
// enhance behaviour ships everywhere at once.

const LONG_PRESS_MS = 420;

/** Sparkle split-control in the composer's 30px round-button language.
 *  Click = smart enhance; the chevron (or ArrowDown / long-press on the main
 *  button) opens the intent menu. Accent shows only while loading. */
export function EnhanceControl({
  state,
  onEnhance,
  onCancel,
  disabled,
}: {
  state: PromptEnhanceState;
  onEnhance: (intent: EnhanceIntent) => void;
  onCancel: () => void;
  disabled?: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const mainRef = useRef<HTMLButtonElement | null>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loading = state.phase === "loading";

  const clearPress = useCallback(() => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = null;
  }, []);
  useEffect(() => clearPress, [clearPress]);

  const baseBtn =
    "cave-composer-icon-button focus-ring grid h-[30px] w-[30px] place-items-center rounded-full border border-[var(--border-hairline)] hover:bg-[var(--bg-raised)] disabled:opacity-40";

  return (
    <span className="composer-enhance-control inline-flex items-center gap-0.5">
      <button
        ref={mainRef}
        type="button"
        className={baseBtn}
        title="Enhance prompt"
        aria-label="Enhance prompt"
        disabled={disabled && !loading}
        onClick={() => {
          clearPress();
          if (loading) onCancel();
          else onEnhance("auto");
        }}
        onPointerDown={() => {
          if (loading || disabled) return;
          clearPress();
          pressTimer.current = setTimeout(() => setMenuOpen(true), LONG_PRESS_MS);
        }}
        onPointerUp={clearPress}
        onPointerLeave={clearPress}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setMenuOpen(true);
          }
        }}
      >
        {loading ? (
          <Icon
            name="ph:sparkle"
            width={15}
            aria-hidden
            className="animate-pulse text-[var(--accent-presence)]"
          />
        ) : (
          <Icon name="ph:sparkle" width={15} aria-hidden />
        )}
      </button>
      <button
        type="button"
        className="cave-composer-icon-button focus-ring grid h-[30px] w-4 place-items-center rounded-full text-[var(--text-muted)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)] disabled:opacity-40"
        aria-label="Enhance options"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        disabled={disabled || loading}
        onClick={() => setMenuOpen((v) => !v)}
      >
        <Icon name="ph:caret-down-bold" width={9} aria-hidden />
      </button>
      <Popover
        open={menuOpen}
        onOpenChange={setMenuOpen}
        anchorRef={mainRef}
        placement="top-end"
        minWidth={200}
        ariaLabel="Enhance options"
      >
        <PopoverBody role="menu" ariaLabel="Enhance options">
          {ENHANCE_INTENTS.map((intent, i) => (
            <span key={intent.id}>
              <PopoverItem
                onSelect={() => {
                  setMenuOpen(false);
                  onEnhance(intent.id);
                }}
              >
                {intent.label}
              </PopoverItem>
              {i === 0 ? <PopoverSeparator /> : null}
            </span>
          ))}
        </PopoverBody>
      </Popover>
    </span>
  );
}

/** The status strip under the composer: streaming preview while loading,
 *  Apply/Dismiss for a suggestion that arrived after the draft changed,
 *  Revert after an in-place apply, and error reporting. */
export function EnhanceStrip({
  state,
  onApply,
  onDismiss,
  onRevert,
  onCancel,
}: {
  state: PromptEnhanceState;
  onApply: () => void;
  onDismiss: () => void;
  onRevert: () => void;
  onCancel: () => void;
}) {
  if (state.phase === "idle") return null;

  const pillBtn =
    "focus-ring rounded-full border border-[var(--border-hairline)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]";

  return (
    <div
      role="status"
      className="composer-enhance-strip flex items-center gap-2 border-t border-[var(--border-hairline)] px-3 py-1.5 text-[11px] text-[var(--text-muted)]"
    >
      {state.phase === "loading" ? (
        <>
          <Icon name="ph:sparkle" width={12} aria-hidden className="shrink-0 animate-pulse text-[var(--accent-presence)]" />
          <span className="min-w-0 flex-1 truncate">
            {state.preview ? state.preview : "Enhancing…"}
          </span>
          <button type="button" className={pillBtn} onClick={onCancel} aria-label="Cancel enhance">
            Cancel
          </button>
        </>
      ) : state.phase === "suggested" ? (
        <>
          <Icon name="ph:sparkle" width={12} aria-hidden className="shrink-0 text-[var(--text-secondary)]" />
          <span className="min-w-0 flex-1 truncate" title={state.enhanced}>
            Enhanced version ready{state.offline ? " (offline)" : ""}: {state.enhanced}
          </span>
          <button type="button" className={pillBtn} onClick={onApply} aria-label="Apply enhanced prompt">
            Apply
          </button>
          <button type="button" className={pillBtn} onClick={onDismiss} aria-label="Dismiss enhanced prompt">
            Dismiss
          </button>
        </>
      ) : state.phase === "applied" ? (
        <>
          <Icon name="ph:check" width={12} aria-hidden className="shrink-0 text-[var(--text-secondary)]" />
          <span className="min-w-0 flex-1 truncate">
            Prompt improved{state.offline ? " (offline)" : ""}.
          </span>
          <button type="button" className={pillBtn} onClick={onRevert} aria-label="Revert enhanced prompt">
            Revert
          </button>
        </>
      ) : (
        <>
          <Icon name="ph:warning-circle" width={12} aria-hidden className="shrink-0 text-[var(--color-warning)]" />
          <span className="min-w-0 flex-1 truncate">{state.message}</span>
          <button type="button" className={pillBtn} onClick={onDismiss} aria-label="Dismiss enhance error">
            Dismiss
          </button>
        </>
      )}
    </div>
  );
}
