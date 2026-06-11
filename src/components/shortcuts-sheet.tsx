"use client";

import { Modal } from "@/components/ui/modal";
import { platformizeHint, useKeySymbols } from "@/lib/platform-keys";
import { SHORTCUT_GROUPS } from "@/lib/keyboard-shortcuts";

/**
 * Keyboard shortcuts sheet — opened with ⌘/ (Ctrl+/ off-Mac) or `?` outside
 * an input (wired in workspace.tsx, next to the ⌘K palette listener), or via
 * the /shortcuts slash command. Renders the static catalog from
 * src/lib/keyboard-shortcuts.ts through the shared a11y Modal, so Esc-close
 * and focus restore come from useFocusTrap for free.
 */
export function ShortcutsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const keys = useKeySymbols();
  return (
    <Modal
      open={open}
      onClose={onClose}
      breadcrumb={["CovenCave", "Keyboard shortcuts"]}
      wide
      ariaLabel="Keyboard shortcuts"
    >
      <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
        {SHORTCUT_GROUPS.map((group) => (
          <section key={group.id} aria-label={group.label}>
            <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
              {group.label}
            </h3>
            <ul className="flex flex-col gap-1.5">
              {group.entries.map((entry) => (
                <li
                  key={`${entry.keys} ${entry.description}`}
                  className="flex items-center justify-between gap-3 text-[13px]"
                >
                  <span className="text-[var(--text-secondary)]">{entry.description}</span>
                  <kbd className="shell-kbd whitespace-nowrap">
                    {platformizeHint(entry.keys, keys)}
                  </kbd>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Modal>
  );
}
