"use client";

import "@/styles/cave-composer.css";
import "@/styles/composer-enhance.css";

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
  disabled: disabledByComposer,
  unavailableReason,
  size = "md",
}: {
  state: PromptEnhanceState;
  onEnhance: (intent: EnhanceIntent) => void;
  onCancel: () => void;
  disabled?: boolean;
  /** Why Enhance can't run here (e.g. no familiar). Disables both segments
   *  and is shown as the control's tooltip and accessible description. */
  unavailableReason?: string | null;
  /** Height language of the hosting composer — "md" sits with the 30px
   *  icon-button rows (home, chat); "sm" matches the 26px `Button size="sm"`
   *  Send button (quick chat). */
  size?: "sm" | "md";
}) {
  const disabled = disabledByComposer || Boolean(unavailableReason);
  const [menuOpen, setMenuOpen] = useState(false);
  const mainRef = useRef<HTMLButtonElement | null>(null);
  const optionsRef = useRef<HTMLButtonElement | null>(null);
  const menuAnchorRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const keyboardOpenRequested = useRef(false);
  const consumedPress = useRef(false);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressOrigin = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const loading = state.phase === "loading";

  const clearPress = useCallback(() => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = null;
  }, []);
  const abandonPress = useCallback(() => {
    if (pressOrigin.current) consumedPress.current = true;
    pressOrigin.current = null;
    clearPress();
  }, [clearPress]);
  useEffect(() => clearPress, [clearPress]);
  useEffect(() => {
    if (disabled || loading) {
      abandonPress();
      setMenuOpen(false);
    }
  }, [abandonPress, disabled, loading]);

  const focusFirstIntent = useCallback(() => {
    keyboardOpenRequested.current = false;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, []);
  useEffect(() => {
    if (!menuOpen || !keyboardOpenRequested.current) return;
    const frame = requestAnimationFrame(focusFirstIntent);
    return () => cancelAnimationFrame(frame);
  }, [focusFirstIntent, menuOpen]);

  const openFromKeyboard = (anchor: HTMLButtonElement | null) => {
    if (loading || disabled) return;
    keyboardOpenRequested.current = true;
    menuAnchorRef.current = anchor;
    if (menuOpen) focusFirstIntent();
    else setMenuOpen(true);
  };

  // Both segments share one hairline rectangle — borderless inside, split by
  // a hairline divider, height matched to the composer's Send button. They use
  // their own segment class (NOT cave-composer-icon-button): the mobile
  // touch-target override turns that class into 44px circles, which blew the
  // segments out of the rectangle. Here the rectangle itself is the control —
  // two flat rectangles inside it, the sparkle wider than the caret.
  const heightClass = size === "sm" ? "h-[26px]" : "h-[30px]";
  const segmentBtn = `composer-enhance-control__segment focus-ring grid ${heightClass} place-items-center hover:bg-[var(--bg-raised)] disabled:opacity-40`;

  return (
    <span
      className="composer-enhance-control inline-flex items-stretch overflow-hidden rounded-[var(--radius-control)] border border-[var(--border-hairline)]"
      // Disabled buttons drop hover in some engines; the wrapper keeps the
      // reason discoverable.
      title={!loading && unavailableReason ? unavailableReason : undefined}
    >
      <button
        ref={mainRef}
        type="button"
        className={`${segmentBtn} px-2`}
        title={loading ? "Cancel enhancement" : unavailableReason ?? "Enhance prompt"}
        aria-label={loading ? "Cancel enhancement" : "Enhance prompt"}
        disabled={disabled && !loading}
        onClick={(event) => {
          clearPress();
          // A long press ends in a click on touch and pointer devices. Opening
          // the menu consumes that click; a later keyboard activation does not.
          if (consumedPress.current && event.detail !== 0) {
            consumedPress.current = false;
            return;
          }
          consumedPress.current = false;
          if (loading) onCancel();
          else onEnhance("auto");
        }}
        onPointerDown={(event) => {
          if (event.button !== 0 || event.isPrimary === false) return;
          clearPress();
          pressOrigin.current = null;
          keyboardOpenRequested.current = false;
          consumedPress.current = false;
          if (loading || disabled) return;
          // Context chips can wrap while a finger or mouse is stationary.
          // Capture keeps that layout shift from cancelling the hold; actual
          // movement still abandons it and consumes the captured release click.
          try {
            event.currentTarget.setPointerCapture(event.pointerId);
          } catch {
            return;
          }
          pressOrigin.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
          pressTimer.current = setTimeout(() => {
            consumedPress.current = true;
            menuAnchorRef.current = mainRef.current;
            // Safari does not focus buttons on pointer activation. Establish
            // the trigger before opening so Escape cannot leave focus behind.
            mainRef.current?.focus();
            setMenuOpen(true);
          }, LONG_PRESS_MS);
        }}
        onPointerMove={(event) => {
          const origin = pressOrigin.current;
          if (origin?.pointerId === event.pointerId && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 8) abandonPress();
        }}
        onPointerUp={(event) => {
          if (pressOrigin.current && pressOrigin.current.pointerId !== event.pointerId) return;
          pressOrigin.current = null;
          clearPress();
        }}
        onPointerCancel={(event) => {
          if (pressOrigin.current?.pointerId === event.pointerId) abandonPress();
        }}
        onLostPointerCapture={(event) => {
          if (pressOrigin.current?.pointerId === event.pointerId) abandonPress();
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            openFromKeyboard(mainRef.current);
          }
        }}
      >
        {loading ? (
          <Icon
            name="ph:stop-fill"
            width={15}
            aria-hidden
            className="text-[var(--text-primary)]"
          />
        ) : (
          <Icon name="ph:sparkle" width={15} aria-hidden />
        )}
      </button>
      <button
        ref={optionsRef}
        type="button"
        className={`${segmentBtn} w-[18px] border-l border-[var(--border-hairline)] text-[var(--text-muted)] hover:text-[var(--text-primary)]`}
        aria-label="Enhance options"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        disabled={disabled || loading}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown") return;
          event.preventDefault();
          openFromKeyboard(optionsRef.current);
        }}
        onClick={(event) => {
          keyboardOpenRequested.current = event.detail === 0;
          menuAnchorRef.current = optionsRef.current;
          optionsRef.current?.focus();
          setMenuOpen((v) => !v);
        }}
      >
        <Icon name="ph:caret-down-bold" width={9} aria-hidden />
      </button>
      <Popover
        open={menuOpen}
        onOpenChange={setMenuOpen}
        anchorRef={menuAnchorRef}
        placement="top-end"
        minWidth={200}
        ariaLabel="Enhance options"
      >
        <div ref={menuRef} onKeyDown={(event) => {
          if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
          const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
          if (!items.length) return;
          event.preventDefault();
          event.stopPropagation();
          const current = items.indexOf(document.activeElement as HTMLElement);
          const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
            : event.key === "ArrowDown" ? (current + 1) % items.length
              : current <= 0 ? items.length - 1 : current - 1;
          items[next]?.focus();
        }}>
          <PopoverBody role="menu" ariaLabel="Enhance options">
            {ENHANCE_INTENTS.map((intent, i) => (
              <span key={intent.id}>
                <PopoverItem
                  onSelect={() => {
                    // The options trigger disables during loading. Keep focus
                    // on the main segment, which becomes the Cancel control.
                    mainRef.current?.focus();
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
        </div>
      </Popover>
    </span>
  );
}

/** The status strip under the composer: streaming preview while loading,
 *  Apply/Dismiss for a suggestion that arrived after the draft changed,
 *  Revert after an in-place apply, and error reporting with Retry. */
export function EnhanceStrip({
  state,
  onApply,
  onDismiss,
  onRevert,
  onCancel,
  onRetry,
  onFocusComposer,
}: {
  state: PromptEnhanceState;
  onApply: () => void;
  onDismiss: () => void;
  onRevert: () => void;
  onCancel: () => void;
  /** Re-runs a failed enhancement; offered only when retrying can help. */
  onRetry?: () => void;
  /** User-action-only focus return after a strip control unmounts. */
  onFocusComposer?: () => void;
}) {
  if (state.phase === "idle") return null;
  const recommendation =
    state.phase === "suggested" || state.phase === "applied" ? state.recommendation : null;
  const evidenceGroups = new Map<string, { label: string; count: number }>();
  for (const evidence of recommendation?.evidenceRefs ?? []) {
    const key = `${evidence.kind}:${evidence.label}`;
    const previous = evidenceGroups.get(key);
    evidenceGroups.set(key, { label: evidence.label, count: (previous?.count ?? 0) + 1 });
  }

  const actionClass =
    "composer-enhance-strip__action focus-ring";
  const focusComposerAfterAction = () => {
    requestAnimationFrame(() => onFocusComposer?.());
  };

  if (state.phase === "error") {
    return (
      <div
        role="alert"
        className="composer-enhance-strip composer-enhance-strip--error"
      >
        <Icon name="ph:warning-circle" width={12} aria-hidden className="shrink-0 text-[var(--color-warning)]" />
        <span className="composer-enhance-strip__message">{state.message}</span>
        {state.retryable && onRetry ? (
          <button
            type="button"
            className={actionClass}
            onClick={() => {
              onRetry();
              focusComposerAfterAction();
            }}
            aria-label="Retry enhance"
          >
            Retry
          </button>
        ) : null}
        <button
          type="button"
          className={actionClass}
          onClick={() => {
            onDismiss();
            focusComposerAfterAction();
          }}
          aria-label="Dismiss enhance error"
        >
          Dismiss
        </button>
      </div>
    );
  }

  return (
    <div
      className="composer-enhance-strip"
      data-phase={state.phase}
    >
      <div className="composer-enhance-strip__row" role="status">
        {state.phase === "loading" ? (
          <>
            <Icon name="ph:sparkle" width={12} aria-hidden className="shrink-0 animate-pulse text-[var(--accent-presence)]" />
            <span className="composer-enhance-strip__message">Enhancing…</span>
            <button
              type="button"
              className={actionClass}
              onClick={() => {
                onCancel();
                focusComposerAfterAction();
              }}
              aria-label="Cancel enhance"
            >
              Cancel
            </button>
          </>
        ) : state.phase === "suggested" ? (
          <>
            <Icon name="ph:sparkle" width={12} aria-hidden className="shrink-0 text-[var(--text-secondary)]" />
            <span className="composer-enhance-strip__message">
              Enhanced version ready.
            </span>
            <button
              type="button"
              className={actionClass}
              onClick={() => {
                onApply();
                focusComposerAfterAction();
              }}
              aria-label="Apply enhanced prompt"
            >
              Apply
            </button>
            <button
              type="button"
              className={actionClass}
              onClick={() => {
                onDismiss();
                focusComposerAfterAction();
              }}
              aria-label="Dismiss enhanced prompt"
            >
              Dismiss
            </button>
          </>
        ) : state.phase === "applied" ? (
          <>
            <Icon name="ph:check" width={12} aria-hidden className="shrink-0 text-[var(--text-secondary)]" />
            <span className="composer-enhance-strip__message">
              Prompt improved.
            </span>
            <button
              type="button"
              className={actionClass}
              onClick={() => {
                onRevert();
                focusComposerAfterAction();
              }}
              aria-label="Revert enhanced prompt"
            >
              Revert
            </button>
          </>
        ) : null}
      </div>
      {state.phase === "suggested" ? (
        <div className="composer-enhance-strip__preview focus-ring" role="region" aria-label="Enhanced prompt preview" tabIndex={0}>
          {state.enhanced}
        </div>
      ) : state.phase === "loading" && state.preview ? (
        <div className="composer-enhance-strip__preview" aria-hidden="true">{state.preview}</div>
      ) : null}
      {recommendation ? (
        <details className="composer-enhance-strip__details" key={recommendation.id}>
          <summary className="focus-ring">Why this?</summary>
          <p>{recommendation.rationale}</p>
          {recommendation.evidenceRefs.length > 0 ? (
            <ul className="composer-enhance-strip__evidence" aria-label="Evidence">
              {Array.from(
                evidenceGroups,
                ([key, evidence]) => (
                  <li key={key}>
                    {evidence.label}{evidence.count > 1 ? ` × ${evidence.count}` : ""}
                  </li>
                ),
              )}
            </ul>
          ) : null}
        </details>
      ) : null}
    </div>
  );
}
