import type { ReactNode } from "react";

/**
 * A labeled settings group: an uppercase caption over a boxed, divided list of
 * rows. Shared by the settings sections (Mode, Theme, …) and FontSettings so the
 * whole Appearance page reads as one consistent set of groups rather than mixing
 * boxed groups with bare headings. Pass `description` for a sub-caption.
 */
export function SettingsGroup({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <p
        className={`text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)] ${
          description ? "mb-1" : "mb-2"
        }`}
      >
        {label}
      </p>
      {description ? <p className="mb-2 text-[11px] text-[var(--text-muted)]">{description}</p> : null}
      <div className="divide-y divide-[var(--border-hairline)] rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-raised)] overflow-hidden">
        {children}
      </div>
    </div>
  );
}
