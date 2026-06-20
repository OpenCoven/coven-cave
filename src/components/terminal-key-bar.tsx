"use client";

import { Icon, type IconName } from "@/lib/icon";

// Escape sequences the soft keyboard can't produce. Arrow keys use the
// standard CSI cursor sequences xterm expects.
const KEYS = {
  esc: "\x1b",
  tab: "\t",
  up: "\x1b[A",
  down: "\x1b[B",
  left: "\x1b[D",
  right: "\x1b[C",
} as const;

type Props = {
  /** Inject a raw sequence as if typed (routes through xterm.onData → pty). */
  onKey: (seq: string) => void;
  /** Sticky Ctrl: when active, the next soft-keyboard character is sent as its
   *  control code. The bar only reflects/toggles the state — the transform
   *  itself lives in the terminal's onData handler. */
  ctrlActive: boolean;
  onToggleCtrl: () => void;
};

const KEY_CLASS =
  "terminal-key inline-flex min-h-[var(--touch-target)] min-w-[var(--touch-target)] flex-shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-[var(--border-hairline)] bg-[var(--bg-base)] px-2.5 text-[12px] font-medium text-[var(--text-secondary)] active:bg-[var(--bg-hover)]";

/**
 * Touch-only accessory bar for the mobile terminal. iOS/Android soft keyboards
 * omit Esc, Tab, Ctrl, and arrow keys — which makes a shell (let alone vim or a
 * TUI) unusable. This bar surfaces them as 44px targets just above the keyboard.
 */
export function TerminalKeyBar({ onKey, ctrlActive, onToggleCtrl }: Props) {
  return (
    <div
      className="terminal-key-bar flex items-center gap-1.5 overflow-x-auto border-t border-[var(--border-hairline)] bg-[var(--bg-raised)] px-2 py-1.5 [padding-bottom:calc(6px+var(--sai-bottom))]"
      role="toolbar"
      aria-label="Terminal keys"
    >
      <button type="button" className={KEY_CLASS} onClick={() => onKey(KEYS.esc)} aria-label="Escape">
        esc
      </button>
      <button type="button" className={KEY_CLASS} onClick={() => onKey(KEYS.tab)} aria-label="Tab">
        tab
      </button>
      <button
        type="button"
        className={`${KEY_CLASS}${ctrlActive ? " terminal-key--active !border-[color-mix(in_oklch,var(--accent-presence)_55%,var(--border-hairline))] !bg-[color-mix(in_oklch,var(--accent-presence)_18%,var(--bg-base))] !text-[var(--text-primary)]" : ""}`}
        onClick={onToggleCtrl}
        aria-pressed={ctrlActive}
      >
        ctrl
      </button>
      <span className="flex-1" aria-hidden />
      <ArrowKey label="Left" icon="ph:arrow-left-bold" onClick={() => onKey(KEYS.left)} />
      <ArrowKey label="Up" icon="ph:arrow-up-bold" onClick={() => onKey(KEYS.up)} />
      <ArrowKey label="Down" icon="ph:arrow-down-bold" onClick={() => onKey(KEYS.down)} />
      <ArrowKey label="Right" icon="ph:arrow-right-bold" onClick={() => onKey(KEYS.right)} />
    </div>
  );
}

function ArrowKey({ label, icon, onClick }: { label: string; icon: IconName; onClick: () => void }) {
  return (
    <button type="button" className={KEY_CLASS} onClick={onClick} aria-label={label}>
      <Icon name={icon} width={14} aria-hidden />
    </button>
  );
}
