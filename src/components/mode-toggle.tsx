"use client";

/**
 * ModeToggle — segmented Light / Dark control. Pure presentational.
 *
 * Lives in the Appearance settings section above the theme grid.
 * Caller is responsible for persistence + applying `data-mode` on <html>.
 */

import { Icon, type IconName } from "@/lib/icon";
import type { Mode } from "@/lib/theme-storage";

interface ModeToggleProps {
  value: Mode;
  onChange: (next: Mode) => void;
}

const OPTIONS: { id: Mode; label: string; icon: IconName }[] = [
  { id: "light", label: "Light", icon: "ph:sun" },
  { id: "dark", label: "Dark", icon: "ph:moon" },
];

export function ModeToggle({ value, onChange }: ModeToggleProps) {
  return (
    <div
      role="group"
      aria-label="Color mode"
      className="inline-flex items-center gap-0.5 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-base)] p-0.5"
    >
      {OPTIONS.map((opt) => {
        const active = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.id)}
            className={`mode-toggle__option inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors ${
              active
                ? "bg-[var(--bg-raised)] text-[var(--text-primary)]"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
          >
            <Icon name={opt.icon} width={14} />
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
