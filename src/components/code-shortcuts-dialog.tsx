"use client";

/**
 * CodeShortcutsDialog — rebindable Coding Room shortcuts (cave-0rcku).
 *
 * The `Cody Code Reading v2` frame does not just *list* keys, it lets you take
 * them: press Rebind, press the combo, done, saved on this device. The rule its
 * own footer states — "a duplicate combo takes the key from the older binding"
 * — is implemented in `code-shortcuts.ts` and shown here, because the displaced
 * binding turning visibly `unbound` in the same list is what makes the trade
 * legible instead of mysterious.
 *
 * While capturing, every keydown is swallowed: a rebind that also fired the
 * action it was rebinding would be a trap.
 */

import { useCallback, useEffect, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { useAnnouncer } from "@/components/ui/live-region";
import { CODE_ROOM_SHORTCUT_HINTS } from "@/lib/code-room-shortcuts";
import {
  CODE_SHORTCUTS,
  bindCodeShortcut,
  codeComboChips,
  codeComboFromEvent,
  defaultCodeKeymap,
  type CodeShortcutId,
} from "@/lib/code-shortcuts";

/** Human labels for the fixed terminal bindings. */
const FIXED_LABEL: Record<string, string> = {
  "focus-next-terminal": "Focus the next terminal pane",
  "focus-previous-terminal": "Focus the previous terminal pane",
  "split-right": "Split the pane right",
  "split-down": "Split the pane down",
  "close-terminal": "Close the pane",
  "toggle-broadcast": "Broadcast typing to every pane",
};

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
      // Swallow everything while capturing, including Escape — Escape is a
      // bindable key, and letting it close the dialog would make it unbindable.
      event.preventDefault();
      event.stopPropagation();
      const combo = codeComboFromEvent(event);
      if (!combo) return;
      if (combo === "Escape") {
        setCapturing(null);
        announce("Rebinding cancelled.");
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
  }, [announce, capturing, keymap, onChange]);

  const reset = useCallback(() => {
    onChange(defaultCodeKeymap());
    setCapturing(null);
    announce("Shortcuts reset to defaults.");
  }, [announce, onChange]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      breadcrumb={["Coding Room", "Keyboard shortcuts"]}
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
                  <span className="code-keys__capturing">Press keys… (Esc cancels)</span>
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
                aria-pressed={isCapturing}
                onClick={() => setCapturing(isCapturing ? null : shortcut.id)}
              >
                {isCapturing ? "Cancel" : "Rebind"}
              </button>
              <button
                type="button"
                className="focus-ring code-keys__unbind"
                disabled={!combo || isCapturing}
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
      {/* The terminal's own bindings are FIXED — they resolve inside a focused
          pane, before this keymap is consulted. Listing them here is what stops
          a rebind from silently colliding with a key that will never reach it. */}
      <p className="code-keys__section">Terminal panes — fixed</p>
      <ul className="code-keys">
        {(Object.entries(CODE_ROOM_SHORTCUT_HINTS) as [string, string][]).map(([id, hint]) => (
          <li key={id} className="code-keys__row">
            <span className="code-keys__label">{FIXED_LABEL[id] ?? id}</span>
            <span className="code-keys__combo">
              <kbd className="code-keys__kbd">{hint}</kbd>
            </span>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
