"use client";

/**
 * ModeToggle — segmented Light / Dark control. Pure presentational.
 *
 * Lives in the Appearance settings section above the theme grid.
 * Caller is responsible for persistence + applying `data-mode` on <html>.
 */

import { Button } from "@/components/ui/button";
import type { IconName } from "@/lib/icon";
import type { ModePref } from "@/lib/theme-storage";

interface ModeToggleProps {
  value: ModePref;
  onChange: (next: ModePref) => void;
}

const OPTIONS: { id: ModePref; label: string; icon: IconName }[] = [
  { id: "light", label: "Light", icon: "ph:sun" },
  { id: "dark", label: "Dark", icon: "ph:moon" },
  { id: "system", label: "System", icon: "ph:circle-half-tilt" },
];

export function ModeToggle({ value, onChange }: ModeToggleProps) {
  return (
    <div
      role="group"
      aria-label="Color mode"
      className="inline-flex items-center gap-0.5 rounded-[var(--radius-control)] border border-[var(--border-hairline)] bg-[var(--bg-base)] p-0.5"
    >
      {OPTIONS.map((opt) => {
        const active = value === opt.id;
        return (
          <Button
            key={opt.id}
            variant="ghost"
            size="sm"
            aria-pressed={active}
            onClick={() => onChange(opt.id)}
            leadingIcon={opt.icon}
            className={`mode-toggle__option gap-1.5 px-3 text-[12px] font-medium transition-colors ${
              active
                ? "bg-[var(--bg-raised)] text-[var(--text-primary)]"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
          >
            {opt.label}
          </Button>
        );
      })}
    </div>
  );
}
