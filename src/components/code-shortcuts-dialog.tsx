"use client";

/**
 * CodeShortcutsDialog — rebindable Coding Desk shortcuts (cave-0rcku).
 *
 * The `Cody Code Reading v2` frame does not just *list* keys, it lets you take
 * them: press Rebind, press the combo, done, saved on this device. The rule its
 * own footer states — "a duplicate combo takes the key from the older binding"
 * — is implemented in `code-shortcuts.ts` and shown here, because the displaced
 * binding turning visibly `unbound` in the same list is what makes the trade
 * legible instead of mysterious.
 *
 * While capturing, every keydown but Tab is swallowed: a rebind that also
 * fired the action it was rebinding would be a trap. Tab ends the capture and
 * moves on, and the other keys that move around the page are refused (#5795).
 */

import { useCallback, useEffect, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { useAnnouncer } from "@/components/ui/live-region";
import {
  CODE_APP_RESERVED_SHORTCUTS,
  CODE_FIXED_QUEUE_SHORTCUTS,
  CODE_FIXED_TERMINAL_SHORTCUTS,
  CODE_SHORTCUTS,
  bindCodeShortcut,
  codeRequiredComboHolder,
  isCodeShortcutRequired,
  codeComboChips,
  codeComboFromEvent,
  codeReservedComboOwner,
  defaultCodeKeymap,
  isCodeNavigationCombo,
  type CodeShortcutId,
} from "@/lib/code-shortcuts";

export type CodeShortcutsDialogProps = {
  open: boolean;
  onClose: () => void;
  keymap: Record<CodeShortcutId, string>;
  onChange: (keymap: Record<CodeShortcutId, string>) => void;
};

export function CodeShortcutsDialog({ open, onClose, keymap, onChange }: CodeShortcutsDialogProps) {
  const [capturing, setCapturing] = useState<CodeShortcutId | null>(null);
  const { announce } = useAnnouncer();
  const apple =
    typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);

  useEffect(() => {
    if (!open) setCapturing(null);
  }, [open]);

  useEffect(() => {
    if (!capturing) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const combo = codeComboFromEvent(event);
      // Tab and Shift+Tab end the capture and move on as they always do
      // (#5795): capture took Tab as the binding, and from then on every Tab
      // on the desk opened the session picker.
      if (combo === "Tab" || combo === "Shift+Tab") {
        setCapturing(null);
        announce("Rebinding cancelled.");
        return;
      }
      // Swallow everything else while capturing, including Escape — Escape is
      // a bindable key, and letting it close the dialog would make it unbindable.
      event.preventDefault();
      event.stopPropagation();
      if (!combo) return;
      if (combo === "Escape") {
        setCapturing(null);
        announce("Rebinding cancelled.");
        return;
      }
      // Enter, Space, the arrows, Home, End and the page keys press and move
      // through the desk's controls; on their own they'd take that away.
      if (isCodeNavigationCombo(combo)) {
        const key = combo.slice(combo.lastIndexOf("+") + 1);
        const named = key.startsWith("Arrow") ? "An arrow key" : key.replace(/^Page(Up|Down)$/, "Page $1");
        announce(`${named} is how the desk is used from the keyboard, so a shortcut with it needs ${apple ? "⌘" : "Ctrl"} or ${apple ? "⌥" : "Alt"} too.`);
        return;
      }
      const reservedOwner = codeReservedComboOwner(combo);
      if (reservedOwner) {
        announce(`That shortcut is reserved for the ${reservedOwner}.`);
        return;
      }
      const holder = codeRequiredComboHolder(keymap, capturing, combo);
      if (holder) {
        const holderLabel = CODE_SHORTCUTS.find((s) => s.id === holder)?.label ?? holder;
        announce(`That shortcut belongs to ${holderLabel}, which always keeps a key.`);
        return;
      }
      const displaced = CODE_SHORTCUTS.find((s) => s.id !== capturing && keymap[s.id] === combo);
      onChange(bindCodeShortcut(keymap, capturing, combo));
      setCapturing(null);
      announce(
        displaced
          ? `Bound to ${combo}. ${displaced.label} is now unbound.`
          : `Bound to ${combo}.`,
      );
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [announce, apple, capturing, keymap, onChange]);

  const reset = useCallback(() => {
    onChange(defaultCodeKeymap());
    setCapturing(null);
    announce("Shortcuts reset to defaults.");
  }, [announce, onChange]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      breadcrumb={["Coding Desk", "Keyboard shortcuts"]}
      dismissOnEscape={!capturing}
      footerPills={
        <span className="code-keys__footnote">
          Saved on this device. A duplicate combo takes the key from the older binding.
        </span>
      }
      footerActions={
        <>
          <Button variant="ghost" size="sm" onClick={reset}>
            Reset defaults
          </Button>
          <Button size="sm" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <ul className="code-keys">
        {CODE_SHORTCUTS.map((shortcut) => {
          const combo = keymap[shortcut.id] ?? "";
          const isCapturing = capturing === shortcut.id;
          return (
            <li key={shortcut.id} className="code-keys__row">
              <span className="code-keys__label">{shortcut.label}</span>
              <span className="code-keys__combo">
                {isCapturing ? (
                  <span className="code-keys__capturing">Press keys… (Esc or Tab cancels)</span>
                ) : combo ? (
                  codeComboChips(combo, apple).map((chip, i) => (
                    <kbd key={`${chip}-${i}`} className="code-keys__kbd">
                      {chip}
                    </kbd>
                  ))
                ) : (
                  <span className="code-keys__unbound">unbound</span>
                )}
              </span>
              <button
                type="button"
                className="focus-ring code-keys__rebind"
                // Named for its shortcut (#5781): ten buttons all read "Rebind".
                // The label says what it does, so it isn't also a pressed toggle.
                aria-label={`${isCapturing ? "Cancel rebinding" : "Rebind"} ${shortcut.label}`}
                onClick={() => setCapturing(isCapturing ? null : shortcut.id)}
              >
                {isCapturing ? "Cancel" : "Rebind"}
              </button>
              <button
                type="button"
                className="focus-ring code-keys__unbind"
                aria-label={`Unbind ${shortcut.label}`}
                // The terminal toggle is the way out of a focused terminal, so
                // it can be rebound but never unbound (#5729).
                disabled={!combo || isCapturing || isCodeShortcutRequired(shortcut.id)}
                title={isCodeShortcutRequired(shortcut.id) ? "Always keeps a key: it is the way out of a focused terminal" : undefined}
                onClick={() => {
                  onChange(bindCodeShortcut(keymap, shortcut.id, ""));
                  announce(`${shortcut.label} unbound.`);
                }}
              >
                Unbind
              </button>
            </li>
          );
        })}
      </ul>
      {/* Queue and terminal bindings are FIXED — they resolve before this
          per-session keymap. Listing them here is what stops a rebind from
          silently colliding with a key that will never reach it. */}
      <p className="code-keys__section">Session queue — fixed</p>
      <ul className="code-keys">
        {CODE_FIXED_QUEUE_SHORTCUTS.map((shortcut) => (
          <li key={shortcut.id} className="code-keys__row">
            <span className="code-keys__label">{shortcut.label}</span>
            <span className="code-keys__combo">
              {codeComboChips(shortcut.combo, apple).map((chip, i) => (
                <kbd key={`${shortcut.id}-${chip}-${i}`} className="code-keys__kbd">
                  {chip}
                </kbd>
              ))}
            </span>
          </li>
        ))}
      </ul>
      <p className="code-keys__section">Terminal panes — fixed</p>
      <ul className="code-keys">
        {CODE_FIXED_TERMINAL_SHORTCUTS.map((shortcut) => (
          <li key={shortcut.id} className="code-keys__row">
            <span className="code-keys__label">{shortcut.label}</span>
            <span className="code-keys__combo">
              {codeComboChips(shortcut.combo, apple).map((chip, i) => (
                <kbd key={`${shortcut.id}-${chip}-${i}`} className="code-keys__kbd">
                  {chip}
                </kbd>
              ))}
            </span>
          </li>
        ))}
      </ul>
      {/* The app's own keys run before the desk's on every surface (#5729),
          so they are listed as taken rather than left to fail silently. */}
      <p className="code-keys__section">App-wide — fixed</p>
      <ul className="code-keys">
        {CODE_APP_RESERVED_SHORTCUTS.map((shortcut) => (
          <li key={shortcut.id} className="code-keys__row">
            <span className="code-keys__label">{shortcut.label}</span>
            <span className="code-keys__combo">
              {codeComboChips(shortcut.combo, apple).map((chip, i) => (
                <kbd key={`${shortcut.id}-${chip}-${i}`} className="code-keys__kbd">
                  {chip}
                </kbd>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
