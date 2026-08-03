import type { ReactNode } from "react";
import { settingsGroupId } from "@/lib/settings-group-id";

export { settingsGroupId };

export type SettingsGroupVariant = "card" | "ruled";

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
  variant = "card",
  meta,
  action,
  panel = variant === "card",
}: {
  label: string;
  description?: string;
  children: ReactNode;
  variant?: SettingsGroupVariant;
  meta?: ReactNode;
  action?: ReactNode;
  panel?: boolean;
}) {
  const ruled = variant === "ruled";
  return (
    <div
      id={settingsGroupId(label)}
      data-settings-group
      tabIndex={-1}
      role="group"
      aria-label={label}
      className={`scroll-mt-4 settings-group focus-ring${ruled ? " settings-group--ruled" : ""}`}
    >
      {ruled ? (
        <>
          <div className="settings-group__rule">
            <p className="settings-group__rule-label">{label}</p>
            {meta ? <span className="settings-group__rule-meta">{meta}</span> : null}
            <span className="settings-group__rule-line" aria-hidden="true" />
            {action ? <div className="settings-group__rule-action">{action}</div> : null}
          </div>
          {description ? <p className="settings-group__rule-description">{description}</p> : null}
        </>
      ) : (
        <>
          <p
            className={`text-[length:var(--text-2xs)] font-semibold uppercase tracking-widest text-[var(--text-muted)] ${
              description ? "mb-1" : "mb-2"
            }`}
          >
            {label}
          </p>
          {description ? (
            <p className="mb-2 text-[length:var(--text-xs)] text-[var(--text-muted)]">
              {description}
            </p>
          ) : null}
        </>
      )}
      <div
        className={
          ruled
            ? `settings-group__body${panel ? " settings-group__body--panel" : ""}`
            : "divide-y divide-[var(--border-hairline)] rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-raised)] overflow-hidden"
        }
      >
        {children}
      </div>
    </div>
  );
}
