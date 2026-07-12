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

/** Sparkle split-control: one minimal rectangle (control-radius, hairline
 *  border) holding the sparkle segment and the caret segment — a single
 *  combined control, not two floating round buttons.
 *  Click = smart enhance; the caret (or ArrowDown / long-press on the main
 *  segment) opens the intent menu. Accent shows only while loading. */
export function EnhanceControl({
  state,
  onEnhance,
  onCancel,
  disabled,
  size = "md",
}: {
  state: PromptEnhanceState;
  onEnhance: (intent: EnhanceIntent) => void;
  onCancel: () => void;
  disabled?: boolean;
  /** Height language of the hosting composer — "md" sits with the 30px
   *  icon-button rows (home, chat); "sm" matches the 26px `Button size="sm"`
   *  Send button (quick chat). */
  size?: "sm" | "md";
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

  // Both segments share one hairline rectangle — borderless inside, split by
  // a hairline divider, height matched to the composer's Send button. They use
  // their own segment class (NOT cave-composer-icon-button): the mobile
  // touch-target override turns that class into 44px circles, which blew the
  // segments out of the rectangle. Here the rectangle itself is the control —
  // two flat rectangles inside it, the sparkle wider than the caret.
  const heightClass = size === "sm" ? "h-[26px]" : "h-[30px]";
  const segmentBtn = `composer-enhance-control__segment focus-ring grid ${heightClass} place-items-center hover:bg-[var(--bg-raised)] disabled:opacity-40`;

  return (
    <span className="composer-enhance-control inline-flex items-stretch overflow-hidden rounded-[var(--radius-control)] border border-[var(--border-hairline)]">
      <button
        ref={mainRef}
        type="button"
        className={`${segmentBtn} px-2`}
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
        className={`${segmentBtn} w-[18px] border-l border-[var(--border-hairline)] text-[var(--text-muted)] hover:text-[var(--text-primary)]`}
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
    "focus-ring rounded-[var(--radius-pill)] border border-[var(--border-hairline)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]";

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
