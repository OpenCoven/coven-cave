"use client";

import { SettingsOverview } from "./settings-overview";
import { type Section } from "./settings-sections";

// ─── Primitives ───────────────────────────────────────────────────────────────

export function SettingsPage({
  title,
  description,
  section,
  variant = "default",
  children,
}: {
  title: string;
  description?: string;
  section?: Section;
  variant?: "default" | "control-sheet";
  children: React.ReactNode;
}) {
  const pageTitleId = section ? `settings-${section}-title` : "settings-page-title";

  if (variant === "control-sheet") {
    return (
      <section className="settings-general" aria-labelledby={pageTitleId}>
        <h2 id={pageTitleId} className="sr-only">{title}</h2>
        {section ? (
          <SettingsOverview section={section} variant="control-sheet" />
        ) : (
          <div>
            <p className="text-[length:var(--text-xl)] font-semibold text-[var(--text-primary)]">{title}</p>
            {description && <p className="mt-1 text-[length:var(--text-sm)] text-[var(--text-muted)]">{description}</p>}
          </div>
        )}
        {children}
      </section>
    );
  }

  return (
    <section className="max-w-none space-y-6" aria-labelledby={pageTitleId}>
      <h2 id={pageTitleId} className="sr-only">{title}</h2>
      {section ? (
        <SettingsOverview section={section} />
      ) : (
        <div>
          <p className="text-[length:var(--text-xl)] font-semibold text-[var(--text-primary)]">{title}</p>
          {description && <p className="mt-1 text-[length:var(--text-sm)] text-[var(--text-muted)]">{description}</p>}
        </div>
      )}
      {children}
    </section>
  );
}


export function SettingsRow({
  label,
  description,
  descriptionId,
  comingSoon,
  variant = "default",
  children,
}: {
  label: string;
  description?: string;
  descriptionId?: string;
  comingSoon?: boolean;
  variant?: "default" | "sheet";
  children?: React.ReactNode;
}) {
  return (
    <div
      className={
        variant === "sheet"
          ? `settings-row settings-row--sheet${comingSoon ? " is-dimmed" : ""}`
          : `flex items-center justify-between gap-4 px-4 py-3 ${comingSoon ? "opacity-50" : ""}`
      }
    >
      <div className="min-w-0">
        <p className="text-[length:var(--text-base)] text-[var(--text-primary)]">{label}</p>
        {description ? (
          <p
            id={descriptionId}
            className="text-[length:var(--text-xs)] text-[var(--text-muted)]"
          >
            {description}
          </p>
        ) : null}
      </div>
      {comingSoon ? (
        <span className="shrink-0 rounded-full bg-[var(--bg-raised)] px-2 py-0.5 text-[length:var(--text-2xs)] text-[var(--text-muted)]">Soon</span>
      ) : children}
    </div>
  );
}
