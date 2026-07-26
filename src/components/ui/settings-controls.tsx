import type { ReactNode } from "react";

/**
 * SettingControlRow — the canonical "label on the left, control on the right"
 * settings row. Every toggle-style preference uses this so the whole settings
 * surface reads as one consistent rhythm instead of bespoke flex blocks. Wraps
 * to a stacked layout on narrow widths so the control never collides with a long
 * label.
 */
export function SettingControlRow({
  label,
  hint,
  children,
  className = "",
}: {
  label: ReactNode;
  hint?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3 ${className}`}
    >
      <div className="min-w-0">
        <div className="text-[length:var(--text-sm)] font-medium text-[var(--text-secondary)]">{label}</div>
        {hint ? <div className="text-[length:var(--text-xs)] text-[var(--text-muted)]">{hint}</div> : null}
      </div>
      {children}
    </div>
  );
}

/**
 * Segmented — a compact single-select pill track (segmented control). The shared
 * shape for the many "pick one of N" settings (corner radius, switcher style,
 * reading controls, …) so they all sit in the same bordered track with the same
 * active treatment.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  getLabel,
  getTitle,
  ariaLabel,
  equalWidth = false,
}: {
  options: readonly T[];
  value: T;
  onChange: (next: T) => void;
  getLabel: (option: T) => string;
  /** Optional per-option tooltip explaining what picking it does. */
  getTitle?: (option: T) => string;
  ariaLabel: string;
  /** Force every segment to the same min width (good for short numeric labels). */
  equalWidth?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="flex w-fit shrink-0 rounded-[var(--radius-control)] border border-[var(--border-hairline)] bg-[var(--bg-base)] p-0.5"
    >
      {options.map((option) => {
        const active = value === option;
        return (
          <button
            key={option}
            type="button"
            aria-pressed={active}
            aria-label={`${ariaLabel}: ${getLabel(option)}`}
            title={getTitle?.(option)}
            onClick={() => onChange(option)}
            className={`focus-ring rounded-[var(--radius-control)] px-2.5 py-1.5 text-[length:var(--text-xs)] font-medium transition-colors ${
              equalWidth ? "min-w-12 text-center" : ""
            } ${
              active
                ? "bg-[var(--accent-presence)] text-[var(--accent-presence-foreground)]"
                : "text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
            }`}
          >
            {getLabel(option)}
          </button>
        );
      })}
    </div>
  );
}
